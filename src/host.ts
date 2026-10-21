// ============================================================
// Host adapter: the single place where the execution layer touches the
// outside world. Every other module receives these collaborators as
// arguments, which keeps the logic modules pure and testable.
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, resolve } from 'node:path';

import { PathExists, ReadTextFile } from './spine-env';

/** Collaborators and ambient facts the tools need. */
export interface SpineHost {
  platform: NodeJS.Platform;
  homeDir: string;
  /** Windows `Program Files` location, when applicable. */
  programFiles?: string;
  /**
   * Root that file writes are confined to. Defaults to the process working
   * directory, which is the workspace Kiro launched the server in.
   */
  workspaceRoot: string;
  /**
   * Root of this package, used to find the bundled `templates/` directory.
   * Resolves the same way from `src/` and from the compiled `dist/`.
   */
  packageRoot: string;
  exists: PathExists;
  readText: ReadTextFile;
  /**
   * Write a UTF-8 text file, creating parent directories as needed.
   * Callers must pass a path already validated by `resolveWriteTarget`,
   * which confines writes to the workspace root.
   */
  writeText: (path: string, content: string) => void;
  /** Read a binary file (atlas page images), or null when unreadable. */
  readBinary: (path: string) => Buffer | null;
  /** Write a binary file (rendered screenshots), creating directories. */
  writeBinary: (path: string, data: Buffer) => void;
  /** Explicit executable override, e.g. `SPINE_EXECUTABLE`. */
  explicitExecutable: string | null;
  /** Explicit user data directory override, e.g. `SPINE_USER_DATA`. */
  explicitUserDataDir: string | null;
}

/** Build a host backed by the real file system and process environment. */
export function createNodeHost(overrides: Partial<SpineHost> = {}): SpineHost {
  const base: SpineHost = {
    platform: platform(),
    homeDir: homedir(),
    ...(process.env.ProgramFiles ? { programFiles: process.env.ProgramFiles } : {}),
    workspaceRoot: resolve(process.env.SPINE_WORKSPACE_ROOT ?? process.cwd()),
    packageRoot: resolve(__dirname, '..'),
    exists: (path: string) => existsSync(path),
    readText: (path: string) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    writeText: (path: string, content: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf8');
    },
    readBinary: (path: string) => {
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    },
    writeBinary: (path: string, data: Buffer) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    },
    explicitExecutable: process.env.SPINE_EXECUTABLE ?? null,
    explicitUserDataDir: process.env.SPINE_USER_DATA ?? null,
  };
  return { ...base, ...overrides };
}
