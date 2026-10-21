#!/usr/bin/env node
// ============================================================
// spine-mcp — the execution layer for the Spine 2D Power.
//
// Transport is stdio only: the server opens no network port, so there is no
// listening surface to authenticate. It is launched as a child process by
// the MCP client and speaks JSON-RPC over stdin/stdout.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { SpineHost, createNodeHost } from './host';
import { ToolDependencies, registerAllTools } from './tools';

export const SERVER_NAME = 'spine-mcp';
export const SERVER_VERSION = '0.1.0';

/** Build a fully wired server instance. Exported for in-process tests. */
export function createServer(
  host: SpineHost = createNodeHost(),
  dependencies: ToolDependencies = {},
): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: [
        'Execution layer for Spine 2D automation.',
        'Spine has no in-editor API: this server drives the Spine command-line interface in a separate process and operates on exported skeleton/atlas data.',
        'It cannot manipulate an open Spine editor window.',
        'Call spine_env_probe first — the Spine trial blocks saving, texture packing and all exports, and write tools are gated on that result.',
      ].join(' '),
    },
  );
  registerAllTools(server, host, dependencies);
  return server;
}

/** Entry point used when the server is launched as a process. */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// `require.main === module` is the CommonJS equivalent of "run directly".
if (require.main === module) {
  main().catch((cause: unknown) => {
    // stderr is safe: stdout carries the JSON-RPC stream.
    process.stderr.write(
      `spine-mcp failed to start: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exit(1);
  });
}
