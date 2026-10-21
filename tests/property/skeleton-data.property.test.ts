/**
 * Property tests for the skeleton inspector.
 *
 * The inspector is the foundation every other data-layer tool builds on,
 * so these check invariants over generated skeletons rather than specific
 * examples: counts must match the input, durations must equal the largest
 * keyframe time, and arbitrary extra fields must never cause a throw.
 */
import fc from 'fast-check';

import { inspectSkeleton, readAnimation, readBones } from '../../src/skeleton-data';

const boneName = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((name) => name.trim().length > 0);

/** A chain of bones where each bone's parent is the previous one. */
const boneChain = fc.array(boneName, { minLength: 1, maxLength: 12 }).map((names) => {
  const unique = [...new Set(names)];
  return unique.map((name, index) => ({
    name,
    ...(index === 0 ? {} : { parent: unique[index - 1]! }),
  }));
});

describe('readBones properties', () => {
  it('counts every uniquely named bone', () => {
    fc.assert(
      fc.property(boneChain, (bones) => {
        const summary = readBones({ bones });
        expect(summary.count).toBe(bones.length);
        expect(summary.names).toEqual(bones.map((bone) => bone.name));
      }),
    );
  });

  it('reports depth equal to the chain length for a linear hierarchy', () => {
    fc.assert(
      fc.property(boneChain, (bones) => {
        const summary = readBones({ bones });
        expect(summary.maxDepth).toBe(bones.length);
        expect(summary.rootCount).toBe(1);
        expect(summary.missingParents).toEqual([]);
      }),
    );
  });

  it('never throws on arbitrary bone payloads', () => {
    fc.assert(
      fc.property(fc.array(fc.object(), { maxLength: 10 }), (bones) => {
        expect(() => readBones({ bones })).not.toThrow();
      }),
    );
  });
});

describe('readAnimation properties', () => {
  const keyframes = fc.array(
    fc.record({ time: fc.double({ min: 0, max: 100, noNaN: true }) }),
    { minLength: 1, maxLength: 20 },
  );

  it('derives duration as the maximum keyframe time', () => {
    fc.assert(
      fc.property(keyframes, (frames) => {
        const summary = readAnimation('a', {
          bones: { bone: { rotate: frames } },
        });
        const expected = Math.max(...frames.map((frame) => frame.time));
        expect(summary.duration).toBeCloseTo(expected, 6);
      }),
    );
  });

  it('counts keyframes exactly once per timeline', () => {
    fc.assert(
      fc.property(keyframes, keyframes, (rotate, translate) => {
        const summary = readAnimation('a', {
          bones: { bone: { rotate, translate } },
        });
        expect(summary.timelineCount).toBe(2);
        expect(summary.keyframeCount).toBe(rotate.length + translate.length);
        expect(summary.groups['bones']).toBe(2);
      }),
    );
  });

  it('treats a missing time as zero rather than failing', () => {
    const summary = readAnimation('a', { bones: { bone: { rotate: [{ value: 1 }] } } });
    expect(summary.duration).toBe(0);
    expect(summary.keyframeCount).toBe(1);
  });

  it('never throws on arbitrary animation payloads', () => {
    fc.assert(
      fc.property(fc.anything(), (animation) => {
        expect(() => readAnimation('a', animation)).not.toThrow();
      }),
    );
  });
});

describe('inspectSkeleton properties', () => {
  it('never throws on arbitrary top-level objects', () => {
    fc.assert(
      fc.property(fc.object(), (root) => {
        expect(() => inspectSkeleton(root as Record<string, unknown>)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it('keeps totals consistent with the per-animation figures', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 6 }),
          fc.record({
            bones: fc.dictionary(
              fc.string({ minLength: 1, maxLength: 4 }),
              fc.record({
                rotate: fc.array(
                  fc.record({ time: fc.double({ min: 0, max: 10, noNaN: true }) }),
                  { minLength: 1, maxLength: 5 },
                ),
              }),
            ),
          }),
          { maxKeys: 5 },
        ),
        (animations) => {
          const report = inspectSkeleton({ bones: [{ name: 'root' }], animations });
          const summed = report.animations.reduce(
            (sum, animation) => sum + animation.timelineCount,
            0,
          );
          expect(report.totals.timelineCount).toBe(summed);
          expect(report.totals.animationCount).toBe(report.animations.length);
          if (report.animations.length > 0) {
            expect(report.totals.longestDuration).toBe(
              Math.max(...report.animations.map((animation) => animation.duration)),
            );
          }
        },
      ),
    );
  });
});
