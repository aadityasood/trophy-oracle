import { describe, expect, it } from 'vitest';
import type { AchievementRecord } from './achievement-schema';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID,
  createDefaultGameProgressV3,
  createDefaultHuntMemoryStore,
} from './hunt-memory-lifecycle';
import { reconcileHuntMemoryGameProgress } from './hunt-memory-reconciliation';
import {
  LocalProgressStoreV3Schema,
  type AchievementProgressV3,
  type LocalProgressStoreV3,
  type OrphanedAchievementProgressV3,
  type RunProgress,
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

function setupTestGame(
  prevAchievements: AchievementRecord[],
  nextAchievements: AchievementRecord[],
  setId = 'set-1',
  gameId = 'g-1',
) {
  const prevGame = createTestGame(gameId, '1.0', [createTestSet(setId, '1.0', prevAchievements)]);
  const nextGame = createTestGame(gameId, '1.0', [createTestSet(setId, '1.0', nextAchievements)]);
  const store = createDefaultHuntMemoryStore();
  const gameProgress = createDefaultGameProgressV3(prevGame, TS1);
  store.gameProgress[gameId] = gameProgress;
  const run = gameProgress.sets[setId].runs[DEFAULT_HUNT_MEMORY_RUN_ID];
  return { prevGame, nextGame, store, gameProgress, run };
}

function createActiveProgress(
  achievementId: string,
  overrides?: Partial<AchievementProgressV3>,
): AchievementProgressV3 {
  return {
    achievementId,
    completed: false,
    manualOverride: false,
    lastUpdated: TS1,
    provenance: 'manual',
    ...overrides,
  };
}

function getRunProgress(
  store: LocalProgressStoreV3,
  runId = DEFAULT_HUNT_MEMORY_RUN_ID,
  setId = 'set-1',
  gameId = 'g-1',
): RunProgress {
  return store.gameProgress[gameId].sets[setId].runs[runId];
}

function setRunUndoSnapshot(
  store: LocalProgressStoreV3,
  run: RunProgress,
  runId = DEFAULT_HUNT_MEMORY_RUN_ID,
  setId = 'set-1',
  gameId = 'g-1',
): void {
  store.undoState = {
    [gameId]: {
      setId,
      runId,
      guardedSetVersion: '1.0',
      previous: deepClone(run),
    },
  };
}

describe('hunt-memory-reconciliation active repair', () => {
  it('repairs counter progress missing counter, preserves orphan as binary, and clears matching undo', () => {
    const ach = createCounterAchievement('ach-counter-missing', 10);
    const { prevGame, nextGame, store, run } = setupTestGame([ach], [ach]);

    run.progress['ach-counter-missing'] = createActiveProgress('ach-counter-missing', {
      notes: 'preserve this note',
    });
    run.pinnedAchievementIds = ['ach-counter-missing'];
    setRunUndoSnapshot(store, run);

    const storeBefore = deepClone(store);
    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);

    expect(store).toEqual(storeBefore);
    expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);

    const updatedRun = getRunProgress(result.store);
    expect(updatedRun.progress['ach-counter-missing'].counter).toEqual({
      certainty: 'exact',
      value: 0,
    });
    expect(updatedRun.pinnedAchievementIds).toEqual([]);

    const orphanHistory = updatedRun.orphanedProgress['ach-counter-missing'];
    expect(orphanHistory.length).toBe(1);
    expect(orphanHistory[0].trackingModeAtRemoval).toBe('binary');
    expect(orphanHistory[0].counter).toBeUndefined();
    expect(orphanHistory[0].notes).toBe('preserve this note');
    expect(orphanHistory[0].lastUpdated).toBe(TS1);

    const runDelta = result.report.setDeltas[0].runDeltas[0];
    expect(runDelta.quarantinedAchievementIds).toEqual(['ach-counter-missing']);
    expect(runDelta.removedPinnedAchievementIds).toEqual(['ach-counter-missing']);
    expect(runDelta.addedAchievementIds).toEqual([]);
    expect(runDelta.repairedDerivedCompletionIds).toEqual([]);

    expect(result.report.schemaConflicts.length).toBe(1);
    expect(result.report.schemaConflicts[0]).toContain(
      "Active progress for 'ach-counter-missing' in set 'set-1', run 'default-run' is incompatible with previous definition",
    );
    expect(result.report.clearedUndoTarget).toEqual({
      setId: 'set-1',
      runId: DEFAULT_HUNT_MEMORY_RUN_ID,
    });
    expect(result.store.undoState).toBeUndefined();
  });

  it('preserves represented tracker state for checklist-as-counter and binary-as-checklist', () => {
    const achChk = createChecklistAchievement('ach-chk-mismatch', ['chk-1']);
    const achBin = createBinaryAchievement('ach-bin-mismatch');
    const { prevGame, nextGame, store, run } = setupTestGame([achChk, achBin], [achChk, achBin]);

    run.progress['ach-chk-mismatch'] = createActiveProgress('ach-chk-mismatch', {
      counter: { certainty: 'exact', value: 7 },
    });
    run.progress['ach-bin-mismatch'] = createActiveProgress('ach-bin-mismatch', {
      completed: true,
      checklistCompletion: { 'old-item': true },
    });

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    const updatedRun = getRunProgress(result.store);

    expect(updatedRun.orphanedProgress['ach-chk-mismatch'][0].trackingModeAtRemoval).toBe('counter');
    expect(updatedRun.orphanedProgress['ach-chk-mismatch'][0].counter).toEqual({
      certainty: 'exact',
      value: 7,
    });
    expect(updatedRun.progress['ach-chk-mismatch'].checklistCompletion).toEqual({ 'chk-1': false });

    expect(updatedRun.orphanedProgress['ach-bin-mismatch'][0].trackingModeAtRemoval).toBe('checklist');
    expect(updatedRun.orphanedProgress['ach-bin-mismatch'][0].checklistCompletion).toEqual({
      'old-item': true,
    });
    expect(updatedRun.progress['ach-bin-mismatch'].counter).toBeUndefined();
    expect(updatedRun.progress['ach-bin-mismatch'].checklistCompletion).toBeUndefined();
  });

  it('quarantines active progress absent from previous definition without immediate re-admission', () => {
    const achPres = createBinaryAchievement('ach-ungrounded-present');
    const { prevGame, nextGame, store, run } = setupTestGame([], [achPres]);

    const historicalOrphan: OrphanedAchievementProgressV3 = {
      achievementId: 'ach-ungrounded-present',
      completed: true,
      manualOverride: false,
      notes: 'older orphan',
      lastUpdated: TS1,
      provenance: 'manual',
      trackingModeAtRemoval: 'binary',
    };
    run.orphanedProgress['ach-ungrounded-present'] = [historicalOrphan];
    run.progress['ach-ungrounded-present'] = createActiveProgress('ach-ungrounded-present', {
      completed: true,
      notes: 'active ungrounded',
    });
    run.progress['ach-ungrounded-absent'] = createActiveProgress('ach-ungrounded-absent', {
      notes: 'absent from next definition',
    });

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    const updatedRun = getRunProgress(result.store);

    expect(updatedRun.orphanedProgress['ach-ungrounded-present'].length).toBe(2);
    expect(updatedRun.orphanedProgress['ach-ungrounded-present'][0]).toEqual(historicalOrphan);
    expect(updatedRun.orphanedProgress['ach-ungrounded-present'][1].notes).toBe('active ungrounded');
    expect(updatedRun.progress['ach-ungrounded-present'].completed).toBe(false);
    expect(updatedRun.progress['ach-ungrounded-present'].lastUpdated).toBe(TS2);

    expect(Object.hasOwn(updatedRun.progress, 'ach-ungrounded-absent')).toBe(false);
    expect(updatedRun.orphanedProgress['ach-ungrounded-absent'].length).toBe(1);

    const runDelta = result.report.setDeltas[0].runDeltas[0];
    expect(runDelta.quarantinedAchievementIds).toEqual([
      'ach-ungrounded-absent',
      'ach-ungrounded-present',
    ]);
    expect(runDelta.addedAchievementIds).toEqual([]);
    expect(runDelta.restoredOrphanedAchievementIds).toEqual([]);
  });

  it('follows normal checklist item reconciliation when previous checklist shape was valid', () => {
    const prevChk = createChecklistAchievement('ach-chk', ['i1', 'i2']);
    const nextChk = createChecklistAchievement('ach-chk', ['i2', 'i3']);
    const { prevGame, nextGame, store, run } = setupTestGame([prevChk], [nextChk]);

    run.progress['ach-chk'] = createActiveProgress('ach-chk', {
      checklistCompletion: { i1: true, i2: false },
    });

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    const runDelta = result.report.setDeltas[0].runDeltas[0];

    expect(runDelta.quarantinedAchievementIds).toEqual([]);
    expect(result.report.schemaConflicts).toEqual([]);
    expect(runDelta.addedChecklistItems).toEqual([{ achievementId: 'ach-chk', itemIds: ['i3'] }]);
    expect(runDelta.removedChecklistItems).toEqual([{ achievementId: 'ach-chk', itemIds: ['i1'] }]);
  });

  it('reports derived-only repairs, clears matching undo, and preserves metadata', () => {
    const achCnt = createCounterAchievement('ach-cnt-stale', 5);
    const achChk = createChecklistAchievement('ach-chk-stale', ['i1', 'i2']);
    const { prevGame, nextGame, store, run } = setupTestGame([achCnt, achChk], [achCnt, achChk]);

    run.progress['ach-cnt-stale'] = createActiveProgress('ach-cnt-stale', {
      counter: { certainty: 'exact', value: 5 },
      notes: 'counter note',
    });
    run.progress['ach-chk-stale'] = createActiveProgress('ach-chk-stale', {
      checklistCompletion: { i1: true, i2: true },
      notes: 'chk note',
    });
    setRunUndoSnapshot(store, run);

    const storeBefore = deepClone(store);
    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);

    expect(store).toEqual(storeBefore);
    const runDelta = result.report.setDeltas[0].runDeltas[0];
    expect(runDelta.repairedDerivedCompletionIds).toEqual(['ach-chk-stale', 'ach-cnt-stale']);
    expect(runDelta.addedAchievementIds).toEqual([]);
    expect(runDelta.quarantinedAchievementIds).toEqual([]);

    const updatedRun = getRunProgress(result.store);
    expect(updatedRun.progress['ach-cnt-stale'].completed).toBe(true);
    expect(updatedRun.progress['ach-cnt-stale'].lastUpdated).toBe(TS1);
    expect(updatedRun.progress['ach-cnt-stale'].notes).toBe('counter note');
    expect(updatedRun.progress['ach-cnt-stale'].counter).toEqual({ certainty: 'exact', value: 5 });
    expect(updatedRun.progress['ach-cnt-stale'].provenance).toBe('manual');
    expect(updatedRun.progress['ach-chk-stale'].completed).toBe(true);
    expect(updatedRun.progress['ach-chk-stale'].lastUpdated).toBe(TS1);
    expect(updatedRun.progress['ach-chk-stale'].notes).toBe('chk note');
    expect(updatedRun.progress['ach-chk-stale'].checklistCompletion).toEqual({ i1: true, i2: true });
    expect(updatedRun.progress['ach-chk-stale'].provenance).toBe('manual');

    expect(result.report.clearedUndoTarget).toEqual({
      setId: 'set-1',
      runId: DEFAULT_HUNT_MEMORY_RUN_ID,
    });
    expect(result.store.undoState).toBeUndefined();
  });

  it('leaves repair list empty and preserves safe undo when derived state and override are correct', () => {
    const achCnt = createCounterAchievement('ach-cnt-correct', 5);
    const achOver = createCounterAchievement('ach-cnt-override', 10);
    const { prevGame, nextGame, store, run } = setupTestGame([achCnt, achOver], [achCnt, achOver]);

    run.progress['ach-cnt-correct'] = createActiveProgress('ach-cnt-correct', {
      completed: true,
      counter: { certainty: 'exact', value: 5 },
    });
    run.progress['ach-cnt-override'] = createActiveProgress('ach-cnt-override', {
      completed: true,
      manualOverride: true,
      counter: { certainty: 'exact', value: 2 },
    });
    setRunUndoSnapshot(store, run);

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    const runDelta = result.report.setDeltas[0].runDeltas[0];

    expect(runDelta.repairedDerivedCompletionIds).toEqual([]);
    expect(result.report.clearedUndoTarget).toBeUndefined();
    expect(result.store.undoState).toBeDefined();
  });

  it('produces duplicate-free arrays and clears undo only for the exact changed run', () => {
    const prevAch = [createBinaryAchievement('ach-remove'), createCounterAchievement('ach-cnt', 5)];
    const nextAch = [createCounterAchievement('ach-cnt', 5)];
    const { prevGame, nextGame, store, gameProgress, run: run1 } = setupTestGame(prevAch, nextAch);
    const setProgress = gameProgress.sets['set-1'];

    run1.progress['ach-remove'] = createActiveProgress('ach-remove');
    run1.progress['ach-cnt'] = createActiveProgress('ach-cnt', {
      counter: { certainty: 'exact', value: 5 },
    });

    const run2 = deepClone(run1);
    run2.runId = 'run-2';
    run2.progress['ach-cnt'].completed = true;
    delete run2.progress['ach-remove'];
    setProgress.runs['run-2'] = run2;
    setRunUndoSnapshot(store, run2, 'run-2');

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    const runDeltas = result.report.setDeltas[0].runDeltas;

    expect(runDeltas.length).toBe(2);
    expect(runDeltas[0].runId).toBe(DEFAULT_HUNT_MEMORY_RUN_ID);
    expect(runDeltas[0].quarantinedAchievementIds).toEqual(['ach-remove']);
    expect(runDeltas[0].repairedDerivedCompletionIds).toEqual(['ach-cnt']);

    expect(runDeltas[1].runId).toBe('run-2');
    expect(runDeltas[1].quarantinedAchievementIds).toEqual([]);
    expect(runDeltas[1].repairedDerivedCompletionIds).toEqual([]);

    expect(result.report.clearedUndoTarget).toBeUndefined();
    expect(result.store.undoState?.['g-1']).toBeDefined();
  });

  it('preserves constructor and toString IDs, own-property semantics, and Schema 3.0 validity', () => {
    const achs = [createCounterAchievement('constructor', 5), createCounterAchievement('toString', 5)];
    const { prevGame, nextGame, store, run } = setupTestGame(achs, achs);

    run.progress['constructor'] = createActiveProgress('constructor', { completed: true });
    run.progress['toString'] = createActiveProgress('toString');

    const priorOrphan: OrphanedAchievementProgressV3 = {
      achievementId: 'toString',
      completed: true,
      manualOverride: false,
      counter: { certainty: 'exact', value: 2 },
      lastUpdated: TS1,
      provenance: 'manual',
      trackingModeAtRemoval: 'counter',
    };
    run.orphanedProgress['toString'] = [priorOrphan];
    expect(Object.hasOwn(run.orphanedProgress, 'constructor')).toBe(false);
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);

    expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    const updatedRun = getRunProgress(result.store);

    expect(updatedRun.orphanedProgress['toString'].length).toBe(2);
    expect(updatedRun.orphanedProgress['toString'][0]).toEqual(priorOrphan);
    expect(updatedRun.orphanedProgress['toString'][1].trackingModeAtRemoval).toBe('binary');
    expect(updatedRun.progress['toString'].counter).toEqual({
      certainty: 'exact',
      value: 0,
    });
    expect(Object.hasOwn(updatedRun.orphanedProgress, 'constructor')).toBe(true);
    expect(updatedRun.orphanedProgress['constructor']).toEqual([{
      ...createActiveProgress('constructor', { completed: true }),
      trackingModeAtRemoval: 'binary',
    }]);
    expect(updatedRun.progress['constructor']).toEqual(createActiveProgress('constructor', {
      counter: { certainty: 'exact', value: 0 },
      lastUpdated: TS2,
    }));

    const runDelta = result.report.setDeltas[0].runDeltas[0];
    expect(runDelta.quarantinedAchievementIds).toEqual(['constructor', 'toString']);
    expect(result.report.schemaConflicts).toEqual([
      "Active progress for 'constructor' in set 'set-1', run 'default-run' is incompatible with previous definition",
      "Active progress for 'toString' in set 'set-1', run 'default-run' is incompatible with previous definition",
    ]);
  });

  it('clears matching undo when compatible orphan restoration is the only run change', () => {
    const { prevGame, nextGame, store, run } = setupTestGame([], [createBinaryAchievement('ach-returning')]);
    const restoredProgress = createActiveProgress('ach-returning', {
      completed: true,
      notes: 'restored note',
    });
    run.orphanedProgress['ach-returning'] = [{ ...restoredProgress, trackingModeAtRemoval: 'binary' }];
    setRunUndoSnapshot(store, run);

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);

    expect(result.report.setDeltas[0].runDeltas).toEqual([{
      runId: DEFAULT_HUNT_MEMORY_RUN_ID,
      addedAchievementIds: [],
      quarantinedAchievementIds: [],
      restoredOrphanedAchievementIds: ['ach-returning'],
      repairedDerivedCompletionIds: [],
      addedChecklistItems: [],
      removedChecklistItems: [],
      removedPinnedAchievementIds: [],
    }]);
    expect(getRunProgress(result.store).progress['ach-returning']).toEqual(restoredProgress);
    expect(getRunProgress(result.store).orphanedProgress).toEqual({});
    expect(result.report.schemaConflicts).toEqual([]);
    expect(result.report.clearedUndoTarget).toEqual({
      setId: 'set-1',
      runId: DEFAULT_HUNT_MEMORY_RUN_ID,
    });
    expect(result.store.undoState).toBeUndefined();
  });
});
