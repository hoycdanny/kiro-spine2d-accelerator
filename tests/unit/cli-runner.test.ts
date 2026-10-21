import {
  DEFAULT_TIMEOUT_MS,
  SpawnFn,
  SpawnOutcome,
  runCli,
  summarizeFailureOutput,
} from '../../src/cli-runner';
import { SpineErrorCode } from '../../src/types';

function fakeSpawn(
  outcome: Partial<SpawnOutcome>,
  record?: { executable?: string; args?: string[]; timeoutMs?: number; cwd?: string },
): SpawnFn {
  return async (executable, args, options) => {
    if (record) {
      record.executable = executable;
      record.args = args;
      record.timeoutMs = options.timeoutMs;
      record.cwd = options.cwd;
    }
    return {
      code: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 1200,
      ...outcome,
    };
  };
}

const invocation = {
  executable: 'C:\\Program Files\\Spine\\Spine.com',
  args: ['-i', 'hero.spine'],
  commands: [{ kind: 'info' as const, input: 'hero.spine' }],
};

describe('runCli', () => {
  it('passes the argument array through without shell involvement', async () => {
    const record: { args?: string[]; executable?: string } = {};
    await runCli(fakeSpawn({}, record), {
      ...invocation,
      args: ['-i', 'C:\\path with spaces\\hero.spine'],
    });

    expect(record.executable).toBe('C:\\Program Files\\Spine\\Spine.com');
    expect(record.args).toEqual(['-i', 'C:\\path with spaces\\hero.spine']);
  });

  it('applies the default timeout', async () => {
    const record: { timeoutMs?: number } = {};
    await runCli(fakeSpawn({}, record), invocation);
    expect(record.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('honours an explicit timeout and cwd', async () => {
    const record: { timeoutMs?: number; cwd?: string } = {};
    await runCli(fakeSpawn({}, record), {
      ...invocation,
      timeoutMs: 5000,
      cwd: 'C:\\work',
    });
    expect(record.timeoutMs).toBe(5000);
    expect(record.cwd).toBe('C:\\work');
  });

  it('returns the run data on success', async () => {
    const result = await runCli(
      fakeSpawn({ stdout: 'Complete.', durationMs: 2500 }),
      invocation,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exitCode).toBe(0);
    expect(result.data.stdout).toBe('Complete.');
    expect(result.data.commandLine).toBe(
      '"C:\\Program Files\\Spine\\Spine.com" -i hero.spine',
    );
    expect(result.summary).toContain('2.5s');
  });

  it('maps a timeout onto CLI_TIMEOUT with the editor-running hint', async () => {
    const result = await runCli(
      fakeSpawn({ timedOut: true, code: null, stdout: 'Started.' }),
      { ...invocation, timeoutMs: 30_000 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliTimeout);
    expect(result.message).toContain('30s');
    expect(result.hint).toContain('already open');
    expect(result.details?.['commandLine']).toContain('Spine.com');
  });

  it('maps a non-zero exit onto CLI_FAILED and keeps the output', async () => {
    const result = await runCli(
      fakeSpawn({
        code: 1,
        stderr: 'Error: export settings file not found',
        stdout: 'Spine Launcher 4.2.37',
      }),
      invocation,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliFailed);
    expect(result.message).toContain('exited with code 1');
    expect(result.message).toContain('export settings file not found');
    expect(result.details?.['exitCode']).toBe(1);
  });

  it('treats a spawn failure (null exit code) as a failure', async () => {
    const result = await runCli(
      fakeSpawn({ code: null, stderr: 'spawn ENOENT' }),
      invocation,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliFailed);
  });
});

describe('summarizeFailureOutput', () => {
  it('prefers lines that look like errors', () => {
    const summary = summarizeFailureOutput(
      'Spine Launcher 4.2.37\nStarting: Spine 4.2.37\nError: cannot read project',
      '',
    );
    expect(summary).toBe('Error: cannot read project');
  });

  it('falls back to the last lines when nothing looks like an error', () => {
    const summary = summarizeFailureOutput('one\ntwo\nthree', '');
    expect(summary).toBe('one\ntwo\nthree');
  });

  it('caps the number of reported lines', () => {
    const noisy = Array.from({ length: 30 }, (_, i) => `error ${i}`).join('\n');
    expect(summarizeFailureOutput(noisy, '').split('\n')).toHaveLength(8);
  });
});
