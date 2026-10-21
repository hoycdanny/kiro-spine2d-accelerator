import {
  SIDECAR_PROTOCOL_VERSION,
  SidecarRunner,
  callSidecar,
  mapSidecarCode,
  probeSidecar,
} from '../../src/sidecar';
import { SpineErrorCode } from '../../src/types';

function runner(
  outcome: Partial<{
    stdout: string;
    stderr: string;
    code: number | null;
    timedOut: boolean;
    spawnError: string;
  }>,
  capture?: { request?: Record<string, unknown> },
): SidecarRunner {
  return async (request) => {
    if (capture) capture.request = request;
    return {
      code: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      ...outcome,
    };
  };
}

const READY_PROBE = JSON.stringify({
  ok: true,
  data: {
    protocolVersion: SIDECAR_PROTOCOL_VERSION,
    python: '3.12.10',
    dependencies: { 'psd-tools': '1.10.7', Pillow: '11.0.0', rectpack: '0.2.2' },
    missing: [],
    ready: true,
  },
});

describe('mapSidecarCode', () => {
  it('maps the documented codes', () => {
    expect(mapSidecarCode('INVALID_ARGUMENT')).toBe(SpineErrorCode.InvalidArgument);
    expect(mapSidecarCode('INPUT_MISSING')).toBe(SpineErrorCode.InputMissing);
    expect(mapSidecarCode('DEPENDENCY_MISSING')).toBe(SpineErrorCode.DependencyMissing);
    expect(mapSidecarCode('VALIDATION_FAILED')).toBe(SpineErrorCode.ValidationFailed);
    expect(mapSidecarCode('PARSE_FAILED')).toBe(SpineErrorCode.ParseFailed);
  });

  it('falls back to CLI_FAILED for anything else', () => {
    expect(mapSidecarCode('SIDECAR_FAILED')).toBe(SpineErrorCode.CliFailed);
  });
});

describe('callSidecar', () => {
  it('passes the request through and returns data', async () => {
    const capture: { request?: Record<string, unknown> } = {};
    const result = await callSidecar<{ ready: boolean }>(
      runner({ stdout: '{"ok":true,"data":{"ready":true}}' }, capture),
      { command: 'probe' },
    );

    expect(capture.request).toEqual({ command: 'probe' });
    expect(result.ok && result.data.ready).toBe(true);
  });

  it('ignores library chatter before the response line', async () => {
    const result = await callSidecar<{ value: number }>(
      runner({ stdout: 'UserWarning: something\n{"ok":true,"data":{"value":7}}\n' }),
      { command: 'probe' },
    );
    expect(result.ok && result.data.value).toBe(7);
  });

  it('maps a structured sidecar error', async () => {
    const result = await callSidecar(
      runner({
        stdout: JSON.stringify({
          ok: false,
          error: { code: 'INPUT_MISSING', message: 'PSD not found: x.psd', hint: 'Check the path.' },
        }),
        code: 2,
      }),
      { command: 'psd_to_skeleton' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InputMissing);
    expect(result.message).toContain('x.psd');
    expect(result.details?.['sidecarCode']).toBe('INPUT_MISSING');
  });

  it('includes stderr in the details of a failure', async () => {
    const result = await callSidecar(
      runner({
        stdout: JSON.stringify({
          ok: false,
          error: { code: 'SIDECAR_FAILED', message: 'boom', hint: 'report it' },
        }),
        stderr: 'Traceback (most recent call last): ...',
      }),
      { command: 'probe' },
    );
    expect(!result.ok && String(result.details?.['stderr'])).toContain('Traceback');
  });

  it('reports a spawn failure as a dependency problem', async () => {
    const result = await callSidecar(
      runner({ spawnError: 'spawn uv ENOENT' }),
      { command: 'probe' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.DependencyMissing);
    expect(result.hint).toContain('uv sync --project python');
  });

  it('reports a timeout with the duration', async () => {
    const result = await callSidecar(
      runner({ timedOut: true, code: null }),
      { command: 'probe' },
      30_000,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliTimeout);
    expect(result.message).toContain('30s');
  });

  it('reports empty output', async () => {
    const result = await callSidecar(runner({ stdout: '   ' }), { command: 'probe' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ParseFailed);
    expect(result.message).toContain('no output');
  });

  it('reports unparseable output', async () => {
    const result = await callSidecar(runner({ stdout: 'not json' }), { command: 'probe' });
    expect(!result.ok && result.code).toBe(SpineErrorCode.ParseFailed);
  });

  it('reports a non-object response', async () => {
    const result = await callSidecar(runner({ stdout: '42' }), { command: 'probe' });
    expect(!result.ok && result.message).toContain('not an object');
  });

  it('reports a failure without an error object', async () => {
    const result = await callSidecar(runner({ stdout: '{"ok":false}' }), {
      command: 'probe',
    });
    expect(!result.ok && result.message).toContain('without an error object');
  });
});

describe('probeSidecar', () => {
  it('reports a ready sidecar with its dependency versions', async () => {
    const result = await probeSidecar(runner({ stdout: READY_PROBE }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ready).toBe(true);
    expect(result.summary).toContain('Python 3.12.10');
    expect(result.summary).toContain('psd-tools 1.10.7');
  });

  it('rejects a protocol version it does not speak', async () => {
    const result = await probeSidecar(
      runner({
        stdout: JSON.stringify({
          ok: true,
          data: { protocolVersion: 99, python: '3.12.0', dependencies: {}, missing: [], ready: true },
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.DependencyMissing);
    expect(result.message).toContain('protocol 99');
  });

  it('reports missing Python dependencies', async () => {
    const result = await probeSidecar(
      runner({
        stdout: JSON.stringify({
          ok: true,
          data: {
            protocolVersion: SIDECAR_PROTOCOL_VERSION,
            python: '3.12.10',
            dependencies: {},
            missing: ['psd-tools', 'rectpack'],
            ready: false,
          },
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('psd-tools, rectpack');
    expect(result.hint).toContain('uv sync');
  });
});
