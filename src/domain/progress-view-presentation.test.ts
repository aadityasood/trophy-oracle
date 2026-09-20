import { describe, expect, it } from 'vitest';
import type { AchievementRecord } from './achievement-schema';
import type { AchievementProgress } from './progress-schema';
import {
  getProgressSummary,
  getRiskLabel,
  hasUrgency,
} from './progress-view';
import { MOCK_TIMESTAMP } from '../test/progress-fixtures';

describe('getRiskLabel presentation mapping', () => {
  it('classifies risk labels with point_of_no_return precedence, missable, caution for warning, or undefined', () => {
    const baseAch: AchievementRecord = {
      id: 'r-01',
      name: 'Record',
      description: 'Desc',
      evidence: 'Ev',
      reward: { type: 'trophy', grade: 'bronze' },
      tracking: { mode: 'binary' },
      labels: ['story'],
      expectedStage: 'story',
      confidence: 1,
      prerequisites: [],
    };

    const achWarningOnly: AchievementRecord = {
      ...baseAch,
      labels: ['online'],
      warning: 'Online servers close soon',
    };
    expect(hasUrgency(achWarningOnly)).toBe(false);
    expect(getRiskLabel(achWarningOnly)).toBe('Caution');

    const achMissable: AchievementRecord = {
      ...baseAch,
      labels: ['missable'],
    };
    expect(hasUrgency(achMissable)).toBe(true);
    expect(getRiskLabel(achMissable)).toBe('Missable');

    const achPonr: AchievementRecord = {
      ...baseAch,
      labels: ['point_of_no_return'],
    };
    expect(hasUrgency(achPonr)).toBe(true);
    expect(getRiskLabel(achPonr)).toBe('Point of no return');

    const achCombined: AchievementRecord = {
      ...baseAch,
      labels: ['missable', 'point_of_no_return'],
      warning: 'Cannot backtrack',
    };
    expect(hasUrgency(achCombined)).toBe(true);
    expect(getRiskLabel(achCombined)).toBe('Point of no return');

    const achNormal: AchievementRecord = {
      ...baseAch,
      labels: ['story'],
    };
    expect(hasUrgency(achNormal)).toBe(false);
    expect(getRiskLabel(achNormal)).toBeUndefined();

    const achBlankWarning: AchievementRecord = {
      ...baseAch,
      labels: ['story'],
      warning: '   ',
    };
    expect(hasUrgency(achBlankWarning)).toBe(false);
    expect(getRiskLabel(achBlankWarning)).toBeUndefined();
  });
});

describe('getProgressSummary shared progress formatting', () => {
  const counterAch: AchievementRecord = {
    id: 'c-01',
    name: 'Counter',
    description: 'Desc',
    evidence: 'Ev',
    reward: { type: 'trophy', grade: 'bronze' },
    tracking: { mode: 'counter', unit: 'beacons', target: 48 },
    labels: ['grind'],
    expectedStage: 'cleanup',
    confidence: 1,
    prerequisites: [],
  };

  it('formats bounded counter progress, remaining count, and floor percentage', () => {
    const progress: AchievementProgress = {
      achievementId: 'c-01',
      completed: false,
      manualOverride: false,
      counterValue: 5,
      lastUpdated: MOCK_TIMESTAMP,
      provenance: 'manual',
    };
    expect(getProgressSummary(counterAch, progress)).toBe(
      'Progress: 5 / 48 (43 remaining, 10%)',
    );
  });

  it('formats bounded counter with zero progress', () => {
    const progress: AchievementProgress = {
      achievementId: 'c-01',
      completed: false,
      manualOverride: false,
      counterValue: 0,
      lastUpdated: MOCK_TIMESTAMP,
      provenance: 'manual',
    };
    expect(getProgressSummary(counterAch, progress)).toBe(
      'Progress: 0 / 48 (48 remaining, 0%)',
    );
  });

  it('preserves over-target stored counter values while clamping remaining to zero and capping percentage at 100%', () => {
    const progress: AchievementProgress = {
      achievementId: 'c-01',
      completed: true,
      manualOverride: false,
      counterValue: 53,
      lastUpdated: MOCK_TIMESTAMP,
      provenance: 'manual',
    };
    expect(getProgressSummary(counterAch, progress)).toBe(
      'Progress: 53 / 48 (0 remaining, 100%)',
    );
  });

  it('formats open counter progress without remaining or percentage claims', () => {
    const openCounterAch: AchievementRecord = {
      ...counterAch,
      tracking: { mode: 'counter', unit: 'duels' },
    };
    const progress: AchievementProgress = {
      achievementId: 'c-01',
      completed: false,
      manualOverride: false,
      counterValue: 3,
      lastUpdated: MOCK_TIMESTAMP,
      provenance: 'manual',
    };
    expect(getProgressSummary(openCounterAch, progress)).toBe(
      'Progress: 3 duels (open counter)',
    );
  });

  it('formats checklist progress and derives completion strictly from definition items ignoring extra or inherited keys', () => {
    const checklistAch: AchievementRecord = {
      id: 'cl-01',
      name: 'Checklist',
      description: 'Desc',
      evidence: 'Ev',
      reward: { type: 'trophy', grade: 'bronze' },
      tracking: {
        mode: 'checklist',
        items: [
          { id: 'item-1', name: 'Item 1' },
          { id: 'item-2', name: 'Item 2' },
          { id: 'item-3', name: 'Item 3' },
        ],
      },
      labels: ['grind'],
      expectedStage: 'cleanup',
      confidence: 1,
      prerequisites: [],
    };
    const completionWithInherited = Object.create({ 'item-2': true });
    completionWithInherited['item-1'] = true;
    completionWithInherited['item-3'] = false;
    completionWithInherited['unrelated-key'] = true;
    completionWithInherited['obsolete-key'] = true;

    const progress: AchievementProgress = {
      achievementId: 'cl-01',
      completed: false,
      manualOverride: false,
      checklistCompletion: completionWithInherited,
      lastUpdated: MOCK_TIMESTAMP,
      provenance: 'manual',
    };
    expect(getProgressSummary(checklistAch, progress)).toBe(
      'Progress: 1 / 3 items (2 remaining, 33%)',
    );
  });

  it('defensively handles missing progress, zero totals, and binary achievements', () => {
    const binaryAch: AchievementRecord = {
      ...counterAch,
      tracking: { mode: 'binary' },
    };
    expect(getProgressSummary(binaryAch, undefined)).toBeUndefined();
    expect(getProgressSummary(counterAch, undefined)).toBe(
      'Progress: 0 / 48 (48 remaining, 0%)',
    );

    const zeroTargetAch: AchievementRecord = {
      ...counterAch,
      tracking: { mode: 'counter', unit: 'items', target: 0 },
    };
    expect(getProgressSummary(zeroTargetAch, undefined)).toBe(
      'Progress: 0 / 0 (0 remaining, 0%)',
    );

    const openCounterAch: AchievementRecord = {
      ...counterAch,
      tracking: { mode: 'counter', unit: 'duels' },
    };
    expect(getProgressSummary(openCounterAch, undefined)).toBe(
      'Progress: 0 duels (open counter)',
    );
  });
});
