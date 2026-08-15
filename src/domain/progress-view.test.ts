import { describe, expect, it } from 'vitest';
import type {
  AchievementRecord,
  AchievementSet,
} from './achievement-schema';
import { createDefaultAchievementSetProgress } from './progress-engine';
import type { AchievementProgress } from './progress-schema';
import {
  CANONICAL_STAGE_ORDER,
  STAGE_DISPLAY_LABELS,
  arePrerequisitesMet,
  getOracleFocus,
  getPinnedAchievements,
  getStageSummaries,
  hasPartialProgress,
  hasUrgency,
  resolveActiveStage,
} from './progress-view';
import {
  mockGameStellarDrift,
  MOCK_TIMESTAMP,
} from '../test/progress-fixtures';

const sampleSet: AchievementSet = mockGameStellarDrift.achievementSets[0];

describe('progress-view pure selectors', () => {
  describe('stage summaries and active stage', () => {
    it('computes pure stage summaries in canonical order for incomplete progress', () => {
      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      const summaries = getStageSummaries(sampleSet, setProgress);

      expect(CANONICAL_STAGE_ORDER).toEqual(['story', 'missables', 'cleanup']);
      expect(summaries.map((s) => s.stage)).toEqual([
        'story',
        'missables',
        'cleanup',
      ]);
      expect(summaries.map((s) => s.label)).toEqual([
        STAGE_DISPLAY_LABELS.story,
        STAGE_DISPLAY_LABELS.missables,
        STAGE_DISPLAY_LABELS.cleanup,
      ]);

      const storySummary = summaries.find((s) => s.stage === 'story')!;
      expect(storySummary.totalCount).toBe(2);
      expect(storySummary.completedCount).toBe(0);
      expect(storySummary.remainingCount).toBe(2);
      expect(storySummary.fraction).toBe(0);

      const missablesSummary = summaries.find((s) => s.stage === 'missables')!;
      expect(missablesSummary.totalCount).toBe(1);
      expect(missablesSummary.completedCount).toBe(0);
      expect(missablesSummary.remainingCount).toBe(1);
      expect(missablesSummary.fraction).toBe(0);

      const cleanupSummary = summaries.find((s) => s.stage === 'cleanup')!;
      expect(cleanupSummary.totalCount).toBe(3);
      expect(cleanupSummary.completedCount).toBe(0);
      expect(cleanupSummary.remainingCount).toBe(3);
      expect(cleanupSummary.fraction).toBe(0);
    });

    it('computes correct counts and fractions for partially completed progress', () => {
      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      setProgress.progress['sd-ps-001'].completed = true;
      setProgress.progress['sd-ps-004'].completed = true;

      const summaries = getStageSummaries(sampleSet, setProgress);

      const story = summaries.find((s) => s.stage === 'story')!;
      expect(story.totalCount).toBe(2);
      expect(story.completedCount).toBe(1);
      expect(story.remainingCount).toBe(1);
      expect(story.fraction).toBe(0.5);

      const cleanup = summaries.find((s) => s.stage === 'cleanup')!;
      expect(cleanup.totalCount).toBe(3);
      expect(cleanup.completedCount).toBe(1);
      expect(cleanup.remainingCount).toBe(2);
      expect(cleanup.fraction).toBeCloseTo(1 / 3, 5);
    });

    it('returns zero values stably for empty stages and missing progress', () => {
      const setWithNoCleanup: AchievementSet = {
        id: 'test-no-cleanup',
        platform: 'playstation',
        version: '1.0',
        achievements: [
          {
            id: 't-01',
            name: 'Story Only',
            description: 'Story',
            evidence: 'Mandatory',
            reward: { type: 'trophy', grade: 'bronze' },
            tracking: { mode: 'binary' },
            labels: ['story'],
            expectedStage: 'story',
            confidence: 1,
            prerequisites: [],
          },
        ],
      };

      const summaries = getStageSummaries(setWithNoCleanup, undefined);
      expect(summaries).toHaveLength(3);

      const cleanup = summaries.find((s) => s.stage === 'cleanup')!;
      expect(cleanup.totalCount).toBe(0);
      expect(cleanup.completedCount).toBe(0);
      expect(cleanup.remainingCount).toBe(0);
      expect(cleanup.fraction).toBe(0);

      const missables = summaries.find((s) => s.stage === 'missables')!;
      expect(missables.totalCount).toBe(0);
      expect(missables.completedCount).toBe(0);
      expect(missables.remainingCount).toBe(0);
      expect(missables.fraction).toBe(0);
    });

    it('resolves stored active stage and falls back to story when absent', () => {
      expect(resolveActiveStage(undefined)).toBe('story');

      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      expect(resolveActiveStage(setProgress)).toBe('story');

      setProgress.activeStage = 'missables';
      expect(resolveActiveStage(setProgress)).toBe('missables');

      setProgress.activeStage = 'cleanup';
      expect(resolveActiveStage(setProgress)).toBe('cleanup');
    });
  });

  describe('pinned achievements', () => {
    it('returns pinned achievements in stored order up to 5 items', () => {
      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      setProgress.pinnedAchievementIds = [
        'sd-ps-004',
        'sd-ps-001',
        'sd-ps-002',
      ];

      const pinned = getPinnedAchievements(sampleSet, setProgress);
      expect(pinned.map((a) => a.id)).toEqual([
        'sd-ps-004',
        'sd-ps-001',
        'sd-ps-002',
      ]);
    });

    it('filters out non-existent pin IDs and returns empty array when none pinned', () => {
      expect(getPinnedAchievements(sampleSet, undefined)).toEqual([]);

      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      setProgress.pinnedAchievementIds = ['non-existent-id', 'sd-ps-001'];

      const pinned = getPinnedAchievements(sampleSet, setProgress);
      expect(pinned.map((a) => a.id)).toEqual(['sd-ps-001']);
    });

    it('does not read pins or stage completion from another achievement set', () => {
      const otherSet = mockGameStellarDrift.achievementSets[1];
      const otherSetProgress = createDefaultAchievementSetProgress(
        otherSet,
        MOCK_TIMESTAMP,
      );
      otherSetProgress.pinnedAchievementIds = ['sd-steam-001'];
      otherSetProgress.progress['sd-steam-001'].completed = true;

      expect(getPinnedAchievements(sampleSet, otherSetProgress)).toEqual([]);
      expect(
        getStageSummaries(sampleSet, otherSetProgress).map((summary) =>
          summary.completedCount,
        ),
      ).toEqual([0, 0, 0]);
    });
  });

  describe('urgency and partial progress helpers', () => {
    it('detects urgency from warnings, point_of_no_return, or missable labels', () => {
      const achWarning: AchievementRecord = {
        id: 'w-01',
        name: 'Warning',
        description: 'Desc',
        evidence: 'Ev',
        reward: { type: 'trophy', grade: 'bronze' },
        tracking: { mode: 'binary' },
        labels: ['story'],
        expectedStage: 'story',
        confidence: 1,
        prerequisites: [],
        warning: 'Careful here',
      };
      expect(hasUrgency(achWarning)).toBe(true);

      const achMissable: AchievementRecord = {
        ...achWarning,
        warning: undefined,
        labels: ['missable'],
      };
      expect(hasUrgency(achMissable)).toBe(true);

      const achPonr: AchievementRecord = {
        ...achWarning,
        warning: undefined,
        labels: ['point_of_no_return'],
      };
      expect(hasUrgency(achPonr)).toBe(true);

      const achNormal: AchievementRecord = {
        ...achWarning,
        warning: undefined,
        labels: ['story'],
      };
      expect(hasUrgency(achNormal)).toBe(false);
    });

    it('detects partial progress on counters and checklists, but not on binary or completed achievements', () => {
      const counterAch: AchievementRecord = {
        id: 'c-01',
        name: 'Counter',
        description: 'Desc',
        evidence: 'Ev',
        reward: { type: 'trophy', grade: 'bronze' },
        tracking: { mode: 'counter', unit: 'items', target: 10 },
        labels: ['grind'],
        expectedStage: 'cleanup',
        confidence: 1,
        prerequisites: [],
      };

      const pZero: AchievementProgress = {
        achievementId: 'c-01',
        completed: false,
        manualOverride: false,
        counterValue: 0,
        lastUpdated: MOCK_TIMESTAMP,
        provenance: 'manual',
      };
      expect(hasPartialProgress(counterAch, pZero)).toBe(false);

      const pPartial: AchievementProgress = {
        ...pZero,
        counterValue: 3,
      };
      expect(hasPartialProgress(counterAch, pPartial)).toBe(true);

      const pCompleted: AchievementProgress = {
        ...pZero,
        counterValue: 10,
        completed: true,
      };
      expect(hasPartialProgress(counterAch, pCompleted)).toBe(false);

      const checklistAch: AchievementRecord = {
        id: 'cl-01',
        name: 'Checklist',
        description: 'Desc',
        evidence: 'Ev',
        reward: { type: 'trophy', grade: 'bronze' },
        tracking: {
          mode: 'checklist',
          items: [
            { id: 'i1', name: 'Item 1' },
            { id: 'i2', name: 'Item 2' },
          ],
        },
        labels: ['grind'],
        expectedStage: 'cleanup',
        confidence: 1,
        prerequisites: [],
      };

      const clProgress: AchievementProgress = {
        achievementId: 'cl-01',
        completed: false,
        manualOverride: false,
        checklistCompletion: { i1: true, i2: false },
        lastUpdated: MOCK_TIMESTAMP,
        provenance: 'manual',
      };
      expect(hasPartialProgress(checklistAch, clProgress)).toBe(true);

      const clNone: AchievementProgress = {
        ...clProgress,
        checklistCompletion: { i1: false, i2: false },
      };
      expect(hasPartialProgress(checklistAch, clNone)).toBe(false);
    });

    it('checks prerequisites accurately', () => {
      const achWithPrereqs: AchievementRecord = {
        id: 'p-02',
        name: 'Prereq Test',
        description: 'Desc',
        evidence: 'Ev',
        reward: { type: 'trophy', grade: 'bronze' },
        tracking: { mode: 'binary' },
        labels: ['story'],
        expectedStage: 'story',
        confidence: 1,
        prerequisites: ['p-01'],
      };

      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      expect(arePrerequisitesMet(achWithPrereqs, setProgress)).toBe(false);

      setProgress.progress['p-01'] = {
        achievementId: 'p-01',
        completed: true,
        manualOverride: false,
        lastUpdated: MOCK_TIMESTAMP,
        provenance: 'manual',
      };
      expect(arePrerequisitesMet(achWithPrereqs, setProgress)).toBe(true);
    });
  });

  describe('getOracleFocus deterministic recommendation selector', () => {
    it('filters out blocked achievements whose prerequisites are not complete', () => {
      // In sampleSet: sd-ps-002 requires sd-ps-001.
      // Initially sd-ps-001 is incomplete, so sd-ps-002 is blocked.
      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      const focus = getOracleFocus(sampleSet, setProgress);

      expect(focus.some((a) => a.id === 'sd-ps-002')).toBe(false);

      // Now complete sd-ps-001: sd-ps-002 becomes eligible and prioritized (has missable/warning urgency)
      setProgress.progress['sd-ps-001'].completed = true;
      const focusAfterPrereq = getOracleFocus(sampleSet, setProgress);
      expect(focusAfterPrereq[0].id).toBe('sd-ps-002');
    });

    it('returns no recommendations without matching set progress and excludes records whose progress is missing', () => {
      expect(getOracleFocus(sampleSet, undefined)).toEqual([]);

      const otherSet = mockGameStellarDrift.achievementSets[1];
      const otherSetProgress = createDefaultAchievementSetProgress(
        otherSet,
        MOCK_TIMESTAMP,
      );
      expect(getOracleFocus(sampleSet, otherSetProgress)).toEqual([]);

      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      delete setProgress.progress['sd-ps-001'];
      const focus = getOracleFocus(sampleSet, setProgress);

      expect(focus.some((achievement) => achievement.id === 'sd-ps-001')).toBe(
        false,
      );
    });

    it('excludes completed achievements from recommendations', () => {
      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      setProgress.progress['sd-ps-001'].completed = true;

      const focus = getOracleFocus(sampleSet, setProgress);
      expect(focus.some((a) => a.id === 'sd-ps-001')).toBe(false);
    });

    it('prioritizes urgency over non-urgent items', () => {
      const customSet: AchievementSet = {
        id: 'test-urgency',
        platform: 'playstation',
        version: '1.0',
        achievements: [
          {
            id: 'a-story',
            name: 'Story Regular',
            description: 'Story',
            evidence: 'Mandatory',
            reward: { type: 'trophy', grade: 'bronze' },
            tracking: { mode: 'binary' },
            labels: ['story'],
            expectedStage: 'story',
            confidence: 1,
            prerequisites: [],
          },
          {
            id: 'a-urgent',
            name: 'Urgent Item',
            description: 'Missable',
            evidence: 'Optional',
            reward: { type: 'trophy', grade: 'silver' },
            tracking: { mode: 'binary' },
            labels: ['missable'],
            expectedStage: 'missables',
            confidence: 1,
            prerequisites: [],
            warning: 'Missable warning',
          },
        ],
      };

      const setProgress = createDefaultAchievementSetProgress(
        customSet,
        MOCK_TIMESTAMP,
      );
      const focus = getOracleFocus(customSet, setProgress);

      expect(focus[0].id).toBe('a-urgent');
      expect(focus[1].id).toBe('a-story');
    });

    it('prioritizes active-stage match after urgency', () => {
      const customSet: AchievementSet = {
        id: 'test-stage-match',
        platform: 'playstation',
        version: '1.0',
        achievements: [
          {
            id: 'a-cleanup',
            name: 'Cleanup Ach',
            description: 'Cleanup',
            evidence: 'Free roam',
            reward: { type: 'trophy', grade: 'bronze' },
            tracking: { mode: 'binary' },
            labels: ['grind'],
            expectedStage: 'cleanup',
            confidence: 1,
            prerequisites: [],
          },
          {
            id: 'a-story',
            name: 'Story Ach',
            description: 'Story',
            evidence: 'Mandatory',
            reward: { type: 'trophy', grade: 'bronze' },
            tracking: { mode: 'binary' },
            labels: ['story'],
            expectedStage: 'story',
            confidence: 1,
            prerequisites: [],
          },
        ],
      };

      const setProgress = createDefaultAchievementSetProgress(
        customSet,
        MOCK_TIMESTAMP,
      );
      setProgress.activeStage = 'cleanup';

      const focus = getOracleFocus(customSet, setProgress);
      expect(focus[0].id).toBe('a-cleanup');
      expect(focus[1].id).toBe('a-story');
    });

    it('prioritizes partial progress when urgency and stage match are equal', () => {
      const customSet: AchievementSet = {
        id: 'test-partial-progress',
        platform: 'playstation',
        version: '1.0',
        achievements: [
          {
            id: 'a-counter-zero',
            name: 'Counter Zero',
            description: 'Counter',
            evidence: 'Free roam',
            reward: { type: 'trophy', grade: 'bronze' },
            tracking: { mode: 'counter', unit: 'items', target: 50 },
            labels: ['grind'],
            expectedStage: 'cleanup',
            confidence: 1,
            prerequisites: [],
          },
          {
            id: 'a-counter-partial',
            name: 'Counter Partial',
            description: 'Counter',
            evidence: 'Free roam',
            reward: { type: 'trophy', grade: 'bronze' },
            tracking: { mode: 'counter', unit: 'items', target: 50 },
            labels: ['grind'],
            expectedStage: 'cleanup',
            confidence: 1,
            prerequisites: [],
          },
        ],
      };

      const setProgress = createDefaultAchievementSetProgress(
        customSet,
        MOCK_TIMESTAMP,
      );
      setProgress.progress['a-counter-partial'].counterValue = 15;

      const focus = getOracleFocus(customSet, setProgress);
      expect(focus[0].id).toBe('a-counter-partial');
      expect(focus[1].id).toBe('a-counter-zero');
    });

    it('caps results at at most 3 achievements', () => {
      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      const focus = getOracleFocus(sampleSet, setProgress);

      expect(focus.length).toBeLessThanOrEqual(3);
      expect(focus.length).toBe(3);
    });

    it('returns an empty array when all achievements are completed or blocked', () => {
      const customSet: AchievementSet = {
        id: 'test-all-complete',
        platform: 'playstation',
        version: '1.0',
        achievements: [
          {
            id: 'a-01',
            name: 'Only Ach',
            description: 'Desc',
            evidence: 'Ev',
            reward: { type: 'trophy', grade: 'bronze' },
            tracking: { mode: 'binary' },
            labels: ['story'],
            expectedStage: 'story',
            confidence: 1,
            prerequisites: [],
          },
        ],
      };

      const setProgress = createDefaultAchievementSetProgress(
        customSet,
        MOCK_TIMESTAMP,
      );
      setProgress.progress['a-01'].completed = true;

      const focus = getOracleFocus(customSet, setProgress);
      expect(focus).toEqual([]);
    });

    it('does not mutate input achievement set or progress objects', () => {
      const setProgress = createDefaultAchievementSetProgress(
        sampleSet,
        MOCK_TIMESTAMP,
      );
      const setBefore = structuredClone(sampleSet);
      const progressBefore = structuredClone(setProgress);

      const focus = getOracleFocus(sampleSet, setProgress);
      expect(focus).toBeDefined();

      expect(sampleSet).toEqual(setBefore);
      expect(setProgress).toEqual(progressBefore);
    });
  });
});
