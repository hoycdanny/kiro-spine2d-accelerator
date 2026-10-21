import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUILT_IN_PACK_TEMPLATES,
  exportSettingsBuild,
  packSettingsBuild,
  resolveTemplate,
} from '../../src/tools/settings-tools';
import { BUILT_IN_EXPORT_TEMPLATES } from '../../src/export-settings';
import { SpineErrorCode } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';

const REPO_ROOT = join(__dirname, '..', '..');
const PACKAGE_ROOT = 'C:\\power';

/** Load the real template files into the in-memory host. */
function templateFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of BUILT_IN_EXPORT_TEMPLATES) {
    // Key by the same path join() produces inside resolveTemplate.
    files[join(PACKAGE_ROOT, 'templates/export-settings', `${name}.export.json`)] =
      readFileSync(
        join(REPO_ROOT, 'templates', 'export-settings', `${name}.export.json`),
        'utf8',
      );
  }
  for (const name of BUILT_IN_PACK_TEMPLATES) {
    files[join(PACKAGE_ROOT, 'templates/pack-settings', `${name}.pack.json`)] =
      readFileSync(
        join(REPO_ROOT, 'templates', 'pack-settings', `${name}.pack.json`),
        'utf8',
      );
  }
  return files;
}

function makeHost() {
  return createFakeHost({
    packageRoot: PACKAGE_ROOT,
    files: {
      ...templateFiles(),
      'C:\\work\\project\\custom.export.json': JSON.stringify({
        class: 'export-json',
        extension: '.json',
        output: 'out/',
        input: '',
      }),
      'C:\\work\\project\\broken.json': '{ nope',
      'C:\\work\\project\\array.json': '[]',
    },
  });
}

describe('resolveTemplate', () => {
  const host = makeHost();

  it('resolves a bundled export template from the package root', () => {
    const result = resolveTemplate(host, 'web-json', 'export');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.path).toBe(
      join(PACKAGE_ROOT, 'templates/export-settings/web-json.export.json'),
    );
    expect(result.data.parsed['class']).toBe('export-json');
  });

  it('resolves a bundled pack template', () => {
    const result = resolveTemplate(host, 'pixelart', 'pack');
    expect(result.ok && result.data.parsed['filterMin']).toBe('Nearest');
  });

  it('resolves a workspace path', () => {
    const result = resolveTemplate(host, 'custom.export.json', 'export');
    expect(result.ok && result.data.parsed['class']).toBe('export-json');
  });

  it('lists the built-in names when a path is missing', () => {
    const result = resolveTemplate(host, 'nope.json', 'export');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InputMissing);
    expect(result.hint).toContain('unity-binary');
  });

  it('reports invalid JSON', () => {
    const result = resolveTemplate(host, 'broken.json', 'export');
    expect(!result.ok && result.code).toBe(SpineErrorCode.ParseFailed);
  });

  it('rejects a JSON array', () => {
    const result = resolveTemplate(host, 'array.json', 'export');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('must be a JSON object');
  });

  it('reports a missing bundled template as a broken install', () => {
    const bare = createFakeHost({ packageRoot: 'C:\\missing' });
    const result = resolveTemplate(bare, 'web-json', 'export');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.hint).toContain('Power package looks incomplete');
  });
});

describe('exportSettingsBuild', () => {
  it('previews without writing when no output is given', () => {
    const host = makeHost();
    const result = exportSettingsBuild(host, { template: 'web-json' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outputPath).toBeNull();
    expect(Object.keys(host.writes)).toEqual([]);
    expect(result.summary).toContain('Not written to disk');
  });

  it('writes the file inside the workspace', () => {
    const host = makeHost();
    const result = exportSettingsBuild(host, {
      template: 'unity-binary',
      overrides: { output: 'Assets/Spine/' },
      output: 'export/unity.export.json',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outputPath).toBe(
      'C:\\work\\project\\export\\unity.export.json',
    );
    const written = host.writes[result.data.outputPath!]!;
    expect(JSON.parse(written)['output']).toBe('Assets/Spine/');
    expect(written.endsWith('\n')).toBe(true);
  });

  it('always states the provenance caveat', () => {
    const host = makeHost();
    const result = exportSettingsBuild(host, { template: 'ci-batch' });
    expect(result.ok && result.summary).toContain('Calibrate with spine_export_settings_capture');
  });

  it('refuses an unknown override key', () => {
    const host = makeHost();
    const result = exportSettingsBuild(host, {
      template: 'web-json',
      overrides: { outptu: 'typo/' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
    expect(result.message).toContain('outptu');
  });

  it('refuses to write outside the workspace', () => {
    const host = makeHost();
    const result = exportSettingsBuild(host, {
      template: 'web-json',
      output: '../escape.json',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.PathNotAllowed);
    expect(Object.keys(host.writes)).toEqual([]);
  });
});

describe('packSettingsBuild', () => {
  it('starts from Spine defaults when no template is given', () => {
    const host = makeHost();
    const result = packSettingsBuild(host, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.templatePath).toBeNull();
    expect(result.data.built.changedKeys).toEqual([]);
    expect(result.summary).toContain('Non-default settings: none');
  });

  it('builds from a bundled template with overrides', () => {
    const host = makeHost();
    const result = packSettingsBuild(host, {
      template: 'unity-default',
      overrides: { maxWidth: 1024, maxHeight: 1024 },
      output: 'atlas/pack.json',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = JSON.parse(host.writes[result.data.outputPath!]!);
    expect(written['maxWidth']).toBe(1024);
    // The Unity template ships straight alpha and the .atlas.txt extension.
    expect(written['premultiplyAlpha']).toBe(false);
    expect(written['atlasExtension']).toBe('.atlas.txt');
    expect(written['multipleOfFour']).toBe(true);
    expect(result.summary).toContain('Pages up to 1024x1024');
  });

  it('always warns that the shorthand export ignores pack.json', () => {
    const host = makeHost();
    const result = packSettingsBuild(host, { template: 'web-pot' });
    expect(result.ok && result.summary).toContain('json+pack / binary+pack shorthands ignore it');
  });

  it('fails on an invalid override', () => {
    const host = makeHost();
    const result = packSettingsBuild(host, { overrides: { pot: 'yes' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
  });

  it('refuses to write outside the workspace', () => {
    const host = makeHost();
    const result = packSettingsBuild(host, { output: 'C:\\Windows\\pack.json' });
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
  });
});
