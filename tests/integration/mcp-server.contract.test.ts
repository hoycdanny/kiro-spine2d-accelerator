/**
 * Contract tests for the MCP server: tool discovery, input schema
 * validation, and the shape of success and failure results. The client and
 * server are linked in-process, so no child process or port is involved,
 * and every collaborator (CLI, browser, Python sidecar) is stubbed.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { SERVER_NAME, SERVER_VERSION, createServer } from '../../src/server';
import { SpineHost } from '../../src/host';
import { SIDECAR_PROTOCOL_VERSION, SidecarRunner } from '../../src/sidecar';
import { SpineErrorCode } from '../../src/types';
import { TRIAL_EXECUTABLE, createFakeHost } from '../helpers/fake-host';

/** A sidecar stub, so the contract tests never start a Python process. */
const stubSidecar: SidecarRunner = async () => ({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    data: {
      protocolVersion: SIDECAR_PROTOCOL_VERSION,
      python: '3.12.10',
      dependencies: { 'psd-tools': '1.10.7' },
      missing: [],
      ready: true,
    },
  }),
  stderr: '',
  timedOut: false,
});

/** A browser stub, so no Chromium is launched. */
const stubLauncher = async () => ({
  newPage: async () => ({
    setContent: async () => {},
    on: () => {},
    evaluate: async () => ({
      frames: [],
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      animations: [],
      skins: [],
      warnings: [],
      spineVersion: null,
    }),
  }),
  close: async () => {},
});

async function connect(host: SpineHost): Promise<Client> {
  const server = createServer(host, {
    sidecar: stubSidecar,
    launcher: stubLauncher as never,
    spawn: async () => ({
      code: 0,
      stdout: 'Spine Launcher 4.2.37\nComplete.',
      stderr: '',
      timedOut: false,
      durationMs: 10,
    }),
  });
  const client = new Client({ name: 'contract-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

type TextBlock = { type: string; text: string };

function textOf(result: unknown): string {
  const blocks = (result as { content: TextBlock[] }).content;
  return blocks.map((block) => block.text).join('\n');
}

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent: Record<string, unknown> }).structuredContent;
}

/** Every tool the Power documents, by group. */
const EXPECTED_TOOLS = [
  // A — CLI orchestration
  'spine_env_probe',
  'spine_project_info',
  'spine_export',
  'spine_pack',
  'spine_unpack',
  'spine_import',
  'spine_cleanup',
  'spine_export_settings_capture',
  'spine_batch',
  // B — data layer
  'skeleton_inspect',
  'atlas_inspect',
  'skeleton_diff',
  'skeleton_lint',
  'export_settings_build',
  'pack_settings_build',
  // C — generation
  'psd_to_skeleton',
  // D — verification
  'render_preview',
  'visual_regression',
  // E — integration
  'runtime_scaffold',
];

describe('spine-mcp server contract', () => {
  it('reports its name and version', async () => {
    const client = await connect(createFakeHost());
    expect(client.getServerVersion()).toEqual({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    await client.close();
  });

  it('advertises every documented tool, and nothing else', async () => {
    const client = await connect(createFakeHost());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    await client.close();
  });

  it('gives every tool a description and an input schema', async () => {
    const client = await connect(createFakeHost());
    const { tools } = await client.listTools();

    const missing = tools
      .filter((tool) => !tool.description || tool.description.length < 80)
      .map((tool) => tool.name);
    expect(missing).toEqual([]);

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
    }
    await client.close();
  });

  it('marks read-only tools as such', async () => {
    const client = await connect(createFakeHost());
    const { tools } = await client.listTools();
    const readOnly = tools
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map((tool) => tool.name)
      .sort();

    expect(readOnly).toEqual([
      'atlas_inspect',
      'skeleton_diff',
      'skeleton_inspect',
      'skeleton_lint',
      'spine_env_probe',
      'spine_project_info',
    ]);
    await client.close();
  });

  it('marks the one destructive tool as destructive', async () => {
    const client = await connect(createFakeHost());
    const { tools } = await client.listTools();
    const destructive = tools
      .filter((tool) => tool.annotations?.destructiveHint === true)
      .map((tool) => tool.name);

    // Animation clean up rewrites the project file in place.
    expect(destructive).toEqual(['spine_cleanup']);
    await client.close();
  });

  it('documents the spine_env_probe inputs as all optional', async () => {
    const client = await connect(createFakeHost());
    const { tools } = await client.listTools();
    const probe = tools.find((tool) => tool.name === 'spine_env_probe')!;

    expect(probe.description).toContain('capability matrix');
    expect(probe.inputSchema.properties).toHaveProperty('executable');
    expect(probe.inputSchema.properties).toHaveProperty('userDataDir');
    expect(probe.inputSchema.properties).toHaveProperty('includeSidecar');
    expect(probe.inputSchema.required ?? []).toHaveLength(0);
    await client.close();
  });

  it('returns a summary block plus a JSON block on success', async () => {
    const client = await connect(createFakeHost({ edition: 'trial' }));
    const result = await client.callTool({ name: 'spine_env_probe', arguments: {} });

    expect(result.isError).toBeFalsy();
    const payload = structured(result);
    expect(payload['ok']).toBe(true);

    const data = payload['data'] as Record<string, unknown>;
    const spine = data['spine'] as Record<string, unknown>;
    expect(spine['edition']).toBe('trial');
    expect(spine['executable']).toBe(TRIAL_EXECUTABLE);
    expect(spine['runtimeBranch']).toBe('4.3');
    expect((spine['capabilities'] as Record<string, boolean>)['canExport']).toBe(false);

    const text = textOf(result);
    expect(text).toContain('Spine 4.3.26 (trial)');
    expect(text).toContain('Blocked by this edition');
    await client.close();
  });

  it('includes the Python sidecar state in the probe', async () => {
    const client = await connect(createFakeHost({ edition: 'trial' }));
    const result = await client.callTool({ name: 'spine_env_probe', arguments: {} });

    const data = structured(result)['data'] as Record<string, unknown>;
    expect(data['sidecar']).toMatchObject({ available: true });
    expect(textOf(result)).toContain('sidecar ready');
    await client.close();
  });

  it('can skip the sidecar probe', async () => {
    const client = await connect(createFakeHost({ edition: 'trial' }));
    const result = await client.callTool({
      name: 'spine_env_probe',
      arguments: { includeSidecar: false },
    });

    const data = structured(result)['data'] as Record<string, unknown>;
    expect(data['sidecar']).toBeNull();
    await client.close();
  });

  it('reports a licensed install as export-capable', async () => {
    const client = await connect(createFakeHost({ edition: 'licensed' }));
    const result = await client.callTool({ name: 'spine_env_probe', arguments: {} });
    const data = structured(result)['data'] as Record<string, unknown>;
    const spine = data['spine'] as Record<string, unknown>;

    expect(spine['edition']).toBe('licensed');
    expect((spine['capabilities'] as Record<string, boolean>)['canExport']).toBe(true);
    expect(spine['runtimeBranch']).toBe('4.2');
    expect(textOf(result)).not.toContain('Blocked by this edition');
    await client.close();
  });

  it('fails with SPINE_NOT_FOUND when nothing is installed', async () => {
    const client = await connect(createFakeHost({ edition: 'none' }));
    const result = await client.callTool({ name: 'spine_env_probe', arguments: {} });

    expect(result.isError).toBe(true);
    const payload = structured(result);
    expect(payload['ok']).toBe(false);
    expect(payload['code']).toBe(SpineErrorCode.SpineNotFound);
    expect(payload['hint']).toContain('.com console build');
    await client.close();
  });

  it('honours an explicit executable argument', async () => {
    const client = await connect(
      createFakeHost({ edition: 'none', paths: ['D:\\portable\\Spine.com'] }),
    );
    const result = await client.callTool({
      name: 'spine_env_probe',
      arguments: { executable: 'D:\\portable\\Spine.com', includeSidecar: false },
    });

    const data = structured(result)['data'] as Record<string, unknown>;
    const spine = data['spine'] as Record<string, unknown>;
    expect(spine['executable']).toBe('D:\\portable\\Spine.com');
    expect(spine['installDir']).toBe('D:\\portable');
    await client.close();
  });

  it('gates a write tool on the trial and shows the command it would run', async () => {
    const client = await connect(
      createFakeHost({
        edition: 'trial',
        paths: ['C:\\work\\project\\art\\hero.spine'],
      }),
    );
    const result = await client.callTool({
      name: 'spine_export',
      arguments: { input: 'art/hero.spine', exportSpec: 'binary' },
    });

    expect(result.isError).toBe(true);
    const payload = structured(result);
    expect(payload['code']).toBe(SpineErrorCode.CapabilityDenied);
    expect(JSON.stringify(payload['details'])).toContain('-e binary');
    await client.close();
  });

  it('rejects arguments of the wrong type', async () => {
    const client = await connect(createFakeHost());
    const result = await client.callTool({
      name: 'spine_env_probe',
      arguments: { executable: 42 },
    });

    // The SDK validates against the declared schema and answers with an
    // error result rather than throwing at the transport level.
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/executable|invalid|expected string/i);
    await client.close();
  });

  it('rejects unknown tool names', async () => {
    const client = await connect(createFakeHost());
    const result = await client.callTool({ name: 'spine_does_not_exist' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not found');
    await client.close();
  });
});
