import { SpawnFn, SpawnOutcome } from '../../src/cli-runner';
import {
  looksLikePath,
  resolveCommand,
  spineBatch,
  spineCleanup,
  spineExport,
  spineExportSettingsCapture,
  spineImport,
  spinePack,
  spineUnpack,
} from '../../src/tools/export-tools';
import { SpineErrorCode } from '../../src/types';
import { LICENSED_EXECUTABLE, createFakeHost } from '../helpers/fake-host';

const COMPLETE_OUTPUT = [
  'Spine Launcher 4.2.37',
  'Starting: Spine 4.2.37',
  'Complete.',
].join('\n');

const HANDOFF_OUTPUT = ['Spine Launcher 4.2.37', 'Starting: Spine 4.2.37', 'Started.'].join(
  '\n',
);

interface SpawnRecord {
  executable?: string;
  args?: string[];
}

function spawnWith(outcome: Partial<SpawnOutcome>, record?: SpawnRecord): SpawnFn {
  return async (executable, args) => {
    if (record) {
      record.executable = executable;
      record.args = args;
    }
    return {
      code: 0,
      stdout: COMPLETE_OUTPUT,
      stderr: '',
      timedOut: false,
      durationMs: 4200,
      ...outcome,
    };
  };
}

const PROJECT = 'C:\\work\\project\\art\\hero.spine';
const SETTINGS = 'C:\\work\\project\\export\\unity.export.json';
const PACK_SETTINGS = 'C:\\work\\project\\export\\pack.json';
const ATLAS = 'C:\\work\\project\\atlas\\hero.atlas';
const IMAGES = 'C:\\work\\project\\art\\images';
const ATLAS_DIR = 'C:\\work\\project\\atlas';
const SKELETON_JSON = 'C:\\work\\project\\export\\hero.json';

function licensedHost() {
  return createFakeHost({
    edition: 'licensed',
    paths: [PROJECT, IMAGES, ATLAS, ATLAS_DIR],
    files: {
      [SETTINGS]: '{"class":"export-binary"}',
      [PACK_SETTINGS]: '{"pot":true}',
      [SKELETON_JSON]: '{"skeleton":{}}',
    },
  });
}

function trialHost() {
  return createFakeHost({
    edition: 'trial',
    paths: [PROJECT, IMAGES, ATLAS, ATLAS_DIR],
    files: { [SETTINGS]: '{"class":"export-binary"}' },
  });
}

describe('looksLikePath', () => {
  it('treats separators and .json as a path', () => {
    expect(looksLikePath('export/pack.json')).toBe(true);
    expect(looksLikePath('pack.json')).toBe(true);
    expect(looksLikePath('C:\\a\\pack.json')).toBe(true);
  });

  it('treats a bare name as an atlas name', () => {
    expect(looksLikePath('hero')).toBe(false);
  });
});

describe('resolveCommand', () => {
  const host = licensedHost();

  it('resolves an export with a settings file', () => {
    const result = resolveCommand(host, {
      kind: 'export',
      input: 'art/hero.spine',
      output: 'build/spine',
      exportSpec: 'export/unity.export.json',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.command).toEqual({
      kind: 'export',
      input: PROJECT,
      output: 'C:\\work\\project\\build\\spine',
      exportSpec: SETTINGS,
    });
  });

  it('warns that a +pack shorthand ignores pack.json', () => {
    const result = resolveCommand(host, {
      kind: 'export',
      input: 'art/hero.spine',
      exportSpec: 'binary+pack',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.notes.join(' ')).toContain('ignores pack.json');
  });

  it('requires an input for a shorthand export', () => {
    const result = resolveCommand(host, { kind: 'export', exportSpec: 'binary' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.message).toContain('needs an input path');
  });

  it('suggests the shorthands when a settings file is missing', () => {
    const result = resolveCommand(host, {
      kind: 'export',
      input: 'art/hero.spine',
      exportSpec: 'export/missing.export.json',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.hint).toContain('json+pack');
    expect(result.hint).toContain('export_settings_build');
  });

  it('refuses an export output outside the workspace', () => {
    const result = resolveCommand(host, {
      kind: 'export',
      input: 'art/hero.spine',
      output: '../outside',
      exportSpec: 'binary',
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
  });

  it('notes when a pack spec is only an atlas name', () => {
    const result = resolveCommand(host, {
      kind: 'pack',
      input: 'art/images',
      output: 'atlas',
      packSpec: 'hero',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.notes.join(' ')).toContain('treated as the atlas name');
    expect(result.data.notes.join(' ')).toContain('Polygon packing');
  });

  it('resolves pack projects and keeps their order', () => {
    const result = resolveCommand(host, {
      kind: 'pack',
      input: 'art/images',
      output: 'atlas',
      packSpec: 'export/pack.json',
      projects: ['art/hero.spine'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.command).toMatchObject({
      packSpec: PACK_SETTINGS,
      projects: [PROJECT],
    });
    expect(result.data.notes.join(' ')).not.toContain('Polygon packing');
  });

  it('reports a missing pack project', () => {
    const result = resolveCommand(host, {
      kind: 'pack',
      input: 'art/images',
      output: 'atlas',
      packSpec: 'hero',
      projects: ['art/ghost.spine'],
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });

  it('resolves an unpack and warns about missing project context', () => {
    const result = resolveCommand(host, {
      kind: 'unpack',
      input: 'atlas',
      output: 'unpacked',
      atlas: 'atlas/hero.atlas',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.notes.join(' ')).toContain('polygons cannot be fully restored');
  });

  it('notes when an import target already exists', () => {
    const result = resolveCommand(host, {
      kind: 'import',
      input: 'export/hero.json',
      output: 'art/hero.spine',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.notes.join(' ')).toContain('already exists');
  });

  it('refuses clean up without confirmation', () => {
    const result = resolveCommand(host, { kind: 'cleanup', input: 'art/hero.spine' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.hint).toContain('confirm: true');
  });

  it('allows clean up once confirmed and states the consequence', () => {
    const result = resolveCommand(host, {
      kind: 'cleanup',
      input: 'art/hero.spine',
      confirm: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.notes.join(' ')).toContain('no undo outside version control');
  });

  it('notes that last-export-settings defaults to writing next to the project', () => {
    const result = resolveCommand(host, {
      kind: 'last-export-settings',
      input: 'art/hero.spine',
    });
    expect(result.ok && result.data.notes.join(' ')).toContain('next to the project');
  });
});

describe('capability gating on a trial', () => {
  it('refuses an export and shows the command it would have run', async () => {
    const host = trialHost();
    let spawned = false;
    const result = await spineExport(
      host,
      async () => {
        spawned = true;
        return { code: 0, stdout: '', stderr: '', timedOut: false, durationMs: 0 };
      },
      { input: 'art/hero.spine', exportSpec: 'binary' },
    );

    expect(spawned).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CapabilityDenied);
    expect(result.message).toContain('exporting skeleton data');
    expect(String(result.details?.['wouldHaveRun'])).toContain('-e binary');
    expect(result.hint).toContain('Purchase a Spine license');
  });

  it('refuses pack, import and cleanup too', async () => {
    const host = trialHost();
    const spawn = spawnWith({});

    const pack = await spinePack(host, spawn, {
      input: 'art/images',
      output: 'atlas',
      packSpec: 'hero',
    });
    const importResult = await spineImport(host, spawn, {
      input: 'export/unity.export.json',
      output: 'art/new.spine',
    });
    const cleanup = await spineCleanup(host, spawn, {
      input: 'art/hero.spine',
      confirm: true,
    });

    for (const result of [pack, importResult, cleanup]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe(SpineErrorCode.CapabilityDenied);
    }
  });

  it('refuses a whole batch when one command is blocked', async () => {
    const host = trialHost();
    const result = await spineBatch(host, spawnWith({}), {
      commands: [
        { kind: 'info', input: 'art/hero.spine' },
        { kind: 'export', input: 'art/hero.spine', exportSpec: 'binary' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CapabilityDenied);
    expect(result.message).toContain('exporting skeleton data (export)');
  });
});

describe('licensed runs', () => {
  it('builds the export command line', async () => {
    const host = licensedHost();
    const record: SpawnRecord = {};
    const result = await spineExport(host, spawnWith({}, record), {
      input: 'art/hero.spine',
      output: 'build/spine',
      exportSpec: 'export/unity.export.json',
      clean: true,
      update: '4.2.xx',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(record.executable).toBe(LICENSED_EXECUTABLE);
    expect(record.args).toEqual([
      '--update',
      '4.2.xx',
      '-i',
      PROJECT,
      '-m',
      '-o',
      'C:\\work\\project\\build\\spine',
      '-e',
      SETTINGS,
    ]);
    expect(result.data.result.completed).toBe(true);
    expect(result.summary).toContain('Export completed');
  });

  it('builds the pack command line with projects', async () => {
    const host = licensedHost();
    const record: SpawnRecord = {};
    await spinePack(host, spawnWith({}, record), {
      input: 'art/images',
      output: 'atlas',
      packSpec: 'export/pack.json',
      name: 'hero',
      projects: ['art/hero.spine'],
    });

    expect(record.args).toEqual([
      '-i',
      IMAGES,
      '-j',
      PROJECT,
      '-o',
      'C:\\work\\project\\atlas',
      '-n',
      'hero',
      '-p',
      PACK_SETTINGS,
    ]);
  });

  it('builds the unpack command line', async () => {
    const host = licensedHost();
    const record: SpawnRecord = {};
    await spineUnpack(host, spawnWith({}, record), {
      input: 'atlas',
      output: 'unpacked',
      atlas: 'atlas/hero.atlas',
    });

    expect(record.args).toEqual([
      '-i',
      'C:\\work\\project\\atlas',
      '-o',
      'C:\\work\\project\\unpacked',
      '-c',
      ATLAS,
    ]);
  });

  it('builds the import command line with scale and rename', async () => {
    const host = licensedHost();
    const record: SpawnRecord = {};
    await spineImport(host, spawnWith({}, record), {
      input: 'export/hero.json',
      output: 'art/generated.spine',
      scale: 0.5,
      skeletonName: 'hero',
    });

    expect(record.args).toEqual([
      '-i',
      SKELETON_JSON,
      '-s',
      '0.5',
      '-o',
      'C:\\work\\project\\art\\generated.spine',
      '-r',
      'hero',
    ]);
  });

  it('builds the cleanup command line', async () => {
    const host = licensedHost();
    const record: SpawnRecord = {};
    await spineCleanup(host, spawnWith({}, record), {
      input: 'art/hero.spine',
      confirm: true,
    });
    expect(record.args).toEqual(['-i', PROJECT, '-m']);
  });

  it('captures export settings and points at the calibration step', async () => {
    const host = licensedHost();
    const record: SpawnRecord = {};
    const result = await spineExportSettingsCapture(host, spawnWith({}, record), {
      input: 'art/hero.spine',
      output: 'export/captured.export.json',
    });

    expect(record.args).toEqual([
      '-i',
      PROJECT,
      '-o',
      'C:\\work\\project\\export\\captured.export.json',
      '--last-export-settings',
    ]);
    expect(result.ok && result.summary).toContain('calibrate the bundled templates');
  });

  it('chains a batch into a single invocation', async () => {
    const host = licensedHost();
    const record: SpawnRecord = {};
    const result = await spineBatch(host, spawnWith({}, record), {
      commands: [
        {
          kind: 'export',
          input: 'art/hero.spine',
          output: 'build',
          exportSpec: 'binary',
        },
        {
          kind: 'pack',
          input: 'art/images',
          output: 'atlas',
          packSpec: 'export/pack.json',
          projects: ['art/hero.spine'],
        },
      ],
      cleanAll: true,
      update: '4.2.37',
    });

    expect(result.ok).toBe(true);
    expect(record.args).toEqual([
      '--update',
      '4.2.37',
      '--clean-all',
      '-i',
      PROJECT,
      '-o',
      'C:\\work\\project\\build',
      '-e',
      'binary',
      '-i',
      IMAGES,
      '-j',
      PROJECT,
      '-o',
      'C:\\work\\project\\atlas',
      '-p',
      PACK_SETTINGS,
    ]);
  });

  it('reports which batch entry failed to resolve', async () => {
    const host = licensedHost();
    const result = await spineBatch(host, spawnWith({}), {
      commands: [
        { kind: 'info', input: 'art/hero.spine' },
        { kind: 'cleanup', input: 'art/hero.spine' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Command 2 (cleanup)');
  });

  it('rejects an empty batch', async () => {
    const result = await spineBatch(licensedHost(), spawnWith({}), { commands: [] });
    expect(!result.ok && result.code).toBe(SpineErrorCode.InvalidArgument);
  });

  it('fails when Spine hands off to a running editor', async () => {
    const result = await spineExport(
      licensedHost(),
      spawnWith({ stdout: HANDOFF_OUTPUT }),
      { input: 'art/hero.spine', exportSpec: 'binary' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliFailed);
    expect(result.hint).toContain('Close any running Spine editor');
  });

  it('propagates a non-zero exit code', async () => {
    const result = await spineExport(
      licensedHost(),
      spawnWith({ code: 1, stderr: 'Error: invalid export settings' }),
      { input: 'art/hero.spine', exportSpec: 'binary' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliFailed);
    expect(result.message).toContain('invalid export settings');
  });

  it('notes a zero exit without the Complete. marker', async () => {
    const result = await spineExport(
      licensedHost(),
      spawnWith({ stdout: 'Spine Launcher 4.2.37\nStarting: Spine 4.2.37' }),
      { input: 'art/hero.spine', exportSpec: 'binary' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.result.completed).toBe(false);
    expect(result.summary).toContain('did not print "Complete."');
  });
});
