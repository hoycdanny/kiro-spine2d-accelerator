import { isInside, resolveReadTarget, resolveWriteTarget } from '../../src/path-safety';
import { SpineErrorCode } from '../../src/types';

const root = process.platform === 'win32' ? 'C:\\work\\project' : '/work/project';
const join = (...parts: string[]) =>
  parts.join(process.platform === 'win32' ? '\\' : '/');

describe('isInside', () => {
  it('accepts the root itself and its children', () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, join(root, 'assets', 'hero.json'))).toBe(true);
  });

  it('rejects parents and siblings', () => {
    expect(isInside(root, join(root, '..'))).toBe(false);
    expect(isInside(root, join(root, '..', 'other'))).toBe(false);
  });
});

describe('resolveWriteTarget', () => {
  it('resolves a relative path against the workspace root', () => {
    const result = resolveWriteTarget('out/hero.json', root);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toBe(join(root, 'out', 'hero.json'));
  });

  it('accepts an absolute path inside the workspace', () => {
    const target = join(root, 'out', 'hero.json');
    const result = resolveWriteTarget(target, root);
    expect(result.ok && result.data).toBe(target);
  });

  it('refuses traversal out of the workspace', () => {
    const result = resolveWriteTarget('../escape/hero.json', root);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
    expect(!result.ok && result.hint).toContain(root);
  });

  it('refuses an absolute path outside the workspace', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\hero.json' : '/etc/hero.json';
    const result = resolveWriteTarget(outside, root);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
  });

  it('refuses an empty path', () => {
    const result = resolveWriteTarget('   ', root);
    expect(!result.ok && result.code).toBe(SpineErrorCode.InvalidArgument);
  });
});

describe('resolveReadTarget', () => {
  it('allows reads from outside the workspace when the file exists', () => {
    const outside =
      process.platform === 'win32'
        ? 'C:\\Users\\Dev\\SpineTrial\\examples\\hero.spine'
        : '/Users/dev/SpineTrial/examples/hero.spine';
    const result = resolveReadTarget(outside, root, (p) => p === outside);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toBe(outside);
  });

  it('resolves relative inputs against the workspace root', () => {
    const expected = join(root, 'assets', 'hero.spine');
    const result = resolveReadTarget('assets/hero.spine', root, (p) => p === expected);
    expect(result.ok && result.data).toBe(expected);
  });

  it('reports a missing input', () => {
    const result = resolveReadTarget('assets/missing.spine', root, () => false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });

  it('refuses an empty input', () => {
    const result = resolveReadTarget('', root, () => true);
    expect(!result.ok && result.code).toBe(SpineErrorCode.InvalidArgument);
  });
});
