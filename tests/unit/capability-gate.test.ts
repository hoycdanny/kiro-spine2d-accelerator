import { capabilityFor, requireCapabilitiesFor, requireCapability } from '../../src/capability-gate';
import { buildEnvironment } from '../../src/spine-env';
import { SpineErrorCode } from '../../src/types';

const trialEnv = buildEnvironment({
  executable: 'C:\\Program Files\\Spine Trial\\SpineTrial.com',
  guiExecutable: null,
  installDir: 'C:\\Program Files\\Spine Trial',
  userDataDir: 'C:\\Users\\Dev\\SpineTrial',
  logContent: 'Spine Launcher 4.3.08 Trial\nStarting: Spine 4.3.26 Trial',
  versionFileContent: 'latestbeta',
});

const licensedEnv = buildEnvironment({
  executable: 'C:\\Program Files\\Spine\\Spine.com',
  guiExecutable: null,
  installDir: 'C:\\Program Files\\Spine',
  userDataDir: 'C:\\Users\\Dev\\Spine',
  logContent: 'Spine Launcher 4.2.37\nStarting: Spine 4.2.37',
  versionFileContent: '4.2.37',
});

const unknownEnv = buildEnvironment({
  executable: null,
  guiExecutable: null,
  installDir: null,
  userDataDir: null,
  logContent: null,
  versionFileContent: null,
});

describe('capabilityFor', () => {
  it('maps each command kind to the capability it needs', () => {
    expect(capabilityFor({ kind: 'info', input: 'a' })).toBe('canInfo');
    expect(capabilityFor({ kind: 'export', exportSpec: 'json' })).toBe('canExport');
    expect(
      capabilityFor({ kind: 'pack', input: 'i', output: 'o', packSpec: 'p' }),
    ).toBe('canPack');
    expect(
      capabilityFor({ kind: 'unpack', input: 'i', output: 'o', atlas: 'a' }),
    ).toBe('canUnpack');
    expect(capabilityFor({ kind: 'import', input: 'i', output: 'o' })).toBe('canImport');
    expect(capabilityFor({ kind: 'cleanup', input: 'i' })).toBe('canCleanup');
    expect(capabilityFor({ kind: 'last-export-settings', input: 'i' })).toBe('canInfo');
  });
});

describe('requireCapability', () => {
  it('allows project info on the trial', () => {
    expect(requireCapability(trialEnv, 'canInfo')).toBeNull();
  });

  it('refuses export on the trial with an actionable hint', () => {
    const refusal = requireCapability(trialEnv, 'canExport');
    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe(SpineErrorCode.CapabilityDenied);
    expect(refusal!.message).toContain('exporting skeleton data');
    expect(refusal!.message).toContain('trial does not permit');
    expect(refusal!.hint).toContain('Purchase a Spine license');
    expect(refusal!.details?.['edition']).toBe('trial');
  });

  it('includes the command line that would have run', () => {
    const refusal = requireCapability(trialEnv, 'canPack', {
      commandLine: 'SpineTrial.com -i images/ -o out/ -p pack.json',
    });
    expect(refusal!.details?.['wouldHaveRun']).toBe(
      'SpineTrial.com -i images/ -o out/ -p pack.json',
    );
  });

  it('allows everything on a licensed install', () => {
    for (const capability of [
      'canExport',
      'canPack',
      'canUnpack',
      'canImport',
      'canCleanup',
      'canSave',
      'canRenderImages',
      'canInfo',
    ] as const) {
      expect(requireCapability(licensedEnv, capability)).toBeNull();
    }
  });

  it('blocks writes when the edition is unknown', () => {
    const refusal = requireCapability(unknownEnv, 'canExport');
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toContain('could not be confirmed');
    expect(refusal!.hint).toContain('spine_env_probe');
  });
});

describe('requireCapabilitiesFor', () => {
  it('passes a read-only batch on the trial', () => {
    expect(
      requireCapabilitiesFor(trialEnv, [
        { kind: 'info', input: 'a.spine' },
        { kind: 'info', input: 'b.spine' },
      ]),
    ).toBeNull();
  });

  it('reports every blocked capability at once', () => {
    const refusal = requireCapabilitiesFor(trialEnv, [
      { kind: 'export', input: 'a.spine', exportSpec: 'binary' },
      { kind: 'pack', input: 'images/', output: 'out/', packSpec: 'pack.json' },
      { kind: 'info', input: 'a.spine' },
    ]);

    expect(refusal).not.toBeNull();
    const blocked = refusal!.details?.['blocked'] as string[];
    expect(blocked).toHaveLength(2);
    expect(refusal!.message).toContain('exporting skeleton data (export)');
    expect(refusal!.message).toContain('packing a texture atlas (pack)');
  });

  it('groups repeated command kinds under one capability', () => {
    const refusal = requireCapabilitiesFor(trialEnv, [
      { kind: 'export', input: 'a.spine', exportSpec: 'binary' },
      { kind: 'export', input: 'b.spine', exportSpec: 'binary' },
    ]);
    expect((refusal!.details?.['blocked'] as string[])).toHaveLength(1);
    expect(refusal!.message).toContain('(export, export)');
  });

  it('allows a full batch on a licensed install', () => {
    expect(
      requireCapabilitiesFor(licensedEnv, [
        { kind: 'export', input: 'a.spine', exportSpec: 'binary+pack' },
        { kind: 'cleanup', input: 'a.spine' },
      ]),
    ).toBeNull();
  });
});
