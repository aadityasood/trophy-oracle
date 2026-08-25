import { describe, expect, it } from 'vitest';
import type {
  AchievementRecord,
  AchievementSet,
  GameRecord,
} from './achievement-schema';
import {
  LocalProgressStoreV3Schema,
  RunProgressSchema,
} from './hunt-memory-schema';
import type { LocalProgressStoreV3, RunProgress } from './hunt-memory-schema';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID,
  DEFAULT_HUNT_MEMORY_RUN_NAME,
  createDefaultAchievementProgressV3,
  createDefaultAchievementSetProgressV3,
  createDefaultGameProgressV3,
  createDefaultHuntMemoryStore,
  createDefaultRunProgress,
  createRun,
  selectRun,
} from './hunt-memory-lifecycle';

const TS = '2026-07-22T00:00:00.000Z';
const TS2 = '2026-07-22T01:00:00.000Z';
const PROTOTYPE_SENSITIVE_IDS = [
  'constructor',
  'toString',
  '__proto__',
] as const;

function binaryAchievement(id: string): AchievementRecord {
  return {
    id,
    name: `Achievement ${id}`,
    description: 'A binary achievement',
    evidence: 'Mandatory',
    reward: { type: 'achievement' },
    tracking: { mode: 'binary' },
    labels: [],
    expectedStage: 'story',
    confidence: 1,
    prerequisites: [],
  };
}

function counterAchievement(id: string, target?: number): AchievementRecord {
  return {
    id,
    name: `Achievement ${id}`,
    description: 'A counter achievement',
    evidence: 'Free roam',
    reward: { type: 'achievement' },
    tracking:
      target === undefined
        ? { mode: 'counter', unit: 'items' }
        : { mode: 'counter', unit: 'items', target },
    labels: [],
    expectedStage: 'cleanup',
    confidence: 1,
    prerequisites: [],
  };
}

function checklistAchievement(id: string, itemIds: string[]): AchievementRecord {
  return {
    id,
    name: `Achievement ${id}`,
    description: 'A checklist achievement',
    evidence: 'Free roam tasks',
    reward: { type: 'achievement' },
    tracking: {
      mode: 'checklist',
      items: itemIds.map((itemId) => ({ id: itemId, name: `Item ${itemId}` })),
    },
    labels: [],
    expectedStage: 'cleanup',
    confidence: 1,
    prerequisites: [],
    spoilerSafeHint: 'Complete required tasks',
  };
}

function achievementSet(
  id: string,
  version: string,
  achievements: AchievementRecord[],
): AchievementSet {
  return { id, platform: 'steam', version, achievements };
}

function game(id: string, sets: AchievementSet[]): GameRecord {
  return {
    id,
    title: `Game ${id}`,
    aliases: [],
    sourceType: 'fictional_demo',
    version: '2026.07.13',
    theme: {
      primary: '#000000',
      secondary: '#111111',
      surfaceGlow: '#222222',
      mood: 'test',
    },
    summary: 'Test game',
    achievementSets: sets,
  };
}

const SET_A = achievementSet('set-a', '1.0', [
  binaryAchievement('ach-binary'),
  counterAchievement('ach-counter-bounded', 48),
  counterAchievement('ach-counter-open'),
  checklistAchievement('ach-checklist', ['task-a', 'task-b', 'task-c']),
]);
const SET_B = achievementSet('set-b', '1.0', [binaryAchievement('ach-b2')]);
const RETIRED_SET = achievementSet('retired-set', '2.0', [
  binaryAchievement('ach-retired'),
]);
const GAME_A = game('game-a', [SET_A, SET_B]);
const GAME_B = game('game-b', [
  achievementSet('set-c', '1.0', [binaryAchievement('ach-c')]),
]);
const GAME_MISSING = game('missing-game', [
  achievementSet('set-x', '1.0', [binaryAchievement('ach-x')]),
]);

function populateActiveRunState(run: RunProgress, timestamp: string): void {
  run.activeStage = 'missables';
  run.pinnedAchievementIds = ['ach-binary'];
  run.progress['ach-binary'] = {
    achievementId: 'ach-binary',
    completed: true,
    manualOverride: false,
    notes: 'carried note',
    lastUpdated: timestamp,
    provenance: 'manual',
  };
  run.progress['ach-counter-bounded'] = {
    achievementId: 'ach-counter-bounded',
    completed: false,
    manualOverride: false,
    counter: { certainty: 'exact', value: 7 },
    lastUpdated: timestamp,
    provenance: 'manual',
  };
}

function createPopulatedStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.lastGameId = 'game-a';

  const gameAProgress = createDefaultGameProgressV3(GAME_A, TS);
  gameAProgress.preferredSetId = 'set-a';
  gameAProgress.sets['set-a'].runs['second-run'] = createDefaultRunProgress(
    SET_A,
    'second-run',
    'Second Run',
    TS,
  );
  gameAProgress.retiredSets['retired-set'] = {
    setId: 'retired-set',
    version: '2.0',
    retirementReason: 'removed_set',
    activeRunId: DEFAULT_HUNT_MEMORY_RUN_ID,
    runs: {
      [DEFAULT_HUNT_MEMORY_RUN_ID]: createDefaultRunProgress(
        RETIRED_SET,
        DEFAULT_HUNT_MEMORY_RUN_ID,
        DEFAULT_HUNT_MEMORY_RUN_NAME,
        TS,
      ),
    },
  };

  store.gameProgress['game-a'] = gameAProgress;
  store.gameProgress['game-b'] = createDefaultGameProgressV3(GAME_B, TS);
  store.undoState = {
    'game-a': {
      setId: 'set-a',
      runId: DEFAULT_HUNT_MEMORY_RUN_ID,
      guardedSetVersion: '1.0',
      previous: createDefaultRunProgress(
        SET_A,
        DEFAULT_HUNT_MEMORY_RUN_ID,
        DEFAULT_HUNT_MEMORY_RUN_NAME,
        TS,
      ),
    },
  };

  return store;
}

function freshBinaryProgress(achievementId: string, timestamp: string) {
  return {
    achievementId,
    completed: false,
    manualOverride: false,
    lastUpdated: timestamp,
    provenance: 'manual',
  };
}

describe('hunt memory lifecycle', () => {
  it('creates a strict-schema-valid empty store with no invented optional state', () => {
    const store = createDefaultHuntMemoryStore();

    expect(DEFAULT_HUNT_MEMORY_RUN_ID).toBe('default-run');
    expect(DEFAULT_HUNT_MEMORY_RUN_NAME).toBe('Main Run');
    expect(store).toEqual({ schemaVersion: '3.0', gameProgress: {} });
    expect('lastGameId' in store).toBe(false);
    expect('undoState' in store).toBe(false);
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
  });

  it('initializes every current set with an independent default-run ledger', () => {
    const gameProgress = createDefaultGameProgressV3(GAME_A, TS);

    expect(Object.keys(gameProgress.sets).sort()).toEqual(['set-a', 'set-b']);
    expect('preferredSetId' in gameProgress).toBe(false);
    expect(gameProgress.retiredSets).toEqual({});

    const setA = gameProgress.sets['set-a'];
    const setB = gameProgress.sets['set-b'];
    expect(setA.setId).toBe('set-a');
    expect(setA.version).toBe('1.0');
    expect(setB.setId).toBe('set-b');
    expect(setB.version).toBe('1.0');

    expect(setA.activeRunId).toBe(DEFAULT_HUNT_MEMORY_RUN_ID);
    expect(setB.activeRunId).toBe(DEFAULT_HUNT_MEMORY_RUN_ID);
    expect(Object.keys(setA.runs)).toEqual([DEFAULT_HUNT_MEMORY_RUN_ID]);
    expect(Object.keys(setB.runs)).toEqual([DEFAULT_HUNT_MEMORY_RUN_ID]);
    expect(setA.runs[DEFAULT_HUNT_MEMORY_RUN_ID].name).toBe(
      DEFAULT_HUNT_MEMORY_RUN_NAME,
    );
    expect(setB.runs[DEFAULT_HUNT_MEMORY_RUN_ID].name).toBe(
      DEFAULT_HUNT_MEMORY_RUN_NAME,
    );
    expect(setA.runs[DEFAULT_HUNT_MEMORY_RUN_ID]).not.toBe(
      setB.runs[DEFAULT_HUNT_MEMORY_RUN_ID],
    );
  });

  it('builds mode-correct fresh binary, bounded counter, open counter, and checklist state', () => {
    const gameProgress = createDefaultGameProgressV3(GAME_A, TS);
    const run = gameProgress.sets['set-a'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

    expect(run.progress['ach-binary']).toEqual(freshBinaryProgress('ach-binary', TS));

    expect(run.progress['ach-counter-bounded']).toEqual({
      achievementId: 'ach-counter-bounded',
      completed: false,
      manualOverride: false,
      counter: { certainty: 'exact', value: 0 },
      lastUpdated: TS,
      provenance: 'manual',
    });

    expect(run.progress['ach-counter-open']).toEqual({
      achievementId: 'ach-counter-open',
      completed: false,
      manualOverride: false,
      counter: { certainty: 'exact', value: 0 },
      lastUpdated: TS,
      provenance: 'manual',
    });

    expect(run.progress['ach-checklist']).toEqual({
      achievementId: 'ach-checklist',
      completed: false,
      manualOverride: false,
      checklistCompletion: {
        'task-a': false,
        'task-b': false,
        'task-c': false,
      },
      lastUpdated: TS,
      provenance: 'manual',
    });

    expect(LocalProgressStoreV3Schema.safeParse({
      schemaVersion: '3.0',
      gameProgress: { 'game-a': gameProgress },
    }).success).toBe(true);
  });

  it('uses the caller timestamp for createdAt and every lastUpdated', () => {
    const gameProgress = createDefaultGameProgressV3(GAME_A, TS);
    const run = gameProgress.sets['set-a'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

    expect(run.createdAt).toBe(TS);
    expect(run.progress['ach-binary'].lastUpdated).toBe(TS);
    expect(run.progress['ach-counter-bounded'].lastUpdated).toBe(TS);
    expect(run.progress['ach-counter-open'].lastUpdated).toBe(TS);
    expect(run.progress['ach-checklist'].lastUpdated).toBe(TS);
    expect(gameProgress.sets['set-b'].runs[DEFAULT_HUNT_MEMORY_RUN_ID].createdAt).toBe(
      TS,
    );
  });

  it('rejects invalid timestamps in every timestamp-taking constructor without mutating input', () => {
    const achievement = SET_A.achievements[0];
    const achievementBefore = structuredClone(achievement);
    expect(() => createDefaultAchievementProgressV3(achievement, 'invalid')).toThrow();
    expect(achievement).toEqual(achievementBefore);

    expect(() => createDefaultRunProgress(SET_A, 'r', 'n', 'invalid')).toThrow();
    expect(() => createDefaultAchievementSetProgressV3(SET_A, 'invalid')).toThrow();

    const gameBefore = structuredClone(GAME_A);
    expect(() => createDefaultGameProgressV3(GAME_A, 'invalid')).toThrow();
    expect(GAME_A).toEqual(gameBefore);
  });

  it('creates a valid empty run, makes it active, and preserves the supplied id and name exactly', () => {
    const store = createDefaultHuntMemoryStore();
    store.gameProgress['game-a'] = createDefaultGameProgressV3(GAME_A, TS);

    const result = createRun(store, GAME_A, 'set-a', 'fresh-run', 'Padded Run ', TS2);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.runId).toBe('fresh-run');
    const set = result.store.gameProgress['game-a'].sets['set-a'];
    expect(set.activeRunId).toBe('fresh-run');
    expect(Object.keys(set.runs).sort()).toEqual(['default-run', 'fresh-run']);

    const run = set.runs['fresh-run'];
    expect(run.runId).toBe('fresh-run');
    expect(run.name).toBe('Padded Run ');
    expect(run.createdAt).toBe(TS2);
    expect(run.pinnedAchievementIds).toEqual([]);
    expect('activeStage' in run).toBe(false);
    expect(run.orphanedProgress).toEqual({});
    expect(run.progress['ach-binary']).toEqual(freshBinaryProgress('ach-binary', TS2));
    expect(run.progress['ach-counter-bounded']).toEqual({
      achievementId: 'ach-counter-bounded',
      completed: false,
      manualOverride: false,
      counter: { certainty: 'exact', value: 0 },
      lastUpdated: TS2,
      provenance: 'manual',
    });

    expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    expect(store.gameProgress['game-a'].sets['set-a'].activeRunId).toBe(
      DEFAULT_HUNT_MEMORY_RUN_ID,
    );
  });

  it('allows duplicate display names', () => {
    const store = createDefaultHuntMemoryStore();
    store.gameProgress['game-a'] = createDefaultGameProgressV3(GAME_A, TS);

    const first = createRun(store, GAME_A, 'set-a', 'run-a', 'Shared Name', TS);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = createRun(first.store, GAME_A, 'set-a', 'run-b', 'Shared Name', TS2);
    expect(second.success).toBe(true);
    if (!second.success) return;

    const runs = second.store.gameProgress['game-a'].sets['set-a'].runs;
    expect(runs['run-a'].name).toBe('Shared Name');
    expect(runs['run-b'].name).toBe('Shared Name');
  });

  it('does not carry any state from the previously active run', () => {
    const store = createDefaultHuntMemoryStore();
    const gameProgress = createDefaultGameProgressV3(GAME_A, TS);
    store.gameProgress['game-a'] = gameProgress;
    populateActiveRunState(gameProgress.sets['set-a'].runs[DEFAULT_HUNT_MEMORY_RUN_ID], TS);

    const result = createRun(store, GAME_A, 'set-a', 'fresh-run', 'Fresh Run', TS2);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const freshRun = result.store.gameProgress['game-a'].sets['set-a'].runs['fresh-run'];
    expect(freshRun.pinnedAchievementIds).toEqual([]);
    expect('activeStage' in freshRun).toBe(false);
    expect(freshRun.orphanedProgress).toEqual({});
    expect(freshRun.progress['ach-binary']).toEqual(freshBinaryProgress('ach-binary', TS2));
    expect(freshRun.progress['ach-counter-bounded']).toEqual({
      achievementId: 'ach-counter-bounded',
      completed: false,
      manualOverride: false,
      counter: { certainty: 'exact', value: 0 },
      lastUpdated: TS2,
      provenance: 'manual',
    });

    const priorRun = store.gameProgress['game-a'].sets['set-a'].runs[DEFAULT_HUNT_MEMORY_RUN_ID];
    expect(priorRun.progress['ach-binary'].completed).toBe(true);
    expect(priorRun.progress['ach-binary'].notes).toBe('carried note');
  });

  it('preserves every selection and unrelated ledger while creating a run', () => {
    const store = createPopulatedStore();
    const before = structuredClone(store);

    const result = createRun(store, GAME_A, 'set-a', 'fresh-run', 'Fresh Run', TS2);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const next = result.store;
    expect(next.lastGameId).toBe('game-a');
    expect(next.gameProgress['game-a'].preferredSetId).toBe('set-a');
    expect(next.gameProgress['game-a'].retiredSets).toEqual(
      before.gameProgress['game-a'].retiredSets,
    );
    expect(next.gameProgress['game-a'].sets['set-b']).toEqual(
      before.gameProgress['game-a'].sets['set-b'],
    );
    expect(next.gameProgress['game-a'].sets['set-a'].runs[DEFAULT_HUNT_MEMORY_RUN_ID]).toEqual(
      before.gameProgress['game-a'].sets['set-a'].runs[DEFAULT_HUNT_MEMORY_RUN_ID],
    );
    expect(next.gameProgress['game-a'].sets['set-a'].runs['second-run']).toEqual(
      before.gameProgress['game-a'].sets['set-a'].runs['second-run'],
    );
    expect(next.gameProgress['game-b']).toEqual(before.gameProgress['game-b']);
    expect(next.undoState).toEqual(before.undoState);
    expect(next.gameProgress['game-a'].sets['set-a'].activeRunId).toBe('fresh-run');
    expect(store).toEqual(before);

    expect(LocalProgressStoreV3Schema.safeParse(next).success).toBe(true);
  });

  it('returns every create-run failure code and leaves the input deeply unchanged', () => {
    const store = createPopulatedStore();
    const before = structuredClone(store);

    const cases = [
      { args: [GAME_A, 'set-a', '   ', 'Run', TS2], code: 'INVALID_RUN_ID' },
      { args: [GAME_A, 'set-a', 'run', '   ', TS2], code: 'INVALID_RUN_NAME' },
      { args: [GAME_A, 'set-a', 'run', 'Run', 'invalid'], code: 'INVALID_TIMESTAMP' },
      { args: [GAME_MISSING, 'set-x', 'run', 'Run', TS2], code: 'GAME_NOT_FOUND' },
      { args: [GAME_A, 'retired-set', 'run', 'Run', TS2], code: 'SET_RETIRED' },
      { args: [GAME_A, 'missing-set', 'run', 'Run', TS2], code: 'SET_NOT_FOUND' },
      { args: [GAME_A, 'set-a', DEFAULT_HUNT_MEMORY_RUN_ID, 'Run', TS2], code: 'DUPLICATE_RUN_ID' },
    ] as const;

    for (const failure of cases) {
      const result = createRun(
        store,
        failure.args[0],
        failure.args[1],
        failure.args[2],
        failure.args[3],
        failure.args[4],
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe(failure.code);
      expect('store' in result).toBe(false);
      expect(store).toEqual(before);
    }
  });

  it('returns SET_NOT_FOUND when an active stored set has no matching current definition', () => {
    const store = createDefaultHuntMemoryStore();
    store.gameProgress['game-a'] = createDefaultGameProgressV3(GAME_A, TS);

    const gameWithoutSet = game('game-a', [SET_B]);
    const before = structuredClone(store);
    const result = createRun(store, gameWithoutSet, 'set-a', 'run', 'Run', TS);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe('SET_NOT_FOUND');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns typed failures for missing prototype-sensitive game, set, retired-set, and run keys', () => {
    const store = createPopulatedStore();
    const before = structuredClone(store);

    for (const id of PROTOTYPE_SENSITIVE_IDS) {
      const missingGame = game(id, [SET_A]);
      const createMissingGame = createRun(
        store,
        missingGame,
        'set-a',
        'new-run',
        'New Run',
        TS2,
      );
      expect(createMissingGame).toMatchObject({
        success: false,
        code: 'GAME_NOT_FOUND',
      });
      expect('store' in createMissingGame).toBe(false);

      const selectMissingGame = selectRun(store, id, 'set-a', 'new-run');
      expect(selectMissingGame).toMatchObject({
        success: false,
        code: 'GAME_NOT_FOUND',
      });
      expect('store' in selectMissingGame).toBe(false);

      const createMissingSet = createRun(
        store,
        GAME_A,
        id,
        'new-run',
        'New Run',
        TS2,
      );
      expect(createMissingSet).toMatchObject({
        success: false,
        code: 'SET_NOT_FOUND',
      });
      expect('store' in createMissingSet).toBe(false);

      const selectMissingSet = selectRun(store, 'game-a', id, 'new-run');
      expect(selectMissingSet).toMatchObject({
        success: false,
        code: 'SET_NOT_FOUND',
      });
      expect('store' in selectMissingSet).toBe(false);

      const selectMissingRun = selectRun(store, 'game-a', 'set-a', id);
      expect(selectMissingRun).toMatchObject({
        success: false,
        code: 'RUN_NOT_FOUND',
      });
      expect('store' in selectMissingRun).toBe(false);
    }

    expect(store).toEqual(before);
  });

  it('creates and selects owned constructor and toString run IDs without prototype mutation', () => {
    let store = createPopulatedStore();
    const unrelatedObject = {};

    for (const runId of ['constructor', 'toString'] as const) {
      const before = structuredClone(store);
      const previousRunIds = Object.keys(
        store.gameProgress['game-a'].sets['set-a'].runs,
      );
      const created = createRun(
        store,
        GAME_A,
        'set-a',
        runId,
        `Run ${runId}`,
        TS2,
      );
      expect(created.success).toBe(true);
      if (!created.success) {
        throw new Error(`Expected run '${runId}' to be created`);
      }

      expect(store).toEqual(before);
      expect(created.store.undoState).toEqual(before.undoState);
      const createdRuns = created.store.gameProgress['game-a'].sets['set-a'].runs;
      expect(Object.keys(createdRuns)).toEqual([...previousRunIds, runId]);
      expect(Object.hasOwn(createdRuns, runId)).toBe(true);
      expect(createdRuns[runId].runId).toBe(runId);
      expect(Object.getPrototypeOf(createdRuns)).toBe(Object.prototype);
      expect(LocalProgressStoreV3Schema.safeParse(created.store).success).toBe(
        true,
      );

      const duplicate = createRun(
        created.store,
        GAME_A,
        'set-a',
        runId,
        'Duplicate ID',
        TS2,
      );
      expect(duplicate).toMatchObject({
        success: false,
        code: 'DUPLICATE_RUN_ID',
      });
      expect('store' in duplicate).toBe(false);

      const selectedDefault = selectRun(
        created.store,
        'game-a',
        'set-a',
        DEFAULT_HUNT_MEMORY_RUN_ID,
      );
      expect(selectedDefault.success).toBe(true);
      if (!selectedDefault.success) {
        throw new Error('Expected the default run to remain selectable');
      }

      const selected = selectRun(
        selectedDefault.store,
        'game-a',
        'set-a',
        runId,
      );
      expect(selected.success).toBe(true);
      if (!selected.success) {
        throw new Error(`Expected run '${runId}' to be selectable`);
      }

      expect(
        selectedDefault.store.gameProgress['game-a'].sets['set-a'].activeRunId,
      ).toBe(DEFAULT_HUNT_MEMORY_RUN_ID);
      expect(
        selected.store.gameProgress['game-a'].sets['set-a'].activeRunId,
      ).toBe(runId);
      expect(selected.store.undoState).toEqual(before.undoState);
      expect(
        Object.getPrototypeOf(
          selected.store.gameProgress['game-a'].sets['set-a'].runs,
        ),
      ).toBe(Object.prototype);
      expect(LocalProgressStoreV3Schema.safeParse(selected.store).success).toBe(
        true,
      );

      store = selected.store;
    }

    expect(Object.getPrototypeOf(unrelatedObject)).toBe(Object.prototype);
    expect('runId' in unrelatedObject).toBe(false);
    expect('name' in unrelatedObject).toBe(false);
    expect('createdAt' in unrelatedObject).toBe(false);
  });

  it('returns INVALID_RUN_ID for the reserved run ID without mutation, store leak, or prototype pollution', () => {
    const store = createPopulatedStore();
    const before = structuredClone(store);
    const unrelatedObject = {};

    const result = createRun(
      store,
      GAME_A,
      'set-a',
      '__proto__',
      'Reserved Run',
      TS2,
    );

    expect(result).toEqual({
      success: false,
      code: 'INVALID_RUN_ID',
      message: "Run ID '__proto__' is reserved and cannot be used",
    });
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
    expect(Object.getPrototypeOf(unrelatedObject)).toBe(Object.prototype);
    expect('runId' in unrelatedObject).toBe(false);
  });

  it('switches the active run changing only activeRunId and preserving undo and all other state', () => {
    const store = createPopulatedStore();
    const before = structuredClone(store);

    const result = selectRun(store, 'game-a', 'set-a', 'second-run');
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.runId).toBe('second-run');
    const next = result.store;
    expect(next.gameProgress['game-a'].sets['set-a'].activeRunId).toBe('second-run');
    expect(next.undoState).toEqual(before.undoState);
    expect(next.gameProgress['game-a'].sets['set-a'].runs).toEqual(
      before.gameProgress['game-a'].sets['set-a'].runs,
    );
    expect(next.gameProgress['game-a'].retiredSets).toEqual(
      before.gameProgress['game-a'].retiredSets,
    );
    expect(next.gameProgress['game-a'].preferredSetId).toBe('set-a');
    expect(next.lastGameId).toBe('game-a');
    expect(next.gameProgress['game-b']).toEqual(before.gameProgress['game-b']);
    expect(store).toEqual(before);
    expect(LocalProgressStoreV3Schema.safeParse(next).success).toBe(true);
  });

  it('returns the original store reference when selecting the already active run', () => {
    const store = createPopulatedStore();
    const result = selectRun(store, 'game-a', 'set-a', DEFAULT_HUNT_MEMORY_RUN_ID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.store).toBe(store);
    expect(result.runId).toBe(DEFAULT_HUNT_MEMORY_RUN_ID);
  });

  it('returns every select-run failure code without exposing a store', () => {
    const store = createPopulatedStore();

    const cases = [
      { gameId: 'missing-game', setId: 'set-a', runId: 'run', code: 'GAME_NOT_FOUND' },
      { gameId: 'game-a', setId: 'retired-set', runId: 'run', code: 'SET_RETIRED' },
      { gameId: 'game-a', setId: 'missing-set', runId: 'run', code: 'SET_NOT_FOUND' },
      { gameId: 'game-a', setId: 'set-a', runId: 'missing-run', code: 'RUN_NOT_FOUND' },
    ] as const;

    for (const failure of cases) {
      const result = selectRun(store, failure.gameId, failure.setId, failure.runId);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe(failure.code);
      expect('store' in result).toBe(false);
    }
  });

  it('allows the same runId in different sets', () => {
    const store = createDefaultHuntMemoryStore();
    store.gameProgress['game-a'] = createDefaultGameProgressV3(GAME_A, TS);

    const first = createRun(store, GAME_A, 'set-a', 'shared-run', 'Shared', TS);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = createRun(first.store, GAME_A, 'set-b', 'shared-run', 'Shared', TS2);
    expect(second.success).toBe(true);
    if (!second.success) return;

    expect(second.store.gameProgress['game-a'].sets['set-a'].runs['shared-run']).toBeDefined();
    expect(second.store.gameProgress['game-a'].sets['set-b'].runs['shared-run']).toBeDefined();
    expect(
      second.store.gameProgress['game-a'].sets['set-a'].runs['shared-run'],
    ).not.toBe(second.store.gameProgress['game-a'].sets['set-b'].runs['shared-run']);
    expect(second.store.gameProgress['game-a'].sets['set-a'].activeRunId).toBe('shared-run');
    expect(second.store.gameProgress['game-a'].sets['set-b'].activeRunId).toBe('shared-run');
  });

  it('builds a run ledger type directly through createDefaultRunProgress', () => {
    const run = createDefaultRunProgress(SET_A, 'direct-run', 'Direct Run', TS);
    expect(run.runId).toBe('direct-run');
    expect(run.name).toBe('Direct Run');
    expect(run.createdAt).toBe(TS);
    expect(run.pinnedAchievementIds).toEqual([]);
    expect(run.orphanedProgress).toEqual({});
    expect(Object.keys(run.progress).sort()).toEqual([
      'ach-binary',
      'ach-checklist',
      'ach-counter-bounded',
      'ach-counter-open',
    ]);
    expect(RunProgressSchema.safeParse(run).success).toBe(true);

    const before = structuredClone(SET_A);
    expect(() =>
      createDefaultRunProgress(SET_A, '   ', 'Direct Run', TS),
    ).toThrowError('Run ID must contain at least one non-whitespace character');
    expect(() =>
      createDefaultRunProgress(SET_A, '__proto__', 'Direct Run', TS),
    ).toThrowError("Run ID '__proto__' is reserved and cannot be used");
    expect(() =>
      createDefaultRunProgress(SET_A, 'direct-run', '   ', TS),
    ).toThrowError('Run name must contain at least one non-whitespace character');
    expect(SET_A).toEqual(before);
  });
});
