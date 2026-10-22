import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { inspectAtlasText } from '../../src/atlas-data';
import {
  BrowserLauncher,
  RUNTIME_RELATIVE_PATH,
  loadRuntimeSource,
} from '../../src/preview-renderer';
import {
  DEFAULT_SAMPLE_COUNT,
  evenSampleTimes,
  exportInteractivePreview,
  frameFileName,
  loadAtlasImages,
  renderPreview,
} from '../../src/tools/preview-tools';
import { SpineErrorCode } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';
import {
  RENDERABLE_ATLAS,
  RENDERABLE_SKELETON,
  toJsonText,
} from '../helpers/fixtures';
import { encodePng, solidImage } from '../helpers/png';

const SKELETON = 'C:\\work\\project\\export\\hero.json';
const ATLAS = 'C:\\work\\project\\export\\hero.atlas';
const PAGE = 'C:\\work\\project\\export\\fixture.png';
const PNG = encodePng(solidImage(8, 8, [255, 0, 0, 255]));

const REPO_ROOT = join(__dirname, '..', '..');
/** The in-memory host needs the real runtime file at its real path. */
const RUNTIME_PATH = join(REPO_ROOT, RUNTIME_RELATIVE_PATH);
const RUNTIME_SOURCE = readFileSync(RUNTIME_PATH, 'utf8');

function previewHost() {
  return createFakeHost({
    files: {
      [SKELETON]: toJsonText(RENDERABLE_SKELETON),
      [ATLAS]: RENDERABLE_ATLAS,
      [RUNTIME_PATH]: RUNTIME_SOURCE,
    },
    binaries: { [PAGE]: PNG },
  });
}

/** A launcher that records the input and returns canned frames. */
function stubLauncher(
  capture: { input?: Record<string, unknown> } = {},
  options: { fail?: string; coverage?: number } = {},
): BrowserLauncher {
  return async () => ({
    newPage: async () => ({
      setContent: async () => {},
      on: () => {},
      evaluate: async (_fn: unknown, input: unknown) => {
        if (options.fail) throw new Error(options.fail);
        capture.input = input as Record<string, unknown>;
        const times = (input as { times: number[] }).times;
        return {
          frames: times.map((time) => ({
            time,
            dataUrl: `data:image/png;base64,${PNG.toString('base64')}`,
            coverage: options.coverage ?? 0.5,
          })),
          bounds: { x: -32, y: 0, width: 64, height: 64 },
          animations: ['spin'],
          skins: ['default'],
          warnings: [],
          spineVersion: '4.2.37',
        } as never;
      },
    }),
    close: async () => {},
  });
}

describe('evenSampleTimes', () => {
  it('spreads samples from 0 to the duration inclusive', () => {
    expect(evenSampleTimes(1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('returns a single zero for one sample or no duration', () => {
    expect(evenSampleTimes(1, 1)).toEqual([0]);
    expect(evenSampleTimes(0, 4)).toEqual([0]);
  });
});

describe('frameFileName', () => {
  it('encodes animation, index and time', () => {
    expect(frameFileName('walk', 0.25, 1)).toBe('walk-01-0_250s.png');
  });

  it('labels a setup-pose render', () => {
    expect(frameFileName(null, 0, 0)).toBe('setup-00-0_000s.png');
  });

  it('sanitises names that are not file-safe', () => {
    expect(frameFileName('jump up!', 0, 0)).toBe('jump-up--00-0_000s.png');
  });
});

describe('loadAtlasImages', () => {
  it('reads page images from beside the atlas', () => {
    const host = previewHost();
    const atlas = inspectAtlasText(RENDERABLE_ATLAS);
    if (!atlas.ok) throw new Error('fixture atlas failed to parse');

    const result = loadAtlasImages(host, ATLAS, atlas.data);
    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.data)).toEqual(['fixture.png']);
  });

  it('names the missing page images and where it looked', () => {
    const host = createFakeHost({ files: { [ATLAS]: RENDERABLE_ATLAS } });
    const atlas = inspectAtlasText(RENDERABLE_ATLAS);
    if (!atlas.ok) throw new Error('fixture atlas failed to parse');

    const result = loadAtlasImages(host, ATLAS, atlas.data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InputMissing);
    expect(result.hint).toContain('imageDir');
  });
});

describe('loadRuntimeSource', () => {
  it('reports a missing runtime as a dependency problem', () => {
    const host = createFakeHost({ packageRoot: 'C:\\nowhere' });
    const result = loadRuntimeSource(host);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.DependencyMissing);
    expect(result.hint).toContain('spine-webgl');
  });
});

describe('renderPreview', () => {
  it('samples the animation duration when no times are given', async () => {
    const host = previewHost();
    const capture: { input?: Record<string, unknown> } = {};
    const result = await renderPreview(host, stubLauncher(capture), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.animation).toBe('spin');
    expect(result.data.times).toHaveLength(DEFAULT_SAMPLE_COUNT);
    expect(result.data.times[result.data.times.length - 1]).toBeCloseTo(1);
  });

  it('honours explicit times', async () => {
    const host = previewHost();
    const result = await renderPreview(host, stubLauncher(), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      times: [0, 0.5],
    });
    expect(result.ok && result.data.times).toEqual([0, 0.5]);
  });

  it('takes premultiplied alpha from the atlas by default', async () => {
    const host = previewHost();
    const capture: { input?: Record<string, unknown> } = {};
    await renderPreview(host, stubLauncher(capture), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      times: [0],
    });
    // The fixture atlas declares pma: false.
    expect(capture.input?.['premultipliedAlpha']).toBe(false);
  });

  it('lets the caller override premultiplied alpha', async () => {
    const host = previewHost();
    const capture: { input?: Record<string, unknown> } = {};
    await renderPreview(host, stubLauncher(capture), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      times: [0],
      premultipliedAlpha: true,
    });
    expect(capture.input?.['premultipliedAlpha']).toBe(true);
  });

  it('writes PNGs with stable names', async () => {
    const host = previewHost();
    const result = await renderPreview(host, stubLauncher(), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      times: [0, 0.5],
      outputDir: 'preview',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.files).toEqual([
      'C:\\work\\project\\preview\\spin-00-0_000s.png',
      'C:\\work\\project\\preview\\spin-01-0_500s.png',
    ]);
    expect(Object.keys(host.binaryWrites)).toEqual(result.data.files);
  });

  it('does not write when no output directory is given', async () => {
    const host = previewHost();
    const result = await renderPreview(host, stubLauncher(), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      times: [0],
    });
    expect(result.ok && result.data.outputDir).toBeNull();
    expect(Object.keys(host.binaryWrites)).toEqual([]);
    expect(result.ok && result.summary).toContain('Not written to disk');
  });

  it('refuses an output directory outside the workspace', async () => {
    const host = previewHost();
    const result = await renderPreview(host, stubLauncher(), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      times: [0],
      outputDir: '../escape',
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
  });

  it('rejects an animation that does not exist and lists the real ones', async () => {
    const host = previewHost();
    const result = await renderPreview(host, stubLauncher(), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      animation: 'nope',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.hint).toContain('spin');
  });

  it('warns when every frame is empty', async () => {
    const host = previewHost();
    const result = await renderPreview(host, stubLauncher({}, { coverage: 0 }), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      times: [0],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('Every frame is empty');
  });

  it('maps a missing browser onto DEPENDENCY_MISSING', async () => {
    const host = previewHost();
    const result = await renderPreview(
      host,
      stubLauncher({}, { fail: 'DEPENDENCY_MISSING: Chromium failed to launch' }),
      { skeleton: 'export/hero.json', atlas: 'export/hero.atlas', times: [0] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.DependencyMissing);
  });

  it('maps a render failure onto CLI_FAILED with a diagnostic hint', async () => {
    const host = previewHost();
    const result = await renderPreview(
      host,
      stubLauncher({}, { fail: 'No image was supplied for atlas page "x.png".' }),
      { skeleton: 'export/hero.json', atlas: 'export/hero.atlas', times: [0] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliFailed);
    expect(result.hint).toContain('major.minor must match');
  });

  it('reports a missing skeleton file', async () => {
    const host = previewHost();
    const result = await renderPreview(host, stubLauncher(), {
      skeleton: 'export/nope.json',
      atlas: 'export/hero.atlas',
    });
    expect(!result.ok && result.code).toBe(SpineErrorCode.InputMissing);
  });
});

// Deliberately no launcher anywhere below: generating the standalone page
// needs the runtime file and the exported data, nothing else. That is what
// makes it usable on a machine without Chromium.
describe('exportInteractivePreview', () => {
  const ARGS = {
    skeleton: 'export/hero.json',
    atlas: 'export/hero.atlas',
    output: 'preview/hero.html',
  };

  it('writes exactly one HTML file at the resolved path', () => {
    const host = previewHost();
    const result = exportInteractivePreview(host, ARGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outputFile).toBe('C:\\work\\project\\preview\\hero.html');
    expect(Object.keys(host.writes)).toEqual(['C:\\work\\project\\preview\\hero.html']);
    expect(Object.keys(host.binaryWrites)).toEqual([]);
  });

  it('reports what it embedded, without the HTML itself', () => {
    const host = previewHost();
    const result = exportInteractivePreview(host, ARGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.animation).toBe('spin');
    expect(result.data.animations).toEqual(['spin']);
    expect(result.data.skins).toEqual(['default']);
    expect(result.data.pages).toEqual(['fixture.png']);
    expect(result.data.spineVersion).toBe('4.2.37');
    // The runtime alone is over 200 KB, so a small file means it is missing.
    expect(result.data.bytes).toBeGreaterThan(200_000);
    expect(JSON.stringify(result.data)).not.toContain('<!DOCTYPE html>');
  });

  it('embeds the runtime, the data and the page image in the written file', () => {
    const host = previewHost();
    const result = exportInteractivePreview(host, ARGS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const html = host.writes[result.data.outputFile]!;
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('bounds: 0, 0, 64, 64');
    expect(html).toContain('id="timeline"');
  });

  it('says in the summary that it needs no server, and names the licence', () => {
    const host = previewHost();
    const result = exportInteractivePreview(host, ARGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('spine-purchase');
    expect(result.summary).toContain('no server');
    expect(result.summary).toContain('KB');
  });

  it('refuses an output path outside the workspace', () => {
    const host = previewHost();
    const result = exportInteractivePreview(host, { ...ARGS, output: '../escape' });
    expect(!result.ok && result.code).toBe(SpineErrorCode.PathNotAllowed);
  });

  it('reports a missing atlas page image rather than writing a blank page', () => {
    const host = createFakeHost({
      files: {
        [SKELETON]: toJsonText(RENDERABLE_SKELETON),
        [ATLAS]: RENDERABLE_ATLAS,
        [RUNTIME_PATH]: RUNTIME_SOURCE,
      },
    });
    const result = exportInteractivePreview(host, ARGS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InputMissing);
    expect(result.hint).toContain('imageDir');
    expect(Object.keys(host.writes)).toEqual([]);
  });

  it('reports a missing spine-webgl install as a dependency problem', () => {
    const host = createFakeHost({
      files: { [SKELETON]: toJsonText(RENDERABLE_SKELETON), [ATLAS]: RENDERABLE_ATLAS },
      binaries: { [PAGE]: PNG },
      packageRoot: 'C:\\nowhere',
    });
    const result = exportInteractivePreview(host, ARGS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.DependencyMissing);
    expect(result.hint).toContain('spine-webgl');
  });

  it('rejects an animation that does not exist and lists the real ones', () => {
    const host = previewHost();
    const result = exportInteractivePreview(host, { ...ARGS, animation: 'nope' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.hint).toContain('spin');
  });
});
