import {
  buildEnvironment,
  capabilitiesFor,
  defaultInstallCandidates,
  formatVersion,
  parseSpineLog,
  parseVersion,
  parseVersionFile,
  probeEnvironment,
  resolveExecutables,
  runtimeBranchFor,
  summarizeEnvironment,
} from '../../src/spine-env';
import { SpineEdition } from '../../src/types';

const TRIAL_LOG = [
  'Spine Launcher 4.3.08 Trial',
  'Esoteric Software LLC (C) 2013-2026 | http://esotericsoftware.com',
  'Windows 10 Pro amd64 10.0',
  'Intel, Intel(R) UHD Graphics 730, 4.6.0 - Build 32.0.101.7088',
  'Starting: Spine 4.3.26 Trial',
  'Spine 4.3.26 Trial',
  'Started.',
  'OpenAL 1.1, Default audio device',
  '',
].join('\n');

const LICENSED_LOG = [
  'Spine Launcher 4.2.37',
  'Esoteric Software LLC (C) 2013-2026 | http://esotericsoftware.com',
  'Windows 11 Pro amd64 10.0',
  'NVIDIA Corporation, NVIDIA GeForce RTX 4070, 4.6.0 NVIDIA 551.23',
  'Starting: Spine 4.2.37',
  'Started.',
].join('\r\n');

describe('parseVersion', () => {
  it('parses a full version', () => {
    expect(parseVersion('4.3.26')).toEqual({ major: 4, minor: 3, patch: 26, raw: '4.3.26' });
  });

  it('defaults a missing patch to zero', () => {
    expect(parseVersion('4.2')).toEqual({ major: 4, minor: 2, patch: 0, raw: '4.2' });
  });

  it('trims surrounding whitespace in raw', () => {
    expect(parseVersion('  4.1.9 \n')?.raw).toBe('4.1.9');
  });

  it('returns null for channel names', () => {
    expect(parseVersion('latestbeta')).toBeNull();
    expect(parseVersion('stable')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('formats back to major.minor.patch', () => {
    const parsed = parseVersion('4.2');
    expect(parsed && formatVersion(parsed)).toBe('4.2.0');
  });
});

describe('runtimeBranchFor', () => {
  it('maps an editor version to a spine-runtimes branch', () => {
    expect(runtimeBranchFor(parseVersion('4.3.26'))).toBe('4.3');
    expect(runtimeBranchFor(parseVersion('4.2.37'))).toBe('4.2');
  });

  it('returns null without a version', () => {
    expect(runtimeBranchFor(null)).toBeNull();
  });
});

describe('parseSpineLog', () => {
  it('detects trial edition and both versions', () => {
    const info = parseSpineLog(TRIAL_LOG);
    expect(info.edition).toBe(SpineEdition.Trial);
    expect(info.launcherVersion && formatVersion(info.launcherVersion)).toBe('4.3.8');
    expect(info.editorVersion && formatVersion(info.editorVersion)).toBe('4.3.26');
    expect(info.os).toBe('Windows 10 Pro amd64 10.0');
    expect(info.graphics).toContain('UHD Graphics 730');
  });

  it('detects licensed edition from a log without a trial marker', () => {
    const info = parseSpineLog(LICENSED_LOG);
    expect(info.edition).toBe(SpineEdition.Licensed);
    expect(info.editorVersion && formatVersion(info.editorVersion)).toBe('4.2.37');
  });

  it('prefers the Starting: line as the editor version', () => {
    const log = ['Spine Launcher 4.3.08 Trial', 'Starting: Spine 4.2.37 Trial'].join('\n');
    expect(formatVersion(parseSpineLog(log).editorVersion!)).toBe('4.2.37');
  });

  it('falls back to a bare Spine version line', () => {
    const info = parseSpineLog('Spine 4.1.19 Trial\nStarted.');
    expect(formatVersion(info.editorVersion!)).toBe('4.1.19');
    expect(info.edition).toBe(SpineEdition.Trial);
  });

  it('returns unknown edition for a missing log', () => {
    const info = parseSpineLog(null);
    expect(info.edition).toBe(SpineEdition.Unknown);
    expect(info.editorVersion).toBeNull();
    expect(info.launcherVersion).toBeNull();
  });

  it('returns unknown edition for an unrelated log', () => {
    expect(parseSpineLog('some unrelated text\nanother line').edition).toBe(
      SpineEdition.Unknown,
    );
  });
});

describe('parseVersionFile', () => {
  it('preserves channel names verbatim', () => {
    expect(parseVersionFile('latestbeta\n')).toBe('latestbeta');
  });

  it('preserves wildcard pins', () => {
    expect(parseVersionFile(' 4.2.xx ')).toBe('4.2.xx');
  });

  it('returns null for blank or missing content', () => {
    expect(parseVersionFile('   ')).toBeNull();
    expect(parseVersionFile(null)).toBeNull();
  });
});

describe('capabilitiesFor', () => {
  it('blocks every write operation on the trial', () => {
    const caps = capabilitiesFor(SpineEdition.Trial);
    expect(caps).toEqual({
      canSave: false,
      canExport: false,
      canPack: false,
      canUnpack: false,
      canImport: false,
      canCleanup: false,
      canRenderImages: false,
      canInfo: true,
    });
  });

  it('allows everything on a licensed install', () => {
    const caps = capabilitiesFor(SpineEdition.Licensed);
    expect(Object.values(caps).every(Boolean)).toBe(true);
  });

  it('treats an unknown edition as restrictive', () => {
    const caps = capabilitiesFor(SpineEdition.Unknown);
    expect(caps.canExport).toBe(false);
    expect(caps.canInfo).toBe(true);
  });
});

describe('defaultInstallCandidates', () => {
  it('prefers a licensed Windows install over the trial', () => {
    const candidates = defaultInstallCandidates('win32', 'C:\\Users\\Danny');
    expect(candidates[0]?.edition).toBe(SpineEdition.Licensed);
    expect(candidates[0]?.dir).toBe('C:\\Program Files\\Spine');
    expect(candidates[1]?.dir).toBe('C:\\Program Files\\Spine Trial');
    expect(candidates[1]?.userDataDir).toBe('C:\\Users\\Danny\\SpineTrial');
  });

  it('honours a custom Program Files location', () => {
    const candidates = defaultInstallCandidates('win32', 'C:\\Users\\D', 'D:\\Apps');
    expect(candidates[0]?.dir).toBe('D:\\Apps\\Spine');
  });

  it('targets the executable inside the app bundle on macOS', () => {
    const candidates = defaultInstallCandidates('darwin', '/Users/danny');
    expect(candidates[0]?.dir).toBe('/Applications/Spine.app/Contents/MacOS');
  });

  it('targets the shell script on Linux', () => {
    const candidates = defaultInstallCandidates('linux', '/home/danny');
    expect(candidates[0]?.baseName).toBe('Spine.sh');
  });
});

describe('resolveExecutables', () => {
  const trialCandidate = {
    dir: 'C:\\Program Files\\Spine Trial',
    baseName: 'SpineTrial',
    userDataDir: 'C:\\Users\\Danny\\SpineTrial',
    edition: SpineEdition.Trial,
  };

  it('picks the .com console executable on Windows', () => {
    const exists = (p: string) => p.endsWith('.com') || p.endsWith('.exe');
    const resolved = resolveExecutables(trialCandidate, 'win32', exists);
    expect(resolved.cli).toBe('C:\\Program Files\\Spine Trial\\SpineTrial.com');
    expect(resolved.gui).toBe('C:\\Program Files\\Spine Trial\\SpineTrial.exe');
  });

  it('reports no CLI executable when only the GUI exists', () => {
    const exists = (p: string) => p.endsWith('.exe');
    expect(resolveExecutables(trialCandidate, 'win32', exists).cli).toBeNull();
  });

  it('resolves a single executable on POSIX platforms', () => {
    const candidate = {
      dir: '/Applications/Spine.app/Contents/MacOS',
      baseName: 'Spine',
      userDataDir: '/Users/danny/Spine',
      edition: SpineEdition.Licensed,
    };
    const resolved = resolveExecutables(candidate, 'darwin', () => true);
    expect(resolved.cli).toBe('/Applications/Spine.app/Contents/MacOS/Spine');
    expect(resolved.gui).toBeNull();
  });
});

describe('buildEnvironment', () => {
  it('builds a trial environment with export blocked', () => {
    const env = buildEnvironment({
      executable: 'C:\\Program Files\\Spine Trial\\SpineTrial.com',
      guiExecutable: 'C:\\Program Files\\Spine Trial\\SpineTrial.exe',
      installDir: 'C:\\Program Files\\Spine Trial',
      userDataDir: 'C:\\Users\\Danny\\SpineTrial',
      logContent: TRIAL_LOG,
      versionFileContent: 'latestbeta\n',
    });

    expect(env.found).toBe(true);
    expect(env.edition).toBe(SpineEdition.Trial);
    expect(formatVersion(env.editorVersion!)).toBe('4.3.26');
    expect(env.capabilities.canExport).toBe(false);
    expect(env.capabilities.canInfo).toBe(true);
    expect(env.runtimeBranch).toBe('4.3');
    expect(env.requestedVersion).toBe('latestbeta');
    expect(env.notes.join(' ')).toContain('Trial edition detected');
  });

  it('warns that a channel pin is not reproducible', () => {
    const env = buildEnvironment({
      executable: 'C:\\Spine\\Spine.com',
      guiExecutable: null,
      installDir: 'C:\\Spine',
      userDataDir: 'C:\\Users\\D\\Spine',
      logContent: LICENSED_LOG,
      versionFileContent: 'latest',
    });
    expect(env.notes.join(' ')).toContain('--update');
  });

  it('warns when the editor is off the 4.2 baseline', () => {
    const env = buildEnvironment({
      executable: 'C:\\Spine\\Spine.com',
      guiExecutable: null,
      installDir: 'C:\\Spine',
      userDataDir: 'C:\\Users\\D\\Spine',
      logContent: TRIAL_LOG,
      versionFileContent: '4.3.xx',
    });
    expect(env.notes.join(' ')).toContain('4.2 baseline');
  });

  it('does not warn about the baseline on a 4.2 install', () => {
    const env = buildEnvironment({
      executable: 'C:\\Spine\\Spine.com',
      guiExecutable: null,
      installDir: 'C:\\Spine',
      userDataDir: 'C:\\Users\\D\\Spine',
      logContent: LICENSED_LOG,
      versionFileContent: '4.2.37',
    });
    expect(env.notes.join(' ')).not.toContain('4.2 baseline');
    expect(env.capabilities.canExport).toBe(true);
  });

  it('infers the edition from the executable name when the log is missing', () => {
    const env = buildEnvironment({
      executable: 'C:\\Program Files\\Spine Trial\\SpineTrial.com',
      guiExecutable: null,
      installDir: 'C:\\Program Files\\Spine Trial',
      userDataDir: null,
      logContent: null,
      versionFileContent: null,
    });
    expect(env.edition).toBe(SpineEdition.Trial);
    expect(env.notes.join(' ')).toContain('inferred from the executable name');
  });

  it('reports not found with no executable', () => {
    const env = buildEnvironment({
      executable: null,
      guiExecutable: null,
      installDir: null,
      userDataDir: null,
      logContent: null,
      versionFileContent: null,
    });
    expect(env.found).toBe(false);
    expect(env.edition).toBe(SpineEdition.Unknown);
    expect(env.capabilities.canExport).toBe(false);
    expect(env.notes.join(' ')).toContain('No Spine command-line executable');
  });
});

describe('probeEnvironment', () => {
  const files: Record<string, string> = {
    'C:\\Users\\Danny\\SpineTrial\\spine.log': TRIAL_LOG,
    'C:\\Users\\Danny\\SpineTrial\\version.txt': 'latestbeta\n',
  };
  const installed = new Set([
    'C:\\Program Files\\Spine Trial\\SpineTrial.com',
    'C:\\Program Files\\Spine Trial\\SpineTrial.exe',
    'C:\\Users\\Danny\\SpineTrial',
    ...Object.keys(files),
  ]);

  const exists = (p: string) => installed.has(p);
  const readText = (p: string) => files[p] ?? null;

  it('finds the trial install and reads its metadata', () => {
    const env = probeEnvironment({
      platform: 'win32',
      homeDir: 'C:\\Users\\Danny',
      exists,
      readText,
    });

    expect(env.executable).toBe('C:\\Program Files\\Spine Trial\\SpineTrial.com');
    expect(env.guiExecutable).toBe('C:\\Program Files\\Spine Trial\\SpineTrial.exe');
    expect(env.userDataDir).toBe('C:\\Users\\Danny\\SpineTrial');
    expect(env.edition).toBe(SpineEdition.Trial);
    expect(formatVersion(env.editorVersion!)).toBe('4.3.26');
  });

  it('honours an explicit executable override', () => {
    const env = probeEnvironment({
      platform: 'win32',
      homeDir: 'C:\\Users\\Danny',
      explicitExecutable: 'D:\\Portable\\Spine\\Spine.com',
      exists: (p) => p === 'D:\\Portable\\Spine\\Spine.com' || exists(p),
      readText,
      explicitUserDataDir: 'C:\\Users\\Danny\\SpineTrial',
    });
    expect(env.executable).toBe('D:\\Portable\\Spine\\Spine.com');
    expect(env.installDir).toBe('D:\\Portable\\Spine');
  });

  it('ignores an explicit executable that does not exist', () => {
    const env = probeEnvironment({
      platform: 'win32',
      homeDir: 'C:\\Users\\Danny',
      explicitExecutable: 'D:\\missing\\Spine.com',
      exists,
      readText,
    });
    expect(env.executable).toBe('C:\\Program Files\\Spine Trial\\SpineTrial.com');
  });

  it('reports not found when nothing is installed', () => {
    const env = probeEnvironment({
      platform: 'win32',
      homeDir: 'C:\\Users\\Danny',
      exists: () => false,
      readText: () => null,
    });
    expect(env.found).toBe(false);
    expect(summarizeEnvironment(env)).toBe('No Spine installation found.');
  });
});

describe('summarizeEnvironment', () => {
  it('states the version, edition and export status', () => {
    const env = buildEnvironment({
      executable: 'C:\\Program Files\\Spine Trial\\SpineTrial.com',
      guiExecutable: null,
      installDir: 'C:\\Program Files\\Spine Trial',
      userDataDir: 'C:\\Users\\Danny\\SpineTrial',
      logContent: TRIAL_LOG,
      versionFileContent: 'latestbeta',
    });
    expect(summarizeEnvironment(env)).toBe(
      'Spine 4.3.26 (trial), export blocked (trial), runtime branch 4.3.',
    );
  });
});
