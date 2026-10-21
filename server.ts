import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPTransport } from '@hono/mcp';
import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { randomUUID } from 'crypto';
import type { PaperBridge } from './bridge';
import type { MCPServerConfig } from '@paper/models/src/mcp/mcp-types';
import pkg from '../../package.json';
import type { InitMcpServerOptions } from '.';
import { TokenStore } from '../auth/auth-through-mcp';

const MCP_PORT = 29979;
const MCP_ENDPOINT = '/mcp';

export interface McpServerInstance {
  httpServer: ServerType;
}

/**
 * Creates a new MCP Server instance that proxies all tool knowledge to the client bundle.
 * Tool definitions and instructions are fetched from the client via the bridge.
 */
async function createServerInstance(bridge: PaperBridge, sessionId: string, config: MCPServerConfig): Promise<Server> {
  const server = new Server(
    {
      name: 'paper-desktop',
      version: pkg.version,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: config.instructions,
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: config.tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await bridge.call('handleToolCall', sessionId, name, args ?? {});
    } catch (e) {
      return {
        content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
        isError: true as const,
      };
    }
  });

  return server;
}

interface Session {
  server: Server;
  transport: StreamableHTTPTransport;
}

/**
 * Creates and starts the MCP HTTP server with Streamable HTTP transport.
 * Supports multiple concurrent agent sessions (e.g. Cursor + Claude Code).
 */
export function createMcpServer(bridge: PaperBridge, options: InitMcpServerOptions): McpServerInstance {
  const app = new Hono();

  // Log to both main process and renderer (visible in client dev tools)
  const log = (message: string) => {
    console.log(message);
    bridge.call('mcpLog', message).catch(() => {});
  };
  const warn = (message: string) => {
    console.warn(message);
    bridge.call('mcpLog', message, 'warn').catch(() => {});
  };

  // Session state — supports multiple concurrent sessions
  const sessions = new Map<string, Session>();

  const cleanupSession = async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;

    log(`[mcp-server] Cleaning up session: ${sessionId}`);

    // Remove agent from file data
    await bridge.call('removeAgent', sessionId).catch((err) => {
      warn(`[mcp-server] removeAgent failed for ${sessionId}: ${err}`);
    });

    // Detach onclose before closing transport so it doesn't double-fire removeAgent
    session.transport.onclose = undefined;
    await session.transport.close().catch(() => {});
    await session.server.close().catch(() => {});

    sessions.delete(sessionId);
  };

  /**
   * Bearer-token middleware for headless mode. The first valid token locks the process to
   * a single Paper user; later requests must present a token that hashes to the same value.
   * Skipped entirely in the UI build.
   */
  if (options.headless) {
    app.use(MCP_ENDPOINT, async (c, next) => {
      // Don't gate DELETE (session termination) — these arrive at shutdown and rejecting them
      // would leak server-side session state.
      if (c.req.method === 'DELETE') {
        return next();
      }

      // NOTE: do NOT use `error` / `error_description` field names — Claude Code's MCP SDK
      // interprets that shape as an OAuth challenge and starts a discovery probe that fails
      // against this non-OAuth server. Use neutral field names instead.
      const unauthorized = (message: string) => c.json({ status: 'unauthorized', message }, 401);

      const authHeader = c.req.header('Authorization') ?? '';
      if (!authHeader.startsWith('Bearer ')) {
        return unauthorized('Missing bearer token');
      }

      const authToken = authHeader.slice('Bearer '.length).trim();
      if (!authToken) {
        return unauthorized('Empty bearer token');
      }

      if (TokenStore.matches(authToken)) {
        // Already authenticated.
        return next();
      }

      const result = await TokenStore.set(authToken);

      if (!result.ok) {
        warn(`[mcp-server] ${result.reason}`);
        return unauthorized(result.reason);
      }

      if (result.state === 'initial') {
        await options.onFirstTokenReceived();
      }

      return next();
    });
  }

  /**
   * Security middleware to block browser requests.
   * - Rejects CORS preflight OPTIONS requests
   * - Rejects requests with Origin header (browsers send this, MCP clients don't)
   * - Validates Host header to prevent DNS rebinding attacks
   */
  app.use(MCP_ENDPOINT, async (c, next) => {
    // Block CORS preflight requests
    if (c.req.method === 'OPTIONS') {
      warn('[mcp-server] Blocked CORS preflight request');
      return c.body(null, 403);
    }

    // Block requests with Origin header (browser cross-origin requests)
    const origin = c.req.header('origin');
    if (origin) {
      warn(`[mcp-server] Blocked browser request from origin: ${origin}`);
      return c.json({ error: 'forbidden', error_description: 'Browser requests not allowed' }, 403);
    }

    // Validate Host header to prevent DNS rebinding
    const host = c.req.header('host');
    const allowedHosts = [`127.0.0.1:${MCP_PORT}`, `localhost:${MCP_PORT}`];
    if (host && !allowedHosts.includes(host)) {
      warn(`[mcp-server] Blocked DNS rebinding attempt with host: ${host}`);
      return c.json({ error: 'forbidden', error_description: 'Invalid host' }, 403);
    }

    await next();
  });

  // Ensure the Accept header required by the Streamable HTTP spec is present.
  // Some MCP clients (e.g. Claude Code) omit it, causing @hono/mcp to return
  // 406 which the client then misinterprets as an auth failure.
  // See: https://github.com/anthropics/claude-code/issues/42470
  app.use(MCP_ENDPOINT, async (c, next) => {
    const accept = c.req.header('Accept') ?? '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
      c.req.raw = new Request(c.req.raw, {
        headers: new Headers([
          ...Array.from(c.req.raw.headers.entries()),
          ['Accept', 'application/json, text/event-stream'],
        ]),
      });
    }
    await next();
  });

  // Handle all MCP requests (POST, GET for SSE, DELETE for session termination)
  app.all(MCP_ENDPOINT, async (c) => {
    try {
      const sessionId = c.req.header('mcp-session-id');

      // Handle DELETE requests (session termination)
      if (c.req.method === 'DELETE') {
        if (sessionId && sessions.has(sessionId)) {
          log(`[mcp-server] DELETE received for session: ${sessionId}`);
          await cleanupSession(sessionId);
        }
        return c.body(null, 202);
      }

      // Handle GET requests (SSE stream) - requires existing session
      if (c.req.method === 'GET') {
        const session = sessionId ? sessions.get(sessionId) : undefined;
        if (!session) {
          return c.json({ error: 'not_found', error_description: 'Session not found' }, 404);
        }
        c.header('mcp-session-id', sessionId!);
        return session.transport.handleRequest(c);
      }

      // Handle POST requests
      if (c.req.method === 'POST') {
        const agentId = sessionId ?? randomUUID();

        // Create session on demand — handles both first contact and resurrection
        // after a server restart. We omit sessionIdGenerator so the transport
        // skips its #initialized gate, allowing any request (not just initialize)
        // to be processed immediately.
        if (!sessions.has(agentId)) {
          const config = await bridge.call('getMCPServerConfig');
          const server = await createServerInstance(bridge, agentId, config);
          const transport = new StreamableHTTPTransport({});

          sessions.set(agentId, { server, transport });

          log(`[mcp-server] New session: ${agentId} (${sessions.size} active)`);

          transport.onclose = () => {
            log(`[mcp-server] Transport onclose fired for session: ${agentId}`);
            bridge.call('removeAgent', agentId).catch(() => {});
            sessions.delete(agentId);
          };

          await server.connect(transport);
        }

        // Set session ID header ourselves since the transport won't (no generator)
        c.header('mcp-session-id', agentId);
        return sessions.get(agentId)!.transport.handleRequest(c);
      }

      // Unknown method
      return c.json({ error: 'method_not_allowed', error_description: 'Method not allowed' }, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`[mcp-server] Error handling request: ${message}`);
      return c.json({ error: 'server_error', error_description: message }, 500);
    }
  });

  // Explicitly handle OAuth/OIDC discovery endpoints. Claude Code probes
  // these when any connection attempt fails and misinterprets structured
  // responses as "this server does OAuth". Returning a minimal 404 with no
  // OAuth-shaped fields prevents that misclassification.
  app.get('/.well-known/oauth-authorization-server', (c) => c.body(null, 404));
  app.get('/.well-known/openid-configuration', (c) => c.body(null, 404));
  app.get('/.well-known/oauth-protected-resource', (c) => c.body(null, 404));

  // For all other unmatched routes, return a JSON hint without using
  // OAuth-style field names (error / error_description) that Claude Code's
  // OAuth client could latch onto.
  app.notFound((c) =>
    c.json(
      {
        status: 'not_found',
        message: `Route not found. The MCP endpoint is ${MCP_ENDPOINT}. Try restarting your agent and Paper.`,
      },
      404
    )
  );

  // Start HTTP server bound to localhost only (security)
  const httpServer = serve({
    fetch: app.fetch,
    port: MCP_PORT,
    hostname: '127.0.0.1',
  });

  log(`[mcp-server] Paper MCP server listening on http://127.0.0.1:${MCP_PORT}${MCP_ENDPOINT}`);

  return { httpServer };
}
