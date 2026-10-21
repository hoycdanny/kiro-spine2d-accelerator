import { SpawnFn, SpawnOutcome } from '../../src/cli-runner';
import { projectInfo } from '../../src/tools/cli-tools';
import { SpineErrorCode } from '../../src/types';
import { TRIAL_EXECUTABLE, createFakeHost } from '../helpers/fake-host';

const INFO_OUTPUT = [
  'Spine Launcher 4.3.08 Trial',
  'Esoteric Software LLC (C) 2013-2026 | http://esotericsoftware.com',
  'Starting: Spine 4.3.26 Trial',
  'C:\\work\\project\\assets\\hero.spine',
  'Spine: 4.2.37',
  'Skeletons: 1',
  'Animations: 11',
  'Complete.',
].join('\n');

const HANDOFF_OUTPUT = [
  'Spine Launcher 4.3.08 Trial',
  'Starting: Spine 4.3.26 Trial',
  'Started.',
].join('\n');

function spawnWith(
  outcome: Partial<SpawnOutcome>,
  record?: { args?: string[]; executable?: string; cwd?: string },
): SpawnFn {
  return async (executable, args, options) => {
    if (record) {
      record.executable = executable;
      record.args = args;
      record.cwd = options.cwd;
    }
    return {
      code: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 900,
      ...outcome,
    };
  };
}

describe('projectInfo', () => {
  const host = createFakeHost({
    edition: 'trial',
    paths: ['C:\\work\\project\\assets\\hero.spine'],
  });

  it('runs the info command and parses the report', async () => {
    const record: { args?: string[]; executable?: string; cwd?: string } = {};
    const result = await projectInfo(host, spawnWith({ stdout: INFO_OUTPUT }, record), {
      input: 'assets/hero.spine',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(record.executable).toBe(TRIAL_EXECUTABLE);
    expect(record.args).toEqual(['-i', 'C:\\work\\project\\assets\\hero.spine']);
    expect(record.cwd).toBe('C:\\work\\project');

    const entry = result.data.result.entries[0]!;
    expect(entry.spineVersion).toBe('4.2.37');
    expect(entry.animations).toBe(11);
    expect(result.data.commandLine).toContain('SpineTrial.com');
    expect(result.summary).toContain('11 animation(s)');
    expect(result.summary).toContain('Command:');
  });

  it('works on the trial because info is read-only', async () => {
    const result = await projectInfo(host, spawnWith({ stdout: INFO_OUTPUT }), {
      input: 'assets/hero.spine',
    });
    expect(result.ok).toBe(true);
  });

  it('pins the editor version when asked', async () => {
    const record: { args?: string[] } = {};
    await projectInfo(host, spawnWith({ stdout: INFO_OUTPUT }, record), {
      input: 'assets/hero.spine',
      update: '4.2.xx',
      ignoreUnknown: true,
    });
    expect(record.args?.slice(0, 3)).toEqual(['--update', '4.2.xx', '--ignore-unknown']);
  });

  it('reports a missing input before spawning anything', async () => {
    let spawned = false;
    const result = await projectInfo(
      host,
      async () => {
        spawned = true;
        return { code: 0, stdout: '', stderr: '', timedOut: false, durationMs: 0 };
      },
      { input: 'assets/nope.spine' },
    );

    expect(spawned).toBe(false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });

  it('fails clearly when the launcher hands off to a running editor', async () => {
    const result = await projectInfo(host, spawnWith({ stdout: HANDOFF_OUTPUT }), {
      input: 'assets/hero.spine',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliFailed);
    expect(result.hint).toContain('Close any running Spine editor');
  });

  it('propagates a CLI timeout', async () => {
    const result = await projectInfo(
      host,
      spawnWith({ timedOut: true, code: null }),
      { input: 'assets/hero.spine', timeoutSeconds: 10 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliTimeout);
  });

  it('fails with SPINE_NOT_FOUND when no install is present', async () => {
    const bare = createFakeHost({
      edition: 'none',
      paths: ['C:\\work\\project\\assets\\hero.spine'],
    });
    const result = await projectInfo(bare, spawnWith({ stdout: INFO_OUTPUT }), {
      input: 'assets/hero.spine',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.SpineNotFound);
  });
});
