// ============================================================
// Tool registration entry point.
//
// Tools are grouped the same way the Power documents them:
//   A. CLI orchestration   B. data layer
//   C. generation          D. verification        E. integration
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SpineHost } from '../host';
import { SpawnFn, createNodeSpawn } from '../cli-runner';
import { BrowserLauncher, createPlaywrightLauncher } from '../preview-renderer';
import { SidecarRunner, createUvSidecarRunner } from '../sidecar';
import { registerEnvTools } from './env-tools';
import { registerCliTools } from './cli-tools';
import { registerExportTools } from './export-tools';
import { registerDataTools, registerDiffTools } from './data-tools';
import { registerLintTools } from './lint-tools';
import { registerSettingsTools } from './settings-tools';
import { registerGenerateTools } from './generate-tools';
import { registerPreviewTools } from './preview-tools';
import { registerRegressionTools } from './regression-tools';
import { registerDocTools } from './doc-tools';
import { registerAnimateTools } from './animate-tools';
import { registerScaffoldTools } from './scaffold-tools';

/** Collaborators the tool layer needs, all injectable for tests. */
export interface ToolDependencies {
  spawn?: SpawnFn;
  launcher?: BrowserLauncher;
  sidecar?: SidecarRunner;
}

/** Register every tool this server exposes. */
export function registerAllTools(
  server: McpServer,
  host: SpineHost,
  dependencies: ToolDependencies = {},
): void {
  const spawn = dependencies.spawn ?? createNodeSpawn();
  const launcher = dependencies.launcher ?? createPlaywrightLauncher();
  const sidecar = dependencies.sidecar ?? createUvSidecarRunner(host);

  // Group A — CLI orchestration
  registerEnvTools(server, host, sidecar);
  registerCliTools(server, host, spawn);
  registerExportTools(server, host, spawn);

  // Group B — data layer
  registerDataTools(server, host);
  registerDiffTools(server, host);
  registerLintTools(server, host);
  registerSettingsTools(server, host);

  // Group C — generation
  registerGenerateTools(server, host, sidecar);
  registerAnimateTools(server, host);

  // Group D — verification
  registerPreviewTools(server, host, launcher);
  registerRegressionTools(server, host, launcher);
  registerDocTools(server, host, launcher);

  // Group E — integration
  registerScaffoldTools(server, host);
}

export {
  registerEnvTools,
  registerCliTools,
  registerExportTools,
  registerDataTools,
  registerDiffTools,
  registerLintTools,
  registerSettingsTools,
  registerGenerateTools,
  registerPreviewTools,
  registerRegressionTools,
  registerDocTools,
  registerAnimateTools,
  registerScaffoldTools,
};
