import type { PaperTabbedWindow } from '../window/paper-window';
import { createBridge } from './bridge';
import { createMcpServer, type McpServerInstance } from './server';

export interface McpModule {
  /** Clean up resources when the app quits */
  cleanup: () => void;
}

type CommonMcpServerOptions = {
  getTargetWindow: () => PaperTabbedWindow | null;
  /** Locate a window that already has a given file open, so file-targeted calls route to it. */
  getWindowWithFile: (fileId: string) => PaperTabbedWindow | null;
  /** Resolve a session binding's stored window id to a live window. */
  getWindowById: (windowId: number) => PaperTabbedWindow | null;
};

export type InitMcpServerOptions =
  | (CommonMcpServerOptions & {
      headless?: never;
    })
  | (CommonMcpServerOptions & {
      onFirstTokenReceived: () => Promise<void> | void;
      headless: true;
    });

/**
 * Initialize the MCP server module.
 */
export function initMcpServer(options: InitMcpServerOptions): McpModule {
  // Create the bridge for communicating with the renderer
  const bridge = createBridge({
    getTargetWindow: options.getTargetWindow,
    getWindowWithFile: options.getWindowWithFile,
    getWindowById: options.getWindowById,
  });

  // Create and start the MCP server
  const { httpServer }: McpServerInstance = createMcpServer(bridge, options);

  return {
    cleanup: () => {
      console.log('[mcp-server] Shutting down MCP server...');
      httpServer.close();
    },
  };
}
