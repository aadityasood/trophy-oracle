import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID,
  createDefaultGameProgressV3,
  createDefaultHuntMemoryStore,
} from './hunt-memory-lifecycle';
import { reconcileHuntMemoryGameProgress } from './hunt-memory-reconciliation';
import type { OrphanedAchievementProgressV3 } from './hunt-memory-schema';
import {
  TS1,
  TS2,
  createBinaryAchievement,
  createChecklistAchievement,
  createCounterAchievement,
  createTestGame,
  createTestSet,
  deepClone,
} from './hunt-memory-reconciliation-test-fixtures';

describe('hunt-memory-reconciliation runs', () => {
  describe('Area 5: New achievements with and without compatible orphan history', () => {
    it('initializes additions without orphan and restores additions with compatible orphan', () => {
      const prevSet = createTestSet('set-1', '1.0', []);
      const nextSet = createTestSet('set-1', '1.1', [
        createBinaryAchievement('ach-brand-new'),
        createCounterAchievement('ach-returning', 5),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      const run = gameProgress.sets['set-1'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

      run.orphanedProgress = {
        'ach-returning': [
          {
            achievementId: 'ach-returning',
            completed: true,
            manualOverride: false,
            counter: { certainty: 'exact', value: 5 },
            lastUpdated: TS1,
            provenance: 'manual',
            trackingModeAtRemoval: 'counter',
          },
        ],
      };
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );
      const runDelta = result.report.setDeltas[0].runDeltas[0];

      expect(runDelta.addedAchievementIds).toEqual(['ach-brand-new']);
      expect(runDelta.restoredOrphanedAchievementIds).toEqual(['ach-returning']);

      const updatedRun =
        result.store.gameProgress['g-1'].sets['set-1'].runs[
          DEFAULT_HUNT_MEMORY_RUN_ID
        ];
      expect(updatedRun.progress['ach-returning'].counter).toEqual({
        certainty: 'exact',
        value: 5,
      });
      expect(Object.hasOwn(updatedRun.orphanedProgress, 'ach-returning')).toBe(
        false,
      );
    });
  });

  describe('Area 6: Newest-compatible orphan restoration', () => {
    it('restores newest compatible orphan while retaining older and incompatible history', () => {
      const prevSet = createTestSet('set-1', '1.0', []);
      const nextSet = createTestSet('set-1', '1.1', [
        createCounterAchievement('ach-multi-orphan', 10),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      const run = gameProgress.sets['set-1'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

      const orphanOlderCounter: OrphanedAchievementProgressV3 = {
        achievementId: 'ach-multi-orphan',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 3 },
        lastUpdated: TS1,
        provenance: 'manual',
        trackingModeAtRemoval: 'counter',
      };
      const orphanIncompatibleBinary: OrphanedAchievementProgressV3 = {
        achievementId: 'ach-multi-orphan',
        completed: true,
        manualOverride: false,
        lastUpdated: TS1,
        provenance: 'manual',
        trackingModeAtRemoval: 'binary',
      };
      const orphanNewerCounter: OrphanedAchievementProgressV3 = {
        achievementId: 'ach-multi-orphan',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 8 },
        lastUpdated: TS1,
        provenance: 'manual',
        trackingModeAtRemoval: 'counter',
      };

      run.orphanedProgress['ach-multi-orphan'] = [
        orphanOlderCounter,
        orphanIncompatibleBinary,
        orphanNewerCounter,
      ];
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );
      const updatedRun =
        result.store.gameProgress['g-1'].sets['set-1'].runs[
          DEFAULT_HUNT_MEMORY_RUN_ID
        ];

      expect(updatedRun.progress['ach-multi-orphan'].counter).toEqual({
        certainty: 'exact',
        value: 8,
      });
      expect(updatedRun.orphanedProgress['ach-multi-orphan']).toEqual([
        orphanOlderCounter,
        orphanIncompatibleBinary,
      ]);
    });
  });

  describe('Area 7: Removal append semantics', () => {
    it('appends removed achievement to pre-existing orphan history without overwrite', () => {
      const prevSet = createTestSet('set-1', '1.0', [
        createBinaryAchievement('ach-remove'),
      ]);
      const nextSet = createTestSet('set-1', '1.1', []);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      const run = gameProgress.sets['set-1'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

      const historicalOrphan: OrphanedAchievementProgressV3 = {
        achievementId: 'ach-remove',
        completed: true,
        manualOverride: false,
        notes: 'First removal',
        lastUpdated: TS1,
        provenance: 'manual',
        trackingModeAtRemoval: 'binary',
      };
      run.orphanedProgress['ach-remove'] = [historicalOrphan];
      run.progress['ach-remove'] = {
        achievementId: 'ach-remove',
        completed: false,
        manualOverride: false,
        notes: 'Second removal',
        lastUpdated: TS1,
        provenance: 'manual',
      };
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );
      const updatedRun =
        result.store.gameProgress['g-1'].sets['set-1'].runs[
          DEFAULT_HUNT_MEMORY_RUN_ID
        ];

      expect(updatedRun.orphanedProgress['ach-remove'].length).toBe(2);
      expect(updatedRun.orphanedProgress['ach-remove'][0]).toEqual(historicalOrphan);
      expect(updatedRun.orphanedProgress['ach-remove'][1].notes).toBe('Second removal');
      expect(Object.hasOwn(updatedRun.progress, 'ach-remove')).toBe(false);
    });
  });

  describe('Area 8: Tracking-mode changes and pin repair', () => {
    it('quarantines old progress, replaces with default, reports conflict, and removes pins', () => {
      const prevSet = createTestSet('set-1', '1.0', [
        createCounterAchievement('ach-mode-change', 10),
      ]);
      const nextSet = createTestSet('set-1', '1.1', [
        createChecklistAchievement('ach-mode-change', ['t1', 't2']),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      const run = gameProgress.sets['set-1'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

      run.progress['ach-mode-change'] = {
        achievementId: 'ach-mode-change',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 4 },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.pinnedAchievementIds = ['ach-mode-change'];
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );
      const updatedRun =
        result.store.gameProgress['g-1'].sets['set-1'].runs[
          DEFAULT_HUNT_MEMORY_RUN_ID
        ];

      expect(updatedRun.orphanedProgress['ach-mode-change'].length).toBe(1);
      expect(
        updatedRun.orphanedProgress['ach-mode-change'][0].trackingModeAtRemoval,
      ).toBe('counter');
      expect(updatedRun.progress['ach-mode-change'].checklistCompletion).toEqual({
        t1: false,
        t2: false,
      });
      expect(updatedRun.pinnedAchievementIds).toEqual([]);

      const runDelta = result.report.setDeltas[0].runDeltas[0];
      expect(runDelta.quarantinedAchievementIds).toEqual(['ach-mode-change']);
      expect(runDelta.removedPinnedAchievementIds).toEqual(['ach-mode-change']);
      expect(result.report.schemaConflicts[0]).toContain(
        "Incompatible tracking mode change for 'ach-mode-change' in set 'set-1', run 'default-run': was 'counter', now 'checklist'",
      );
    });
  });

  describe('Area 9: Checklist add/remove grouped deltas', () => {
    it('preserves matching items, reports exact grouped deltas, and leaves orphan checklists untouched', () => {
      const prevSet = createTestSet('set-1', '1.0', [
        createChecklistAchievement('ach-chk', ['i1', 'i2', 'i3']),
      ]);
      const nextSet = createTestSet('set-1', '1.1', [
        createChecklistAchievement('ach-chk', ['i2', 'i3', 'i4']),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      const run = gameProgress.sets['set-1'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

      run.progress['ach-chk'] = {
        achievementId: 'ach-chk',
        completed: false,
        manualOverride: false,
        checklistCompletion: { i1: true, i2: true, i3: false },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.orphanedProgress['ach-orphan-chk'] = [
        {
          achievementId: 'ach-orphan-chk',
          completed: false,
          manualOverride: false,
          checklistCompletion: { oldA: true, oldB: false },
          lastUpdated: TS1,
          provenance: 'manual',
          trackingModeAtRemoval: 'checklist',
        },
      ];
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );
      const runDelta = result.report.setDeltas[0].runDeltas[0];

      expect(runDelta.addedChecklistItems).toEqual([
        { achievementId: 'ach-chk', itemIds: ['i4'] },
      ]);
      expect(runDelta.removedChecklistItems).toEqual([
        { achievementId: 'ach-chk', itemIds: ['i1'] },
      ]);

      const updatedRun =
        result.store.gameProgress['g-1'].sets['set-1'].runs[
          DEFAULT_HUNT_MEMORY_RUN_ID
        ];
      expect(updatedRun.progress['ach-chk'].checklistCompletion).toEqual({
        i2: true,
        i3: false,
        i4: false,
      });
      expect(updatedRun.orphanedProgress['ach-orphan-chk'][0].checklistCompletion).toEqual({
        oldA: true,
        oldB: false,
      });
    });
  });

  describe('Area 10: Multiple runs reconciled independently', () => {
    it('reconciles each run independently and emits empty deltas for unchanged runs', () => {
      const prevSet = createTestSet('set-1', '1.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const nextSet = createTestSet('set-1', '1.1', [
        createBinaryAchievement('ach-1'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      const setProgress = gameProgress.sets['set-1'];

      setProgress.runs['run-2'] = deepClone(setProgress.runs[DEFAULT_HUNT_MEMORY_RUN_ID]);
      setProgress.runs['run-2'].runId = 'run-2';
      delete setProgress.runs[DEFAULT_HUNT_MEMORY_RUN_ID].progress['ach-1'];
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );
      const runDeltas = result.report.setDeltas[0].runDeltas;

      expect(runDeltas.length).toBe(2);
      expect(runDeltas[0].runId).toBe(DEFAULT_HUNT_MEMORY_RUN_ID);
      expect(runDeltas[0].addedAchievementIds).toEqual(['ach-1']);
      expect(runDeltas[1]).toEqual({
        runId: 'run-2',
        addedAchievementIds: [],
        quarantinedAchievementIds: [],
        restoredOrphanedAchievementIds: [],
        addedChecklistItems: [],
        removedChecklistItems: [],
        removedPinnedAchievementIds: [],
      });
    });
  });
});
