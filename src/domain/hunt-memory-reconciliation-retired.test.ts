import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID,
  createDefaultGameProgressV3,
  createDefaultHuntMemoryStore,
} from './hunt-memory-lifecycle';
import { reconcileHuntMemoryGameProgress } from './hunt-memory-reconciliation';
import {
  LocalProgressStoreV3Schema,
  type RunProgress,
} from './hunt-memory-schema';
import {
  TS1,
  TS2,
  createBinaryAchievement,
  createChecklistAchievement,
  createTestGame,
  createTestSet,
  deepClone,
} from './hunt-memory-reconciliation-test-fixtures';

describe('hunt-memory-reconciliation retired and safety', () => {
  describe('Area 11: Stored-version mismatch and missing previous definition', () => {
    it('leaves active set unchanged on version mismatch and reports conflict', () => {
      const prevSet = createTestSet('set-1', '1.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const nextSet = createTestSet('set-1', '1.1', [
        createBinaryAchievement('ach-1'),
        createBinaryAchievement('ach-2'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      gameProgress.sets['set-1'].version = 'stored-wrong-version';
      store.gameProgress['g-1'] = gameProgress;

      const setSnapshotBefore = deepClone(gameProgress.sets['set-1']);

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(result.store.gameProgress['g-1'].sets['set-1']).toEqual(
        setSnapshotBefore,
      );
      expect(result.report.setDeltas[0].runDeltas).toEqual([]);
      expect(result.report.schemaConflicts).toEqual([
        "Set 'set-1' version mismatch: stored 'stored-wrong-version', expected '1.0'",
      ]);
    });

    it('leaves active set unchanged when it has no previous definition', () => {
      const nextSet = createTestSet('set-1', '1.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', []);
      const nextGame = createTestGame('g-1', '1.0', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(nextGame, TS1);
      store.gameProgress['g-1'] = gameProgress;
      const setSnapshotBefore = deepClone(gameProgress.sets['set-1']);

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(result.store.gameProgress['g-1'].sets['set-1']).toEqual(
        setSnapshotBefore,
      );
      expect(result.report.schemaConflicts).toEqual([
        "Active set 'set-1' has no previous definition; state was left unchanged",
      ]);
    });
  });

  describe('Area 12: Removed-set retirement', () => {
    it('retires removed set intact, clears matching preference and undo', () => {
      const prevSet = createTestSet('set-retire', '1.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.0', []);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      gameProgress.preferredSetId = 'set-retire';
      store.gameProgress['g-1'] = gameProgress;
      store.undoState = {
        'g-1': {
          setId: 'set-retire',
          runId: DEFAULT_HUNT_MEMORY_RUN_ID,
          guardedSetVersion: '1.0',
          previous: deepClone(
            gameProgress.sets['set-retire'].runs[DEFAULT_HUNT_MEMORY_RUN_ID],
          ),
        },
      };

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(Object.hasOwn(result.store.gameProgress['g-1'].sets, 'set-retire')).toBe(
        false,
      );
      expect(
        Object.hasOwn(result.store.gameProgress['g-1'].retiredSets, 'set-retire'),
      ).toBe(true);
      const retired = result.store.gameProgress['g-1'].retiredSets['set-retire'];
      expect(retired.retirementReason).toBe('removed_set');
      if (retired.retirementReason === 'removed_set') {
        expect(retired.version).toBe('1.0');
      }
      expect(result.store.gameProgress['g-1'].preferredSetId).toBeUndefined();
      expect(result.store.undoState).toBeUndefined();

      expect(result.report.retiredSetIds).toEqual(['set-retire']);
      expect(result.report.clearedPreferredSetId).toBe('set-retire');
      expect(result.report.clearedUndoTarget).toEqual({
        setId: 'set-retire',
        runId: DEFAULT_HUNT_MEMORY_RUN_ID,
      });
      expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    });
  });

  describe('Area 13: Same-version removed_set restoration and retention', () => {
    it('restores same-version removed_set when all active records are compatible', () => {
      const returningSet = createTestSet('set-ret', '1.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', []);
      const nextGame = createTestGame('g-1', '1.0', [returningSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(nextGame, TS1);
      const setLedger = gameProgress.sets['set-ret'];
      delete gameProgress.sets['set-ret'];
      gameProgress.retiredSets['set-ret'] = {
        ...setLedger,
        retirementReason: 'removed_set',
        version: '1.0',
      };
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(Object.hasOwn(result.store.gameProgress['g-1'].sets, 'set-ret')).toBe(
        true,
      );
      expect(
        Object.hasOwn(result.store.gameProgress['g-1'].retiredSets, 'set-ret'),
      ).toBe(false);
      expect(result.report.restoredRetiredSetIds).toEqual(['set-ret']);
      expect(result.report.retainedRetiredSetIds).toEqual([]);
    });

    it('retains removed_set when version mismatches returning definition', () => {
      const returningSet = createTestSet('set-ret', '2.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', []);
      const nextGame = createTestGame('g-1', '2.0', [returningSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(nextGame, TS1);
      const setLedger = gameProgress.sets['set-ret'];
      delete gameProgress.sets['set-ret'];
      gameProgress.retiredSets['set-ret'] = {
        ...setLedger,
        retirementReason: 'removed_set',
        version: '1.0',
      };
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(
        Object.hasOwn(result.store.gameProgress['g-1'].retiredSets, 'set-ret'),
      ).toBe(true);
      expect(result.report.retainedRetiredSetIds).toEqual(['set-ret']);
      expect(result.report.schemaConflicts).toEqual([
        "Retired set 'set-ret' version mismatch: stored '1.0', expected '2.0'",
      ]);
    });

    it('retains same-version removed_set when active tracker shape is incompatible', () => {
      const returningSet = createTestSet('set-ret', '1.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', []);
      const nextGame = createTestGame('g-1', '1.0', [returningSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(nextGame, TS1);
      const setLedger = gameProgress.sets['set-ret'];
      setLedger.runs[DEFAULT_HUNT_MEMORY_RUN_ID].progress['ach-1'] = {
        achievementId: 'ach-1',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 4 },
        lastUpdated: TS1,
        provenance: 'manual',
      };
      delete gameProgress.sets['set-ret'];
      gameProgress.retiredSets['set-ret'] = {
        ...setLedger,
        retirementReason: 'removed_set',
        version: '1.0',
      };
      store.gameProgress['g-1'] = gameProgress;
      const retiredSnapshot = deepClone(gameProgress.retiredSets['set-ret']);

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(Object.hasOwn(result.store.gameProgress['g-1'].sets, 'set-ret')).toBe(
        false,
      );
      expect(result.store.gameProgress['g-1'].retiredSets['set-ret']).toEqual(
        retiredSnapshot,
      );
      expect(result.report.restoredRetiredSetIds).toEqual([]);
      expect(result.report.retainedRetiredSetIds).toEqual(['set-ret']);
      expect(result.report.schemaConflicts).toEqual([
        "Retired set 'set-ret' has incompatible progress for returning definition",
      ]);
      expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    });
  });

  describe('Area 14: schema_2_absent_orphans restoration', () => {
    it('restores schema_2_absent_orphans set with compatible and incompatible histories', () => {
      const returningSet = createTestSet('set-v2', '3.0', [
        createBinaryAchievement('ach-compat'),
        createChecklistAchievement('ach-incompat', ['x1', 'x2']),
      ]);
      const prevGame = createTestGame('g-1', '1.0', []);
      const nextGame = createTestGame('g-1', '3.0', [returningSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(nextGame, TS1);
      delete gameProgress.sets['set-v2'];

      const legacyRun: RunProgress = {
        runId: 'legacy-v2',
        name: 'Legacy V2 Run',
        createdAt: TS1,
        pinnedAchievementIds: [],
        progress: {},
        orphanedProgress: {
          'ach-compat': [
            {
              achievementId: 'ach-compat',
              completed: true,
              manualOverride: false,
              lastUpdated: TS1,
              provenance: 'manual',
              trackingModeAtRemoval: 'binary',
            },
          ],
          'ach-incompat': [
            {
              achievementId: 'ach-incompat',
              completed: false,
              manualOverride: false,
              counter: { certainty: 'exact', value: 3 },
              lastUpdated: TS1,
              provenance: 'manual',
              trackingModeAtRemoval: 'counter',
            },
          ],
        },
      };

      gameProgress.retiredSets['set-v2'] = {
        setId: 'set-v2',
        retirementReason: 'schema_2_absent_orphans',
        activeRunId: 'legacy-v2',
        runs: { 'legacy-v2': legacyRun },
      };
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(Object.hasOwn(result.store.gameProgress['g-1'].sets, 'set-v2')).toBe(
        true,
      );
      const restoredSet = result.store.gameProgress['g-1'].sets['set-v2'];
      expect(restoredSet.version).toBe('3.0');
      expect(restoredSet.activeRunId).toBe('legacy-v2');

      const restoredRun = restoredSet.runs['legacy-v2'];
      expect(restoredRun.progress['ach-compat'].completed).toBe(true);
      expect(restoredRun.progress['ach-incompat'].checklistCompletion).toEqual({
        x1: false,
        x2: false,
      });
      expect(restoredRun.orphanedProgress['ach-incompat'].length).toBe(1);

      expect(result.report.restoredRetiredSetIds).toEqual(['set-v2']);
      expect(result.report.schemaConflicts[0]).toContain(
        "Incompatible orphan tracking mode in set 'set-v2', run 'legacy-v2' for 'ach-incompat': removed as 'counter', reappeared as 'checklist'",
      );
    });
  });

  describe('Area 15: Absent retired sets retention', () => {
    it('reports pre-existing retired sets still absent as retained without mutation', () => {
      const prevGame = createTestGame('g-1', '1.0', []);
      const nextGame = createTestGame('g-1', '1.0', []);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      gameProgress.retiredSets['set-still-absent'] = {
        setId: 'set-still-absent',
        retirementReason: 'removed_set',
        version: '1.0',
        activeRunId: DEFAULT_HUNT_MEMORY_RUN_ID,
        runs: {
          [DEFAULT_HUNT_MEMORY_RUN_ID]: {
            runId: DEFAULT_HUNT_MEMORY_RUN_ID,
            name: 'Main Run',
            createdAt: TS1,
            pinnedAchievementIds: [],
            progress: {},
            orphanedProgress: {},
          },
        },
      };
      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(result.report.retainedRetiredSetIds).toEqual(['set-still-absent']);
      expect(result.report.retiredSetIds).toEqual([]);
      expect(result.report.restoredRetiredSetIds).toEqual([]);
      expect(
        Object.hasOwn(
          result.store.gameProgress['g-1'].retiredSets,
          'set-still-absent',
        ),
      ).toBe(true);
    });
  });

  describe('Area 16: Undo snapshot preservation and clearing', () => {
    it('preserves undo when safe, clears for version mismatch or target-run mutation, and isolates games', () => {
      const setDefinition = createTestSet('set-1', '1.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [setDefinition]);
      const nextGame = createTestGame('g-1', '1.0', [setDefinition]);

      const otherGame = createTestGame('g-2', '1.0', [
        createTestSet('set-2', '1.0', [createBinaryAchievement('ach-o1')]),
      ]);

      const store = createDefaultHuntMemoryStore();
      store.gameProgress['g-1'] = createDefaultGameProgressV3(prevGame, TS1);
      store.gameProgress['g-2'] = createDefaultGameProgressV3(otherGame, TS1);

      const undoSnapshotG1 = {
        setId: 'set-1',
        runId: DEFAULT_HUNT_MEMORY_RUN_ID,
        guardedSetVersion: '1.0',
        previous: deepClone(
          store.gameProgress['g-1'].sets['set-1'].runs[DEFAULT_HUNT_MEMORY_RUN_ID],
        ),
      };
      const undoSnapshotG2 = {
        setId: 'set-2',
        runId: DEFAULT_HUNT_MEMORY_RUN_ID,
        guardedSetVersion: '1.0',
        previous: deepClone(
          store.gameProgress['g-2'].sets['set-2'].runs[DEFAULT_HUNT_MEMORY_RUN_ID],
        ),
      };

      store.undoState = {
        'g-1': undoSnapshotG1,
        'g-2': undoSnapshotG2,
      };

      const safeResult = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );
      expect(safeResult.store.undoState?.['g-1']).toEqual(undoSnapshotG1);
      expect(safeResult.store.undoState?.['g-2']).toEqual(undoSnapshotG2);
      expect(safeResult.report.clearedUndoTarget).toBeUndefined();

      const nextGameVersionMismatch = createTestGame('g-1', '2.0', [
        createTestSet('set-1', '2.0', [createBinaryAchievement('ach-1')]),
      ]);
      const mismatchResult = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGameVersionMismatch,
        TS2,
      );
      expect(mismatchResult.store.undoState?.['g-1']).toBeUndefined();
      expect(mismatchResult.store.undoState?.['g-2']).toEqual(undoSnapshotG2);
      expect(mismatchResult.report.clearedUndoTarget).toEqual({
        setId: 'set-1',
        runId: DEFAULT_HUNT_MEMORY_RUN_ID,
      });

      const nextGameMutated = createTestGame('g-1', '1.0', [
        createTestSet('set-1', '1.0', [
          createBinaryAchievement('ach-1'),
          createBinaryAchievement('ach-added'),
        ]),
      ]);
      const mutatedResult = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGameMutated,
        TS2,
      );
      expect(mutatedResult.store.undoState?.['g-1']).toBeUndefined();
      expect(mutatedResult.store.undoState?.['g-2']).toEqual(undoSnapshotG2);
      expect(mutatedResult.report.clearedUndoTarget).toEqual({
        setId: 'set-1',
        runId: DEFAULT_HUNT_MEMORY_RUN_ID,
      });
    });
  });

  describe('Area 17: Deterministic sorting', () => {
    it('sorts sets, runs, achievements, checklist items, and conflicts deterministically', () => {
      const prevSetZ = createTestSet('set-z', '1.0', [
        createBinaryAchievement('ach-z2'),
        createBinaryAchievement('ach-z1'),
      ]);
      const prevSetA = createTestSet('set-a', '1.0', [
        createBinaryAchievement('ach-a1'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSetZ, prevSetA]);

      const nextSetZ = createTestSet('set-z', '1.1', [
        createBinaryAchievement('ach-z1'),
      ]);
      const nextSetA = createTestSet('set-a', '1.1', [
        createBinaryAchievement('ach-a1'),
        createChecklistAchievement('ach-chk-z', ['item-b', 'item-a']),
        createChecklistAchievement('ach-chk-a', ['item-2', 'item-1']),
      ]);
      const nextGame = createTestGame('g-1', '1.1', [nextSetA, nextSetZ]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);

      gameProgress.sets['set-z'].runs['run-b'] = deepClone(
        gameProgress.sets['set-z'].runs[DEFAULT_HUNT_MEMORY_RUN_ID],
      );
      gameProgress.sets['set-z'].runs['run-b'].runId = 'run-b';
      gameProgress.sets['set-z'].runs['run-a'] = deepClone(
        gameProgress.sets['set-z'].runs[DEFAULT_HUNT_MEMORY_RUN_ID],
      );
      gameProgress.sets['set-z'].runs['run-a'].runId = 'run-a';

      store.gameProgress['g-1'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(result.report.setDeltas.map((d) => d.setId)).toEqual(['set-a', 'set-z']);

      const setADelta = result.report.setDeltas[0];
      expect(
        setADelta.runDeltas[0].addedChecklistItems.map((c) => c.achievementId),
      ).toEqual(['ach-chk-a', 'ach-chk-z']);
      expect(setADelta.runDeltas[0].addedChecklistItems[0].itemIds).toEqual([
        'item-1',
        'item-2',
      ]);
      expect(setADelta.runDeltas[0].addedChecklistItems[1].itemIds).toEqual([
        'item-a',
        'item-b',
      ]);

      const setZDelta = result.report.setDeltas[1];
      expect(setZDelta.runDeltas.map((r) => r.runId)).toEqual([
        DEFAULT_HUNT_MEMORY_RUN_ID,
        'run-a',
        'run-b',
      ]);
      expect(setZDelta.runDeltas[0].quarantinedAchievementIds).toEqual(['ach-z2']);
    });
  });

  describe('Area 18: Prototype-sensitive own IDs', () => {
    it('handles constructor and toString as own IDs without prototype pollution', () => {
      const prevSet = createTestSet('toString', '1.0', [
        createBinaryAchievement('constructor'),
      ]);
      const nextSet = createTestSet('toString', '1.1', [
        createBinaryAchievement('constructor'),
        createChecklistAchievement('toString', ['constructor', 'toString']),
      ]);
      const prevGame = createTestGame('constructor', '1.0', [prevSet]);
      const nextGame = createTestGame('constructor', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
      store.gameProgress['constructor'] = gameProgress;

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(Object.hasOwn(result.store.gameProgress, 'constructor')).toBe(true);
      const setProgress = result.store.gameProgress['constructor'].sets['toString'];
      expect(setProgress).toBeDefined();

      const run = setProgress.runs[DEFAULT_HUNT_MEMORY_RUN_ID];
      expect(Object.hasOwn(run.progress, 'constructor')).toBe(true);
      expect(Object.hasOwn(run.progress, 'toString')).toBe(true);
      expect(run.progress['toString'].checklistCompletion).toEqual({
        constructor: false,
        toString: false,
      });

      expect(Object.hasOwn(Object.prototype, 'constructor')).toBe(true);
      expect(typeof Object.prototype.toString).toBe('function');
      expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    });
  });

  describe('Area 19: Deep input immutability and valid store output', () => {
    it('leaves inputs untouched, retains no aliases, and validates complete target store', () => {
      const prevSet = createTestSet('set-1', '1.0', [
        createBinaryAchievement('ach-1'),
      ]);
      const nextSet = createTestSet('set-1', '1.1', [
        createBinaryAchievement('ach-1'),
        createBinaryAchievement('ach-2'),
      ]);
      const prevGame = createTestGame('g-1', '1.0', [prevSet]);
      const nextGame = createTestGame('g-1', '1.1', [nextSet]);

      const store = createDefaultHuntMemoryStore();
      store.gameProgress['g-1'] = createDefaultGameProgressV3(prevGame, TS1);

      const storeSnapshot = deepClone(store);
      const prevGameSnapshot = deepClone(prevGame);
      const nextGameSnapshot = deepClone(nextGame);

      const result = reconcileHuntMemoryGameProgress(
        store,
        prevGame,
        nextGame,
        TS2,
      );

      expect(store).toEqual(storeSnapshot);
      expect(prevGame).toEqual(prevGameSnapshot);
      expect(nextGame).toEqual(nextGameSnapshot);

      result.store.gameProgress['g-1'].sets['set-1'].version = 'mutated-externally';
      expect(store.gameProgress['g-1'].sets['set-1'].version).toBe('1.0');

      expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    });
  });

  describe('Area 20: Scope boundaries', () => {
    it('produces valid Schema 3.0 store output and leaves source store unchanged', () => {
      const game = createTestGame('g-1', '1.0', []);
      const store = createDefaultHuntMemoryStore();
      const storeSnapshot = deepClone(store);

      const result = reconcileHuntMemoryGameProgress(store, game, game, TS1);

      expect(store).toEqual(storeSnapshot);
      expect(result.store.schemaVersion).toBe('3.0');
      expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    });
  });
});
