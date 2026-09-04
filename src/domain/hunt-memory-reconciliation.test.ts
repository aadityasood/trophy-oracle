import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID,
  createDefaultGameProgressV3,
  createDefaultHuntMemoryStore,
} from './hunt-memory-lifecycle';
import { reconcileHuntMemoryGameProgress } from './hunt-memory-reconciliation';
import {
  LocalProgressStoreV3Schema,
  type LocalProgressStoreV3,
} from './hunt-memory-schema';
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

describe('hunt-memory-reconciliation', () => {
  describe('Area 1: Fatal gates and atomicity', () => {
    it('returns original store reference with conflict on invalid timestamp', () => {
      const store = createDefaultHuntMemoryStore();
      const game = createTestGame('game-1', '1.0', [
        createTestSet('set-1', '1.0', [createBinaryAchievement('ach-1')]),
      ]);

      const result = reconcileHuntMemoryGameProgress(
        store,
        game,
        game,
        'not-a-timestamp',
      );

      expect(result.store).toBe(store);
      expect(result.report.schemaConflicts).toEqual([
        'Invalid reconciliation timestamp: not-a-timestamp',
      ]);
      expect(result.report.setDeltas).toEqual([]);
      expect(result.report.retiredSetIds).toEqual([]);
      expect(result.report.restoredRetiredSetIds).toEqual([]);
      expect(result.report.retainedRetiredSetIds).toEqual([]);
    });

    it('returns original store reference with conflict on game ID mismatch', () => {
      const store = createDefaultHuntMemoryStore();
      const previousGame = createTestGame('game-1', '1.0', []);
      const nextGame = createTestGame('game-2', '1.0', []);

      const result = reconcileHuntMemoryGameProgress(
        store,
        previousGame,
        nextGame,
        TS1,
      );

      expect(result.store).toBe(store);
      expect(result.report.schemaConflicts).toEqual([
        "Mismatched game identity: previous 'game-1', next 'game-2'",
      ]);
      expect(result.report.setDeltas).toEqual([]);
    });

    it('returns original store reference with conflict on invalid source store structure', () => {
      const invalidStore = {
        schemaVersion: '3.0',
        gameProgress: {
          'game-1': {
            gameId: 'game-1',
            sets: {},
            retiredSets: {},
            preferredSetId: 'non-existent-set',
          },
        },
      } as unknown as LocalProgressStoreV3;

      const game = createTestGame('game-1', '1.0', []);

      const result = reconcileHuntMemoryGameProgress(
        invalidStore,
        game,
        game,
        TS1,
      );

      expect(result.store).toBe(invalidStore);
      expect(result.report.schemaConflicts.length).toBe(1);
      expect(result.report.schemaConflicts[0]).toContain(
        'Invalid progress store structure',
      );
      expect(result.report.setDeltas).toEqual([]);
    });
  });

  describe('Area 2: Missing game initialization', () => {
    it('initializes a missing game with complete sorted deltas and preserves unrelated state', () => {
      const existingGame = createTestGame('game-existing', '1.0', [
        createTestSet('set-existing', '1.0', [createBinaryAchievement('ach-e1')]),
      ]);
      const store = createDefaultHuntMemoryStore();
      store.gameProgress['game-existing'] = createDefaultGameProgressV3(
        existingGame,
        TS1,
      );
      store.undoState = {
        'game-existing': {
          setId: 'set-existing',
          runId: DEFAULT_HUNT_MEMORY_RUN_ID,
          guardedSetVersion: '1.0',
          previous: deepClone(
            store.gameProgress['game-existing'].sets['set-existing'].runs[
              DEFAULT_HUNT_MEMORY_RUN_ID
            ],
          ),
        },
      };

      const storeSnapshotBefore = deepClone(store);

      const targetGame = createTestGame('game-target', '2.0', [
        createTestSet('set-b', '2.0', [
          createChecklistAchievement('ach-chk', ['item-1', 'item-2']),
        ]),
        createTestSet('set-a', '2.0', [
          createBinaryAchievement('ach-bin'),
          createCounterAchievement('ach-cnt', 10),
        ]),
      ]);

      const result = reconcileHuntMemoryGameProgress(
        store,
        targetGame,
        targetGame,
        TS2,
      );

      expect(result.store).not.toBe(store);
      expect(result.store.gameProgress['game-existing']).toEqual(
        storeSnapshotBefore.gameProgress['game-existing'],
      );
      expect(result.store.undoState?.['game-existing']).toEqual(
        storeSnapshotBefore.undoState?.['game-existing'],
      );

      expect(Object.hasOwn(result.store.gameProgress, 'game-target')).toBe(true);
      const targetProgress = result.store.gameProgress['game-target'];
      expect(Object.keys(targetProgress.sets).sort()).toEqual(['set-a', 'set-b']);

      expect(result.report.setDeltas.map((d) => d.setId)).toEqual(['set-a', 'set-b']);
      const setADelta = result.report.setDeltas[0];
      expect(setADelta.runDeltas[0].addedAchievementIds).toEqual(['ach-bin', 'ach-cnt']);

      const setBDelta = result.report.setDeltas[1];
      expect(setBDelta.runDeltas[0].addedChecklistItems).toEqual([
        { achievementId: 'ach-chk', itemIds: ['item-1', 'item-2'] },
      ]);
      expect(result.report.schemaConflicts).toEqual([]);
      expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    });
  });

  describe('Area 3: Matching achievement preservation', () => {
    it('preserves binary, counter variants, checklist, notes, provenance, and timestamps', () => {
      const achievements = [
        createBinaryAchievement('ach-bin'),
        createCounterAchievement('ach-cnt-exact', 10),
        createCounterAchievement('ach-cnt-atleast', 10),
        createCounterAchievement('ach-cnt-est', 10),
        createCounterAchievement('ach-cnt-unk'),
        createChecklistAchievement('ach-chk', ['i1', 'i2']),
      ];
      const previousSet = createTestSet('set-1', '1.0', achievements);
      const nextSet = createTestSet('set-1', '1.1', achievements);
      const previousGame = createTestGame('game-1', '1.0', [previousSet]);
      const nextGame = createTestGame('game-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const defaultGameProgress = createDefaultGameProgressV3(previousGame, TS1);
      const run =
        defaultGameProgress.sets['set-1'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

      run.progress['ach-bin'] = {
        achievementId: 'ach-bin',
        completed: true,
        manualOverride: false,
        notes: 'Binary note',
        lastUpdated: TS1,
        provenance: 'platform',
      };
      run.progress['ach-cnt-exact'] = {
        achievementId: 'ach-cnt-exact',
        completed: true,
        manualOverride: true,
        counter: { certainty: 'exact', value: 5 },
        notes: 'Exact counter note',
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.progress['ach-cnt-atleast'] = {
        achievementId: 'ach-cnt-atleast',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'at_least', minimum: 4 },
        notes: 'At least note',
        lastUpdated: TS1,
        provenance: 'imported',
      };
      run.progress['ach-cnt-est'] = {
        achievementId: 'ach-cnt-est',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'estimated', estimate: 8 },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.progress['ach-cnt-unk'] = {
        achievementId: 'ach-cnt-unk',
        completed: false,
        manualOverride: false,
        counter: {
          certainty: 'unknown',
          observedSinceStart: 1,
          trackingStartedAt: TS1,
        },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.progress['ach-chk'] = {
        achievementId: 'ach-chk',
        completed: true,
        manualOverride: true,
        checklistCompletion: { i1: true, i2: false },
        notes: 'Checklist note',
        lastUpdated: TS1,
        provenance: 'manual',
      };

      store.gameProgress['game-1'] = defaultGameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        previousGame,
        nextGame,
        TS2,
      );

      const updatedRun =
        result.store.gameProgress['game-1'].sets['set-1'].runs[
          DEFAULT_HUNT_MEMORY_RUN_ID
        ];

      expect(updatedRun.progress['ach-bin'].notes).toBe('Binary note');
      expect(updatedRun.progress['ach-bin'].provenance).toBe('platform');
      expect(updatedRun.progress['ach-bin'].lastUpdated).toBe(TS1);
      expect(updatedRun.progress['ach-bin'].manualOverride).toBe(false);

      expect(updatedRun.progress['ach-cnt-exact'].counter).toEqual({
        certainty: 'exact',
        value: 5,
      });
      expect(updatedRun.progress['ach-cnt-exact'].manualOverride).toBe(true);
      expect(updatedRun.progress['ach-cnt-exact'].completed).toBe(true);
      expect(updatedRun.progress['ach-cnt-exact'].lastUpdated).toBe(TS1);

      expect(updatedRun.progress['ach-cnt-atleast'].counter).toEqual({
        certainty: 'at_least',
        minimum: 4,
      });
      expect(updatedRun.progress['ach-cnt-est'].counter).toEqual({
        certainty: 'estimated',
        estimate: 8,
      });
      expect(updatedRun.progress['ach-cnt-unk'].counter).toEqual({
        certainty: 'unknown',
        observedSinceStart: 1,
        trackingStartedAt: TS1,
      });

      expect(updatedRun.progress['ach-chk'].checklistCompletion).toEqual({
        i1: true,
        i2: false,
      });
      expect(updatedRun.progress['ach-chk'].manualOverride).toBe(true);
      expect(updatedRun.progress['ach-chk'].completed).toBe(true);
      expect(updatedRun.progress['ach-chk'].lastUpdated).toBe(TS1);

      expect(result.report.schemaConflicts).toEqual([]);
      expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    });
  });

  describe('Area 4: Derived completion recomputation', () => {
    it('recomputes derived completion for counters and checklists without false precision', () => {
      const prevSet = createTestSet('set-1', '1.0', [
        createCounterAchievement('cnt-bounded', 10),
        createCounterAchievement('cnt-open'),
        createCounterAchievement('cnt-atleast', 10),
        createCounterAchievement('cnt-estimated', 10),
        createChecklistAchievement('chk-auto', ['a', 'b']),
      ]);
      const nextSet = createTestSet('set-1', '1.1', [
        createCounterAchievement('cnt-bounded', 15),
        createCounterAchievement('cnt-open'),
        createCounterAchievement('cnt-atleast', 15),
        createCounterAchievement('cnt-estimated', 10),
        createChecklistAchievement('chk-auto', ['a', 'b', 'c']),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      const run = gameProgress.sets['set-1'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

      run.progress['cnt-bounded'] = {
        achievementId: 'cnt-bounded',
        completed: true,
        manualOverride: false,
        counter: { certainty: 'exact', value: 10 },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.progress['cnt-open'] = {
        achievementId: 'cnt-open',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 50 },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.progress['cnt-atleast'] = {
        achievementId: 'cnt-atleast',
        completed: true,
        manualOverride: false,
        counter: { certainty: 'at_least', minimum: 10 },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.progress['cnt-estimated'] = {
        achievementId: 'cnt-estimated',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'estimated', estimate: 20 },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      run.progress['chk-auto'] = {
        achievementId: 'chk-auto',
        completed: true,
        manualOverride: false,
        checklistCompletion: { a: true, b: true },
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

      expect(updatedRun.progress['cnt-bounded'].completed).toBe(false);
      expect(updatedRun.progress['cnt-open'].completed).toBe(false);
      expect(updatedRun.progress['cnt-atleast'].completed).toBe(false);
      expect(updatedRun.progress['cnt-estimated'].completed).toBe(false);
      expect(updatedRun.progress['chk-auto'].completed).toBe(false);
      expect(updatedRun.progress['chk-auto'].checklistCompletion).toEqual({
        a: true,
        b: true,
        c: false,
      });
    });
  });
});
