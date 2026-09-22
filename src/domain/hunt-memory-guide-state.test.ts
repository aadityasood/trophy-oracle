import { describe, expect, it } from 'vitest';
import {
  createDefaultGameProgressV3,
  createDefaultHuntMemoryStore,
  createRun,
} from './hunt-memory-lifecycle';
import { reconcileHuntMemoryGameProgress } from './hunt-memory-reconciliation';
import {
  GuideRouteCardRevealLevelSchema,
  GuideRouteContextV3Schema,
  GuideStateV3Schema,
  LocalProgressStoreV3Schema,
  RunProgressSchema,
  type GuideStateV3,
  type LocalProgressStoreV3,
  type RunProgress,
} from './hunt-memory-schema';
import {
  RESERVED_RECORD_KEY,
  RESERVED_RECORD_KEY_MESSAGE,
} from './progress-schema-common';
import {
  TS1,
  TS2,
  createBinaryAchievement,
  createTestGame,
  createTestSet,
  deepClone,
} from './hunt-memory-reconciliation-test-fixtures';

function createSampleRun(runId = 'run-1'): RunProgress {
  return {
    runId,
    name: `Run ${runId}`,
    createdAt: TS1,
    pinnedAchievementIds: [],
    progress: {
      'ach-1': { achievementId: 'ach-1', completed: false, manualOverride: false, lastUpdated: TS1, provenance: 'manual' },
    },
    orphanedProgress: {},
  };
}

function createSampleGuideState(): GuideStateV3 {
  return {
    savedAchievementIds: ['ach-1', 'ach-missing'],
    currentRunNumber: 1,
    routeContext: {
      packId: 'pack-alpha',
      packVersion: '1.0.0',
      areaId: 'area-forest',
      checkpointId: 'cp-bonfire',
      revealByRouteCardId: { 'card-1': 'route', 'card-2': 'exact' },
    },
  };
}

function createBaseStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.gameProgress = {
    'game-1': {
      gameId: 'game-1',
      sets: {
        'set-1': { setId: 'set-1', version: '1.0', activeRunId: 'run-1', runs: { 'run-1': createSampleRun('run-1') } },
      },
      retiredSets: {},
    },
  };
  return store;
}

describe('hunt-memory guide-state schema admission', () => {
  it('admits guideStateByRunId in active sets and both retired-set variants', () => {
    const store = createBaseStore();
    const game = store.gameProgress['game-1'];
    game.sets['set-1'].guideStateByRunId = { 'run-1': createSampleGuideState() };
    game.retiredSets['set-retired-removed'] = {
      setId: 'set-retired-removed',
      version: '1.0',
      activeRunId: 'run-1',
      runs: { 'run-1': createSampleRun('run-1') },
      retirementReason: 'removed_set',
      guideStateByRunId: { 'run-1': createSampleGuideState() },
    };
    game.retiredSets['set-retired-orphans'] = {
      setId: 'set-retired-orphans',
      activeRunId: 'run-1',
      runs: { 'run-1': createSampleRun('run-1') },
      retirementReason: 'schema_2_absent_orphans',
      guideStateByRunId: { 'run-1': createSampleGuideState() },
    };
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
  });

  it('permits absent guideStateByRunId, empty map, and missing run entries', () => {
    const store = createBaseStore();
    const activeSet = store.gameProgress['game-1'].sets['set-1'];
    activeSet.runs['run-2'] = createSampleRun('run-2');
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);

    activeSet.guideStateByRunId = {};
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);

    activeSet.guideStateByRunId = { 'run-1': { savedAchievementIds: [] } };
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
  });

  it('enforces distinct, nonblank savedAchievementIds', () => {
    expect(GuideStateV3Schema.safeParse({ savedAchievementIds: [] }).success).toBe(true);
    expect(GuideStateV3Schema.safeParse({ savedAchievementIds: ['ach-1', 'ach-2'] }).success).toBe(true);
    expect(GuideStateV3Schema.safeParse({ savedAchievementIds: ['ach-1', 'ach-1'] }).success).toBe(false);
    expect(GuideStateV3Schema.safeParse({ savedAchievementIds: ['ach-1', '   '] }).success).toBe(false);
  });

  it('validates optional currentRunNumber as positive integer', () => {
    expect(GuideStateV3Schema.safeParse({ savedAchievementIds: [], currentRunNumber: 1 }).success).toBe(true);
    for (const invalid of [0, -1, 1.5, '2', NaN, Infinity, -Infinity]) {
      expect(GuideStateV3Schema.safeParse({ savedAchievementIds: [], currentRunNumber: invalid }).success).toBe(false);
    }
  });

  it('validates routeContext requirements, checkpoints, and card reveal levels', () => {
    const validMinimal = { packId: 'pack-1', packVersion: '1.0' };
    expect(GuideRouteContextV3Schema.safeParse(validMinimal).success).toBe(true);
    expect(GuideRouteContextV3Schema.safeParse({ ...validMinimal, areaId: 'area-1' }).success).toBe(true);
    expect(GuideRouteContextV3Schema.safeParse({ ...validMinimal, areaId: 'area-1', checkpointId: 'cp-1' }).success).toBe(true);
    expect(GuideRouteContextV3Schema.safeParse({ ...validMinimal, checkpointId: 'cp-1' }).success).toBe(false);

    for (const blankField of ['packId', 'packVersion', 'areaId', 'checkpointId'] as const) {
      expect(
        GuideRouteContextV3Schema.safeParse({ ...validMinimal, areaId: 'area-1', checkpointId: 'cp-1', [blankField]: '   ' }).success,
      ).toBe(false);
    }

    expect(GuideRouteCardRevealLevelSchema.safeParse('route').success).toBe(true);
    expect(GuideRouteCardRevealLevelSchema.safeParse('exact').success).toBe(true);
    expect(GuideRouteCardRevealLevelSchema.safeParse('hint').success).toBe(false);
    expect(GuideRouteCardRevealLevelSchema.safeParse('other').success).toBe(false);
  });

  it('rejects unknown fields on guide entries, route context, and other store levels', () => {
    expect(GuideStateV3Schema.safeParse({ savedAchievementIds: [], unknownField: 'bad' }).success).toBe(false);
    expect(GuideRouteContextV3Schema.safeParse({ packId: 'p', packVersion: '1', extraContext: 42 }).success).toBe(false);

    const storeWithRootGuide = { ...createBaseStore(), guideStateByRunId: {} };
    expect(LocalProgressStoreV3Schema.safeParse(storeWithRootGuide).success).toBe(false);

    const runWithGuide = { ...createSampleRun('run-1'), guideStateByRunId: {} };
    expect(RunProgressSchema.safeParse(runWithGuide).success).toBe(false);

    const storeWithUndoGuide = createBaseStore();
    storeWithUndoGuide.undoState = {
      'game-1': {
        setId: 'set-1',
        runId: 'run-1',
        guardedSetVersion: '1.0',
        previous: runWithGuide as unknown as RunProgress,
      },
    };
    expect(LocalProgressStoreV3Schema.safeParse(storeWithUndoGuide).success).toBe(false);
  });

  it('rejects orphaned guide keys and prototype pollution while accepting own prototype keys', () => {
    const store = createBaseStore();
    const set = store.gameProgress['game-1'].sets['set-1'];
    set.guideStateByRunId = { 'unknown-run': createSampleGuideState() };
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(false);

    const reservedMap: Record<string, unknown> = {};
    Object.defineProperty(reservedMap, RESERVED_RECORD_KEY, {
      value: createSampleGuideState(),
      enumerable: true,
      configurable: true,
      writable: true,
    });
    set.guideStateByRunId = reservedMap as Record<string, GuideStateV3>;
    const reservedCheck = LocalProgressStoreV3Schema.safeParse(store);
    expect(reservedCheck.success).toBe(false);
    if (!reservedCheck.success) {
      expect(reservedCheck.error.issues.some((issue) => issue.message === RESERVED_RECORD_KEY_MESSAGE)).toBe(true);
    }

    const reservedCardRevealMap: Record<string, 'route'> = {};
    Object.defineProperty(reservedCardRevealMap, RESERVED_RECORD_KEY, {
      value: 'route',
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(
      GuideRouteContextV3Schema.safeParse({ packId: 'p', packVersion: '1', revealByRouteCardId: reservedCardRevealMap }).success,
    ).toBe(false);

    for (const ownKey of ['constructor', 'toString'] as const) {
      const protoStore = createBaseStore();
      const protoSet = protoStore.gameProgress['game-1'].sets['set-1'];
      delete protoSet.runs['run-1'];
      protoSet.activeRunId = ownKey;
      protoSet.runs[ownKey] = createSampleRun(ownKey);
      protoSet.guideStateByRunId = { [ownKey]: createSampleGuideState() };
      expect(LocalProgressStoreV3Schema.safeParse(protoStore).success).toBe(true);

      const unrefStore = createBaseStore();
      unrefStore.gameProgress['game-1'].sets['set-1'].guideStateByRunId = { [ownKey]: createSampleGuideState() };
      expect(LocalProgressStoreV3Schema.safeParse(unrefStore).success).toBe(false);
    }
  });

  it('permits saved achievement IDs whose definitions do not exist', () => {
    const store = createBaseStore();
    store.gameProgress['game-1'].sets['set-1'].guideStateByRunId = {
      'run-1': { savedAchievementIds: ['disappeared-ach-id', 'another-historical-id'] },
    };
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
  });
});

describe('hunt-memory reconciliation guide-state carry and isolation', () => {
  it('carries guide state intact through active-set retirement and preserves absence', () => {
    const prevSet = createTestSet('set-1', '1.0', [createBinaryAchievement('ach-1')]);
    const prevGame = createTestGame('game-1', '1.0', [prevSet]);
    const nextGame = createTestGame('game-1', '1.0', []);

    const storeWithGuide = createBaseStore();
    const originalGuideState = { 'run-1': createSampleGuideState() };
    storeWithGuide.gameProgress['game-1'].sets['set-1'].guideStateByRunId = originalGuideState;
    const sourceBefore = deepClone(storeWithGuide);

    const retiredResult = reconcileHuntMemoryGameProgress(storeWithGuide, prevGame, nextGame, TS2);
    expect(storeWithGuide).toEqual(sourceBefore);
    const retiredSet = retiredResult.store.gameProgress['game-1'].retiredSets['set-1'];
    expect(retiredSet?.retirementReason).toBe('removed_set');
    expect(retiredSet?.guideStateByRunId).toEqual(originalGuideState);
    expect(retiredSet?.guideStateByRunId).not.toBe(originalGuideState);
    expect(retiredSet?.guideStateByRunId?.['run-1']).not.toBe(originalGuideState['run-1']);
    expect(retiredSet?.guideStateByRunId?.['run-1'].routeContext).not.toBe(originalGuideState['run-1'].routeContext);

    const storeAbsent = createBaseStore();
    const sourceAbsentBefore = deepClone(storeAbsent);
    expect(LocalProgressStoreV3Schema.safeParse(storeAbsent).success).toBe(true);
    const absentResult = reconcileHuntMemoryGameProgress(storeAbsent, prevGame, nextGame, TS2);
    expect(storeAbsent).toStrictEqual(sourceAbsentBefore);
    const retiredAbsent = absentResult.store.gameProgress['game-1'].retiredSets['set-1'];
    expect(retiredAbsent?.retirementReason).toBe('removed_set');
    expect(retiredAbsent?.guideStateByRunId).toBeUndefined();
    expect(Object.hasOwn(retiredAbsent, 'guideStateByRunId')).toBe(false);
  });

  it('carries guide state intact through same-version removed_set restoration', () => {
    const testSet = createTestSet('set-1', '1.0', [createBinaryAchievement('ach-1')]);
    const prevGame = createTestGame('game-1', '1.0', []);
    const nextGame = createTestGame('game-1', '1.0', [testSet]);

    const store = createDefaultHuntMemoryStore();
    const guideState = { 'run-1': createSampleGuideState() };
    store.gameProgress['game-1'] = {
      gameId: 'game-1',
      sets: {},
      retiredSets: {
        'set-1': {
          setId: 'set-1',
          version: '1.0',
          activeRunId: 'run-1',
          runs: { 'run-1': createSampleRun('run-1') },
          retirementReason: 'removed_set',
          guideStateByRunId: guideState,
        },
      },
    };
    const sourceBefore = deepClone(store);

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    expect(store).toEqual(sourceBefore);
    const restoredSet = result.store.gameProgress['game-1'].sets['set-1'];
    expect(restoredSet?.guideStateByRunId).toEqual(guideState);
    expect(restoredSet?.guideStateByRunId).not.toBe(guideState);
    expect(restoredSet?.guideStateByRunId?.['run-1']).not.toBe(guideState['run-1']);
    expect(restoredSet?.guideStateByRunId?.['run-1'].routeContext).not.toBe(guideState['run-1'].routeContext);
    expect(result.store.gameProgress['game-1'].retiredSets['set-1']).toBeUndefined();
    expect(result.report.restoredRetiredSetIds).toEqual(['set-1']);

    const storeAbsent = deepClone(store);
    delete storeAbsent.gameProgress['game-1'].retiredSets['set-1'].guideStateByRunId;
    const sourceAbsentBefore = deepClone(storeAbsent);
    expect(LocalProgressStoreV3Schema.safeParse(storeAbsent).success).toBe(true);
    const absentResult = reconcileHuntMemoryGameProgress(storeAbsent, prevGame, nextGame, TS2);
    expect(storeAbsent).toStrictEqual(sourceAbsentBefore);
    const restoredAbsent = absentResult.store.gameProgress['game-1'].sets['set-1'];
    expect(Object.hasOwn(restoredAbsent, 'guideStateByRunId')).toBe(false);
    expect(absentResult.store.gameProgress['game-1'].retiredSets['set-1']).toBeUndefined();
    expect(absentResult.report.restoredRetiredSetIds).toEqual(['set-1']);
  });

  it('carries guide state intact through schema_2_absent_orphans restoration', () => {
    const testSet = createTestSet('set-1', '1.0', [createBinaryAchievement('ach-1')]);
    const prevGame = createTestGame('game-1', '1.0', []);
    const nextGame = createTestGame('game-1', '1.0', [testSet]);

    const store = createDefaultHuntMemoryStore();
    const orphanRun = createSampleRun('run-1');
    orphanRun.progress = {};
    orphanRun.orphanedProgress = {
      'ach-1': [{
        achievementId: 'ach-1', completed: true, manualOverride: false, lastUpdated: TS1, provenance: 'manual', trackingModeAtRemoval: 'binary',
      }],
    };

    const guideState = { 'run-1': createSampleGuideState() };
    store.gameProgress['game-1'] = {
      gameId: 'game-1',
      sets: {},
      retiredSets: {
        'set-1': {
          setId: 'set-1',
          activeRunId: 'run-1',
          runs: { 'run-1': orphanRun },
          retirementReason: 'schema_2_absent_orphans',
          guideStateByRunId: guideState,
        },
      },
    };
    const sourceBefore = deepClone(store);

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    expect(store).toEqual(sourceBefore);
    const restoredSet = result.store.gameProgress['game-1'].sets['set-1'];
    expect(restoredSet?.guideStateByRunId).toEqual(guideState);
    expect(restoredSet?.guideStateByRunId).not.toBe(guideState);
    expect(restoredSet?.guideStateByRunId?.['run-1']).not.toBe(guideState['run-1']);
    expect(restoredSet?.guideStateByRunId?.['run-1'].routeContext).not.toBe(guideState['run-1'].routeContext);
    expect(result.report.restoredRetiredSetIds).toEqual(['set-1']);

    const storeAbsent = deepClone(store);
    delete storeAbsent.gameProgress['game-1'].retiredSets['set-1'].guideStateByRunId;
    const sourceAbsentBefore = deepClone(storeAbsent);
    expect(LocalProgressStoreV3Schema.safeParse(storeAbsent).success).toBe(true);
    const absentResult = reconcileHuntMemoryGameProgress(storeAbsent, prevGame, nextGame, TS2);
    expect(storeAbsent).toStrictEqual(sourceAbsentBefore);
    const restoredAbsent = absentResult.store.gameProgress['game-1'].sets['set-1'];
    expect(Object.hasOwn(restoredAbsent, 'guideStateByRunId')).toBe(false);
    expect(absentResult.store.gameProgress['game-1'].retiredSets['set-1']).toBeUndefined();
    expect(absentResult.report.restoredRetiredSetIds).toEqual(['set-1']);
  });

  it('preserves guide state during same-set reconciliation without aliasing input', () => {
    const prevSet = createTestSet('set-1', '1.0', [createBinaryAchievement('ach-1')]);
    const nextSet = createTestSet('set-1', '1.1', [createBinaryAchievement('ach-1'), createBinaryAchievement('ach-2')]);
    const prevGame = createTestGame('game-1', '1.0', [prevSet]);
    const nextGame = createTestGame('game-1', '1.1', [nextSet]);

    const store = createBaseStore();
    const originalGuideState = { 'run-1': createSampleGuideState() };
    store.gameProgress['game-1'].sets['set-1'].guideStateByRunId = originalGuideState;
    const sourceBefore = deepClone(store);

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    expect(store).toEqual(sourceBefore);
    const targetSet = result.store.gameProgress['game-1'].sets['set-1'];
    expect(targetSet.version).toBe('1.1');
    expect(targetSet.guideStateByRunId).toEqual(originalGuideState);
    expect(targetSet.guideStateByRunId).not.toBe(originalGuideState);
    expect(targetSet.guideStateByRunId?.['run-1']).not.toBe(originalGuideState['run-1']);
    expect(targetSet.guideStateByRunId?.['run-1'].routeContext).not.toBe(originalGuideState['run-1'].routeContext);
  });

  it('isolates guide state from progress undo state', () => {
    const prevSet = createTestSet('set-1', '1.0', [createBinaryAchievement('ach-1')]);
    const nextSet = createTestSet('set-1', '1.0', [createBinaryAchievement('ach-1')]);
    const prevGame = createTestGame('game-1', '1.0', [prevSet]);
    const nextGame = createTestGame('game-1', '1.0', [nextSet]);

    const store = createBaseStore();
    store.gameProgress['game-1'].sets['set-1'].guideStateByRunId = { 'run-1': createSampleGuideState() };
    const expectedSnapshot = {
      setId: 'set-1',
      runId: 'run-1',
      guardedSetVersion: '1.0',
      previous: deepClone(store.gameProgress['game-1'].sets['set-1'].runs['run-1']),
    };
    store.undoState = {
      'game-1': deepClone(expectedSnapshot),
    };
    const sourceBefore = deepClone(store);

    const result = reconcileHuntMemoryGameProgress(store, prevGame, nextGame, TS2);
    expect(store).toEqual(sourceBefore);
    expect(result.store.undoState?.['game-1']).toEqual(expectedSnapshot);
    expect(result.store.undoState?.['game-1']).not.toBe(store.undoState?.['game-1']);
    expect('guideStateByRunId' in (result.store.undoState?.['game-1'] ?? {})).toBe(false);
    expect('guideStateByRunId' in (result.store.undoState?.['game-1']?.previous ?? {})).toBe(false);
    expect(result.report.clearedUndoTarget).toBeUndefined();
  });

  it('does not create guide entries when creating runs or default sets', () => {
    const setDef = createTestSet('set-1', '1.0', [createBinaryAchievement('ach-1')]);
    const game = createTestGame('game-1', '1.0', [setDef]);
    const store = createDefaultHuntMemoryStore();
    store.gameProgress['game-1'] = createDefaultGameProgressV3(game, TS1);
    expect(store.gameProgress['game-1'].sets['set-1'].guideStateByRunId).toBeUndefined();

    const runResult = createRun(store, game, 'set-1', 'speedrun', 'Speed Run', TS1);
    expect(runResult.success).toBe(true);
    if (runResult.success) {
      const activeSet = runResult.store.gameProgress['game-1'].sets['set-1'];
      expect(activeSet.guideStateByRunId).toBeUndefined();
      expect(LocalProgressStoreV3Schema.safeParse(runResult.store).success).toBe(true);
    }
  });
});
