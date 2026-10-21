// ============================================================
// Path safety: every file the execution layer writes must land inside the
// workspace root. Reads are unrestricted (Spine projects commonly live
// outside the workspace), writes are not.
// ============================================================

import { isAbsolute, relative, resolve } from 'node:path';

import { SpineErrorCode, SpineResult, err, ok } from './types';

/** True when `child` resolves to `parent` or something beneath it. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Resolve a write target against the workspace root and refuse anything
 * that escapes it, including via `..` segments or an absolute path.
 */
export function resolveWriteTarget(
  path: string,
  workspaceRoot: string,
): SpineResult<string> {
  if (path.trim().length === 0) {
    return err(
      SpineErrorCode.InvalidArgument,
      'An empty path was supplied as a write target.',
      'Pass a path relative to the workspace root, or an absolute path inside it.',
    );
  }

  const absolute = isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path);

  if (!isInside(workspaceRoot, absolute)) {
    return err(
      SpineErrorCode.PathNotAllowed,
      `Write target "${absolute}" is outside the workspace root.`,
      `Choose an output path inside ${workspaceRoot}. The execution layer never writes outside the workspace.`,
      { requested: path, resolved: absolute, workspaceRoot },
    );
  }

  return ok(absolute, `Write target resolved to ${absolute}.`);
}

/**
 * Resolve a read-only input path. Inputs may live anywhere on disk, but the
 * file has to exist so the CLI is not handed a bad argument.
 */
export function resolveReadTarget(
  path: string,
  workspaceRoot: string,
  exists: (path: string) => boolean,
): SpineResult<string> {
  if (path.trim().length === 0) {
    return err(
      SpineErrorCode.InvalidArgument,
      'An empty path was supplied as an input.',
      'Pass the path to a .spine project, an exported data file, or a folder containing them.',
    );
  }

  const absolute = isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path);

  if (!exists(absolute)) {
    return err(
      SpineErrorCode.InputMissing,
      `Input path does not exist: ${absolute}`,
      'Check the path. Relative paths resolve against the workspace root.',
      { requested: path, resolved: absolute, workspaceRoot },
    );
  }

  return ok(absolute, `Input resolved to ${absolute}.`);
}
