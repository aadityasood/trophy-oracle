import { describe, expect, it } from 'vitest';
import type { TrackingConfiguration } from './achievement-schema';
import type { AchievementProgressV3 } from './hunt-memory-schema';
import { validateTrackerShape } from './hunt-memory-tracker-shape';
import { validateTrackerShape as validateTrackerShapeReexport } from './hunt-memory-reconciliation-run';

function createProgress(
  overrides?: Partial<AchievementProgressV3>,
): AchievementProgressV3 {
  return {
    achievementId: 'ach-test',
    completed: false,
    manualOverride: false,
    lastUpdated: '2026-07-22T00:00:00.000Z',
    provenance: 'manual',
    ...overrides,
  };
}

describe('hunt-memory-tracker-shape', () => {
  it('re-exports the exact neutral validator from reconciliation-run module', () => {
    expect(validateTrackerShapeReexport).toBe(validateTrackerShape);
  });

  it('preserves input immutability for progress and tracking configurations', () => {
    const progress: AchievementProgressV3 = createProgress({
      counter: { certainty: 'exact', value: 10 },
      notes: 'preserve me',
    });
    const tracking: TrackingConfiguration = {
      mode: 'counter',
      unit: 'beacons',
      target: 20,
    };

    const progressBefore = structuredClone(progress);
    const trackingBefore = structuredClone(tracking);

    const result = validateTrackerShape(progress, tracking);
    expect(result).toBe(true);

    expect(progress).toEqual(progressBefore);
    expect(tracking).toEqual(trackingBefore);
  });

  describe('binary tracking mode', () => {
    const tracking: TrackingConfiguration = { mode: 'binary' };

    it('accepts completed true and false when manualOverride is false without tracker fields', () => {
      expect(
        validateTrackerShape(
          createProgress({ completed: false, manualOverride: false }),
          tracking,
        ),
      ).toBe(true);

      expect(
        validateTrackerShape(
          createProgress({ completed: true, manualOverride: false }),
          tracking,
        ),
      ).toBe(true);
    });

    it('rejects binary progress when manualOverride is true regardless of completed state', () => {
      expect(
        validateTrackerShape(
          createProgress({ completed: true, manualOverride: true }),
          tracking,
        ),
      ).toBe(false);

      expect(
        validateTrackerShape(
          createProgress({ completed: false, manualOverride: true }),
          tracking,
        ),
      ).toBe(false);
    });

    it('rejects binary progress when counter or checklist state is present', () => {
      expect(
        validateTrackerShape(
          createProgress({
            counter: { certainty: 'exact', value: 0 },
          }),
          tracking,
        ),
      ).toBe(false);

      expect(
        validateTrackerShape(
          createProgress({
            checklistCompletion: { item1: true },
          }),
          tracking,
        ),
      ).toBe(false);

      expect(
        validateTrackerShape(
          createProgress({
            counter: { certainty: 'exact', value: 1 },
            checklistCompletion: { item1: true },
          }),
          tracking,
        ),
      ).toBe(false);
    });
  });

  describe('counter tracking mode', () => {
    const tracking: TrackingConfiguration = {
      mode: 'counter',
      unit: 'items',
      target: 10,
    };

    it('accepts counter state with manualOverride false or true', () => {
      expect(
        validateTrackerShape(
          createProgress({
            counter: { certainty: 'exact', value: 5 },
            manualOverride: false,
          }),
          tracking,
        ),
      ).toBe(true);

      expect(
        validateTrackerShape(
          createProgress({
            counter: { certainty: 'exact', value: 5 },
            completed: true,
            manualOverride: true,
          }),
          tracking,
        ),
      ).toBe(true);
    });

    it('rejects counter tracking when counter is missing or checklist is present', () => {
      expect(
        validateTrackerShape(
          createProgress({
            counter: undefined,
          }),
          tracking,
        ),
      ).toBe(false);

      expect(
        validateTrackerShape(
          createProgress({
            counter: { certainty: 'exact', value: 5 },
            checklistCompletion: { step: true },
          }),
          tracking,
        ),
      ).toBe(false);
    });
  });

  describe('checklist tracking mode', () => {
    const tracking: TrackingConfiguration = {
      mode: 'checklist',
      items: [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
      ],
    };

    it('accepts exact own item keys with manualOverride false or true', () => {
      expect(
        validateTrackerShape(
          createProgress({
            checklistCompletion: { alpha: true, beta: false },
            manualOverride: false,
          }),
          tracking,
        ),
      ).toBe(true);

      expect(
        validateTrackerShape(
          createProgress({
            checklistCompletion: { alpha: true, beta: true },
            completed: true,
            manualOverride: true,
          }),
          tracking,
        ),
      ).toBe(true);
    });

    it('rejects checklist tracking when checklist is missing or counter is present', () => {
      expect(
        validateTrackerShape(
          createProgress({
            checklistCompletion: undefined,
          }),
          tracking,
        ),
      ).toBe(false);

      expect(
        validateTrackerShape(
          createProgress({
            checklistCompletion: { alpha: true, beta: false },
            counter: { certainty: 'exact', value: 0 },
          }),
          tracking,
        ),
      ).toBe(false);
    });

    it('rejects missing, extra, or equal-count wrong checklist keys', () => {
      expect(
        validateTrackerShape(
          createProgress({
            checklistCompletion: { alpha: true },
          }),
          tracking,
        ),
      ).toBe(false);

      expect(
        validateTrackerShape(
          createProgress({
            checklistCompletion: { alpha: true, beta: false, extra: false },
          }),
          tracking,
        ),
      ).toBe(false);

      expect(
        validateTrackerShape(
          createProgress({
            checklistCompletion: { alpha: true, gamma: false },
          }),
          tracking,
        ),
      ).toBe(false);
    });

    it('supports safe own constructor and toString keys and rejects inherited keys', () => {
      const specialTracking: TrackingConfiguration = {
        mode: 'checklist',
        items: [
          { id: 'constructor', name: 'Constructor item' },
          { id: 'toString', name: 'ToString item' },
        ],
      };

      const ownSpecialProgress = createProgress({
        checklistCompletion: {
          ['constructor']: true,
          ['toString']: false,
        },
      });
      expect(validateTrackerShape(ownSpecialProgress, specialTracking)).toBe(true);

      const emptyObjectProgress = createProgress({
        checklistCompletion: {},
      });
      expect(validateTrackerShape(emptyObjectProgress, specialTracking)).toBe(false);

      const inherited = Object.create({ alpha: true, beta: true });
      const inheritedProgress = createProgress({
        checklistCompletion: inherited,
      });
      expect(validateTrackerShape(inheritedProgress, tracking)).toBe(false);
    });
  });
});
