import type { PaperWebContents } from '../window/types';
import type { MCPBridgeContract } from '@paper/models/src/mcp/mcp-types';
import { parseFileIdFromString } from '@paper/models/src/file/parse-file-id';
import type { PaperTabbedWindow } from '../window/paper-window';

/**
 * Bridge for communicating with the Paper editor in the renderer process.
 * Uses Electron's webContents.executeJavaScript to call methods
 * on window.mcpHandlers exposed by the renderer.
 */
export interface PaperBridge {
  call<K extends keyof MCPBridgeContract>(
    method: K,
    ...args: Parameters<MCPBridgeContract[K]>
  ): Promise<Awaited<ReturnType<MCPBridgeContract[K]>>>;
}

/**
 * The window and tab and file the agent is currently working in.
 * File id will be defined when the binding committed to a file — either by latching onto a
 * file tab or by the agent explicitly opening a file via the open_file tool.
 *
 * Stores the window id rather than the PaperWindow itself so a stale binding (an agent that
 * disappears without removeAgent) can't pin a closed window's object graph in memory.
 */
type SessionBinding = { windowId: number; fileId?: string; tabId: string };
type ResolvedSessionBinding = { window: PaperTabbedWindow; fileId?: string; tabId: string };

/** The one tool whose fileId re-homes the agent's sticky session (defined in the client's mcp-tool-registry). */
const OPEN_FILE_TOOL = 'open_file';

/**
 * Creates a bridge instance that communicates with the Paper editor.
 *
 * For file based tool calls they are routed to either the last tab the
 * agent was working on or an exact tab if a file id is provided with the tool call.
 * A file id passed to the open_file tool re-homes the agent's sticky session to that file;
 * on any other tool an explicit file id routes only that call and leaves the session untouched.
 *
 * When a file id is provided, `getWindowWithFile` lets the bridge route to whichever window
 * already has that file open (across all windows) rather than duplicating it into the active one.
 *
 * Throws when the window or mcpHandlers aren't available.
 */
export interface CreateBridgeOptions {
  getTargetWindow: () => PaperTabbedWindow | null;
  /**
   * Locate a window that already has a given file open, so file-targeted calls route to it across
   * windows.
   */
  getWindowWithFile: (fileId: string) => PaperTabbedWindow | null;
  /**
   * Resolve a session binding's stored window id to a live window.
   */
  getWindowById: (windowId: number) => PaperTabbedWindow | null;
}

export function createBridge({ getTargetWindow, getWindowWithFile, getWindowById }: CreateBridgeOptions): PaperBridge {
  const sessionBindings = new Map<string, SessionBinding>();

  const getAgentSessionBinding = (agentId: string): ResolvedSessionBinding | null => {
    const binding = sessionBindings.get(agentId);
    if (!binding) {
      return null;
    }

    const boundWindow = getWindowById(binding.windowId);

    if (!boundWindow || boundWindow.window.isDestroyed()) {
      // The agent's window closed. A committed (fileId) binding is still meaningful — the file may be
      // open in another window, or we can revive it — so re-home the binding onto a live window rather
      // than dropping it and letting the next fileId-less call latch onto whatever tab is now active.
      if (binding.fileId) {
        const rehomedWindow = getWindowWithFile(binding.fileId) ?? getTargetWindow();
        if (rehomedWindow && !rehomedWindow.window.isDestroyed()) {
          // The stale tabId points into the closed window; resolveSessionWebContents re-runs the sticky
          // openTab against the re-homed window and refreshes it.
          sessionBindings.set(agentId, {
            windowId: rehomedWindow.window.id,
            tabId: binding.tabId,
            fileId: binding.fileId,
          });
          return { window: rehomedWindow, tabId: binding.tabId, fileId: binding.fileId };
        }
      }

      sessionBindings.delete(agentId);
      return null;
    }

    if (boundWindow.hasTab(binding.tabId)) {
      // Bound tab still exists (possibly dormant/unloaded) — keep the binding. Routing wakes it: a
      // committed binding via openTab(fileId), a provisional one re-latches to the active tab.
      return { window: boundWindow, tabId: binding.tabId, fileId: binding.fileId };
    }

    // The bound tab was closed (removed from the strip). A committed (fileId) binding still knows which
    // file to reopen, so keep it — resolveSessionWebContents re-runs the sticky openTab and revives the
    // file in a fresh tab.
    if (binding.fileId) {
      return { window: boundWindow, tabId: binding.tabId, fileId: binding.fileId };
    }

    sessionBindings.delete(agentId);
    return null;
  };

  /**
   * Resolve a specific tab's web contents, or throw. Used for file-targeted routing where a tab was
   * just opened/deduped: falling back to the window's active tab would silently run the call (often a
   * write) against whatever the user is currently viewing, so surface an error instead of misrouting.
   */
  const assertTabAlive = (targetWin: PaperTabbedWindow, tabId: string): PaperWebContents => {
    const wc = targetWin.getWebContentsForTab(tabId);
    if (!wc) {
      throw new Error('Could not find Paper. Is it running?');
    }
    return wc;
  };

  /**
   * Resolve the web contents an agent's tool call should run in.
   */
  const resolveSessionWebContents = (
    win: PaperTabbedWindow,
    agentId: string | null,
    toolName: string,
    toolArgs: unknown
  ): PaperWebContents | null => {
    const rawFileId = (toolArgs as Record<string, unknown> | undefined)?.['fileId'];
    const explicitFileId = parseFileIdFromString(rawFileId);

    // A provided-but-invalid fileId must fail loudly. Treating it as absent would silently route the
    // call (often a write) to the sticky session or active tab — a different file than the agent asked for.
    if (rawFileId != null && !explicitFileId) {
      throw new Error(
        `Invalid fileId "${String(rawFileId)}". Expected a Paper file id, /file/<id> route, or file URL.`
      );
    }

    if (!agentId) {
      // No session id (tests/mocks) — no stickiness. Still honor an explicit fileId so calls route.
      if (explicitFileId) {
        // Route to whichever window already has the file, else open it in the active window.
        const targetWin = getWindowWithFile(explicitFileId) ?? win;
        const tabId = targetWin.ensureTab(`/file/${explicitFileId}`);
        return assertTabAlive(targetWin, tabId);
      }

      return win.activeWebContents;
    }

    const binding = getAgentSessionBinding(agentId);

    if (explicitFileId) {
      // Prefer a window that already has the file open (in any window), then the agent's bound
      // window, then the active window. The chosen window's openTab dedups within itself.
      const targetWin = getWindowWithFile(explicitFileId) ?? binding?.window ?? win;
      const tabId = targetWin.ensureTab(`/file/${explicitFileId}`);

      if (toolName === OPEN_FILE_TOOL) {
        // Explicitly opening a file makes it the agent's new home. Any other tool's fileId is a
        // one-off routing hint: the sticky session is left untouched so the agent isn't dragged
        // along by a quick look at another file.
        sessionBindings.set(agentId, { windowId: targetWin.window.id, tabId, fileId: explicitFileId });
      }

      return assertTabAlive(targetWin, tabId);
    }

    if (binding) {
      if (binding.fileId) {
        // Committed to a file — reopen/dedup its tab and stay there regardless of the active tab. This
        // also revives the file if the user had closed its tab (the binding survived via its fileId).
        // Refresh the stored tabId so the binding tracks the live tab again (removeAgent relies on it).
        const tabId = binding.window.ensureTab(`/file/${binding.fileId}`);
        sessionBindings.set(agentId, { windowId: binding.window.window.id, tabId, fileId: binding.fileId });
        return assertTabAlive(binding.window, tabId);
      }

      // Provisional binding: the agent latched onto a non-file tab (e.g. Home) before any file was in
      // play, so it hasn't committed to a file yet. The bound window is only a guide — follow the
      // focused window's active tab, and the moment that's a file (the user opened one and told the
      // agent to work on it) lock onto that file, wherever it lives.
      return resolveActiveTabBinding(agentId, win);
    }

    // First call with no fileId — latch onto the window's active tab. If it's a file tab we commit to
    // the file (sticky like an explicit-fileId binding); if it's Home the binding stays provisional.
    return resolveActiveTabBinding(agentId, win);
  };

  /**
   * Bind the agent to the window's currently active tab and route there. When that tab is a file we
   * capture the file id so the binding becomes sticky to the file; otherwise it stays provisional and
   * will re-resolve against the active tab on the next fileId-less call.
   */
  const resolveActiveTabBinding = (agentId: string, win: PaperTabbedWindow): PaperWebContents | null => {
    const tabId = win.activeTabId;
    const fileId = win.getFileIdForTab(tabId) ?? undefined;
    sessionBindings.set(agentId, { windowId: win.window.id, tabId, fileId });
    return win.getWebContentsForTab(tabId) ?? win.activeWebContents;
  };

  const resolveWebContents = (win: PaperTabbedWindow, method: string, args: unknown[]): PaperWebContents | null => {
    if (method === 'handleToolCall') {
      const [agentId, toolName, toolArgs] = args as [string | null, string, Record<string, unknown>];
      return resolveSessionWebContents(win, agentId, toolName, toolArgs);
    }

    if (method === 'removeAgent') {
      const [agentId] = args as [string];
      if (typeof agentId === 'string') {
        const binding = getAgentSessionBinding(agentId);
        if (binding) {
          // getAgentSessionBinding may now return a committed binding whose tab was closed (kept alive
          // by its fileId). Only clean up a *live* tab — never fall back to the active tab, or we'd
          // un-throttle whatever the user is viewing. A dead tabId yields null → binding is dropped.
          return binding.window.getWebContentsForTab(binding.tabId);
        }
      }

      // The agent's tab is already gone — there's nothing to clean up in a renderer. Return null so
      // we don't run removeAgent against (and un-throttle) whatever tab the user is currently viewing.
      return null;
    }

    return win.activeWebContents;
  };

  const waitForMCPHandlers = async (wc: PaperWebContents) => {
    const timeoutMs = 10_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (wc.isDestroyed()) {
        throw new Error('Could not find Paper. Is it running?');
      }

      const ready = await wc.executeJavaScript(`typeof window.resolveMCPHandlers !== 'undefined'`);
      if (ready) {
        return;
      }

      await new Promise((r) => setTimeout(r, 50));
    }

    throw new Error('Could not find Paper. Is it running?');
  };

  return {
    async call(method, ...args) {
      const win = getTargetWindow();
      if (!win) {
        throw new Error('Could not find Paper. Is it running?');
      }

      const wc = resolveWebContents(win, method, args);

      if (!wc) {
        // No live tab to run against (e.g. removeAgent after its tab was closed). The binding was
        // already dropped while resolving, so there's nothing left to do.
        if (method === 'removeAgent') {
          const [agentId] = args as [string];
          if (agentId) {
            sessionBindings.delete(agentId);
          }
        }

        // removeAgent returns void; nothing to hand back.
        return undefined as never;
      }

      // Hold background throttling off so canvas captures and timers aren't deferred on this
      // (often hidden) agent tab. Nested with window/tab holds via a shared refcount.
      const releaseThrottling = win.disableBackgroundThrottling(wc);

      try {
        await waitForMCPHandlers(wc);

        const argsJson = args.map((a) => JSON.stringify(a) ?? 'undefined').join(', ');

        const result = await wc.executeJavaScript(`
          (async () => {
            const handlers = await window.resolveMCPHandlers;
            if (typeof handlers == 'undefined') {
              return 'handlers_not_found';
            }

            if (typeof handlers.${method} !== 'function') {
              return 'method_not_found';
            }

            return handlers.${method}(${argsJson});
          })()
        `);

        if (result === 'handlers_not_found') {
          throw new Error('Could not find Paper. Is it running?');
        }

        if (result === 'method_not_found') {
          throw new Error(`Tool call "${method}" does not exist.`);
        }

        return result;
      } finally {
        releaseThrottling();

        // A finished session no longer needs its binding.
        if (method === 'removeAgent') {
          const [agentId] = args as [string];
          if (agentId) {
            sessionBindings.delete(agentId);
          }
        }
      }
    },
  };
}
