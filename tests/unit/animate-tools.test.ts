/**
 * `skeleton_animate` end to end, against the in-memory fake host.
 *
 * No browser, no Python and no subprocess: the tool reads exported JSON and
 * writes exported JSON, which is what makes every one of these cases a unit
 * test rather than an integration test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLACEHOLDER_MOTION_NOTE, HASH_ALGORITHM } from '../../src/animation-templates';
import { inspectSkeletonJson } from '../../src/skeleton-data';
import { diffSkeletons } from '../../src/skeleton-diff';
import {
  SkeletonAnimateData,
  SkeletonAnimateRequest,
  skeletonAnimate,
} from '../../src/tools/animate-tools';
import { SpineErrorCode, SpineResult } from '../../src/types';
import { FakeHost, createFakeHost } from '../helpers/fake-host';
import { CANONICAL_RIG, RICH_SKELETON, clone, toJsonText } from '../helpers/fixtures';

type Json = Record<string, unknown>;

const SKELETON = 'C:\\work\\project\\export\\hero.json';
const OUT = 'C:\\work\\project\\export\\hero-animated.json';

/** A host holding one skeleton file at {@link SKELETON}. */
function hostWith(skeleton: unknown, extra: Record<string, string> = {}): FakeHost {
  return createFakeHost({ files: { [SKELETON]: toJsonText(skeleton), ...extra } });
}

function run(
  host: FakeHost,
  args: Partial<SkeletonAnimateRequest> = {},
): SpineResult<SkeletonAnimateData> {
  return skeletonAnimate(host, {
    skeleton: 'export/hero.json',
    animations: [{ template: 'wave' }],
    ...args,
  });
}

/** The file the tool wrote, parsed. */
function written(host: FakeHost, path = OUT): Json {
  const text = host.writes[path];
  expect(typeof text).toBe('string');
  return JSON.parse(text as string) as Json;
}

/** A rig with some bones, and their slots and attachments, removed. */
function withoutBones(names: string[]): Json {
  const rig = clone(CANONICAL_RIG) as unknown as Json;
  const dropped = new Set(names);

  rig['bones'] = (rig['bones'] as Array<Json>).filter(
    (bone) => !dropped.has(bone['name'] as string),
  );

  const slots = (rig['slots'] as Array<Json>).filter(
    (slot) => !dropped.has(slot['bone'] as string),
  );
  rig['slots'] = slots;
  const keptSlots = new Set(slots.map((slot) => slot['name'] as string));

  rig['skins'] = (rig['skins'] as Array<Json>).map((skin) => {
    const attachments = skin['attachments'] as Record<string, unknown>;
    const kept: Record<string, unknown> = {};
    for (const [slot, value] of Object.entries(attachments)) {
      if (keptSlots.has(slot)) kept[slot] = value;
    }
    return { ...skin, attachments: kept };
  });

  return rig;
}

describe('skeletonAnimate', () => {
  it('generates wave on all three of arm_left, arm_right and head', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Read back through the inspector, not out of the emitter: this is what
    // the runtime would see.
    const wave = result.data.skeleton.animations.find(
      (animation) => animation.name === 'wave',
    );
    expect(wave).toBeDefined();
    expect(wave!.duration).toBeGreaterThan(0);
    expect(wave!.animatedBones).toEqual(
      expect.arrayContaining(['arm_left', 'arm_right', 'head']),
    );
    // The optional counter-pose on the other arm is why arm_left is in
    // there at all.
    expect(result.data.animations[0]!.usedBones).toEqual(
      expect.arrayContaining(['arm_left', 'arm_right', 'head']),
    );
    expect(result.data.animations[0]!.omittedOptional).toEqual([]);
    expect(result.data.outPath).toBe(OUT);
    expect(host.writes[OUT]).toBeDefined();
  });

  it('reports the optional bones a one-armed rig lacks, and still emits', () => {
    const host = hostWith(
      withoutBones(['head', 'arm_left', 'forearm_left', 'hand_left']),
    );
    const result = run(host);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.animations[0]!.omittedOptional).toEqual(['arm_left', 'head']);
    expect(result.data.animations[0]!.usedBones).toEqual([
      'arm_right',
      'forearm_right',
      'hand_right',
    ]);
    expect(result.summary).toContain('Omitted optional bones the rig lacks: arm_left, head');
  });

  it('refuses a template whose required bone is missing, and writes nothing', () => {
    const host = hostWith(withoutBones(['thigh_left', 'shin_left']));
    const result = run(host, { animations: [{ template: 'walk' }] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.ValidationFailed);
    expect(result.message).toContain('walk');
    expect(result.message).toContain('thigh_left');
    // The rig's real bones are named in the hint, capped, with the full
    // list in `details` so nothing is hidden.
    expect(result.hint).toContain("The rig's bones are: root, hip, torso");
    expect(result.hint).toContain('more');
    expect(result.details!['availableBones']).toEqual(
      expect.arrayContaining(['thigh_right', 'hip']),
    );
    expect(Object.keys(host.writes)).toEqual([]);
  });

  it('names an advisory rename without substituting the bone', () => {
    const rig = withoutBones(['arm_right', 'forearm_right', 'hand_right']);
    (rig['bones'] as Array<Json>).push({
      name: 'upper_arm_right',
      parent: 'shoulder_right',
      length: 40,
    });
    const host = hostWith(rig);
    const result = run(host);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.hint).toContain('upper_arm_right');
    expect(result.hint).toContain('arm_right');
    expect(result.hint).toContain('rename the bone');
    expect(Object.keys(host.writes)).toEqual([]);
  });

  it('preserves setup and idle untouched alongside the new animations', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host, {
      animations: [{ template: 'wave' }, { template: 'jump' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const output = written(host);
    const animations = output['animations'] as Record<string, unknown>;
    expect(Object.keys(animations).sort()).toEqual(['idle', 'jump', 'setup', 'wave']);
    expect(animations['setup']).toEqual({});
    expect(animations['idle']).toEqual(CANONICAL_RIG.animations.idle);
    expect(result.summary).toContain('Existing animations preserved: setup, idle.');
  });

  it('refuses a name that already exists, then states the replacement', () => {
    const host = hostWith(CANONICAL_RIG);
    const clash = run(host, { animations: [{ template: 'wave', name: 'idle' }] });

    expect(clash.ok).toBe(false);
    if (clash.ok) return;
    expect(clash.code).toBe(SpineErrorCode.InvalidArgument);
    expect(clash.message).toContain('idle');
    expect(clash.hint).toContain('overwriteAnimations');
    expect(Object.keys(host.writes)).toEqual([]);

    const replaced = run(host, {
      animations: [{ template: 'wave', name: 'idle' }],
      overwriteAnimations: true,
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.data.animations[0]!.replacedExisting).toBe(true);
    expect(replaced.summary).toContain('Replaced the existing animation of the same name');

    const output = written(host);
    const animations = output['animations'] as Record<string, unknown>;
    expect(Object.keys(animations).sort()).toEqual(['idle', 'setup']);
    expect(animations['idle']).not.toEqual(CANONICAL_RIG.animations.idle);
  });

  it('refuses two requests that resolve to the same name', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host, {
      animations: [{ template: 'wave' }, { template: 'wave', amplitude: 2 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.message).toContain('wave');
    expect(Object.keys(host.writes)).toEqual([]);
  });

  it('refuses an unusable animation name', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host, {
      animations: [{ template: 'wave', name: '../../etc/passwd' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InvalidArgument);
    expect(result.hint).toContain('A-Za-z0-9_-');
  });

  it('recomputes the hash, and skeleton_diff sees the added animations', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host, {
      animations: [{ template: 'wave' }, { template: 'turn_head' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hashFrom).toBe(CANONICAL_RIG.skeleton.hash);
    expect(result.data.hashTo).not.toBe(result.data.hashFrom);
    expect(result.data.hashTo).toMatch(/^[0-9a-f]{22}$/);
    expect(result.summary).toContain(HASH_ALGORITHM);
    expect(result.summary).toContain("not the editor's");

    const output = written(host);
    expect((output['skeleton'] as Json)['hash']).toBe(result.data.hashTo);

    // `diffSkeletons` takes two reports, not two files, so both files are
    // inspected first.
    const before = inspectSkeletonJson(host.readText(SKELETON) as string);
    const after = inspectSkeletonJson(host.writes[OUT] as string);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;

    const diff = diffSkeletons(before.data, after.data);
    expect(diff.hashChanged).toBe(true);
    expect(diff.animations.added).toEqual(['turn_head', 'wave']);
    expect(diff.animations.removed).toEqual([]);
    expect(diff.bones.added).toEqual([]);
  });

  it('adds no new lint error on a clean rig', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host, { animations: [{ template: 'walk' }] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lint.counts.error).toBe(0);
    expect(result.data.lintPreexistingErrors).toEqual([]);
    expect(result.summary).toContain('Lint added no new errors');
  });

  it('writes the file on a two-root rig and names the error as pre-existing', () => {
    // The delta gate is the whole point: `structure/root-bone` describes the
    // RIG, and adding animations did not cause it. An absolute gate would
    // refuse this rig with "this is a defect in the generator".
    const rig = clone(CANONICAL_RIG) as unknown as Json;
    (rig['bones'] as Array<Json>).push({ name: 'second_root' });
    const host = hostWith(rig);
    const result = run(host, { animations: [{ template: 'walk' }] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(host.writes[OUT]).toBeDefined();
    expect(result.data.lintPreexistingErrors.map((finding) => finding.id)).toContain(
      'structure/root-bone',
    );
    expect(result.summary).toContain(
      'Pre-existing lint errors in the input, not caused by this tool',
    );
    expect(result.summary).toContain('structure/root-bone');
  });

  it('succeeds on a rig with a weighted mesh, naming the mesh', () => {
    const host = hostWith(RICH_SKELETON);
    const result = run(host, { animations: [{ template: 'turn_head' }] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.weightedMeshWarning).toContain('head');
    expect(result.data.weightedMeshWarning).toContain('DEFORMATION');
    expect(result.summary).toContain('deform');
    expect(host.writes[OUT]).toBeDefined();
  });

  it('carries the honesty wording into the file and the summary', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain(PLACEHOLDER_MOTION_NOTE);

    const generator = written(host)['_generator'] as Json;
    expect(generator['tool']).toBe('kiro-spine2d-power/skeleton_animate');
    expect(generator['schema']).toBe(1);
    expect(generator['note']).toBe(PLACEHOLDER_MOTION_NOTE);
    expect(generator['hashAlgorithm']).toBe(HASH_ALGORITHM);
    expect(generator['previousDepth']).toBe(0);
    expect(generator).not.toHaveProperty('previous');
    expect(
      (generator['templates'] as Array<Json>).map((record) => record['template']),
    ).toEqual(['wave']);
  });

  it('keeps one level of previous provenance and counts the depth', () => {
    const rig = clone(CANONICAL_RIG) as unknown as Json;
    rig['_generator'] = {
      tool: 'kiro-spine2d-power/psd_to_skeleton',
      note: 'Generated from a PSD.',
      extra: 'this field is deliberately dropped',
    };
    const host = hostWith(rig);

    const first = run(host, { animations: [{ template: 'wave' }] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const firstGenerator = written(host)['_generator'] as Json;
    expect(firstGenerator['previousDepth']).toBe(1);
    // Projected to three fields: the PSD origin survives, the rest does not.
    expect(firstGenerator['previous']).toEqual({
      tool: 'kiro-spine2d-power/psd_to_skeleton',
      note: 'Generated from a PSD.',
    });
  });

  it('nests exactly one level of provenance on a repeated run', () => {
    const host = hostWith(CANONICAL_RIG);
    expect(run(host, { animations: [{ template: 'wave' }] }).ok).toBe(true);

    const second = createFakeHost({ files: { [SKELETON]: host.writes[OUT] as string } });
    const result = run(second, { animations: [{ template: 'turn_head' }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const generator = written(second)['_generator'] as Json;
    expect(generator['previousDepth']).toBe(1);
    expect(generator['previous']).toEqual({
      tool: 'kiro-spine2d-power/skeleton_animate',
      note: PLACEHOLDER_MOTION_NOTE,
      hashAlgorithm: HASH_ALGORITHM,
    });
    expect(JSON.stringify(generator)).not.toContain('previous.previous');
    expect((generator['previous'] as Json)['previous']).toBeUndefined();
  });

  it('guards an existing output file', () => {
    const host = hostWith(CANONICAL_RIG, { [OUT]: '{}' });
    const refused = run(host);

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe(SpineErrorCode.InvalidArgument);
    expect(refused.hint).toContain('overwriteFile');
    expect(Object.keys(host.writes)).toEqual([]);

    const allowed = run(host, { overwriteFile: true });
    expect(allowed.ok).toBe(true);
    expect(host.writes[OUT]).toBeDefined();
  });

  it('names the parameter when the output path escapes the workspace', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host, { outPath: 'D:\\elsewhere\\hero-animated.json' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.PathNotAllowed);
    expect(result.hint).toContain('`outPath`');
    expect(result.hint).toContain('the skeleton itself may live anywhere');
  });

  it('writes pretty-printed, newline-terminated JSON', () => {
    const host = hostWith(CANONICAL_RIG);
    expect(run(host).ok).toBe(true);
    const text = host.writes[OUT] as string;
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "skeleton"');
  });

  it('never mutates the input object or the input file', () => {
    const host = hostWith(CANONICAL_RIG);
    const before = host.readText(SKELETON) as string;
    expect(run(host).ok).toBe(true);
    expect(host.readText(SKELETON)).toBe(before);
    expect(CANONICAL_RIG.animations.setup).toEqual({});
  });

  it('names the next steps concretely', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nextSteps[0]).toContain('skeleton_diff');
    expect(result.data.nextSteps[0]).toContain('hero-animated.json');
    expect(result.data.nextSteps[1]).toContain('render_preview');
    expect(result.data.nextSteps[1]).toContain('wave');
  });

  it('respects duration and amplitude per request', () => {
    const host = hostWith(CANONICAL_RIG);
    const result = run(host, {
      animations: [{ template: 'wave', name: 'greet', duration: 2, amplitude: 0.5 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.animations[0]).toMatchObject({
      template: 'wave',
      name: 'greet',
      duration: 2,
      amplitude: 0.5,
      intendedLoop: false,
    });

    const animations = written(host)['animations'] as Record<string, Json>;
    const bones = (animations['greet'] as Json)['bones'] as Record<
      string,
      Record<string, Json[]>
    >;
    expect(bones['arm_right']!['rotate']).toEqual([
      { time: 0, value: 0 },
      { time: 0.4, value: -35 },
      { time: 1, value: -35 },
      { time: 1.6, value: -35 },
      { time: 2, value: 0 },
    ]);
  });

  it('fails when the skeleton file is missing', () => {
    const host = createFakeHost();
    const result = run(host);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(SpineErrorCode.InputMissing);
  });

  it('reaches no sidecar, structurally', () => {
    // uv-free operation is established by the source carrying no reference
    // to the Python bridge at all, rather than by asserting nothing was
    // spawned.
    const root = join(__dirname, '..', '..');
    for (const file of ['src/tools/animate-tools.ts', 'src/animation-templates.ts']) {
      const source = readFileSync(join(root, file), 'utf8');
      expect(source.toLowerCase()).not.toContain('sidecar');
      expect(source).not.toContain('node:fs');
      expect(source).not.toContain('child_process');
    }
  });
});
