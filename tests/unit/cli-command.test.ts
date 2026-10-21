import {
  buildArgs,
  buildCommandArgs,
  buildEditorArgs,
  formatCommandLine,
  isExportShorthand,
} from '../../src/cli-command';
import { SpineErrorCode } from '../../src/types';

describe('buildEditorArgs', () => {
  it('emits nothing by default', () => {
    expect(buildEditorArgs()).toEqual([]);
  });

  it('pins the editor version', () => {
    expect(buildEditorArgs({ update: '4.2.xx' })).toEqual(['--update', '4.2.xx']);
  });

  it('trims the version and ignores an empty one', () => {
    expect(buildEditorArgs({ update: '  4.2.37 ' })).toEqual(['--update', '4.2.37']);
    expect(buildEditorArgs({ update: '   ' })).toEqual([]);
  });

  it('emits memory, ignore-unknown, trace and clean-all in a stable order', () => {
    expect(
      buildEditorArgs({
        maxMemoryMb: 4096,
        update: '4.2.37',
        ignoreUnknown: true,
        trace: true,
        cleanAll: true,
      }),
    ).toEqual([
      '-Xmx4096m',
      '--update',
      '4.2.37',
      '--ignore-unknown',
      '--trace',
      '--clean-all',
    ]);
  });
});

describe('buildCommandArgs', () => {
  it('builds an info command', () => {
    const result = buildCommandArgs({ kind: 'info', input: 'C:\\a b\\p.spine' });
    expect(result.ok && result.data).toEqual(['-i', 'C:\\a b\\p.spine']);
  });

  it('builds an export with input, output and a settings file', () => {
    const result = buildCommandArgs({
      kind: 'export',
      input: 'p.spine',
      output: 'out/',
      exportSpec: 'export.json',
    });
    expect(result.ok && result.data).toEqual([
      '-i',
      'p.spine',
      '-o',
      'out/',
      '-e',
      'export.json',
    ]);
  });

  it('places the clean flag between input and output', () => {
    const result = buildCommandArgs({
      kind: 'export',
      input: 'p.spine',
      output: 'out/',
      exportSpec: 'binary+pack',
      clean: true,
    });
    expect(result.ok && result.data).toEqual([
      '-i',
      'p.spine',
      '-m',
      '-o',
      'out/',
      '-e',
      'binary+pack',
    ]);
  });

  it('allows an export that relies on paths from the settings file', () => {
    const result = buildCommandArgs({ kind: 'export', exportSpec: 'export.json' });
    expect(result.ok && result.data).toEqual(['-e', 'export.json']);
  });

  it('rejects an export without a spec', () => {
    const result = buildCommandArgs({ kind: 'export', exportSpec: '  ' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe(SpineErrorCode.InvalidArgument);
  });

  it('builds a last-export-settings command', () => {
    const result = buildCommandArgs({
      kind: 'last-export-settings',
      input: 'p.spine',
      output: 'settings/p.export.json',
    });
    expect(result.ok && result.data).toEqual([
      '-i',
      'p.spine',
      '-o',
      'settings/p.export.json',
      '--last-export-settings',
    ]);
  });

  it('builds a pack command with multiple projects', () => {
    const result = buildCommandArgs({
      kind: 'pack',
      input: 'images/',
      output: 'atlas/',
      packSpec: 'pack.json',
      name: 'hero',
      projects: ['a.spine', 'b.spine'],
    });
    expect(result.ok && result.data).toEqual([
      '-i',
      'images/',
      '-j',
      'a.spine',
      '-j',
      'b.spine',
      '-o',
      'atlas/',
      '-n',
      'hero',
      '-p',
      'pack.json',
    ]);
  });

  it('requires input, output and spec for pack', () => {
    const result = buildCommandArgs({
      kind: 'pack',
      input: 'images/',
      output: '',
      packSpec: 'hero',
    });
    expect(result.ok).toBe(false);
  });

  it('builds an unpack command', () => {
    const result = buildCommandArgs({
      kind: 'unpack',
      input: 'atlas/',
      output: 'images/',
      atlas: 'atlas/hero.atlas',
      projects: ['hero.spine'],
    });
    expect(result.ok && result.data).toEqual([
      '-i',
      'atlas/',
      '-j',
      'hero.spine',
      '-o',
      'images/',
      '-c',
      'atlas/hero.atlas',
    ]);
  });

  it('builds an import command with scale and rename', () => {
    const result = buildCommandArgs({
      kind: 'import',
      input: 'hero.json',
      output: 'hero.spine',
      scale: 0.5,
      skeletonName: 'hero',
    });
    expect(result.ok && result.data).toEqual([
      '-i',
      'hero.json',
      '-s',
      '0.5',
      '-o',
      'hero.spine',
      '-r',
      'hero',
    ]);
  });

  it('omits the skeleton name when not renaming', () => {
    const result = buildCommandArgs({
      kind: 'import',
      input: 'hero.json',
      output: 'hero.spine',
    });
    expect(result.ok && result.data).toEqual([
      '-i',
      'hero.json',
      '-o',
      'hero.spine',
      '-r',
    ]);
  });

  it('rejects a non-positive import scale', () => {
    const result = buildCommandArgs({
      kind: 'import',
      input: 'hero.json',
      output: 'hero.spine',
      scale: 0,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('Invalid import scale');
  });

  it('builds a cleanup command that saves the project', () => {
    const result = buildCommandArgs({ kind: 'cleanup', input: 'projects/' });
    expect(result.ok && result.data).toEqual(['-i', 'projects/', '-m']);
  });
});

describe('buildArgs', () => {
  it('chains several commands after the editor flags', () => {
    const result = buildArgs(
      [
        { kind: 'export', input: 'a.spine', output: 'out/', exportSpec: 'e1.json' },
        { kind: 'export', input: 'b.spine', exportSpec: 'e2.json' },
        { kind: 'pack', input: 'images/', output: 'out/', packSpec: 'pack.json' },
      ],
      { update: '4.2.xx' },
    );

    expect(result.ok && result.data).toEqual([
      '--update',
      '4.2.xx',
      '-i',
      'a.spine',
      '-o',
      'out/',
      '-e',
      'e1.json',
      '-i',
      'b.spine',
      '-e',
      'e2.json',
      '-i',
      'images/',
      '-o',
      'out/',
      '-p',
      'pack.json',
    ]);
  });

  it('rejects an empty command list', () => {
    const result = buildArgs([]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe(SpineErrorCode.InvalidArgument);
  });

  it('propagates the first command error', () => {
    const result = buildArgs([
      { kind: 'info', input: 'ok.spine' },
      { kind: 'cleanup', input: '' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('keeps arguments separate so paths with spaces need no escaping', () => {
    const result = buildArgs([
      { kind: 'info', input: 'C:\\path with spaces\\hero.spine' },
    ]);
    expect(result.ok && result.data).toEqual([
      '-i',
      'C:\\path with spaces\\hero.spine',
    ]);
  });
});

describe('isExportShorthand', () => {
  it('recognises the four built-in shorthands', () => {
    for (const spec of ['json', 'binary', 'json+pack', 'binary+pack']) {
      expect(isExportShorthand(spec)).toBe(true);
    }
  });

  it('treats a settings path as not a shorthand', () => {
    expect(isExportShorthand('templates/export-settings/unity-binary.export.json')).toBe(
      false,
    );
  });
});

describe('formatCommandLine', () => {
  it('quotes only the parts containing whitespace', () => {
    expect(
      formatCommandLine('C:\\Program Files\\Spine Trial\\SpineTrial.com', [
        '-i',
        'C:\\p\\hero.spine',
        '-e',
        'binary',
      ]),
    ).toBe(
      '"C:\\Program Files\\Spine Trial\\SpineTrial.com" -i C:\\p\\hero.spine -e binary',
    );
  });
});
