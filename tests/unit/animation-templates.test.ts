/**
 * The animation template tables, the emitter and the validator.
 *
 * These are correctness proofs rather than smoke tests: the tables are the
 * specification, so the assertions here are what stops a future edit from
 * emitting a key the 4.2 reader does not read, a `curve` array nobody
 * reviewed, a timeline with no pose at time 0, or a negative scale.
 */
import {
  ADVISORY_ALIASES,
  Axis,
  MatchOk,
  SPINE_42_TIMELINE_KEYS,
  TEMPLATES,
  TEMPLATE_NAMES,
  TemplateName,
  applyAmplitude,
  emitAnimation,
  matchTemplate,
  recomputeSkeletonHash,
  validateEmittedAnimations,
} from '../../src/animation-templates';
import { CANONICAL_RIG } from '../helpers/fixtures';

type Json = Record<string, unknown>;

/** Every bone CANONICAL_RIG declares, in declaration order. */
const RIG_BONES = CANONICAL_RIG.bones.map((bone) => bone.name);

/** The amplitudes every cross-template assertion is made at. */
const AMPLITUDES = [0.1, 1, 3];

/** Emit one template against a bone list, failing the test if it does not fit. */
function emit(
  template: TemplateName,
  amplitude: number,
  boneNames: string[] = RIG_BONES,
  duration?: number,
): { animation: Json; emittedKeys: string[] } {
  const match = matchTemplate(TEMPLATES[template], boneNames);
  expect(match.ok).toBe(true);
  const result = emitAnimation(
    TEMPLATES[template],
    {
      name: template,
      duration: duration ?? TEMPLATES[template].defaultDuration,
      amplitude,
      emitEvents: false,
    },
    match as MatchOk,
  );
  return { animation: result.animation, emittedKeys: result.emittedKeys };
}

/** Every `(owner, key, frames)` triple in an emitted animation. */
function timelinesOf(
  animation: Json,
): Array<{ owner: 'bone' | 'slot'; subject: string; key: string; frames: Json[] }> {
  const out: Array<{
    owner: 'bone' | 'slot';
    subject: string;
    key: string;
    frames: Json[];
  }> = [];
  for (const owner of ['bone', 'slot'] as const) {
    const section = animation[owner === 'bone' ? 'bones' : 'slots'] as
      | Record<string, Record<string, Json[]>>
      | undefined;
    if (section === undefined) continue;
    for (const [subject, timelines] of Object.entries(section)) {
      for (const [key, frames] of Object.entries(timelines)) {
        out.push({ owner, subject, key, frames });
      }
    }
  }
  return out;
}

describe('TEMPLATES table invariants', () => {
  it('declares exactly five templates', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...TEMPLATE_NAMES].sort());
    expect(TEMPLATE_NAMES).toHaveLength(5);
  });

  it('gives every required and optional bone at least one track', () => {
    // The failure this catches: a template listing an optional bone with no
    // track to drop, which makes `omittedOptional` claim something was lost
    // when nothing was.
    for (const name of TEMPLATE_NAMES) {
      const template = TEMPLATES[name];
      const tracked = new Set(template.tracks.map((track) => track.bone));
      for (const bone of [...template.requiredBones, ...template.optionalBones]) {
        expect({ template: name, bone, tracked: tracked.has(bone) }).toEqual({
          template: name,
          bone,
          tracked: true,
        });
      }
    }
  });

  it('names every track bone in requiredBones or optionalBones', () => {
    for (const name of TEMPLATE_NAMES) {
      const template = TEMPLATES[name];
      const declared = new Set([...template.requiredBones, ...template.optionalBones]);
      for (const track of template.tracks) {
        expect({ template: name, bone: track.bone, declared: declared.has(track.bone) }).toEqual(
          { template: name, bone: track.bone, declared: true },
        );
      }
    }
  });

  it('gives every track an explicit phase 0 point', () => {
    for (const name of TEMPLATE_NAMES) {
      for (const track of TEMPLATES[name].tracks) {
        expect(track.points.some((point) => point[0] === 0)).toBe(true);
      }
    }
  });

  it('declares no sideSign -1 on any scale track', () => {
    // A negative scale is a reflection, not a smaller bone.
    for (const name of TEMPLATE_NAMES) {
      for (const track of TEMPLATES[name].tracks) {
        if (track.axis !== 'scale') continue;
        expect({ template: name, bone: track.bone, sideSign: track.sideSign }).toEqual({
          template: name,
          bone: track.bone,
          sideSign: 1,
        });
      }
    }
  });

  it('keeps the documented durations and loop intentions', () => {
    expect(TEMPLATES.idle).toMatchObject({ defaultDuration: 2, intendedLoop: true });
    expect(TEMPLATES.walk).toMatchObject({ defaultDuration: 1, intendedLoop: true });
    expect(TEMPLATES.wave).toMatchObject({ defaultDuration: 1, intendedLoop: false });
    expect(TEMPLATES.jump).toMatchObject({ defaultDuration: 0.8, intendedLoop: false });
    expect(TEMPLATES.turn_head).toMatchObject({
      defaultDuration: 1.2,
      intendedLoop: false,
    });
  });

  it('gives every template a one-sentence note', () => {
    for (const name of TEMPLATE_NAMES) {
      expect(TEMPLATES[name].note.length).toBeGreaterThan(20);
      expect(TEMPLATES[name].note.trimEnd().endsWith('.')).toBe(true);
    }
  });
});

describe('applyAmplitude', () => {
  it('scales the deviation from 1 on a scale axis', () => {
    // jump's hip.scale control point, which is the whole reason this
    // function is axis-aware: a flat coefficient x amplitude rule maps
    // (1.05, 0.92) at amplitude 0.5 to (0.525, 0.46) — half-size hip.
    expect(applyAmplitude('scale', 1.05, 0.1, 1)).toBe(1.005);
    expect(applyAmplitude('scale', 0.92, 0.1, 1)).toBe(0.992);
    expect(applyAmplitude('scale', 1.05, 1, 1)).toBe(1.05);
    expect(applyAmplitude('scale', 0.92, 1, 1)).toBe(0.92);
    expect(applyAmplitude('scale', 1.05, 3, 1)).toBe(1.15);
    expect(applyAmplitude('scale', 0.92, 3, 1)).toBe(0.76);
  });

  it('keeps scale within +/-20% of 1 at amplitude 1, closer at 0.1, positive at 3', () => {
    for (const coefficient of [1.05, 0.92, 0.97, 1.06]) {
      const low = applyAmplitude('scale', coefficient, 0.1, 1);
      const unit = applyAmplitude('scale', coefficient, 1, 1);
      const high = applyAmplitude('scale', coefficient, 3, 1);

      expect(Math.abs(unit - 1)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(low - 1)).toBeLessThan(Math.abs(unit - 1));
      expect(high).toBeGreaterThan(0);
    }
  });

  it('scales a rotation linearly and flips it with sideSign', () => {
    expect(applyAmplitude('rotate', -70, 1, 1)).toBe(-70);
    expect(applyAmplitude('rotate', -70, 0.5, 1)).toBe(-35);
    expect(applyAmplitude('rotate', -70, 2, 1)).toBe(-140);
    expect(applyAmplitude('rotate', -70, 1, -1)).toBe(70);
    expect(applyAmplitude('rotate', 25, 0.1, -1)).toBe(-2.5);
  });

  it('treats translate as additive around zero', () => {
    expect(applyAmplitude('translate', 30, 0.5, 1)).toBe(15);
    expect(applyAmplitude('translatey', -8, 3, 1)).toBe(-24);
    expect(applyAmplitude('translate', 0, 3, -1)).toBe(0);
  });
});

describe('the Spine 4.2 timeline key allow-list', () => {
  it('gives every entry a non-empty reader branch', () => {
    expect(SPINE_42_TIMELINE_KEYS.length).toBeGreaterThan(0);
    for (const entry of SPINE_42_TIMELINE_KEYS) {
      expect(entry.readerBranch.length).toBeGreaterThan(0);
      expect(entry.valueFields.length).toBeGreaterThan(0);
      expect(['bone', 'slot', 'animation']).toContain(entry.owner);
    }
  });

  it('does not allow-list `curve`, which is not a timeline key', () => {
    expect(SPINE_42_TIMELINE_KEYS.some((entry) => entry.key === 'curve')).toBe(false);
  });

  it('covers every key all five templates emit, at every amplitude', () => {
    // This is the test that makes adding a key to a template without
    // reviewing the reader fail the build.
    const seen = new Set<string>();

    for (const name of TEMPLATE_NAMES) {
      for (const amplitude of AMPLITUDES) {
        const { animation, emittedKeys } = emit(name, amplitude);

        for (const key of emittedKeys) {
          const entry = SPINE_42_TIMELINE_KEYS.find((spec) => spec.key === key);
          expect(entry).toBeDefined();
          expect(entry!.readerBranch.length).toBeGreaterThan(0);
          seen.add(`${entry!.owner}/${key}`);
        }

        for (const timeline of timelinesOf(animation)) {
          const entry = SPINE_42_TIMELINE_KEYS.find(
            (spec) => spec.owner === timeline.owner && spec.key === timeline.key,
          );
          expect(entry).toBeDefined();
          expect(entry!.readerBranch.length).toBeGreaterThan(0);
          seen.add(`${entry!.owner}/${timeline.key}`);
        }
      }
    }

    // The five tables between them key rotations, a hip translation and the
    // single jump scale track, and nothing else.
    expect([...seen].sort()).toEqual(['bone/rotate', 'bone/scale', 'bone/translate']);
  });
});

describe('emitAnimation', () => {
  it('writes wave at amplitude 1 with the table times and values', () => {
    const { animation } = emit('wave', 1);
    const bones = animation['bones'] as Record<string, Record<string, Json[]>>;

    // Bone order is the skeleton's declaration order, not the table's.
    expect(Object.keys(bones)).toEqual([
      'head',
      'arm_left',
      'arm_right',
      'forearm_right',
      'hand_right',
    ]);

    expect(bones['arm_right']!['rotate']).toEqual([
      { time: 0, value: 0 },
      { time: 0.2, value: -70 },
      { time: 0.5, value: -70 },
      { time: 0.8, value: -70 },
      { time: 1, value: 0 },
    ]);
    // sideSign -1 mirrors the counter-pose and nothing else.
    expect(bones['arm_left']!['rotate']).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: -6 },
      { time: 1, value: 0 },
    ]);
    expect(bones['hand_right']!['rotate']).toEqual([
      { time: 0, value: 0 },
      { time: 0.35, value: 10 },
      { time: 0.65, value: -10 },
      { time: 1, value: 0 },
    ]);
  });

  it('halves every value at amplitude 0.5 and keeps the times', () => {
    const { animation } = emit('wave', 0.5);
    const bones = animation['bones'] as Record<string, Record<string, Json[]>>;

    expect(bones['arm_right']!['rotate']).toEqual([
      { time: 0, value: 0 },
      { time: 0.2, value: -35 },
      { time: 0.5, value: -35 },
      { time: 0.8, value: -35 },
      { time: 1, value: 0 },
    ]);
    expect(bones['head']!['rotate']).toEqual([
      { time: 0, value: 0 },
      { time: 0.2, value: 1.5 },
      { time: 0.8, value: 1.5 },
      { time: 1, value: 0 },
    ]);
  });

  it('maps phase to time through the requested duration', () => {
    const { animation } = emit('jump', 1, RIG_BONES, 2);
    const bones = animation['bones'] as Record<string, Record<string, Json[]>>;
    expect(bones['hip']!['translate']!.map((frame) => frame['time'])).toEqual([
      0, 0.3, 0.9, 1.5, 2,
    ]);
  });

  it('writes the hip timeline keys in rotate, translate, scale order', () => {
    const { animation } = emit('jump', 1);
    const bones = animation['bones'] as Record<string, Record<string, Json[]>>;
    expect(Object.keys(bones['hip']!)).toEqual(['translate', 'scale']);
  });

  it('never writes a curve, and always keys time 0, for every template and amplitude', () => {
    for (const name of TEMPLATE_NAMES) {
      for (const amplitude of AMPLITUDES) {
        const { animation } = emit(name, amplitude);
        expect(JSON.stringify(animation)).not.toContain('curve');

        const timelines = timelinesOf(animation);
        expect(timelines.length).toBeGreaterThan(0);
        for (const timeline of timelines) {
          expect(timeline.frames.length).toBeGreaterThan(0);
          expect(timeline.frames[0]!['time']).toBe(0);
          for (const frame of timeline.frames) {
            expect(frame).not.toHaveProperty('curve');
          }
        }
      }
    }
  });

  it('keeps every emitted scale value strictly positive at every amplitude', () => {
    for (const name of TEMPLATE_NAMES) {
      for (const amplitude of AMPLITUDES) {
        const { animation } = emit(name, amplitude);
        for (const timeline of timelinesOf(animation)) {
          if (timeline.key !== 'scale') continue;
          for (const frame of timeline.frames) {
            expect(frame['x'] as number).toBeGreaterThan(0);
            expect(frame['y'] as number).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('keeps every timeline strictly increasing in time', () => {
    for (const name of TEMPLATE_NAMES) {
      for (const duration of [0.1, 1, 60]) {
        const { animation } = emit(name, 1, RIG_BONES, duration);
        for (const timeline of timelinesOf(animation)) {
          const times = timeline.frames.map((frame) => frame['time'] as number);
          for (let index = 1; index < times.length; index++) {
            expect(times[index]!).toBeGreaterThan(times[index - 1]!);
          }
        }
      }
    }
  });

  it('emits no slots section, because no table declares a slot track', () => {
    for (const name of TEMPLATE_NAMES) {
      const { animation } = emit(name, 1);
      expect(animation).not.toHaveProperty('slots');
      expect(animation).not.toHaveProperty('events');
    }
  });
});

describe('matchTemplate', () => {
  it('fits every template to the canonical rig', () => {
    for (const name of TEMPLATE_NAMES) {
      const match = matchTemplate(TEMPLATES[name], RIG_BONES);
      expect(match.ok).toBe(true);
      if (!match.ok) continue;
      expect(match.usedBones.length).toBeGreaterThan(0);
      expect(match.omittedOptional).toEqual([]);
      expect(match.droppedTracks).toEqual([]);
    }
  });

  it('refuses walk on a rig with no thighs, naming them', () => {
    const legless = RIG_BONES.filter((bone) => !bone.startsWith('thigh_'));
    const match = matchTemplate(TEMPLATES.walk, legless);

    expect(match.ok).toBe(false);
    if (match.ok) return;
    expect(match.missingRequired).toEqual(['thigh_left', 'thigh_right']);
    expect(match.suggestions).toEqual([]);
  });

  it('still fits walk to a rig with no shins, reporting the omission', () => {
    const shinless = RIG_BONES.filter((bone) => !bone.startsWith('shin_'));
    const match = matchTemplate(TEMPLATES.walk, shinless);

    expect(match.ok).toBe(true);
    if (!match.ok) return;
    expect(match.omittedOptional).toEqual(['shin_left', 'shin_right']);
    expect(match.droppedTracks).toEqual(['shin_left/rotate', 'shin_right/rotate']);
    expect(match.usedBones).toContain('thigh_left');
    expect(match.usedBones).not.toContain('shin_left');
  });

  it('suggests a rename for an aliased bone without ever substituting it', () => {
    // `upper_arm_left` is what a layer might be called; the generator calls
    // it `arm_left`. The suggestion is advisory: the match still fails.
    const aliased = ['root', 'hip', 'chest', 'upper_arm_left'];
    const match = matchTemplate(TEMPLATES.idle, aliased);

    expect(match.ok).toBe(false);
    if (match.ok) return;
    expect(match.missingRequired).toEqual(['torso']);
    expect(match.suggestions).toEqual([]);

    const bodyRig = ['root', 'hip', 'body', 'chest'];
    const bodyMatch = matchTemplate(TEMPLATES.idle, bodyRig);
    expect(bodyMatch.ok).toBe(false);
    if (bodyMatch.ok) return;
    expect(bodyMatch.suggestions).toEqual([{ missing: 'torso', candidate: 'body' }]);

    const armRig = ['root', 'chest', 'upper_arm_right'];
    const armMatch = matchTemplate(TEMPLATES.wave, armRig);
    expect(armMatch.ok).toBe(false);
    if (armMatch.ok) return;
    expect(armMatch.suggestions).toEqual([
      { missing: 'arm_right', candidate: 'upper_arm_right' },
    ]);
  });

  it('mirrors the Python aliases it is documented to mirror', () => {
    expect(ADVISORY_ALIASES['upper_arm_left']).toBe('arm_left');
    expect(ADVISORY_ALIASES['body']).toBe('torso');
    expect(ADVISORY_ALIASES['pelvis']).toBe('hip');
    expect(ADVISORY_ALIASES['calf_left']).toBe('shin_left');
  });

  it('returns used bones in skeleton declaration order', () => {
    const reversed = [...RIG_BONES].reverse();
    const match = matchTemplate(TEMPLATES.wave, reversed);
    expect(match.ok).toBe(true);
    if (!match.ok) return;
    expect(match.usedBones).toEqual([
      'hand_right',
      'forearm_right',
      'arm_right',
      'arm_left',
      'head',
    ]);
  });
});

describe('validateEmittedAnimations', () => {
  const base = (animation: Json): Json => ({
    skeleton: { hash: 'validate', spine: '4.2.37' },
    bones: [{ name: 'root' }, { name: 'head', parent: 'root' }],
    slots: [{ name: 'head', bone: 'head', attachment: 'head' }],
    events: { footstep: { int: 1 } },
    animations: { probe: animation },
  });

  it('accepts a well-formed emitted animation', () => {
    const result = validateEmittedAnimations(
      base({ bones: { head: { rotate: [{ time: 0, value: 0 }, { time: 1, value: 5 }] } } }),
      ['rotate'],
      ['probe'],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ animations: 1, timelines: 1, keyframes: 2 });
  });

  it('rejects an undeclared event', () => {
    const result = validateEmittedAnimations(
      base({
        bones: { head: { rotate: [{ time: 0, value: 0 }] } },
        events: [{ time: 0, name: 'ghost' }],
      }),
      ['rotate', 'events'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('ghost');
    expect(result.hint).toContain('defect in the generator');
  });

  it('rejects a bone the skeleton does not declare', () => {
    const result = validateEmittedAnimations(
      base({ bones: { ghost_bone: { rotate: [{ time: 0, value: 0 }] } } }),
      ['rotate'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('ghost_bone');
  });

  it('rejects a non-increasing time', () => {
    const result = validateEmittedAnimations(
      base({
        bones: { head: { rotate: [{ time: 0, value: 0 }, { time: 0, value: 1 }] } },
      }),
      ['rotate'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('non-increasing');
  });

  it('rejects a timeline that does not start at time 0', () => {
    const result = validateEmittedAnimations(
      base({ bones: { head: { rotate: [{ time: 0.5, value: 1 }] } } }),
      ['rotate'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('rather than 0');
  });

  it('rejects a stray curve', () => {
    const result = validateEmittedAnimations(
      base({
        bones: { head: { rotate: [{ time: 0, value: 0, curve: 'stepped' }] } },
      }),
      ['rotate'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('curve');
  });

  it('rejects an empty timeline, which the reader silently skips', () => {
    const result = validateEmittedAnimations(
      base({ bones: { head: { rotate: [] } } }),
      ['rotate'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('non-empty');
  });

  it('rejects a key that is not a 4.2 bone timeline', () => {
    const result = validateEmittedAnimations(
      base({ bones: { head: { wobble: [{ time: 0, value: 0 }] } } }),
      ['rotate'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('wobble');
  });

  it('rejects a non-positive scale value', () => {
    const result = validateEmittedAnimations(
      base({ bones: { head: { scale: [{ time: 0, x: 1, y: 0 }] } } }),
      ['scale'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('not greater than zero');
  });

  it('rejects a non-finite number anywhere in the animation', () => {
    const result = validateEmittedAnimations(
      base({ bones: { head: { rotate: [{ time: 0, value: Number.NaN }] } } }),
      ['rotate'],
      ['probe'],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('finite');
  });

  it('accepts every template emitted into the canonical rig', () => {
    const output: Json = JSON.parse(JSON.stringify(CANONICAL_RIG)) as Json;
    const animations: Record<string, unknown> = {};
    const keys = new Set<string>();

    for (const name of TEMPLATE_NAMES) {
      for (const amplitude of AMPLITUDES) {
        const { animation, emittedKeys } = emit(name, amplitude);
        animations[`${name}_${String(amplitude).replace('.', '_')}`] = animation;
        for (const key of emittedKeys) keys.add(key);
      }
    }
    output['animations'] = animations;

    const result = validateEmittedAnimations(output, [...keys], Object.keys(animations));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.animations).toBe(15);
  });
});

describe('recomputeSkeletonHash', () => {
  const rig = (): Json => JSON.parse(JSON.stringify(CANONICAL_RIG)) as Json;

  it('is stable for identical input and 22 hex characters long', () => {
    const first = recomputeSkeletonHash(rig());
    const second = recomputeSkeletonHash(rig());
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{22}$/);
  });

  it('changes when one keyframe value changes', () => {
    const before = rig();
    const after = rig();
    const animations = after['animations'] as Record<string, Json>;
    const idle = animations['idle'] as Json;
    const bones = idle['bones'] as Record<string, Record<string, Json[]>>;
    bones['torso']!['rotate']![1]!['value'] = 2;

    expect(recomputeSkeletonHash(after)).not.toBe(recomputeSkeletonHash(before));
  });

  it('ignores the input hash and the generator record', () => {
    // Otherwise the hash would depend on the hash, and re-running the tool
    // on its own output would change it with no data change.
    const plain = rig();
    const decorated = rig();
    (decorated['skeleton'] as Json)['hash'] = 'something-else-entirely';
    decorated['_generator'] = { tool: 'kiro-spine2d-power/skeleton_animate', schema: 1 };

    expect(recomputeSkeletonHash(decorated)).toBe(recomputeSkeletonHash(plain));
  });

  it('changes when an animation is added', () => {
    const before = rig();
    const after = rig();
    const match = matchTemplate(TEMPLATES.wave, RIG_BONES) as MatchOk;
    const { animation } = emitAnimation(
      TEMPLATES.wave,
      { name: 'wave', duration: 1, amplitude: 1, emitEvents: false },
      match,
    );
    (after['animations'] as Record<string, unknown>)['wave'] = animation;

    expect(recomputeSkeletonHash(after)).not.toBe(recomputeSkeletonHash(before));
  });
});

describe('axis typing', () => {
  it('only uses axes the emitter knows how to write', () => {
    const known: Axis[] = ['rotate', 'translate', 'translatex', 'translatey', 'scale'];
    for (const name of TEMPLATE_NAMES) {
      for (const track of TEMPLATES[name].tracks) {
        expect(known).toContain(track.axis);
      }
    }
  });
});
