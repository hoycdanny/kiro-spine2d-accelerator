import { join } from 'node:path';

import { byCodeUnit } from '../../src/canonical-json';
import { SpineHost } from '../../src/host';

const TRIAL_LOG = [
  'Spine Launcher 4.3.08 Trial',
  'Windows 10 Pro amd64 10.0',
  'Starting: Spine 4.3.26 Trial',
  'Started.',
].join('\n');

const LICENSED_LOG = [
  'Spine Launcher 4.2.37',
  'Windows 11 Pro amd64 10.0',
  'Starting: Spine 4.2.37',
  'Started.',
].join('\n');

/**
 * Split a path into non-empty segments on either separator.
 *
 * Deliberately not `node:path.dirname`: this fake's keys are Windows paths
 * (`C:\work\project\...`) while its `platform` is a constructor option, so
 * `dirname` on a POSIX test runner would not split on a backslash.
 */
const segments = (p: string): string[] => p.split(/[\\/]/).filter((s) => s.length > 0);

export const TRIAL_EXECUTABLE = 'C:\\Program Files\\Spine Trial\\SpineTrial.com';
export const LICENSED_EXECUTABLE = 'C:\\Program Files\\Spine\\Spine.com';

/** A host backed by an in-memory file system, for tests. */
export function createFakeHost(options: {
  files?: Record<string, string>;
  binaries?: Record<string, Buffer>;
  paths?: string[];
  edition?: 'trial' | 'licensed' | 'none';
  workspaceRoot?: string;
  packageRoot?: string;
  platform?: NodeJS.Platform;
} = {}): SpineHost & {
  writes: Record<string, string>;
  binaryWrites: Record<string, Buffer>;
} {
  const edition = options.edition ?? 'trial';
  const files: Record<string, string> = { ...options.files };
  const binaries: Record<string, Buffer> = { ...options.binaries };
  const paths = new Set<string>(options.paths ?? []);
  for (const key of Object.keys(binaries)) paths.add(key);

  if (edition === 'trial') {
    paths.add(TRIAL_EXECUTABLE);
    paths.add('C:\\Program Files\\Spine Trial\\SpineTrial.exe');
    paths.add('C:\\Users\\Dev\\SpineTrial');
    files['C:\\Users\\Dev\\SpineTrial\\spine.log'] = TRIAL_LOG;
    files['C:\\Users\\Dev\\SpineTrial\\version.txt'] = 'latestbeta\n';
  } else if (edition === 'licensed') {
    paths.add(LICENSED_EXECUTABLE);
    paths.add('C:\\Program Files\\Spine\\Spine.exe');
    paths.add('C:\\Users\\Dev\\Spine');
    files['C:\\Users\\Dev\\Spine\\spine.log'] = LICENSED_LOG;
    files['C:\\Users\\Dev\\Spine\\version.txt'] = '4.2.37\n';
  }

  for (const key of Object.keys(files)) paths.add(key);

  const host: SpineHost & {
    writes: Record<string, string>;
    binaryWrites: Record<string, Buffer>;
  } = {
    platform: options.platform ?? 'win32',
    homeDir: 'C:\\Users\\Dev',
    programFiles: 'C:\\Program Files',
    workspaceRoot: options.workspaceRoot ?? 'C:\\work\\project',
    packageRoot: options.packageRoot ?? join(__dirname, '..', '..'),
    exists: (p: string) => paths.has(p),
    readText: (p: string) => files[p] ?? null,
    writeText: (p: string, content: string) => {
      files[p] = content;
      paths.add(p);
      host.writes[p] = content;
    },
    listDir: (dir: string) => {
      const want = segments(dir);
      const out = new Set<string>();
      for (const key of [...Object.keys(files), ...Object.keys(binaries)]) {
        const parts = segments(key);
        if (parts.length !== want.length + 1) continue;
        if (want.every((segment, index) => parts[index] === segment)) {
          out.add(parts[parts.length - 1] as string);
        }
      }
      return [...out].sort(byCodeUnit);
    },
    readBinary: (p: string) => binaries[p] ?? null,
    writeBinary: (p: string, data: Buffer) => {
      binaries[p] = data;
      paths.add(p);
      host.binaryWrites[p] = data;
    },
    explicitExecutable: null,
    explicitUserDataDir: null,
    writes: {},
    binaryWrites: {},
  };

  return host;
}

/** A fake host that also records everything written through it. */
export type FakeHost = ReturnType<typeof createFakeHost>;
