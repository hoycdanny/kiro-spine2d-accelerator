import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_PACK_SETTINGS,
  PACK_SETTING_KEYS,
  buildPackSettings,
  explainPackSettings,
  serializePackSettings,
  validatePackSettings,
} from '../../src/pack-settings';
import { SpineErrorCode } from '../../src/types';

const TEMPLATE_DIR = join(__dirname, '..', '..', 'templates', 'pack-settings');

function loadTemplate(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TEMPLATE_DIR, `${name}.pack.json`), 'utf8'));
}

describe('validatePackSettings', () => {
  it('accepts the documented defaults', () => {
    expect(validatePackSettings(DEFAULT_PACK_SETTINGS as never)).toEqual([]);
  });

  it('rejects an unknown key, because Spine ignores it silently', () => {
    const issues = validatePackSettings({ premultiplyAlpa: true });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.message).toContain('not a texture packer setting');
  });

  it('type-checks booleans', () => {
    const issues = validatePackSettings({ pot: 'yes' });
    expect(issues[0]!.field).toBe('pot');
    expect(issues[0]!.message).toContain('must be a boolean');
  });

  it('requires non-negative integers for sizes and padding', () => {
    expect(validatePackSettings({ paddingX: -1 })[0]!.field).toBe('paddingX');
    expect(validatePackSettings({ maxWidth: 1024.5 })[0]!.field).toBe('maxWidth');
  });

  it('validates enum values', () => {
    expect(validatePackSettings({ filterMin: 'Trilinear' })[0]!.message).toContain(
      'must be one of',
    );
    expect(validatePackSettings({ packing: 'hexagons' })[0]!.field).toBe('packing');
    expect(validatePackSettings({ format: 'RGBA9999' })[0]!.field).toBe('format');
    expect(validatePackSettings({ wrapX: 'Clamp' })[0]!.field).toBe('wrapX');
    expect(validatePackSettings({ outputFormat: 'webp' })[0]!.field).toBe('outputFormat');
  });

  it('range-checks alphaThreshold and jpegQuality', () => {
    expect(validatePackSettings({ alphaThreshold: 300 })[0]!.field).toBe('alphaThreshold');
    expect(validatePackSettings({ jpegQuality: 90 })[0]!.field).toBe('jpegQuality');
    expect(validatePackSettings({ jpegQuality: 0.5 })).toEqual([]);
  });

  it('validates the scale arrays', () => {
    expect(validatePackSettings({ scale: [] })[0]!.field).toBe('scale');
    expect(validatePackSettings({ scale: [0] })[0]!.message).toContain(
      'greater than zero',
    );
    expect(validatePackSettings({ scale: ['1'] })[0]!.field).toBe('scale');
    expect(validatePackSettings({ scaleResampling: ['sinc'] })[0]!.field).toBe(
      'scaleResampling',
    );
  });

  it('flags a scaleSuffix list that does not match scale', () => {
    const issues = validatePackSettings({ scale: [1, 0.5], scaleSuffix: ['@1x'] });
    expect(issues.some((issue) => issue.field === 'scaleSuffix')).toBe(true);
  });

  it('flags max smaller than min', () => {
    expect(
      validatePackSettings({ minWidth: 2048, maxWidth: 512 }).some(
        (issue) => issue.field === 'maxWidth',
      ),
    ).toBe(true);
    expect(
      validatePackSettings({ minHeight: 2048, maxHeight: 512 }).some(
        (issue) => issue.field === 'maxHeight',
      ),
    ).toBe(true);
  });

  it('warns about polygon packing without project context', () => {
    const issues = validatePackSettings({ packing: 'polygons', currentProject: false });
    const warning = issues.find((issue) => issue.field === 'packing');
    expect(warning?.severity).toBe('warning');
    expect(warning?.fix).toContain('--project');
  });

  it('warns about jpg output with premultiplied alpha', () => {
    const issues = validatePackSettings({ outputFormat: 'jpg', premultiplyAlpha: true });
    expect(issues.some((issue) => issue.field === 'outputFormat')).toBe(true);
  });

  it('warns about zero padding with linear filtering', () => {
    const issues = validatePackSettings({ paddingX: 0, paddingY: 0 });
    expect(issues.some((issue) => issue.field === 'paddingX')).toBe(true);
  });

  it('does not warn about zero padding for pixel art', () => {
    const issues = validatePackSettings({
      paddingX: 0,
      paddingY: 0,
      filterMin: 'Nearest',
      filterMag: 'Nearest',
    });
    expect(issues.filter((issue) => issue.field === 'paddingX')).toHaveLength(0);
  });

  it('notes that multipleOfFour is redundant with pot', () => {
    const issues = validatePackSettings({ pot: true, multipleOfFour: true });
    expect(issues.some((issue) => issue.field === 'multipleOfFour')).toBe(true);
  });
});

describe('buildPackSettings', () => {
  it('fills every field so defaults cannot shift underneath a project', () => {
    const result = buildPackSettings({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data.settings).sort()).toEqual([...PACK_SETTING_KEYS].sort());
    expect(result.data.changedKeys).toEqual([]);
  });

  it('reports which values differ from Spine defaults', () => {
    const result = buildPackSettings({}, { pot: true, maxWidth: 1024 });
    expect(result.ok && result.data.changedKeys.sort()).toEqual(['maxWidth', 'pot']);
  });

  it('lets overrides win over the template', () => {
    const result = buildPackSettings({ maxWidth: 2048 }, { maxWidth: 512 });
    expect(result.ok && result.data.settings.maxWidth).toBe(512);
  });

  it('fails on an invalid override', () => {
    const result = buildPackSettings({}, { packing: 'hexagons' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
  });

  it('fails on an invalid template', () => {
    const result = buildPackSettings({ filterMin: 'Trilinear' } as never);
    expect(result.ok).toBe(false);
  });

  it('keeps warnings without failing', () => {
    const result = buildPackSettings({}, { paddingX: 0, paddingY: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });
});

describe('serializePackSettings', () => {
  it('writes pretty JSON ending in a newline', () => {
    const text = serializePackSettings(DEFAULT_PACK_SETTINGS);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(DEFAULT_PACK_SETTINGS);
  });
});

describe('explainPackSettings', () => {
  it('explains page limits, filtering and premultiplied alpha', () => {
    const result = buildPackSettings(loadTemplate('web-pot'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const explanation = explainPackSettings(result.data);
    expect(explanation).toContain('power-of-two');
    expect(explanation).toContain('polygons packing');
    expect(explanation).toContain('Premultiplied alpha on');
    expect(explanation).toContain('Multi-scale output: 1, 0.5');
  });

  it('surfaces warnings in the explanation', () => {
    const result = buildPackSettings({}, { outputFormat: 'jpg' });
    if (!result.ok) return;
    expect(explainPackSettings(result.data)).toContain('Warning (outputFormat)');
  });
});

describe('bundled pack templates', () => {
  for (const name of ['unity-default', 'web-pot', 'pixelart']) {
    it(`${name} is valid and complete`, () => {
      const template = loadTemplate(name);
      expect(validatePackSettings(template).filter((issue) => issue.severity === 'error')).toEqual(
        [],
      );
      // Every template is explicit about every setting.
      expect(Object.keys(template).sort()).toEqual([...PACK_SETTING_KEYS].sort());
    });
  }

  it('pixelart uses nearest filtering and no whitespace stripping', () => {
    const template = loadTemplate('pixelart');
    expect(template['filterMin']).toBe('Nearest');
    expect(template['filterMag']).toBe('Nearest');
    expect(template['stripWhitespaceX']).toBe(false);
    expect(template['rotation']).toBe(false);
    expect(template['premultiplyAlpha']).toBe(false);
  });

  it('web-pot forces power-of-two pages', () => {
    expect(loadTemplate('web-pot')['pot']).toBe(true);
  });

  it('unity-default uses straight alpha and the .atlas.txt extension', () => {
    const template = loadTemplate('unity-default');
    // spine-unity cannot load a plain .atlas, and straight alpha
    // (premultiply off + bleed on) is the choice that works in both Linear
    // and Gamma colour space.
    expect(template['atlasExtension']).toBe('.atlas.txt');
    expect(template['premultiplyAlpha']).toBe(false);
    expect(template['bleed']).toBe(true);
  });
});
