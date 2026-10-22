/**
 * `skeleton_document` end to end, against a stub launcher.
 *
 * The browser is reached only through the injected `BrowserLauncher`,
 * which is what makes the probe layer testable with no Chromium at all.
 * The stub below is the shape `preview-tools.test.ts` already uses,
 * extended to answer the probe page's two functions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BrowserLauncher,
  CHROMIUM_LAUNCH_ARGS,
  RUNTIME_RELATIVE_PATH,
} from '../../src/preview-renderer';
import { SkeletonDocument } from '../../src/skeleton-doc';
import { SlotBox } from '../../src/skeleton-probe';
import {
  MAX_FOREIGN_DOCS_REPORTED,
  SkeletonDocumentData,
  skeletonDocument,
} from '../../src/tools/doc-tools';
import { MAX_NAMED_ITEMS } from '../../src/tool-result';
import { SpineErrorCode, SpineResult } from '../../src/types';
import { createFakeHost } from '../helpers/fake-host';
import {
  MODERN_ATLAS,
  RENDERABLE_ATLAS,
  RICH_SKELETON,
  clone,
  toJsonText,
} from '../helpers/fixtures';
import { encodePng, solidImage } from '../helpers/png';

type Json = Record<string, unknown>;

const SKELETON = 'C:\\work\\project\\export\\hero.json';
const ATLAS = 'C:\\work\\project\\export\\hero.atlas';
const PAGE = 'C:\\work\\project\\export\\fixture.png';
const MD = 'C:\\work\\project\\export\\hero.spine-doc.md';
const JSON_PATH = 'C:\\work\\project\\export\\hero.spine-doc.json';

const REPO_ROOT = join(__dirname, '..', '..');
const RUNTIME_PATH = join(REPO_ROOT, RUNTIME_RELATIVE_PATH);
const RUNTIME_SOURCE = readFileSync(RUNTIME_PATH, 'utf8');
const PAGE_PNG = encodePng(solidImage(8, 8, [255, 0, 0, 255]));

/** Frame size the stub renders at. Small on purpose: these are canned bytes. */
const FRAME = 16;

/** Slot boxes the stub page reports, in the frame's own pixel coordinates. */
const STUB_SLOT_BOXES: SlotBox[] = [
  { slot: 'head', x0: 0, y0: 0, x1: 7, y1: 7 },
  { slot: 'torso', x0: 8, y0: 8, x1: 15, y1: 15 },
];

function dataUrlOf(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** A fully transparent frame: the neutral pose, and every dead bone's pose. */
const NEUTRAL_PNG = encodePng(solidImage(FRAME, FRAME, [0, 0, 0, 0]));

/** A frame whose top-left 4x4 block is opaque red: 16 pixels inside `head`. */
const MOVED_PNG = (() => {
  const image = solidImage(FRAME, FRAME, [0, 0, 0, 0]);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const i = (y * FRAME + x) * 4;
      image.data[i] = 255;
      image.data[i + 3] = 255;
    }
  }
  return encodePng(image);
})();

interface StubOptions {
  /** Bones whose perturbed frame differs from the neutral one. */
  movingBones?: string[];
  warnings?: string[];
  slots?: string[];
  /** Thrown from the launcher, e.g. the DEPENDENCY_MISSING convention. */
  fail?: string;
  /**
   * Canvas the page claims. Defaults to the frame size; the batching test
   * overrides it so a 1024x1024 plan does not decode 800 MB of PNG.
   */
  canvas?: { width: number; height: number };
}

interface StubCapture {
  newPages: number;
  evaluates: number;
  /** The init argument, which is the only one carrying `probes`. */
  init?: Json;
  batches: Array<{ fromIndex: number; count: number }>;
}

/**
 * A launcher that answers the probe page with canned frames.
 *
 * Discrimination rule, since the stub receives the in-page function as an
 * opaque wrapper: the FIRST evaluate on a page is init, because its
 * argument is the only one carrying `probes`; every later one is a batch,
 * carrying `fromIndex` and `count`. That is the same rule the
 * batch-counting assertions rely on.
 */
function probeLauncher(capture: StubCapture, options: StubOptions = {}): BrowserLauncher {
  const moving = new Set(options.movingBones ?? []);
  const canvas = options.canvas ?? { width: FRAME, height: FRAME };

  return async () => {
    if (options.fail) throw new Error(options.fail);
    return {
      newPage: async () => {
        capture.newPages += 1;
        return {
          setContent: async () => {},
          on: () => {},
          evaluate: async (_fn: unknown, arg: unknown) => {
            capture.evaluates += 1;
            const input = arg as Json;

            if ('probes' in input) {
              capture.init = input;
              const probes = input['probes'] as Array<{ bone: string }>;
              return {
                neutral: {
                  dataUrl: dataUrlOf(NEUTRAL_PNG),
                  slotBoxes: STUB_SLOT_BOXES,
                  coverage: 0.25,
                },
                framing: {
                  x: -10,
                  y: -20,
                  width: 100,
                  height: 200,
                  padding: 0.15,
                  fromPoses: probes.length + 1,
                },
                translateUnits: 7.5,
                canvas,
                warnings: options.warnings ?? [],
                slots: options.slots ?? ['head', 'torso'],
              } as never;
            }

            const fromIndex = input['fromIndex'] as number;
            const count = input['count'] as number;
            capture.batches.push({ fromIndex, count });

            const probes = (capture.init?.['probes'] ?? []) as Array<{
              bone: string;
              axis: string;
            }>;
            const frames = [];
            for (let index = fromIndex; index < fromIndex + count; index++) {
              const probe = probes[index]!;
              frames.push({
                bone: probe.bone,
                axis: probe.axis,
                dataUrl: dataUrlOf(moving.has(probe.bone) ? MOVED_PNG : NEUTRAL_PNG),
                slotBoxes: STUB_SLOT_BOXES,
              });
            }
            return frames as never;
          },
        };
      },
      close: async () => {},
    };
  };
}

function freshCapture(): StubCapture {
  return { newPages: 0, evaluates: 0, batches: [] };
}

function docHost(
  options: { skeleton?: unknown; atlas?: string; extraFiles?: Record<string, string> } = {},
) {
  return createFakeHost({
    files: {
      [SKELETON]: toJsonText(options.skeleton ?? RICH_SKELETON),
      [ATLAS]: options.atlas ?? RENDERABLE_ATLAS,
      [RUNTIME_PATH]: RUNTIME_SOURCE,
      ...options.extraFiles,
    },
    binaries: {
      [PAGE]: PAGE_PNG,
      'C:\\work\\project\\export\\hero.png': PAGE_PNG,
      'C:\\work\\project\\export\\hero2.png': PAGE_PNG,
    },
  });
}

function unwrap(result: SpineResult<SkeletonDocumentData>): SkeletonDocumentData {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.data;
}

function writtenDocument(writes: Record<string, string>): SkeletonDocument {
  return JSON.parse(writes[JSON_PATH] as string) as SkeletonDocument;
}

describe('skeleton_document, measured', () => {
  it('writes both files and reports their absolute paths', async () => {
    const host = docHost();
    const result = await skeletonDocument(host, probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });

    const data = unwrap(result);
    expect(data.markdownPath).toBe(MD);
    expect(data.jsonPath).toBe(JSON_PATH);
    expect(Object.keys(host.writes).sort()).toEqual([MD, JSON_PATH].sort());
    expect(host.writes[MD]).toContain('# hero');
  });

  it('creates exactly one page for N probes', async () => {
    const capture = freshCapture();
    const host = docHost();
    const data = unwrap(
      await skeletonDocument(host, probeLauncher(capture), {
        skeleton: 'export/hero.json',
        atlas: 'export/hero.atlas',
      }),
    );

    // RICH_SKELETON declares nine bones, so rotate mode plans nine probes.
    expect(data.probe.planned).toBe(9);
    expect(data.probe.performed).toBe(9);
    expect(capture.newPages).toBe(1);
  });

  it('frames the camera from every pose in the plan, not just the first batch', async () => {
    const host = docHost();
    await skeletonDocument(host, probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });

    const document = writtenDocument(host.writes);
    expect(document.influence.framing).not.toBeNull();
    expect(document.influence.framing?.fromPoses).toBe(
      document.influence.probesPlanned + 1,
    );
    expect(document.influence.framing?.padding).toBe(0.15);
  });

  it('records the launcher\'s own Chromium args as the environment', async () => {
    const host = docHost();
    await skeletonDocument(host, probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });

    // AC-8: the document's comparability claim only holds while the
    // recorded environment is the launcher's array and not a copy of it.
    const document = writtenDocument(host.writes);
    expect(document.influence.environment.launchArgs).toEqual([...CHROMIUM_LAUNCH_ARGS]);
    expect(document.influence.environment.useGl).toBeNull();
  });

  it('attributes moved pixels to the slot whose box contains them', async () => {
    const host = docHost();
    await skeletonDocument(host, probeLauncher(freshCapture(), { movingBones: ['head'] }), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });

    const document = writtenDocument(host.writes);
    const head = document.influence.bones.find((entry) => entry.bone === 'head')!;
    expect(head.noVisibleEffect).toBe(false);
    expect(head.changedPixels).toBe(16);
    expect(head.changedFraction).toBe(0.0625);
    expect(head.bucket).toBe('strong');
    expect(head.maxChannelDelta).toBe(255);
    expect(head.slots).toEqual([
      {
        slot: 'head',
        changedPixels: 16,
        changedFraction: 0.0625,
        bucket: 'strong',
        attachments: ['head'],
      },
    ]);
    expect(head.unattributedPixels).toBe(0);
  });

  it('keeps a bone whose render is identical, marked as having no effect', async () => {
    const host = docHost();
    const data = unwrap(
      await skeletonDocument(
        host,
        probeLauncher(freshCapture(), { movingBones: ['head'] }),
        { skeleton: 'export/hero.json', atlas: 'export/hero.atlas' },
      ),
    );

    const document = writtenDocument(host.writes);
    const torso = document.influence.bones.find((entry) => entry.bone === 'torso')!;
    // Present, not omitted, with an empty slot list.
    expect(torso.noVisibleEffect).toBe(true);
    expect(torso.bucket).toBe('none');
    expect(torso.slots).toEqual([]);
    expect(document.summary.deadBones).toContain('torso');
    expect(document.summary.deadBones).not.toContain('head');
    expect(data.deadBoneCount).toBe(8);
    expect(host.writes[MD]).toContain('Bones with no visible effect:');
  });

  it('derives premultipliedAlpha from an atlas that declares pma false', async () => {
    const capture = freshCapture();
    await skeletonDocument(docHost(), probeLauncher(capture), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    expect(capture.init?.['premultipliedAlpha']).toBe(false);
  });

  it('derives premultipliedAlpha from an atlas that declares pma true', async () => {
    const capture = freshCapture();
    await skeletonDocument(docHost({ atlas: MODERN_ATLAS }), probeLauncher(capture), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    expect(capture.init?.['premultipliedAlpha']).toBe(true);
  });

  it('fixes the skeleton scale at 1, which cannot change which pixels differ', async () => {
    const capture = freshCapture();
    await skeletonDocument(docHost(), probeLauncher(capture), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    expect(capture.init?.['scale']).toBe(1);
  });

  it('fires the framing note whenever influence was measured', async () => {
    const host = docHost();
    await skeletonDocument(host, probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    const document = writtenDocument(host.writes);
    expect(
      document.notes.some((note) =>
        note.includes('Compare buckets and slot sets across plans, not fractions.'),
      ),
    ).toBe(true);
  });

  it('carries a probe warning into the document, the payload and the Markdown', async () => {
    const warning =
      "Attachment kind 'clipping' is not drawn, so it has no slot box: clip";
    const host = docHost();
    const data = unwrap(
      await skeletonDocument(
        host,
        probeLauncher(freshCapture(), { warnings: [warning] }),
        { skeleton: 'export/hero.json', atlas: 'export/hero.atlas' },
      ),
    );

    expect(data.probe.probeWarnings).toEqual([warning]);
    expect(writtenDocument(host.writes).influence.warnings).toEqual([warning]);

    const markdown = host.writes[MD] as string;
    const influenceSection = markdown.slice(
      markdown.indexOf('## Bone influence (measured)'),
    );
    expect(influenceSection).toContain(warning);
    expect(influenceSection).toContain('### Probe caveats');
  });
});

describe('batching', () => {
  it('uses one evaluate per batch for a 12-probe plan at 256x256', async () => {
    const capture = freshCapture();
    const twelve = {
      skeleton: { hash: 'twelve', spine: '4.2.37' },
      bones: Array.from({ length: 12 }, (_, index) =>
        index === 0 ? { name: 'root' } : { name: `b${index}`, parent: 'root' },
      ),
      slots: [],
      skins: [],
      animations: {},
    };

    const host = docHost({ skeleton: twelve });
    const data = unwrap(
      await skeletonDocument(host, probeLauncher(capture), {
        skeleton: 'export/hero.json',
        atlas: 'export/hero.atlas',
        probeWidth: 256,
        probeHeight: 256,
      }),
    );

    expect(data.probe.planned).toBe(12);
    // Init plus exactly one batch: 256x256 fits 256 frames in the budget.
    expect(capture.evaluates).toBe(2);
    expect(capture.batches).toEqual([{ fromIndex: 0, count: 12 }]);
    expect(capture.newPages).toBe(1);
  });

  it('splits into more than one batch when the frame size demands it', async () => {
    // PROBE_BATCH_PIXEL_BUDGET / (1024 * 1024 * 4) = 16 frames per batch,
    // so a 20-probe plan needs two. The stub still returns 16x16 frames:
    // the point is that the batch size is wired to the requested frame
    // size, and decoding 20 real 1024x1024 PNGs would cost 80 MB for no
    // extra proof.
    const capture = freshCapture();
    const twenty = {
      skeleton: { hash: 'twenty', spine: '4.2.37' },
      bones: Array.from({ length: 20 }, (_, index) =>
        index === 0 ? { name: 'root' } : { name: `b${index}`, parent: 'root' },
      ),
      slots: [],
      skins: [],
      animations: {},
    };

    const host = docHost({ skeleton: twenty });
    const data = unwrap(
      await skeletonDocument(
        host,
        probeLauncher(capture, { canvas: { width: 1024, height: 1024 } }),
        {
          skeleton: 'export/hero.json',
          atlas: 'export/hero.atlas',
          probeWidth: 1024,
          probeHeight: 1024,
        },
      ),
    );

    expect(data.probe.planned).toBe(20);
    expect(capture.batches).toEqual([
      { fromIndex: 0, count: 16 },
      { fromIndex: 16, count: 4 },
    ]);
    expect(capture.evaluates).toBe(3);
    // Still exactly one page, which is the FR the batching must not break.
    expect(capture.newPages).toBe(1);
  });
});

describe('the payload stays small whatever the rig does', () => {
  it('carries no pixels, no data URL and no unbounded array', async () => {
    const result = await skeletonDocument(docHost(), probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    const data = unwrap(result);
    const serialised = JSON.stringify(result);

    expect(serialised).not.toContain('data:image/png');
    expect(serialised).not.toContain('base64');
    expect(serialised.length).toBeLessThan(8 * 1024);

    for (const value of Object.values(data)) {
      if (Array.isArray(value)) {
        expect(value.length).toBeLessThanOrEqual(MAX_FOREIGN_DOCS_REPORTED);
      }
    }
    expect(data.deadBones.length).toBeLessThanOrEqual(MAX_NAMED_ITEMS);
    expect(data.defectSummary.length).toBeLessThanOrEqual(MAX_NAMED_ITEMS);
    expect(data.probe.probeWarnings.length).toBeLessThanOrEqual(MAX_NAMED_ITEMS);
  });

  it('does not grow when an animation gains 200 event keyframes', async () => {
    const plain = await skeletonDocument(docHost(), probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });

    const loaded = clone(RICH_SKELETON) as unknown as Json;
    const walk = (loaded['animations'] as Json)['walk'] as Json;
    walk['events'] = Array.from({ length: 200 }, (_, index) => ({
      time: index / 100,
      name: 'footstep',
    }));

    const host = docHost({ skeleton: loaded });
    const bulky = await skeletonDocument(host, probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });

    // The bound is a property of the payload's shape, not of this fixture.
    //
    // `probe.elapsedMs` is the one field in the payload that is a wall-clock
    // measurement, so two otherwise identical payloads differ by a character
    // whenever the two runs land on either side of a digit boundary (99 ms
    // versus 100 ms). That made this assertion fail under full-suite load
    // while passing in isolation, so the timing is normalised and everything
    // else is still compared byte for byte.
    const sameLengthIgnoringTiming = (result: typeof plain): number =>
      JSON.stringify(result).replace(/"elapsedMs":\d+/g, '"elapsedMs":0').length;

    expect(sameLengthIgnoringTiming(bulky)).toBe(sameLengthIgnoringTiming(plain));

    // The document itself caps the two keyframe lists and says how many
    // it left out.
    const document = writtenDocument(host.writes);
    const animation = document.animations.find((entry) => entry.name === 'walk')!;
    expect(animation.events).toHaveLength(64);
    expect(animation.eventsTruncated).toBe(136);
    expect(animation.attachmentSwitchesTruncated).toBe(0);
  });
});

describe('the summary budget', () => {
  const LIMIT = 1200;

  it('fits on an ordinary rig', async () => {
    const result = await skeletonDocument(docHost(), probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.length).toBeLessThanOrEqual(LIMIT);
    expect(result.summary).toContain('Documented hero.json');
    expect(result.summary).toContain('probe(s) in rotate mode');
  });

  it('sheds down to fit a 180-character outDir and five 64-character bone names', async () => {
    const names = Array.from({ length: 5 }, (_, index) => `${'b'.repeat(63)}${index}`);
    const wide = {
      skeleton: { hash: 'wide', spine: '4.2.37' },
      bones: [{ name: 'root' }, ...names.map((name) => ({ name, parent: 'root' }))],
      slots: [],
      skins: [],
      animations: {},
    };

    const deep = 'd'.repeat(180);
    const result = await skeletonDocument(
      docHost({ skeleton: wide }),
      probeLauncher(freshCapture()),
      { skeleton: 'export/hero.json', atlas: 'export/hero.atlas', outDir: deep },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.length).toBeLessThanOrEqual(LIMIT);
    // The ladder shed the notes and then the long name list.
    expect(result.summary).not.toContain('Note: skeleton.hash alone');
  });

  it('truncates terminally rather than trusting any path-length argument', async () => {
    const absurd = 'x'.repeat(4000);
    const result = await skeletonDocument(docHost(), probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      outDir: absurd,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.length).toBeLessThanOrEqual(LIMIT);
    expect(result.summary.endsWith('...')).toBe(true);
  });
});

describe('determinism across two runs', () => {
  it('writes a byte-identical .md and a .json that differs only in generatedAt', async () => {
    const host = docHost();
    const options = { skeleton: 'export/hero.json', atlas: 'export/hero.atlas' };

    unwrap(await skeletonDocument(host, probeLauncher(freshCapture()), options));
    const firstMarkdown = host.writes[MD] as string;
    const firstJson = JSON.parse(host.writes[JSON_PATH] as string) as Json;

    unwrap(await skeletonDocument(host, probeLauncher(freshCapture()), options));
    const secondMarkdown = host.writes[MD] as string;
    const secondJson = JSON.parse(host.writes[JSON_PATH] as string) as Json;

    expect(secondMarkdown).toBe(firstMarkdown);
    delete firstJson['generatedAt'];
    delete secondJson['generatedAt'];
    expect(secondJson).toEqual(firstJson);
  });

  it('reports the second run as fresh, because nothing changed', async () => {
    const host = docHost();
    const options = { skeleton: 'export/hero.json', atlas: 'export/hero.atlas' };
    await skeletonDocument(host, probeLauncher(freshCapture()), options);
    const second = unwrap(
      await skeletonDocument(host, probeLauncher(freshCapture()), options),
    );

    expect(second.previousDocument.existed).toBe(true);
    expect(second.previousDocument.staleness).toBe('fresh');
    expect(second.previousDocument.influenceDiscarded).toBe(0);
  });

  it('reports a changed fingerprint under an unchanged hash as stale', async () => {
    const host = docHost();
    const options = { skeleton: 'export/hero.json', atlas: 'export/hero.atlas' };
    await skeletonDocument(host, probeLauncher(freshCapture()), options);

    // Two extra animations, same editor hash: the two-files-one-hash trap.
    const changed = clone(RICH_SKELETON) as unknown as Json;
    (changed['animations'] as Json)['extra'] = {
      bones: { hip: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 5 }] } },
    };
    host.writeText(SKELETON, toJsonText(changed));

    const again = await skeletonDocument(host, probeLauncher(freshCapture()), options);
    expect(unwrap(again).previousDocument.staleness).toBe('fingerprintChanged');
    expect(again.ok && again.summary).toContain('different fingerprint');
  });
});

describe('degradation', () => {
  it("writes both files and returns ok with probeMode 'off'", async () => {
    const host = docHost();
    const capture = freshCapture();
    const data = unwrap(
      await skeletonDocument(host, probeLauncher(capture), {
        skeleton: 'export/hero.json',
        probeMode: 'off',
      }),
    );

    // The renderer is never called at all.
    expect(capture.newPages).toBe(0);
    expect(Object.keys(host.writes).sort()).toEqual([MD, JSON_PATH].sort());

    expect(data.probe.available).toBe(false);
    expect(data.probe.reason).toMatch(/^Not measured:/);
    expect(data.probe.planned).toBe(0);
    expect(data.probe.performed).toBe(0);
    expect(data.probe.canvas).toBeNull();
    expect(data.probe.elapsedMs).toBe(0);
    expect(data.deadBones).toEqual([]);

    const document = writtenDocument(host.writes);
    expect(document.influence.framing).toBeNull();
    expect(document.influence.bones).toEqual([]);
    expect(document.summary.deadBones).toEqual([]);
    expect(document.summary.unprobedBones).toHaveLength(data.counts.bones);
    expect(document.hierarchy.bones.every((bone) => bone.probe === null)).toBe(true);
    expect(
      document.notes.some((note) => note.startsWith('Influence was not measured:')),
    ).toBe(true);

    // No claim about dead bones anywhere, because nobody looked.
    const markdown = host.writes[MD] as string;
    expect(markdown).not.toContain('Bones with no visible effect:');
    expect(markdown).toContain('| \u2014 |');
  });

  it('refuses to probe without an atlas, naming the two ways forward', async () => {
    const host = docHost();
    const result = await skeletonDocument(host, probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.hint).toContain('atlas');
    expect(result.hint).toContain("'off'");
    expect(host.writes).toEqual({});
  });

  it('still writes both files when Chromium is absent, and records why verbatim', async () => {
    const host = docHost();
    const message =
      'DEPENDENCY_MISSING: Chromium failed to launch (no such file). Install the browser with: npx playwright install chromium';
    const data = unwrap(
      await skeletonDocument(host, probeLauncher(freshCapture(), { fail: message }), {
        skeleton: 'export/hero.json',
        atlas: 'export/hero.atlas',
      }),
    );

    expect(Object.keys(host.writes).sort()).toEqual([MD, JSON_PATH].sort());
    expect(data.probe.available).toBe(false);
    // The fix command survives into the file.
    expect(data.probe.reason).toContain('npx playwright install chromium');
    // The planned count is kept, unlike the probeMode 'off' case.
    expect(data.probe.planned).toBe(9);
    expect(data.probe.performed).toBe(0);

    const document = writtenDocument(host.writes);
    expect(document.influence.probesPlanned).toBe(9);
    expect(document.summary.unprobedBones).toHaveLength(data.counts.bones);
    expect(host.writes[MD]).not.toContain('Bones with no visible effect:');
  });

  it('reports a mid-run page error as the failure it is, writing nothing', async () => {
    const host = docHost();
    const result = await skeletonDocument(
      host,
      probeLauncher(freshCapture(), { fail: 'WebGL is unavailable in this browser context.' }),
      { skeleton: 'export/hero.json', atlas: 'export/hero.atlas' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.CliFailed);
    expect(host.writes).toEqual({});
  });

  it('says so when a cheap staleness check throws away a measured section', async () => {
    const host = docHost();
    // First run measures influence.
    const measured = unwrap(
      await skeletonDocument(host, probeLauncher(freshCapture()), {
        skeleton: 'export/hero.json',
        atlas: 'export/hero.atlas',
      }),
    );
    expect(measured.probe.performed).toBe(9);

    // Second run, data-only, over the same path.
    const result = await skeletonDocument(host, probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      probeMode: 'off',
    });
    const data = unwrap(result);

    expect(data.previousDocument.influenceDiscarded).toBe(9);
    expect(result.ok && result.summary).toContain(
      'The previous document had measured influence for 9 bone(s)',
    );
    expect(result.ok && result.summary).toContain("probeMode: 'rotate'");
  });
});

describe('write scoping', () => {
  it('leaves an unrelated spine-doc file on disk and reports it', async () => {
    const host = docHost({
      extraFiles: {
        'C:\\work\\project\\export\\knight.spine-doc.json': '{}',
        'C:\\work\\project\\export\\knight.spine-doc.html': '<html></html>',
      },
    });

    const data = unwrap(
      await skeletonDocument(host, probeLauncher(freshCapture()), {
        skeleton: 'export/hero.json',
        atlas: 'export/hero.atlas',
      }),
    );

    // Names, not paths, sorted, and the whole *.spine-doc.* family rather
    // than just the two extensions this version writes.
    expect(data.foreignDocsKept).toEqual([
      'knight.spine-doc.html',
      'knight.spine-doc.json',
    ]);
    expect(data.foreignDocsKeptTruncated).toBe(0);
    // Nothing was deleted: only this tool's own two names were written.
    expect(Object.keys(host.writes).sort()).toEqual([MD, JSON_PATH].sort());
    expect(host.readText('C:\\work\\project\\export\\knight.spine-doc.json')).toBe('{}');
  });

  it('refuses an outDir outside the workspace and names the parameter to fix', async () => {
    const host = docHost();
    const result = await skeletonDocument(host, probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      outDir: '../escape',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.PathNotAllowed);
    expect(result.hint).toContain('`outDir`');
    expect(result.hint).toContain('the skeleton itself may live anywhere');
    expect(host.writes).toEqual({});
  });

  it('refuses an over-cap plan before launching anything or writing anything', async () => {
    const capture = freshCapture();
    const host = docHost();
    const result = await skeletonDocument(host, probeLauncher(capture), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      probeMode: 'full',
      maxProbes: 10,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.message).toContain('27');
    expect(result.message).toContain('10');
    expect(capture.newPages).toBe(0);
    expect(host.writes).toEqual({});
  });

  it('rejects an unknown skin, listing the real ones', async () => {
    const result = await skeletonDocument(docHost(), probeLauncher(freshCapture()), {
      skeleton: 'export/hero.json',
      atlas: 'export/hero.atlas',
      skin: 'nope',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.hint).toContain('default');
    expect(result.hint).toContain('blue');
  });
});
