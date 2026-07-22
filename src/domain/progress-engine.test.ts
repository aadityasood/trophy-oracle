import { describe, expect, it } from 'vitest';
import rawDemoGames from '../../data/source-of-truth/demo-games.json';
import { validateDemoGamesDataset } from './achievement-schema';
import type { AchievementRecord, GameRecord } from './achievement-schema';
import {
  computeDerivedCompletion,
  createDefaultAchievementProgress,
  createDefaultAchievementSetProgress,
  createDefaultGameProgress,
  createDefaultLocalProgressStore,
  ensureGameAndSetInitialized,
  getSetCompletionSummary,
  reconcileGameProgress,
  selectGame,
  selectPreferredSet,
  setActiveStage,
  setBinaryCompletion,
  setChecklistItemCompletion,
  setCompletionOverride,
  setCounterValue,
  setNotes,
  togglePin,
  undoLastMutation,
} from './progress-engine';
import type { MutationResult } from './progress-engine';
import {
  CURRENT_STORE_SCHEMA_VERSION,
  ReconciliationDeltaReportSchema,
} from './progress-schema';
import type { LocalProgressStore } from './progress-schema';
import {
  mockGameMythHarbor,
  mockGameStellarDrift,
  MOCK_TIMESTAMP,
  MOCK_TIMESTAMP_2,
} from '../test/progress-fixtures';

function expectChanged(result: MutationResult): LocalProgressStore {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  expect(result.changed).toBe(true);
  return result.store;
}

function expectNoChange(
  result: MutationResult,
  original: LocalProgressStore,
): void {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  expect(result.changed).toBe(false);
  expect(result.store).toBe(original);
}

function asLocalProgressStore(value: unknown): LocalProgressStore {
  return value as LocalProgressStore;
}

function cloneGame(game: GameRecord): GameRecord {
  return structuredClone(game);
}

function getAchievement(game: GameRecord, achievementId: string): AchievementRecord {
  const achievement = game.achievementSets
    .flatMap((achievementSet) => achievementSet.achievements)
    .find((candidate) => candidate.id === achievementId);
  if (!achievement) throw new Error(`Missing fixture achievement ${achievementId}`);
  return achievement;
}

describe('progress engine defaults, selection, and mutation behavior', () => {
  it('uses the real fictional dataset without mutating trusted input', () => {
    const loaded = validateDemoGamesDataset(rawDemoGames);
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    const game = loaded.data.games[0];
    const before = structuredClone(game);
    const achievementSet = game.achievementSets[0];
    const achievement = achievementSet.achievements[0];
    const initialStore = createDefaultLocalProgressStore();
    const initialStoreBefore = structuredClone(initialStore);

    const result = setBinaryCompletion(
      initialStore,
      game,
      achievementSet.id,
      achievement.id,
      true,
      MOCK_TIMESTAMP,
    );

    expect(result.success).toBe(true);
    expect(game).toEqual(before);
    expect(initialStore).toEqual(initialStoreBefore);
    if (result.success) expect(result.store).not.toBe(initialStore);
  });

  it('creates exact defaults for binary, bounded counter, open counter, and checklist', () => {
    const binary = createDefaultAchievementProgress(
      getAchievement(mockGameStellarDrift, 'sd-ps-001'),
      MOCK_TIMESTAMP,
    );
    expect(binary).toEqual({
      achievementId: 'sd-ps-001',
      completed: false,
      manualOverride: false,
      lastUpdated: MOCK_TIMESTAMP,
      provenance: 'manual',
    });

    const bounded = createDefaultAchievementProgress(
      getAchievement(mockGameStellarDrift, 'sd-ps-004'),
      MOCK_TIMESTAMP,
    );
    const open = createDefaultAchievementProgress(
      getAchievement(mockGameStellarDrift, 'sd-ps-006'),
      MOCK_TIMESTAMP,
    );
    expect(bounded.counterValue).toBe(0);
    expect(open.counterValue).toBe(0);

    const checklist = createDefaultAchievementProgress(
      getAchievement(mockGameStellarDrift, 'sd-ps-005'),
      MOCK_TIMESTAMP,
    );
    expect(checklist.checklistCompletion).toEqual({
      'task-a': false,
      'task-b': false,
      'task-c': false,
    });

    const gameProgress = createDefaultGameProgress(
      mockGameStellarDrift,
      MOCK_TIMESTAMP,
    );
    expect(gameProgress.preferredSetId).toBeUndefined();
    expect(() =>
      createDefaultGameProgress(mockGameStellarDrift, 'invalid'),
    ).toThrow('Invalid ISO-8601 UTC timestamp');
  });

  it('derives bounded, open-counter, checklist, and override completion exactly', () => {
    const boundedDefinition = getAchievement(
      mockGameStellarDrift,
      'sd-ps-004',
    );
    const bounded = createDefaultAchievementProgress(
      boundedDefinition,
      MOCK_TIMESTAMP,
    );
    expect(
      computeDerivedCompletion(boundedDefinition, {
        ...bounded,
        counterValue: 47,
      }),
    ).toBe(false);
    expect(
      computeDerivedCompletion(boundedDefinition, {
        ...bounded,
        counterValue: 48,
      }),
    ).toBe(true);
    expect(
      computeDerivedCompletion(boundedDefinition, {
        ...bounded,
        counterValue: 49,
      }),
    ).toBe(true);

    const openDefinition = getAchievement(mockGameStellarDrift, 'sd-ps-006');
    const open = createDefaultAchievementProgress(openDefinition, MOCK_TIMESTAMP);
    expect(
      computeDerivedCompletion(openDefinition, { ...open, counterValue: 999 }),
    ).toBe(false);
    expect(
      computeDerivedCompletion(openDefinition, {
        ...open,
        counterValue: 0,
        manualOverride: true,
      }),
    ).toBe(true);

    const binaryDefinition = getAchievement(
      mockGameStellarDrift,
      'sd-ps-001',
    );
    const binary = createDefaultAchievementProgress(
      binaryDefinition,
      MOCK_TIMESTAMP,
    );
    expect(
      computeDerivedCompletion(binaryDefinition, {
        ...binary,
        manualOverride: true,
      }),
    ).toBe(false);

    const checklistDefinition = getAchievement(
      mockGameStellarDrift,
      'sd-ps-005',
    );
    const checklist = createDefaultAchievementProgress(
      checklistDefinition,
      MOCK_TIMESTAMP,
    );
    expect(
      computeDerivedCompletion(checklistDefinition, {
        ...checklist,
        checklistCompletion: {
          'task-a': true,
          'task-b': true,
          'task-c': false,
        },
      }),
    ).toBe(false);
    expect(
      computeDerivedCompletion(checklistDefinition, {
        ...checklist,
        checklistCompletion: {
          'task-a': true,
          'task-b': true,
          'task-c': true,
        },
      }),
    ).toBe(true);
  });

  it('selects valid uninitialized games and sets without creating undo or a cross-set preference', () => {
    const initial = createDefaultLocalProgressStore();
    const selectedGame = selectGame(
      initial,
      mockGameStellarDrift,
      MOCK_TIMESTAMP,
    );
    expect(selectedGame.lastGameId).toBe('stellar-drift');
    expect(selectedGame.gameProgress['stellar-drift']).toBeDefined();
    expect(
      selectedGame.gameProgress['stellar-drift'].preferredSetId,
    ).toBeUndefined();
    expect(selectedGame.undoState).toBeUndefined();

    const selectedSet = selectPreferredSet(
      initial,
      mockGameStellarDrift,
      'stellar-drift-steam',
      MOCK_TIMESTAMP,
    );
    expect(
      selectedSet.gameProgress['stellar-drift'].preferredSetId,
    ).toBe('stellar-drift-steam');
    expect(
      selectedSet.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-001'].completed,
    ).toBe(false);
    expect(selectedSet.undoState).toBeUndefined();

    const clearedSet = selectPreferredSet(
      selectedSet,
      mockGameStellarDrift,
      undefined,
    );
    expect(
      Object.hasOwn(
        clearedSet.gameProgress['stellar-drift'],
        'preferredSetId',
      ),
    ).toBe(false);
    const clearedGame = selectGame(selectedGame, undefined);
    expect(Object.hasOwn(clearedGame, 'lastGameId')).toBe(false);
    expect(clearedGame.undoState).toBeUndefined();
  });

  it('leaves selection unchanged for invalid sets or timestamps before initialization', () => {
    const initial = createDefaultLocalProgressStore();
    expect(
      selectGame(initial, mockGameStellarDrift, 'invalid'),
    ).toBe(initial);
    expect(
      selectPreferredSet(
        initial,
        mockGameStellarDrift,
        'missing-set',
        MOCK_TIMESTAMP,
      ),
    ).toBe(initial);
    expect(
      selectPreferredSet(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'invalid',
      ),
    ).toBe(initial);
    expect(initial.gameProgress).toEqual({});
  });

  it('supports valid mutations and rejects wrong modes, values, items, and timestamps', () => {
    let store = createDefaultLocalProgressStore();
    store = expectChanged(
      setBinaryCompletion(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      setCounterValue(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        48,
        MOCK_TIMESTAMP_2,
      ),
    );
    expect(
      store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress[
        'sd-ps-004'
      ].completed,
    ).toBe(true);
    store = expectChanged(
      setChecklistItemCompletion(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-005',
        'task-a',
        true,
        MOCK_TIMESTAMP_2,
      ),
    );
    store = expectChanged(
      setNotes(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        'note',
        MOCK_TIMESTAMP_2,
      ),
    );
    store = expectChanged(
      setCompletionOverride(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-006',
        true,
        MOCK_TIMESTAMP_2,
      ),
    );
    store = expectChanged(
      togglePin(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP_2,
      ),
    );
    store = expectChanged(
      setActiveStage(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'missables',
        MOCK_TIMESTAMP_2,
      ),
    );

    expect(
      setBinaryCompletion(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        true,
        MOCK_TIMESTAMP,
      ).success,
    ).toBe(false);
    expect(
      setCounterValue(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        -1,
        MOCK_TIMESTAMP,
      ).success,
    ).toBe(false);
    expect(
      setChecklistItemCompletion(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-005',
        'missing-item',
        true,
        MOCK_TIMESTAMP,
      ).success,
    ).toBe(false);
    expect(
      setCompletionOverride(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ).success,
    ).toBe(false);
    expect(
      setNotes(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        'invalid timestamp',
        'invalid',
      ).success,
    ).toBe(false);
    expect(
      setBinaryCompletion(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        false,
        'invalid',
      ).success,
    ).toBe(false);
  });

  it('enforces five distinct pins and preserves no-op identity', () => {
    let store = createDefaultLocalProgressStore();
    const pinIds = [
      'sd-ps-001',
      'sd-ps-002',
      'sd-ps-004',
      'sd-ps-005',
      'sd-ps-006',
    ];
    pinIds.forEach((achievementId) => {
      store = expectChanged(
        togglePin(
          store,
          mockGameStellarDrift,
          'stellar-drift-ps',
          achievementId,
          true,
          MOCK_TIMESTAMP,
        ),
      );
    });

    expectNoChange(
      togglePin(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP_2,
      ),
      store,
    );
    expect(
      togglePin(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-007',
        true,
        MOCK_TIMESTAMP_2,
      ).success,
    ).toBe(false);
  });

  it('treats every mutation class as a no-op only when its effective state is unchanged', () => {
    const initial = createDefaultLocalProgressStore();
    expectNoChange(
      setBinaryCompletion(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        false,
        MOCK_TIMESTAMP,
      ),
      initial,
    );
    expectNoChange(
      setCounterValue(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        0,
        MOCK_TIMESTAMP,
      ),
      initial,
    );
    expectNoChange(
      setChecklistItemCompletion(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-005',
        'task-a',
        false,
        MOCK_TIMESTAMP,
      ),
      initial,
    );
    expectNoChange(
      setNotes(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        undefined,
        MOCK_TIMESTAMP,
      ),
      initial,
    );
    expectNoChange(
      setCompletionOverride(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        false,
        MOCK_TIMESTAMP,
      ),
      initial,
    );
    expectNoChange(
      togglePin(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        false,
        MOCK_TIMESTAMP,
      ),
      initial,
    );
    expectNoChange(
      setActiveStage(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        undefined,
        MOCK_TIMESTAMP,
      ),
      initial,
    );

    expect(
      togglePin(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'missing-achievement',
        true,
        MOCK_TIMESTAMP,
      ).success,
    ).toBe(false);
    expect(
      setActiveStage(
        initial,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'story',
        'invalid',
      ).success,
    ).toBe(false);
  });

  it('creates a fully initialized restorable snapshot for every mutation class', () => {
    const baseline = createDefaultAchievementSetProgress(
      mockGameStellarDrift.achievementSets[0],
      MOCK_TIMESTAMP,
    );
    const mutations: Array<(store: LocalProgressStore) => MutationResult> = [
      (store) =>
        setBinaryCompletion(
          store,
          mockGameStellarDrift,
          'stellar-drift-ps',
          'sd-ps-001',
          true,
          MOCK_TIMESTAMP,
        ),
      (store) =>
        setCounterValue(
          store,
          mockGameStellarDrift,
          'stellar-drift-ps',
          'sd-ps-004',
          1,
          MOCK_TIMESTAMP,
        ),
      (store) =>
        setChecklistItemCompletion(
          store,
          mockGameStellarDrift,
          'stellar-drift-ps',
          'sd-ps-005',
          'task-a',
          true,
          MOCK_TIMESTAMP,
        ),
      (store) =>
        setNotes(
          store,
          mockGameStellarDrift,
          'stellar-drift-ps',
          'sd-ps-001',
          'note',
          MOCK_TIMESTAMP,
        ),
      (store) =>
        setCompletionOverride(
          store,
          mockGameStellarDrift,
          'stellar-drift-ps',
          'sd-ps-006',
          true,
          MOCK_TIMESTAMP,
        ),
      (store) =>
        togglePin(
          store,
          mockGameStellarDrift,
          'stellar-drift-ps',
          'sd-ps-001',
          true,
          MOCK_TIMESTAMP,
        ),
      (store) =>
        setActiveStage(
          store,
          mockGameStellarDrift,
          'stellar-drift-ps',
          'story',
          MOCK_TIMESTAMP,
        ),
    ];

    mutations.forEach((mutate) => {
      const changedStore = expectChanged(
        mutate(createDefaultLocalProgressStore()),
      );
      expect(
        changedStore.undoState?.['stellar-drift']?.previous,
      ).toEqual(baseline);
      const undo = undoLastMutation(changedStore, 'stellar-drift');
      expect(undo.success).toBe(true);
      if (!undo.success) return;
      expect(
        undo.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'],
      ).toEqual(baseline);
      expect(undo.store.undoState).toBeUndefined();
    });
  });

  it('preserves the prior undo snapshot across failures and effective no-ops', () => {
    const changedStore = expectChanged(
      setBinaryCompletion(
        createDefaultLocalProgressStore(),
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    const snapshot = structuredClone(changedStore.undoState);

    expectNoChange(
      setBinaryCompletion(
        changedStore,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP_2,
      ),
      changedStore,
    );
    expect(
      setCounterValue(
        changedStore,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        -1,
        MOCK_TIMESTAMP_2,
      ).success,
    ).toBe(false);
    expect(
      setNotes(
        changedStore,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'missing-achievement',
        'note',
        MOCK_TIMESTAMP_2,
      ).success,
    ).toBe(false);
    expect(changedStore.undoState).toEqual(snapshot);
  });

  it('normalizes corrupted binary override state as an undoable effective change', () => {
    const initialized = ensureGameAndSetInitialized(
      createDefaultLocalProgressStore(),
      mockGameStellarDrift,
      'stellar-drift-ps',
      MOCK_TIMESTAMP,
    );
    const corrupted = structuredClone(initialized);
    corrupted.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress[
      'sd-ps-001'
    ].manualOverride = true;

    const normalized = setBinaryCompletion(
      corrupted,
      mockGameStellarDrift,
      'stellar-drift-ps',
      'sd-ps-001',
      false,
      MOCK_TIMESTAMP_2,
    );
    expect(normalized.success).toBe(true);
    if (!normalized.success) return;
    expect(normalized.changed).toBe(true);
    expect(
      normalized.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-001'].manualOverride,
    ).toBe(false);
    expect(
      normalized.store.undoState?.['stellar-drift']?.previous.progress[
        'sd-ps-001'
      ].manualOverride,
    ).toBe(true);
  });

  it('preserves exact optional-property presence through snapshot cloning and undo', () => {
    const store = ensureGameAndSetInitialized(
      createDefaultLocalProgressStore(),
      mockGameStellarDrift,
      'stellar-drift-ps',
      MOCK_TIMESTAMP,
    );
    const progress =
      store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress[
        'sd-ps-001'
      ];
    progress.notes = undefined;
    expect(Object.hasOwn(progress, 'notes')).toBe(true);

    const changed = expectChanged(
      setNotes(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        'temporary',
        MOCK_TIMESTAMP_2,
      ),
    );
    const undo = undoLastMutation(changed, 'stellar-drift');
    expect(undo.success).toBe(true);
    if (!undo.success) return;
    const restored =
      undo.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-001'];
    expect(Object.hasOwn(restored, 'notes')).toBe(true);
    expect(restored.notes).toBeUndefined();
  });

  it('repairs stale derived completion instead of classifying it as a no-op', () => {
    const store = ensureGameAndSetInitialized(
      createDefaultLocalProgressStore(),
      mockGameStellarDrift,
      'stellar-drift-ps',
      MOCK_TIMESTAMP,
    );
    store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress[
      'sd-ps-004'
    ].counterValue = 48;
    store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress[
      'sd-ps-004'
    ].completed = false;

    const counter = setCounterValue(
      store,
      mockGameStellarDrift,
      'stellar-drift-ps',
      'sd-ps-004',
      48,
      MOCK_TIMESTAMP_2,
    );
    expect(counter.success).toBe(true);
    if (!counter.success) return;
    expect(counter.changed).toBe(true);
    expect(
      counter.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-004'].completed,
    ).toBe(true);

    const checklistStore = ensureGameAndSetInitialized(
      createDefaultLocalProgressStore(),
      mockGameStellarDrift,
      'stellar-drift-ps',
      MOCK_TIMESTAMP,
    );
    const checklistProgress =
      checklistStore.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-005'];
    checklistProgress.checklistCompletion = {
      'task-a': true,
      'task-b': true,
      'task-c': true,
    };
    checklistProgress.completed = false;
    const checklist = setChecklistItemCompletion(
      checklistStore,
      mockGameStellarDrift,
      'stellar-drift-ps',
      'sd-ps-005',
      'task-a',
      true,
      MOCK_TIMESTAMP_2,
    );
    expect(checklist.success).toBe(true);
    if (checklist.success) expect(checklist.changed).toBe(true);
  });

  it('clears counter and checklist overrides by recomputing tracker completion', () => {
    let store = expectChanged(
      setCompletionOverride(
        createDefaultLocalProgressStore(),
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      setCompletionOverride(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        false,
        MOCK_TIMESTAMP_2,
      ),
    );
    expect(
      store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress[
        'sd-ps-004'
      ],
    ).toMatchObject({ manualOverride: false, completed: false });

    store = expectChanged(
      setCompletionOverride(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-005',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      setCompletionOverride(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-005',
        false,
        MOCK_TIMESTAMP_2,
      ),
    );
    expect(
      store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress[
        'sd-ps-005'
      ],
    ).toMatchObject({ manualOverride: false, completed: false });
  });

  it('returns a typed failure for missing active progress without disturbing state', () => {
    const store = ensureGameAndSetInitialized(
      createDefaultLocalProgressStore(),
      mockGameStellarDrift,
      'stellar-drift-ps',
      MOCK_TIMESTAMP,
    );
    const staleStore = structuredClone(store);
    delete staleStore.gameProgress['stellar-drift'].sets['stellar-drift-ps']
      .progress['sd-ps-001'];
    const before = structuredClone(staleStore);

    const result = setBinaryCompletion(
      staleStore,
      mockGameStellarDrift,
      'stellar-drift-ps',
      'sd-ps-001',
      true,
      MOCK_TIMESTAMP_2,
    );
    expect(result.success).toBe(false);
    expect(staleStore).toEqual(before);
  });

  it('replaces same-game cross-set undo and preserves different-game undo independently', () => {
    let store = expectChanged(
      setBinaryCompletion(
        createDefaultLocalProgressStore(),
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = selectPreferredSet(
      store,
      mockGameStellarDrift,
      'stellar-drift-steam',
      MOCK_TIMESTAMP,
    );
    expect(store.undoState?.['stellar-drift']?.setId).toBe('stellar-drift-ps');
    store = expectChanged(
      setBinaryCompletion(
        store,
        mockGameStellarDrift,
        'stellar-drift-steam',
        'sd-steam-001',
        true,
        MOCK_TIMESTAMP_2,
      ),
    );
    expect(store.undoState?.['stellar-drift']?.setId).toBe(
      'stellar-drift-steam',
    );

    store = expectChanged(
      setBinaryCompletion(
        store,
        mockGameMythHarbor,
        'myth-harbor-ps',
        'mh-ps-001',
        true,
        MOCK_TIMESTAMP_2,
      ),
    );
    expect(Object.keys(store.undoState ?? {}).sort()).toEqual([
      'myth-harbor',
      'stellar-drift',
    ]);

    const undo = undoLastMutation(store, 'stellar-drift');
    expect(undo.success).toBe(true);
    if (!undo.success) return;
    expect(undo.store.undoState?.['myth-harbor']).toBeDefined();
    expect(
      undo.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-001'].completed,
    ).toBe(true);
  });

  it('refuses undo when its target set is no longer active', () => {
    const setProgress = createDefaultAchievementSetProgress(
      mockGameStellarDrift.achievementSets[1],
      MOCK_TIMESTAMP,
    );
    const store: LocalProgressStore = {
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        'stellar-drift': {
          gameId: 'stellar-drift',
          sets: {
            'stellar-drift-ps': createDefaultAchievementSetProgress(
              mockGameStellarDrift.achievementSets[0],
              MOCK_TIMESTAMP,
            ),
          },
          orphanedProgress: {},
        },
      },
      undoState: {
        'stellar-drift': {
          setId: 'stellar-drift-steam',
          previous: setProgress,
        },
      },
    };
    const result = undoLastMutation(store, 'stellar-drift');
    expect(result.success).toBe(false);
    expect(store.undoState?.['stellar-drift']).toBeDefined();
  });

  it('scopes completion summaries to the explicit game and active set, excluding orphans', () => {
    const collidingGame = cloneGame(mockGameStellarDrift);
    collidingGame.id = 'another-game';
    let store = expectChanged(
      setBinaryCompletion(
        createDefaultLocalProgressStore(),
        collidingGame,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = ensureGameAndSetInitialized(
      store,
      mockGameStellarDrift,
      'stellar-drift-ps',
      MOCK_TIMESTAMP,
    );
    store.gameProgress['stellar-drift'].orphanedProgress['stellar-drift-ps'] = {
      orphan: {
        achievementId: 'orphan',
        completed: true,
        manualOverride: false,
        lastUpdated: MOCK_TIMESTAMP,
        provenance: 'manual',
        trackingModeAtRemoval: 'binary',
      },
    };

    const summary = getSetCompletionSummary(
      store,
      'stellar-drift',
      mockGameStellarDrift.achievementSets[0],
    );
    expect(summary).toEqual({
      totalCount: 6,
      completedCount: 0,
      fraction: 0,
    });
  });
});

describe('progress reconciliation', () => {
  it('reconciles surviving and removed sets with complete deltas, pin repair, selection clearing, and undo clearing', () => {
    const previousGame = cloneGame(mockGameStellarDrift);
    let store = expectChanged(
      setBinaryCompletion(
        createDefaultLocalProgressStore(),
        previousGame,
        'stellar-drift-steam',
        'sd-steam-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      togglePin(
        store,
        previousGame,
        'stellar-drift-steam',
        'sd-steam-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      togglePin(
        store,
        previousGame,
        'stellar-drift-ps',
        'sd-ps-002',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      setChecklistItemCompletion(
        store,
        previousGame,
        'stellar-drift-ps',
        'sd-ps-005',
        'task-c',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = selectPreferredSet(
      store,
      previousGame,
      'stellar-drift-steam',
      MOCK_TIMESTAMP,
    );
    store = expectChanged(
      setBinaryCompletion(
        store,
        mockGameMythHarbor,
        'myth-harbor-ps',
        'mh-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    const inputBefore = structuredClone(store);

    const nextGame = cloneGame(previousGame);
    nextGame.version = '2026.07.23';
    const nextPlayStation = nextGame.achievementSets[0];
    nextPlayStation.version = '2026.07.23';
    nextPlayStation.achievements = nextPlayStation.achievements.filter(
      (achievement) => achievement.id !== 'sd-ps-002',
    );
    const checklist = nextPlayStation.achievements.find(
      (achievement) => achievement.id === 'sd-ps-005',
    );
    if (!checklist || checklist.tracking.mode !== 'checklist') {
      throw new Error('Checklist fixture unavailable');
    }
    checklist.tracking.items = [
      { id: 'task-a', name: 'Task A' },
      { id: 'task-b', name: 'Task B' },
      { id: 'task-d', name: 'Task D' },
    ];
    nextPlayStation.achievements.push({
      id: 'sd-ps-008',
      name: 'New Checklist',
      description: 'New checklist achievement',
      evidence: 'Fixture evidence',
      reward: { type: 'trophy', grade: 'bronze' },
      tracking: {
        mode: 'checklist',
        items: [
          { id: 'new-a', name: 'New A' },
          { id: 'new-b', name: 'New B' },
        ],
      },
      labels: ['grind'],
      expectedStage: 'cleanup',
      confidence: 1,
      prerequisites: [],
      spoilerSafeHint: 'Complete two new tasks.',
    });
    nextGame.achievementSets = [nextPlayStation];

    const result = reconcileGameProgress(
      store,
      previousGame,
      nextGame,
      MOCK_TIMESTAMP_2,
    );
    expect(store).toEqual(inputBefore);
    expect(result.report.clearedPreferredSetId).toBe('stellar-drift-steam');
    expect(result.report.clearedUndoSetId).toBe('stellar-drift-ps');

    const playStationDelta = result.report.setDeltas.find(
      (delta) => delta.setId === 'stellar-drift-ps',
    );
    expect(playStationDelta?.quarantinedAchievementIds).toContain('sd-ps-002');
    expect(playStationDelta?.removedPinnedAchievementIds).toContain('sd-ps-002');
    expect(playStationDelta?.addedAchievementIds).toContain('sd-ps-008');
    expect(playStationDelta?.addedChecklistItems).toEqual(
      expect.arrayContaining([
        { achievementId: 'sd-ps-005', itemIds: ['task-d'] },
        { achievementId: 'sd-ps-008', itemIds: ['new-a', 'new-b'] },
      ]),
    );
    expect(playStationDelta?.removedChecklistItems).toContainEqual({
      achievementId: 'sd-ps-005',
      itemIds: ['task-c'],
    });

    const steamDelta = result.report.setDeltas.find(
      (delta) => delta.setId === 'stellar-drift-steam',
    );
    expect(steamDelta?.quarantinedAchievementIds).toEqual(['sd-steam-001']);
    expect(steamDelta?.removedPinnedAchievementIds).toEqual(['sd-steam-001']);
    expect(result.store.gameProgress['stellar-drift'].sets['stellar-drift-steam']).toBeUndefined();
    expect(
      result.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].version,
    ).toBe('2026.07.23');
    expect(result.store.gameProgress['myth-harbor']).toEqual(
      inputBefore.gameProgress['myth-harbor'],
    );
    expect(result.store.undoState?.['myth-harbor']).toEqual(
      inputBefore.undoState?.['myth-harbor'],
    );
    expect(ReconciliationDeltaReportSchema.safeParse(result.report).success).toBe(
      true,
    );
  });

  it('preserves a version-conflicting surviving set and undo while reconciling an unrelated set', () => {
    const previousGame = cloneGame(mockGameStellarDrift);
    const store = expectChanged(
      setNotes(
        createDefaultLocalProgressStore(),
        previousGame,
        'stellar-drift-ps',
        'sd-ps-001',
        'preserve this state',
        MOCK_TIMESTAMP,
      ),
    );
    store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].version =
      'stored-2026.07.21';
    const inputBefore = structuredClone(store);
    const conflictingSetBefore = structuredClone(
      store.gameProgress['stellar-drift'].sets['stellar-drift-ps'],
    );
    const undoBefore = structuredClone(store.undoState?.['stellar-drift']);

    const nextGame = cloneGame(previousGame);
    nextGame.version = '2026.07.24';
    nextGame.achievementSets[0].version = 'next-playstation-version';
    nextGame.achievementSets[1].version = 'next-steam-version';

    const result = reconcileGameProgress(
      store,
      previousGame,
      nextGame,
      MOCK_TIMESTAMP_2,
    );

    expect(store).toEqual(inputBefore);
    expect(
      result.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'],
    ).toEqual(conflictingSetBefore);
    expect(result.store.undoState?.['stellar-drift']).toEqual(undoBefore);
    expect(result.report.clearedUndoSetId).toBeUndefined();
    expect(
      result.store.gameProgress['stellar-drift'].sets['stellar-drift-steam']
        .version,
    ).toBe('next-steam-version');

    const conflict = result.report.schemaConflicts.find((message) =>
      message.includes("Set 'stellar-drift-ps'"),
    );
    expect(conflict).toContain("stored version 'stored-2026.07.21'");
    expect(conflict).toContain(
      "supplied previous-definition version '2026.07.13'",
    );
    expect(
      result.report.setDeltas.find(
        (delta) => delta.setId === 'stellar-drift-ps',
      ),
    ).toEqual({
      setId: 'stellar-drift-ps',
      fromVersion: '2026.07.13',
      toVersion: 'next-playstation-version',
      addedAchievementIds: [],
      quarantinedAchievementIds: [],
      restoredOrphanedAchievementIds: [],
      addedChecklistItems: [],
      removedChecklistItems: [],
      removedPinnedAchievementIds: [],
    });
  });

  it('does not remove or clean related state when a removed set has a version conflict', () => {
    const previousGame = cloneGame(mockGameStellarDrift);
    const pinnedStore = expectChanged(
      togglePin(
        createDefaultLocalProgressStore(),
        previousGame,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    const notedStore = expectChanged(
      setNotes(
        pinnedStore,
        previousGame,
        'stellar-drift-ps',
        'sd-ps-001',
        'keep on removal conflict',
        MOCK_TIMESTAMP_2,
      ),
    );
    const store = selectPreferredSet(
      notedStore,
      previousGame,
      'stellar-drift-ps',
      MOCK_TIMESTAMP_2,
    );
    store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].version =
      'stored-removed-version';
    store.gameProgress['stellar-drift'].orphanedProgress[
      'stellar-drift-ps'
    ] = {
      'retired-same-set': {
        achievementId: 'retired-same-set',
        completed: true,
        manualOverride: false,
        lastUpdated: MOCK_TIMESTAMP,
        provenance: 'manual',
        trackingModeAtRemoval: 'binary',
      },
    };
    const inputBefore = structuredClone(store);
    const setBefore = structuredClone(
      store.gameProgress['stellar-drift'].sets['stellar-drift-ps'],
    );
    const orphansBefore = structuredClone(
      store.gameProgress['stellar-drift'].orphanedProgress[
        'stellar-drift-ps'
      ],
    );
    const undoBefore = structuredClone(store.undoState?.['stellar-drift']);

    const nextGame = cloneGame(previousGame);
    nextGame.version = '2026.07.24';
    nextGame.achievementSets = [nextGame.achievementSets[1]];

    const result = reconcileGameProgress(
      store,
      previousGame,
      nextGame,
      MOCK_TIMESTAMP_2,
    );

    expect(store).toEqual(inputBefore);
    expect(
      result.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'],
    ).toEqual(setBefore);
    expect(
      result.store.gameProgress['stellar-drift'].orphanedProgress[
        'stellar-drift-ps'
      ],
    ).toEqual(orphansBefore);
    expect(
      result.store.gameProgress['stellar-drift'].preferredSetId,
    ).toBe('stellar-drift-ps');
    expect(result.store.undoState?.['stellar-drift']).toEqual(undoBefore);
    expect(result.report.clearedPreferredSetId).toBeUndefined();
    expect(result.report.clearedUndoSetId).toBeUndefined();
    expect(result.report.schemaConflicts).toContain(
      "Set 'stellar-drift-ps' stored version 'stored-removed-version' does not match supplied previous-definition version '2026.07.13'; set state was left unchanged",
    );
    expect(
      result.report.setDeltas.find(
        (delta) => delta.setId === 'stellar-drift-ps',
      ),
    ).toEqual({
      setId: 'stellar-drift-ps',
      fromVersion: '2026.07.13',
      addedAchievementIds: [],
      quarantinedAchievementIds: [],
      restoredOrphanedAchievementIds: [],
      addedChecklistItems: [],
      removedChecklistItems: [],
      removedPinnedAchievementIds: [],
    });
  });

  it('clears undo for an unchanged surviving set by explicit contract', () => {
    const store = expectChanged(
      setNotes(
        createDefaultLocalProgressStore(),
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        'note',
        MOCK_TIMESTAMP,
      ),
    );
    const result = reconcileGameProgress(
      store,
      mockGameStellarDrift,
      cloneGame(mockGameStellarDrift),
      MOCK_TIMESTAMP_2,
    );
    expect(result.report.clearedUndoSetId).toBe('stellar-drift-ps');
    expect(result.store.undoState).toBeUndefined();
  });

  it('clears undo when its target set is removed', () => {
    const store = expectChanged(
      setBinaryCompletion(
        createDefaultLocalProgressStore(),
        mockGameStellarDrift,
        'stellar-drift-steam',
        'sd-steam-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    const nextGame = cloneGame(mockGameStellarDrift);
    nextGame.achievementSets = [nextGame.achievementSets[0]];
    const result = reconcileGameProgress(
      store,
      mockGameStellarDrift,
      nextGame,
      MOCK_TIMESTAMP_2,
    );
    expect(result.report.clearedUndoSetId).toBe('stellar-drift-steam');
    expect(result.store.undoState).toBeUndefined();
  });

  it('initializes a newly added set, reports checklist items, and clears stale matching undo', () => {
    const previousGame = cloneGame(mockGameStellarDrift);
    const addedSet = structuredClone(previousGame.achievementSets[1]);
    previousGame.achievementSets = [previousGame.achievementSets[0]];
    addedSet.achievements.push({
      id: 'sd-steam-002',
      name: 'Steam Checklist',
      description: 'Checklist addition',
      evidence: 'Fixture evidence',
      reward: { type: 'achievement' },
      tracking: {
        mode: 'checklist',
        items: [{ id: 'steam-task', name: 'Steam task' }],
      },
      labels: ['grind'],
      expectedStage: 'cleanup',
      confidence: 1,
      prerequisites: [],
      spoilerSafeHint: 'Complete the Steam task.',
    });
    const nextGame = cloneGame(previousGame);
    nextGame.achievementSets.push(addedSet);

    const store = selectGame(
      createDefaultLocalProgressStore(),
      previousGame,
      MOCK_TIMESTAMP,
    );
    store.undoState = {
      'stellar-drift': {
        setId: addedSet.id,
        previous: createDefaultAchievementSetProgress(
          addedSet,
          MOCK_TIMESTAMP,
        ),
      },
    };
    const result = reconcileGameProgress(
      store,
      previousGame,
      nextGame,
      MOCK_TIMESTAMP_2,
    );
    const delta = result.report.setDeltas.find(
      (candidate) => candidate.setId === addedSet.id,
    );
    expect(delta?.addedAchievementIds).toEqual([
      'sd-steam-001',
      'sd-steam-002',
    ]);
    expect(delta?.addedChecklistItems).toEqual([
      { achievementId: 'sd-steam-002', itemIds: ['steam-task'] },
    ]);
    expect(result.report.clearedUndoSetId).toBe(addedSet.id);
    expect(result.store.undoState).toBeUndefined();
  });

  it('restores a compatible reappearing set and clears stale matching undo', () => {
    const versionOne = cloneGame(mockGameStellarDrift);
    let store = expectChanged(
      setBinaryCompletion(
        createDefaultLocalProgressStore(),
        versionOne,
        'stellar-drift-steam',
        'sd-steam-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    const withoutSteam = cloneGame(versionOne);
    withoutSteam.achievementSets = [withoutSteam.achievementSets[0]];
    store = reconcileGameProgress(
      store,
      versionOne,
      withoutSteam,
      MOCK_TIMESTAMP_2,
    ).store;
    store.undoState = {
      'stellar-drift': {
        setId: 'stellar-drift-steam',
        previous: createDefaultAchievementSetProgress(
          versionOne.achievementSets[1],
          MOCK_TIMESTAMP,
        ),
      },
    };

    const restored = reconcileGameProgress(
      store,
      withoutSteam,
      versionOne,
      MOCK_TIMESTAMP_2,
    );
    const delta = restored.report.setDeltas.find(
      (candidate) => candidate.setId === 'stellar-drift-steam',
    );
    expect(delta?.restoredOrphanedAchievementIds).toEqual(['sd-steam-001']);
    expect(delta?.addedAchievementIds).toEqual([]);
    expect(
      restored.store.gameProgress['stellar-drift'].sets['stellar-drift-steam']
        .progress['sd-steam-001'].completed,
    ).toBe(true);
    expect(restored.report.clearedUndoSetId).toBe('stellar-drift-steam');
  });

  it('restores checklist orphans by item ID and counter orphans across bounded/open changes', () => {
    const versionOne = cloneGame(mockGameStellarDrift);
    let store = expectChanged(
      setChecklistItemCompletion(
        createDefaultLocalProgressStore(),
        versionOne,
        'stellar-drift-ps',
        'sd-ps-005',
        'task-a',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      setCounterValue(
        store,
        versionOne,
        'stellar-drift-ps',
        'sd-ps-004',
        48,
        MOCK_TIMESTAMP,
      ),
    );
    const removed = cloneGame(versionOne);
    removed.achievementSets[0].achievements =
      removed.achievementSets[0].achievements.filter(
        (achievement) =>
          achievement.id !== 'sd-ps-005' && achievement.id !== 'sd-ps-004',
      );
    store = reconcileGameProgress(
      store,
      versionOne,
      removed,
      MOCK_TIMESTAMP_2,
    ).store;

    const readded = cloneGame(versionOne);
    const checklist = getAchievement(readded, 'sd-ps-005');
    if (checklist.tracking.mode !== 'checklist') throw new Error('Bad fixture');
    checklist.tracking.items = [
      { id: 'task-a', name: 'Task A' },
      { id: 'task-d', name: 'Task D' },
    ];
    const boundedCounter = getAchievement(readded, 'sd-ps-004');
    if (boundedCounter.tracking.mode !== 'counter') throw new Error('Bad fixture');
    delete boundedCounter.tracking.target;

    const restored = reconcileGameProgress(
      store,
      removed,
      readded,
      MOCK_TIMESTAMP_2,
    );
    const setProgress =
      restored.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'];
    expect(setProgress.progress['sd-ps-005'].checklistCompletion).toEqual({
      'task-a': true,
      'task-d': false,
    });
    expect(setProgress.progress['sd-ps-004'].counterValue).toBe(48);
    expect(setProgress.progress['sd-ps-004'].completed).toBe(false);
    const delta = restored.report.setDeltas.find(
      (candidate) => candidate.setId === 'stellar-drift-ps',
    );
    expect(delta?.addedChecklistItems).toContainEqual({
      achievementId: 'sd-ps-005',
      itemIds: ['task-d'],
    });
    expect(delta?.removedChecklistItems).toContainEqual({
      achievementId: 'sd-ps-005',
      itemIds: ['task-b', 'task-c'],
    });

    const boundedAgain = cloneGame(readded);
    const counterAgain = getAchievement(boundedAgain, 'sd-ps-004');
    if (counterAgain.tracking.mode !== 'counter') throw new Error('Bad fixture');
    counterAgain.tracking.target = 40;
    const boundedResult = reconcileGameProgress(
      restored.store,
      readded,
      boundedAgain,
      MOCK_TIMESTAMP_2,
    );
    expect(
      boundedResult.store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].progress['sd-ps-004'].completed,
    ).toBe(true);
  });

  it('restores an open-counter orphan into a bounded counter and recomputes completion', () => {
    const versionOne = cloneGame(mockGameStellarDrift);
    let store = expectChanged(
      setCounterValue(
        createDefaultLocalProgressStore(),
        versionOne,
        'stellar-drift-ps',
        'sd-ps-006',
        3,
        MOCK_TIMESTAMP,
      ),
    );
    const removed = cloneGame(versionOne);
    removed.achievementSets[0].achievements =
      removed.achievementSets[0].achievements.filter(
        (achievement) => achievement.id !== 'sd-ps-006',
      );
    store = reconcileGameProgress(
      store,
      versionOne,
      removed,
      MOCK_TIMESTAMP_2,
    ).store;
    const readded = cloneGame(versionOne);
    const counter = getAchievement(readded, 'sd-ps-006');
    if (counter.tracking.mode !== 'counter') throw new Error('Bad fixture');
    counter.tracking.target = 2;

    const result = reconcileGameProgress(
      store,
      removed,
      readded,
      MOCK_TIMESTAMP_2,
    );
    const restored =
      result.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-006'];
    expect(restored.counterValue).toBe(3);
    expect(restored.completed).toBe(true);
    expect(
      result.report.setDeltas.find(
        (delta) => delta.setId === 'stellar-drift-ps',
      )?.restoredOrphanedAchievementIds,
    ).toContain('sd-ps-006');
  });

  it('keeps valid counter and checklist overrides through compatible reconciliation', () => {
    let store = expectChanged(
      setCompletionOverride(
        createDefaultLocalProgressStore(),
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-006',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      setCompletionOverride(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-005',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    const nextGame = cloneGame(mockGameStellarDrift);
    nextGame.version = 'next';
    const result = reconcileGameProgress(
      store,
      mockGameStellarDrift,
      nextGame,
      MOCK_TIMESTAMP_2,
    );
    const setProgress =
      result.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'];
    expect(setProgress.progress['sd-ps-006'].manualOverride).toBe(true);
    expect(setProgress.progress['sd-ps-006'].completed).toBe(true);
    expect(setProgress.progress['sd-ps-005'].manualOverride).toBe(true);
    expect(setProgress.progress['sd-ps-005'].completed).toBe(true);
  });

  it('quarantines incompatible active mode changes, initializes a faithful shape, and removes its pin', () => {
    let store = expectChanged(
      togglePin(
        createDefaultLocalProgressStore(),
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    store = expectChanged(
      setBinaryCompletion(
        store,
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    const nextGame = cloneGame(mockGameStellarDrift);
    const changed = getAchievement(nextGame, 'sd-ps-001');
    changed.tracking = { mode: 'counter', unit: 'runs', target: 2 };

    const result = reconcileGameProgress(
      store,
      mockGameStellarDrift,
      nextGame,
      MOCK_TIMESTAMP_2,
    );
    const delta = result.report.setDeltas.find(
      (candidate) => candidate.setId === 'stellar-drift-ps',
    );
    expect(delta?.quarantinedAchievementIds).toContain('sd-ps-001');
    expect(delta?.removedPinnedAchievementIds).toContain('sd-ps-001');
    const active =
      result.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-001'];
    expect(active).toMatchObject({
      manualOverride: false,
      completed: false,
      counterValue: 0,
      lastUpdated: MOCK_TIMESTAMP_2,
    });
    expect(active.checklistCompletion).toBeUndefined();
    expect(result.report.schemaConflicts).toHaveLength(1);
  });

  it('keeps incompatible orphans quarantined and initializes the reappearing active record', () => {
    const versionOne = cloneGame(mockGameStellarDrift);
    let store = expectChanged(
      setBinaryCompletion(
        createDefaultLocalProgressStore(),
        versionOne,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
        MOCK_TIMESTAMP,
      ),
    );
    const removed = cloneGame(versionOne);
    removed.achievementSets[0].achievements =
      removed.achievementSets[0].achievements.filter(
        (achievement) => achievement.id !== 'sd-ps-001',
      );
    store = reconcileGameProgress(
      store,
      versionOne,
      removed,
      MOCK_TIMESTAMP_2,
    ).store;
    const incompatible = cloneGame(versionOne);
    getAchievement(incompatible, 'sd-ps-001').tracking = {
      mode: 'counter',
      unit: 'runs',
    };

    const result = reconcileGameProgress(
      store,
      removed,
      incompatible,
      MOCK_TIMESTAMP_2,
    );
    expect(
      result.store.gameProgress['stellar-drift'].orphanedProgress[
        'stellar-drift-ps'
      ]['sd-ps-001'],
    ).toBeDefined();
    expect(
      result.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-001'],
    ).toMatchObject({ counterValue: 0, completed: false });
    expect(result.report.schemaConflicts[0]).toContain(
      'Incompatible orphan tracking mode',
    );
  });

  it('reports missing previous set and achievement definitions without overwriting affected state', () => {
    const store = selectGame(
      createDefaultLocalProgressStore(),
      mockGameStellarDrift,
      MOCK_TIMESTAMP,
    );
    const previousWithoutSteam = cloneGame(mockGameStellarDrift);
    previousWithoutSteam.achievementSets = [
      previousWithoutSteam.achievementSets[0],
    ];
    const nextWithoutSteam = cloneGame(previousWithoutSteam);
    const steamBefore = structuredClone(
      store.gameProgress['stellar-drift'].sets['stellar-drift-steam'],
    );

    const missingSet = reconcileGameProgress(
      store,
      previousWithoutSteam,
      nextWithoutSteam,
      MOCK_TIMESTAMP_2,
    );
    expect(missingSet.report.schemaConflicts).toContain(
      "Active set 'stellar-drift-steam' has no previous definition; state was left unchanged",
    );
    expect(
      missingSet.store.gameProgress['stellar-drift'].sets[
        'stellar-drift-steam'
      ],
    ).toEqual(steamBefore);

    const previousWithoutAchievement = cloneGame(mockGameStellarDrift);
    previousWithoutAchievement.achievementSets[0].achievements =
      previousWithoutAchievement.achievementSets[0].achievements.filter(
        (achievement) => achievement.id !== 'sd-ps-001',
      );
    const missingAchievement = reconcileGameProgress(
      store,
      previousWithoutAchievement,
      cloneGame(previousWithoutAchievement),
      MOCK_TIMESTAMP_2,
    );
    expect(missingAchievement.report.schemaConflicts.join(' ')).toContain(
      "Active achievement 'sd-ps-001'",
    );
    expect(
      missingAchievement.store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ],
    ).toEqual(store.gameProgress['stellar-drift'].sets['stellar-drift-ps']);
  });

  it('returns the original store for unsafe structures, legacy orphans, unsupported versions, invalid timestamps, and mismatched games', () => {
    const unsafe = asLocalProgressStore({
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        game: { gameId: 'different', sets: {}, orphanedProgress: {} },
      },
    });
    const unsafeResult = reconcileGameProgress(
      unsafe,
      mockGameStellarDrift,
      cloneGame(mockGameStellarDrift),
      MOCK_TIMESTAMP,
    );
    expect(unsafeResult.store).toBe(unsafe);
    expect(unsafeResult.report.schemaConflicts[0]).toContain(
      'Invalid progress store structure',
    );

    const legacy = asLocalProgressStore({
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        'stellar-drift': {
          gameId: 'stellar-drift',
          sets: {},
          orphanedProgress: {
            'stellar-drift-ps': {
              'sd-ps-001': {
                achievementId: 'sd-ps-001',
                completed: true,
                manualOverride: false,
                lastUpdated: MOCK_TIMESTAMP,
                provenance: 'manual',
              },
            },
          },
        },
      },
    });
    const legacyResult = reconcileGameProgress(
      legacy,
      mockGameStellarDrift,
      cloneGame(mockGameStellarDrift),
      MOCK_TIMESTAMP,
    );
    expect(legacyResult.store).toBe(legacy);
    expect(legacyResult.report.schemaConflicts[0]).toContain(
      'Invalid progress store structure',
    );

    const unsupported = asLocalProgressStore({
      schemaVersion: '1.0',
      gameProgress: {},
    });
    const unsupportedResult = reconcileGameProgress(
      unsupported,
      mockGameStellarDrift,
      cloneGame(mockGameStellarDrift),
      MOCK_TIMESTAMP,
    );
    expect(unsupportedResult.store).toBe(unsupported);
    expect(unsupportedResult.report.schemaConflicts[0]).toContain(
      'Unsupported store schema version',
    );

    const validStore = createDefaultLocalProgressStore();
    const invalidTimestamp = reconcileGameProgress(
      validStore,
      mockGameStellarDrift,
      cloneGame(mockGameStellarDrift),
      'invalid',
    );
    expect(invalidTimestamp.store).toBe(validStore);
    expect(invalidTimestamp.report.schemaConflicts[0]).toContain(
      'Invalid reconciliation timestamp',
    );

    const mismatchedGame = cloneGame(mockGameStellarDrift);
    mismatchedGame.id = 'different-game';
    const mismatch = reconcileGameProgress(
      validStore,
      mockGameStellarDrift,
      mismatchedGame,
      MOCK_TIMESTAMP,
    );
    expect(mismatch.store).toBe(validStore);
    expect(mismatch.report.schemaConflicts[0]).toContain(
      'Mismatched game identity',
    );
  });

  it('initializes an unpersisted game without choosing a preferred set and returns every union delta array', () => {
    const nextGame = cloneGame(mockGameStellarDrift);
    nextGame.version = 'next';
    const result = reconcileGameProgress(
      createDefaultLocalProgressStore(),
      mockGameStellarDrift,
      nextGame,
      MOCK_TIMESTAMP,
    );
    expect(
      result.store.gameProgress['stellar-drift'].preferredSetId,
    ).toBeUndefined();
    expect(result.report.setDeltas).toHaveLength(2);
    result.report.setDeltas.forEach((delta) => {
      expect(delta.addedAchievementIds).toBeDefined();
      expect(delta.quarantinedAchievementIds).toEqual([]);
      expect(delta.restoredOrphanedAchievementIds).toEqual([]);
      expect(delta.addedChecklistItems).toBeDefined();
      expect(delta.removedChecklistItems).toEqual([]);
      expect(delta.removedPinnedAchievementIds).toEqual([]);
    });
    expect(ReconciliationDeltaReportSchema.safeParse(result.report).success).toBe(
      true,
    );
  });
});
