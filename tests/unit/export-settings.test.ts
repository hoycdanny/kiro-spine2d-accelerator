import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUILT_IN_EXPORT_TEMPLATES,
  applyExportOverrides,
  builtInTemplateRelativePath,
  explainExportSettings,
  isBuiltInTemplate,
  serializeExportSettings,
  validateExportSettings,
} from '../../src/export-settings';
import { SpineErrorCode } from '../../src/types';

const TEMPLATE_DIR = join(__dirname, '..', '..', 'templates', 'export-settings');

function loadTemplate(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TEMPLATE_DIR, `${name}.export.json`), 'utf8'));
}

describe('built-in template names', () => {
  it('recognises the bundled names', () => {
    for (const name of BUILT_IN_EXPORT_TEMPLATES) {
      expect(isBuiltInTemplate(name)).toBe(true);
    }
    expect(isBuiltInTemplate('something-else')).toBe(false);
  });

  it('maps a name to a path inside the package', () => {
    expect(builtInTemplateRelativePath('web-json')).toBe(
      'templates/export-settings/web-json.export.json',
    );
  });
});

describe('validateExportSettings', () => {
  it('requires a class', () => {
    const issues = validateExportSettings({ output: 'out/' });
    expect(issues[0]!.field).toBe('class');
    expect(issues[0]!.severity).toBe('error');
  });

  it('accepts the documented data-export classes', () => {
    for (const exportClass of ['export-json', 'export-binary']) {
      const issues = validateExportSettings({
        class: exportClass,
        output: 'out/',
        input: 'p.spine',
      });
      expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });

  it('notes an image or video export class as out of scope', () => {
    const issues = validateExportSettings({
      class: 'export-png',
      output: 'out/',
      input: 'p.spine',
    });
    const note = issues.find((issue) => issue.field === 'class');
    expect(note?.severity).toBe('info');
    expect(note?.fix).toContain('OpenGL');
  });

  it('type-checks known fields', () => {
    const issues = validateExportSettings({
      class: 'export-json',
      prettyPrint: 'yes',
      output: 'out/',
    });
    expect(issues.some((issue) => issue.field === 'prettyPrint')).toBe(true);
  });

  it('warns about a missing output path', () => {
    const issues = validateExportSettings({ class: 'export-json' });
    expect(issues.find((issue) => issue.field === 'output')?.severity).toBe('warning');
  });

  it('treats a missing input as informational, since -i overrides it', () => {
    const issues = validateExportSettings({ class: 'export-json', output: 'out/' });
    expect(issues.find((issue) => issue.field === 'input')?.severity).toBe('info');
  });

  it('notes that nonessential off blocks a Spine round trip', () => {
    const issues = validateExportSettings({
      class: 'export-binary',
      output: 'out/',
      input: 'p.spine',
      nonessential: false,
    });
    expect(issues.find((issue) => issue.field === 'nonessential')?.message).toContain(
      'imported back into Spine',
    );
  });
});

describe('applyExportOverrides', () => {
  const template = loadTemplate('web-json');

  it('applies a known key and records the change', () => {
    const result = applyExportOverrides(template, { prettyPrint: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.settings['prettyPrint']).toBe(false);
    expect(result.data.changed).toEqual([
      { key: 'prettyPrint', from: true, to: false },
    ]);
  });

  it('does not mutate the template', () => {
    const before = JSON.stringify(template);
    applyExportOverrides(template, { prettyPrint: false });
    expect(JSON.stringify(template)).toBe(before);
  });

  it('rejects an override key the template does not have', () => {
    const result = applyExportOverrides(template, { prettyPrintt: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
    expect(result.message).toContain('prettyPrintt');
    expect(result.hint).toContain('silently ignores unknown keys');
    expect(result.details?.['templateKeys']).toContain('prettyPrint');
  });

  it('permits a new key when explicitly allowed', () => {
    const result = applyExportOverrides(template, { futureField: 1 }, { allowNewKeys: true });
    expect(result.ok && result.data.settings['futureField']).toBe(1);
  });

  it('records overrides that matched the template as no-ops', () => {
    const result = applyExportOverrides(template, { prettyPrint: true });
    expect(result.ok && result.data.noopKeys).toEqual(['prettyPrint']);
    expect(result.ok && result.data.changed).toEqual([]);
  });

  it('supports one level of nesting with a dotted key', () => {
    const nested = { class: 'export-json', output: 'out/', packAtlas: { pot: false } };
    const result = applyExportOverrides(nested, { 'packAtlas.pot': true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data.settings['packAtlas'] as Record<string, unknown>)['pot']).toBe(true);
  });

  it('rejects a dotted key whose container is not an object', () => {
    const result = applyExportOverrides(template, { 'packAtlas.pot': true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('packAtlas.pot');
  });

  it('rejects a dotted key that the nested object lacks', () => {
    const nested = { class: 'export-json', output: 'out/', packAtlas: { pot: false } };
    const result = applyExportOverrides(nested, { 'packAtlas.nope': true });
    expect(result.ok).toBe(false);
  });

  it('fails when an override makes the settings invalid', () => {
    const result = applyExportOverrides(template, { prettyPrint: 'yes' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
  });
});

describe('serializeExportSettings', () => {
  it('writes pretty JSON ending in a newline', () => {
    const text = serializeExportSettings({ class: 'export-json' });
    expect(text).toBe('{\n  "class": "export-json"\n}\n');
  });
});

describe('explainExportSettings', () => {
  it('describes a binary export and lists the changes', () => {
    const result = applyExportOverrides(loadTemplate('unity-binary'), {
      output: 'Assets/Spine/',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const explanation = explainExportSettings(result.data);
    expect(explanation).toContain('Binary data export');
    expect(explanation).toContain('Assets/Spine/');
    expect(explanation).toContain('smaller and much faster to load');
    expect(explanation).toContain('changed output');
  });

  it('describes a JSON export', () => {
    const result = applyExportOverrides(loadTemplate('web-json'), { output: 'public/' });
    if (!result.ok) return;
    expect(explainExportSettings(result.data)).toContain('human readable');
  });
});

describe('bundled export templates', () => {
  for (const name of BUILT_IN_EXPORT_TEMPLATES) {
    it(`${name} parses and carries no blocking issues`, () => {
      const template = loadTemplate(name);
      const issues = validateExportSettings(template);
      expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      expect(typeof template['class']).toBe('string');
      expect(template).toHaveProperty('input');
      expect(template).toHaveProperty('output');
    });
  }

  it('unity-binary targets binary data with the extension Unity requires', () => {
    const template = loadTemplate('unity-binary');
    expect(template['class']).toBe('export-binary');
    // spine-unity cannot load files with a plain .skel extension.
    expect(template['extension']).toBe('.skel.bytes');
  });

  it('web-json pretty-prints with nonessential data for tooling', () => {
    const template = loadTemplate('web-json');
    expect(template['class']).toBe('export-json');
    expect(template['prettyPrint']).toBe(true);
    expect(template['nonessential']).toBe(true);
  });

  it('ci-batch runs clean up and suppresses warning dialogs', () => {
    const template = loadTemplate('ci-batch');
    expect(template['cleanUp']).toBe(true);
    expect(template['warnings']).toBe(false);
  });

  it('ships a README documenting provenance and calibration', () => {
    const readme = readFileSync(join(TEMPLATE_DIR, 'README.md'), 'utf8');
    expect(readme).toContain('--last-export-settings');
    expect(readme).toContain('been validated against a real verified export');
  });
});
