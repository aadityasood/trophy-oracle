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
import type {
  AchievementProgressV3,
  CounterProgress,
  LocalProgressStoreV3,
  RunProgress,
} from './hunt-memory-schema';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID,
  createDefaultGameProgressV3,
  createDefaultHuntMemoryStore,
  createDefaultRunProgress,
} from './hunt-memory-lifecycle';
import {
  computeDerivedCompletionV3,
  getCounterDisplayMetrics,
  setRunActiveStage,
  setRunBinaryCompletion,
  setRunChecklistItemCompletion,
  setRunCompletionOverride,
  setRunCounterProgress,
  setRunNotes,
  setRunPinned,
  undoLastRunMutation,
} from './hunt-memory-progress';
import type {
  HuntMemoryMutationFailureCode,
  HuntMemoryMutationResult,
  HuntMemoryUndoResult,
} from './hunt-memory-progress';
import {
  mockGameMythHarbor,
  mockGameStellarDrift,
  MOCK_TIMESTAMP,
  MOCK_TIMESTAMP_2,
} from '../test/progress-fixtures';
import rawDemoGames from '../../data/source-of-truth/demo-games.json';
import { validateDemoGamesDataset } from './achievement-schema';

const TS = MOCK_TIMESTAMP;
const TS2 = MOCK_TIMESTAMP_2;
const TS3 = '2026-07-22T02:00:00.000Z';
const SET_PS = 'stellar-drift-ps';
const SET_STEAM = 'stellar-drift-steam';
const DEFAULT_RUN = DEFAULT_HUNT_MEMORY_RUN_ID;

function expectChanged(result: HuntMemoryMutationResult): LocalProgressStoreV3 {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.message);
  expect(result.changed).toBe(true);
  return result.store;
}

function expectNoChange(
  result: HuntMemoryMutationResult,
  original: LocalProgressStoreV3,
): void {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.message);
  expect(result.changed).toBe(false);
  expect(result.store).toBe(original);
}

function expectUndoChanged(result: HuntMemoryUndoResult): LocalProgressStoreV3 {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.message);
  return result.store;
}

function achievementRecord(
  id: string,
  tracking: AchievementRecord['tracking'],
): AchievementRecord {
  return {
    id,
    name: `Achievement ${id}`,
    description: 'A test achievement',
    evidence: 'Test evidence',
    reward: { type: 'achievement' },
    tracking,
    labels: [],
    expectedStage: 'story',
    confidence: 1,
    prerequisites: [],
  };
}

function achievementSet(
  id: string,
  version: string,
  achievements: AchievementRecord[],
): AchievementSet {
  return { id, platform: 'steam', version, achievements };
}

function gameRecord(id: string, sets: AchievementSet[]): GameRecord {
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

function createPopulatedStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.lastGameId = 'stellar-drift';

  const gameProgress = createDefaultGameProgressV3(mockGameStellarDrift, TS);
  gameProgress.preferredSetId = SET_PS;
  gameProgress.sets[SET_PS].runs['second-run'] = createDefaultRunProgress(
    mockGameStellarDrift.achievementSets[0],
    'second-run',
    'Second Run',
    TS,
  );

  store.gameProgress['stellar-drift'] = gameProgress;
  store.gameProgress['myth-harbor'] = createDefaultGameProgressV3(
    mockGameMythHarbor,
    TS,
  );

  return store;
}

function getRun(
  store: LocalProgressStoreV3,
  gameId: string,
  setId: string,
  runId: string,
): RunProgress {
  return store.gameProgress[gameId].sets[setId].runs[runId];
}

function getProgress(
  store: LocalProgressStoreV3,
  gameId: string,
  setId: string,
  runId: string,
  achievementId: string,
): AchievementProgressV3 {
  return getRun(store, gameId, setId, runId).progress[achievementId];
}

describe('computeDerivedCompletionV3', () => {
  it('derives bounded exact, at-least, estimated, and unknown completion at and above target', () => {
    const exact = achievementRecord('ach', {
      mode: 'counter',
      unit: 'items',
      target: 10,
    });
    expect(
      computeDerivedCompletionV3(exact, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 9 },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(false);
    expect(
      computeDerivedCompletionV3(exact, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 10 },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(true);
    expect(
      computeDerivedCompletionV3(exact, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 11 },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(true);

    const atLeast = achievementRecord('ach', {
      mode: 'counter',
      unit: 'items',
      target: 10,
    });
    expect(
      computeDerivedCompletionV3(atLeast, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'at_least', minimum: 9 },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(false);
    expect(
      computeDerivedCompletionV3(atLeast, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'at_least', minimum: 10 },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(true);
    expect(
      computeDerivedCompletionV3(atLeast, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'at_least', minimum: 12 },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(true);

    const estimated = achievementRecord('ach', {
      mode: 'counter',
      unit: 'items',
      target: 10,
    });
    expect(
      computeDerivedCompletionV3(estimated, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'estimated', estimate: 10 },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(false);
    expect(
      computeDerivedCompletionV3(estimated, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'estimated', estimate: 20 },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(false);

    const unknown = achievementRecord('ach', {
      mode: 'counter',
      unit: 'items',
      target: 10,
    });
    expect(
      computeDerivedCompletionV3(unknown, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'unknown', observedSinceStart: 10, trackingStartedAt: TS },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(false);
    expect(
      computeDerivedCompletionV3(unknown, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        counter: {
          certainty: 'unknown',
          observedSinceStart: 100,
          trackingStartedAt: TS,
        },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(false);
  });

  it('keeps all four open-counter variants incomplete without override', () => {
    const open = achievementRecord('ach', { mode: 'counter', unit: 'items' });
    const variants: CounterProgress[] = [
      { certainty: 'exact', value: 999 },
      { certainty: 'at_least', minimum: 999 },
      { certainty: 'estimated', estimate: 999 },
      { certainty: 'unknown', observedSinceStart: 999, trackingStartedAt: TS },
    ];
    for (const counter of variants) {
      expect(
        computeDerivedCompletionV3(open, {
          achievementId: 'ach',
          completed: false,
          manualOverride: false,
          counter,
          lastUpdated: TS,
          provenance: 'manual',
        }),
      ).toBe(false);
      expect(
        computeDerivedCompletionV3(open, {
          achievementId: 'ach',
          completed: true,
          manualOverride: true,
          counter,
          lastUpdated: TS,
          provenance: 'manual',
        }),
      ).toBe(true);
    }
  });

  it('derives checklist completion only when every current item is true', () => {
    const checklist = achievementRecord('ach', {
      mode: 'checklist',
      items: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    expect(
      computeDerivedCompletionV3(checklist, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        checklistCompletion: { a: true, b: false },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(false);
    expect(
      computeDerivedCompletionV3(checklist, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        checklistCompletion: { a: true, b: true },
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(true);
  });

  it('returns explicit completed for binary and never honors override', () => {
    const binary = achievementRecord('ach', { mode: 'binary' });
    expect(
      computeDerivedCompletionV3(binary, {
        achievementId: 'ach',
        completed: false,
        manualOverride: false,
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(false);
    expect(
      computeDerivedCompletionV3(binary, {
        achievementId: 'ach',
        completed: true,
        manualOverride: true,
        lastUpdated: TS,
        provenance: 'manual',
      }),
    ).toBe(true);
  });
});

describe('getCounterDisplayMetrics', () => {
  const bounded = { mode: 'counter' as const, unit: 'items', target: 100 };
  const open = { mode: 'counter' as const, unit: 'items' };

  it('exposes exact remaining and percentage with clamping', () => {
    expect(getCounterDisplayMetrics(bounded, { certainty: 'exact', value: 0 })).toEqual({
      certainty: 'exact',
      value: 0,
      remaining: 100,
      percentage: 0,
    });
    expect(getCounterDisplayMetrics(bounded, { certainty: 'exact', value: 50 })).toEqual({
      certainty: 'exact',
      value: 50,
      remaining: 50,
      percentage: 50,
    });
    expect(getCounterDisplayMetrics(bounded, { certainty: 'exact', value: 100 })).toEqual({
      certainty: 'exact',
      value: 100,
      remaining: 0,
      percentage: 100,
    });
    expect(getCounterDisplayMetrics(bounded, { certainty: 'exact', value: 150 })).toEqual({
      certainty: 'exact',
      value: 150,
      remaining: 0,
      percentage: 100,
    });
  });

  it('exposes at-least lower-bound fields with clamping', () => {
    expect(
      getCounterDisplayMetrics(bounded, { certainty: 'at_least', minimum: 25 }),
    ).toEqual({
      certainty: 'at_least',
      minimum: 25,
      atMostRemaining: 75,
      lowerBoundPercentage: 25,
    });
    expect(
      getCounterDisplayMetrics(bounded, { certainty: 'at_least', minimum: 100 }),
    ).toEqual({
      certainty: 'at_least',
      minimum: 100,
      atMostRemaining: 0,
      lowerBoundPercentage: 100,
    });
    expect(
      getCounterDisplayMetrics(bounded, { certainty: 'at_least', minimum: 120 }),
    ).toEqual({
      certainty: 'at_least',
      minimum: 120,
      atMostRemaining: 0,
      lowerBoundPercentage: 100,
    });
  });

  it('exposes estimated approximate fields with clamping', () => {
    expect(
      getCounterDisplayMetrics(bounded, { certainty: 'estimated', estimate: 30 }),
    ).toEqual({
      certainty: 'estimated',
      estimate: 30,
      approximateRemaining: 70,
      approximatePercentage: 30,
    });
    expect(
      getCounterDisplayMetrics(bounded, { certainty: 'estimated', estimate: 100 }),
    ).toEqual({
      certainty: 'estimated',
      estimate: 100,
      approximateRemaining: 0,
      approximatePercentage: 100,
    });
    expect(
      getCounterDisplayMetrics(bounded, { certainty: 'estimated', estimate: 200 }),
    ).toEqual({
      certainty: 'estimated',
      estimate: 200,
      approximateRemaining: 0,
      approximatePercentage: 100,
    });
  });

  it('exposes only observation fields for unknown counters', () => {
    expect(
      getCounterDisplayMetrics(bounded, {
        certainty: 'unknown',
        observedSinceStart: 7,
        trackingStartedAt: TS,
      }),
    ).toEqual({
      certainty: 'unknown',
      observedSinceStart: 7,
      trackingStartedAt: TS,
    });
    expect(
      getCounterDisplayMetrics(open, {
        certainty: 'unknown',
        observedSinceStart: 7,
        trackingStartedAt: TS,
      }),
    ).toEqual({
      certainty: 'unknown',
      observedSinceStart: 7,
      trackingStartedAt: TS,
    });
  });

  it('omits derived fields for open counters of all certainties', () => {
    expect(getCounterDisplayMetrics(open, { certainty: 'exact', value: 42 })).toEqual({
      certainty: 'exact',
      value: 42,
    });
    expect(getCounterDisplayMetrics(open, { certainty: 'at_least', minimum: 42 })).toEqual({
      certainty: 'at_least',
      minimum: 42,
    });
    expect(getCounterDisplayMetrics(open, { certainty: 'estimated', estimate: 42 })).toEqual({
      certainty: 'estimated',
      estimate: 42,
    });
  });
});

describe('successful run mutations', () => {
  it('sets binary completion, removes trackers, and updates provenance and timestamp', () => {
    const store = createPopulatedStore();
    const result = setRunBinaryCompletion(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-001',
      true,
      TS2,
    );
    const next = expectChanged(result);
    const progress = getProgress(next, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-001');
    expect(progress.completed).toBe(true);
    expect(progress.manualOverride).toBe(false);
    expect(progress.counter).toBeUndefined();
    expect(progress.checklistCompletion).toBeUndefined();
    expect(progress.provenance).toBe('manual');
    expect(progress.lastUpdated).toBe(TS2);
    expect(LocalProgressStoreV3Schema.safeParse(next).success).toBe(true);
  });

  it('sets counter progress for each certainty variant', () => {
    const counters: CounterProgress[] = [
      { certainty: 'exact', value: 24 },
      { certainty: 'at_least', minimum: 24 },
      { certainty: 'estimated', estimate: 24 },
      {
        certainty: 'unknown',
        observedSinceStart: 24,
        trackingStartedAt: TS,
      },
    ];

    for (const counter of counters) {
      const store = createPopulatedStore();
      const result = setRunCounterProgress(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        counter,
        TS2,
      );
      const next = expectChanged(result);
      const progress = getProgress(next, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-004');
      expect(progress.counter).toEqual(counter);
      expect(progress.checklistCompletion).toBeUndefined();
      expect(progress.provenance).toBe('manual');
      expect(progress.lastUpdated).toBe(TS2);
      expect(LocalProgressStoreV3Schema.safeParse(next).success).toBe(true);
    }
  });

  it('does not retain a caller-owned counter object after success', () => {
    const counter: CounterProgress = { certainty: 'exact', value: 12 };
    const next = expectChanged(
      setRunCounterProgress(
        createPopulatedStore(),
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        counter,
        TS2,
      ),
    );
    const storedCounter = getProgress(
      next,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
    ).counter;
    expect(storedCounter).toEqual({ certainty: 'exact', value: 12 });
    expect(storedCounter).not.toBe(counter);

    counter.value = 99;
    expect(
      getProgress(next, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-004')
        .counter,
    ).toEqual({ certainty: 'exact', value: 12 });
    expect(LocalProgressStoreV3Schema.safeParse(next).success).toBe(true);
  });

  it('preserves an existing counter manual override when the counter value changes', () => {
    let store = createPopulatedStore();
    store = expectChanged(
      setRunCompletionOverride(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        true,
        TS2,
      ),
    );
    store = expectChanged(
      setRunCounterProgress(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        { certainty: 'exact', value: 1 },
        TS3,
      ),
    );
    const progress = getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-004');
    expect(progress.manualOverride).toBe(true);
    expect(progress.completed).toBe(true);
    expect(progress.counter).toEqual({ certainty: 'exact', value: 1 });
  });

  it('sets checklist item completion and preserves override', () => {
    let store = createPopulatedStore();
    store = expectChanged(
      setRunChecklistItemCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-005',
        'task-a',
        true,
        TS2,
      ),
    );
    let progress = getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-005');
    expect(progress.checklistCompletion).toEqual({
      'task-a': true,
      'task-b': false,
      'task-c': false,
    });
    expect(progress.completed).toBe(false);

    store = expectChanged(
      setRunChecklistItemCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-005',
        'task-b',
        true,
        TS3,
      ),
    );
    store = expectChanged(
      setRunChecklistItemCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-005',
        'task-c',
        true,
        TS3,
      ),
    );
    progress = getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-005');
    expect(progress.completed).toBe(true);
    expect(progress.lastUpdated).toBe(TS3);
  });

  it('sets and clears notes preserving whitespace and empty strings', () => {
    let store = createPopulatedStore();
    store = expectChanged(
      setRunNotes(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        '  padded note  ',
        TS2,
      ),
    );
    expect(
      getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-001').notes,
    ).toBe('  padded note  ');

    store = expectChanged(
      setRunNotes(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        '',
        TS3,
      ),
    );
    expect(
      getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-001').notes,
    ).toBe('');

    store = expectChanged(
      setRunNotes(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        undefined,
        TS3,
      ),
    );
    expect(
      Object.hasOwn(
        getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-001'),
        'notes',
      ),
    ).toBe(false);
  });

  it('sets and clears completion override for counters and checklists', () => {
    let store = createPopulatedStore();
    store = expectChanged(
      setRunCompletionOverride(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        true,
        TS2,
      ),
    );
    let progress = getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-004');
    expect(progress.manualOverride).toBe(true);
    expect(progress.completed).toBe(true);

    store = expectChanged(
      setRunCompletionOverride(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        false,
        TS3,
      ),
    );
    progress = getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-004');
    expect(progress.manualOverride).toBe(false);
    expect(progress.completed).toBe(false);

    store = expectChanged(
      setRunCompletionOverride(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-005',
        true,
        TS2,
      ),
    );
    progress = getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-005');
    expect(progress.manualOverride).toBe(true);
    expect(progress.completed).toBe(true);

    store = expectChanged(
      setRunCompletionOverride(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-005',
        false,
        TS3,
      ),
    );
    progress = getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-005');
    expect(progress.manualOverride).toBe(false);
    expect(progress.completed).toBe(false);
  });

  it('pins and unpins achievements preserving order and distinctness', () => {
    let store = createPopulatedStore();
    const ids = ['sd-ps-001', 'sd-ps-002', 'sd-ps-004', 'sd-ps-005', 'sd-ps-006'];
    for (const id of ids) {
      store = expectChanged(
        setRunPinned(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          id,
          true,
          TS2,
        ),
      );
    }
    expect(
      getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN).pinnedAchievementIds,
    ).toEqual(ids);

    store = expectChanged(
      setRunPinned(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-002',
        false,
        TS3,
      ),
    );
    expect(
      getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN).pinnedAchievementIds,
    ).toEqual(['sd-ps-001', 'sd-ps-004', 'sd-ps-005', 'sd-ps-006']);
  });

  it('sets and clears active stage without touching achievement timestamps', () => {
    let store = createPopulatedStore();
    const beforeProgress = getProgress(
      store,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-001',
    );

    store = expectChanged(
      setRunActiveStage(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'missables',
        TS2,
      ),
    );
    expect(getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN).activeStage).toBe(
      'missables',
    );
    expect(
      getProgress(store, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-001').lastUpdated,
    ).toBe(beforeProgress.lastUpdated);

    store = expectChanged(
      setRunActiveStage(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        undefined,
        TS3,
      ),
    );
    expect(
      Object.hasOwn(getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN), 'activeStage'),
    ).toBe(false);
  });

  it('produces a LocalProgressStoreV3Schema-valid store after every mutation class', () => {
    let store = createPopulatedStore();

    const mutations: Array<(s: LocalProgressStoreV3) => HuntMemoryMutationResult> = [
      (s) =>
        setRunBinaryCompletion(
          s,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          true,
          TS2,
        ),
      (s) =>
        setRunCounterProgress(
          s,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-004',
          { certainty: 'exact', value: 12 },
          TS2,
        ),
      (s) =>
        setRunChecklistItemCompletion(
          s,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-005',
          'task-a',
          true,
          TS2,
        ),
      (s) =>
        setRunNotes(
          s,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          'validated',
          TS2,
        ),
      (s) =>
        setRunCompletionOverride(
          s,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-006',
          true,
          TS2,
        ),
      (s) =>
        setRunPinned(
          s,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-002',
          true,
          TS2,
        ),
      (s) =>
        setRunActiveStage(
          s,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'story',
          TS2,
        ),
    ];

    for (const mutate of mutations) {
      const result = mutate(store);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.message);
      expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
      store = result.store;
    }
  });
});

describe('undo snapshots and isolation', () => {
  it('creates a complete run snapshot with exact set, run, and version identity for every mutation class', () => {
    const baseline = createDefaultRunProgress(
      mockGameStellarDrift.achievementSets[0],
      DEFAULT_RUN,
      'Main Run',
      TS,
    );
    const mutations: Array<(store: LocalProgressStoreV3) => HuntMemoryMutationResult> = [
      (store) =>
        setRunBinaryCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          true,
          TS2,
        ),
      (store) =>
        setRunCounterProgress(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-004',
          { certainty: 'exact', value: 10 },
          TS2,
        ),
      (store) =>
        setRunChecklistItemCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-005',
          'task-a',
          true,
          TS2,
        ),
      (store) =>
        setRunNotes(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          'note',
          TS2,
        ),
      (store) =>
        setRunCompletionOverride(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-004',
          true,
          TS2,
        ),
      (store) =>
        setRunPinned(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          true,
          TS2,
        ),
      (store) =>
        setRunActiveStage(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'missables',
          TS2,
        ),
    ];

    for (const mutate of mutations) {
      const next = expectChanged(mutate(createPopulatedStore()));
      const snapshot = next.undoState?.['stellar-drift'];
      expect(snapshot).toBeDefined();
      expect(snapshot?.setId).toBe(SET_PS);
      expect(snapshot?.runId).toBe(DEFAULT_RUN);
      expect(snapshot?.guardedSetVersion).toBe('2026.07.13');
      expect(snapshot?.previous).toEqual(baseline);
      expect(RunProgressSchema.safeParse(snapshot?.previous).success).toBe(true);
    }
  });

  it('replaces the same-game snapshot across runs and preserves another game snapshot', () => {
    let store = createPopulatedStore();
    store = expectChanged(
      setRunBinaryCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        true,
        TS2,
      ),
    );
    const firstSnapshot = structuredClone(store.undoState?.['stellar-drift']);
    expect(firstSnapshot?.runId).toBe(DEFAULT_RUN);

    store = expectChanged(
      setRunBinaryCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        'second-run',
        'sd-ps-001',
        true,
        TS3,
      ),
    );
    const secondSnapshot = store.undoState?.['stellar-drift'];
    expect(secondSnapshot?.runId).toBe('second-run');
    expect(secondSnapshot?.previous.runId).toBe('second-run');

    store = expectChanged(
      setRunBinaryCompletion(
        store,
        mockGameMythHarbor,
        'myth-harbor-ps',
        DEFAULT_RUN,
        'mh-ps-001',
        true,
        TS3,
      ),
    );
    expect(store.undoState?.['stellar-drift']).toEqual(secondSnapshot);
    expect(store.undoState?.['myth-harbor']).toBeDefined();
  });

  it('mutating a non-active run leaves every selection unchanged', () => {
    const store = createPopulatedStore();
    const before = structuredClone(store);

    const result = setRunBinaryCompletion(
      store,
      mockGameStellarDrift,
      SET_PS,
      'second-run',
      'sd-ps-001',
      true,
      TS2,
    );
    const next = expectChanged(result);
    expect(next.lastGameId).toBe('stellar-drift');
    expect(next.gameProgress['stellar-drift'].preferredSetId).toBe(SET_PS);
    expect(next.gameProgress['stellar-drift'].sets[SET_PS].activeRunId).toBe(
      DEFAULT_RUN,
    );
    expect(next.gameProgress['myth-harbor']).toEqual(before.gameProgress['myth-harbor']);
    expect(
      getRun(next, 'stellar-drift', SET_PS, DEFAULT_RUN),
    ).toEqual(before.gameProgress['stellar-drift'].sets[SET_PS].runs[DEFAULT_RUN]);
  });
});

describe('no-ops and stale completion repair', () => {
  it('returns the original store reference for effective no-ops and preserves undo', () => {
    let store = createPopulatedStore();
    store = expectChanged(
      setRunBinaryCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        true,
        TS2,
      ),
    );
    const snapshot = structuredClone(store.undoState);

    expectNoChange(
      setRunBinaryCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        true,
        TS3,
      ),
      store,
    );
    expectNoChange(
      setRunCounterProgress(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        { certainty: 'exact', value: 0 },
        TS3,
      ),
      store,
    );
    expectNoChange(
      setRunChecklistItemCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-005',
        'task-a',
        false,
        TS3,
      ),
      store,
    );
    expectNoChange(
      setRunNotes(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        undefined,
        TS3,
      ),
      store,
    );
    expectNoChange(
      setRunCompletionOverride(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        false,
        TS3,
      ),
      store,
    );
    expectNoChange(
      setRunPinned(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        false,
        TS3,
      ),
      store,
    );
    expectNoChange(
      setRunActiveStage(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        undefined,
        TS3,
      ),
      store,
    );

    expect(store.undoState).toEqual(snapshot);
  });

  it('repairs stale counter and checklist completion as undoable mutations', () => {
    const store = createPopulatedStore();
    const counterProgress = getProgress(
      store,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
    );
    counterProgress.counter = { certainty: 'exact', value: 48 };
    counterProgress.completed = false;
    const staleCounterRun = structuredClone(
      getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN),
    );

    const counter = setRunCounterProgress(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
      { certainty: 'exact', value: 48 },
      TS2,
    );
    expect(counter.success).toBe(true);
    if (!counter.success) return;
    expect(counter.changed).toBe(true);
    expect(
      counter.store.gameProgress['stellar-drift'].sets[SET_PS].runs[DEFAULT_RUN]
        .progress['sd-ps-004'].completed,
    ).toBe(true);
    expect(counter.store.undoState?.['stellar-drift']?.previous).toEqual(
      staleCounterRun,
    );

    const checklistStore = createPopulatedStore();
    const checklistProgress = getProgress(
      checklistStore,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-005',
    );
    checklistProgress.checklistCompletion = {
      'task-a': true,
      'task-b': true,
      'task-c': true,
    };
    checklistProgress.completed = false;
    const staleChecklistRun = structuredClone(
      getRun(checklistStore, 'stellar-drift', SET_PS, DEFAULT_RUN),
    );

    const checklist = setRunChecklistItemCompletion(
      checklistStore,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-005',
      'task-a',
      true,
      TS2,
    );
    expect(checklist.success).toBe(true);
    if (!checklist.success) return;
    expect(checklist.changed).toBe(true);
    expect(
      checklist.store.gameProgress['stellar-drift'].sets[SET_PS].runs[DEFAULT_RUN]
        .progress['sd-ps-005'].completed,
    ).toBe(true);
    expect(checklist.store.undoState?.['stellar-drift']?.previous).toEqual(
      staleChecklistRun,
    );
  });
});

describe('undo', () => {
  it('restores only the target run, clears the snapshot, and leaves selections unchanged', () => {
    let store = createPopulatedStore();
    const before = structuredClone(store);
    store = expectChanged(
      setRunBinaryCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        true,
        TS2,
      ),
    );
    const afterBinary = structuredClone(
      getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN),
    );
    store = expectChanged(
      setRunCounterProgress(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        { certainty: 'exact', value: 25 },
        TS3,
      ),
    );

    const undo = expectUndoChanged(undoLastRunMutation(store, 'stellar-drift'));
    expect(undo.undoState).toBeUndefined();
    expect(
      getRun(undo, 'stellar-drift', SET_PS, DEFAULT_RUN),
    ).toEqual(afterBinary);
    expect(undo.lastGameId).toBe('stellar-drift');
    expect(undo.gameProgress['stellar-drift'].preferredSetId).toBe(SET_PS);
    expect(undo.gameProgress['stellar-drift'].sets[SET_PS].activeRunId).toBe(
      DEFAULT_RUN,
    );
    expect(undo.gameProgress['myth-harbor']).toEqual(before.gameProgress['myth-harbor']);
  });

  it('returns NO_UNDO_SNAPSHOT and leaves input unchanged', () => {
    const store = createPopulatedStore();
    const before = structuredClone(store);
    const result = undoLastRunMutation(store, 'missing-game');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('NO_UNDO_SNAPSHOT');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns GAME_NOT_FOUND and leaves input unchanged', () => {
    const store = createDefaultHuntMemoryStore();
    store.undoState = {
      'orphan-game': {
        setId: SET_PS,
        runId: DEFAULT_RUN,
        guardedSetVersion: '2026.07.13',
        previous: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          DEFAULT_RUN,
          'Main Run',
          TS,
        ),
      },
    };
    const before = structuredClone(store);
    const result = undoLastRunMutation(store, 'orphan-game');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('GAME_NOT_FOUND');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns SET_RETIRED when the target set is retired and leaves input unchanged', () => {
    const store = createPopulatedStore();
    store.gameProgress['stellar-drift'].retiredSets[SET_PS] = {
      setId: SET_PS,
      retirementReason: 'removed_set',
      version: '2026.07.13',
      activeRunId: DEFAULT_RUN,
      runs: {
        [DEFAULT_RUN]: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          DEFAULT_RUN,
          'Main Run',
          TS,
        ),
      },
    };
    store.undoState = {
      'stellar-drift': {
        setId: SET_PS,
        runId: DEFAULT_RUN,
        guardedSetVersion: '2026.07.13',
        previous: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          DEFAULT_RUN,
          'Main Run',
          TS,
        ),
      },
    };
    const before = structuredClone(store);
    const result = undoLastRunMutation(store, 'stellar-drift');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('SET_RETIRED');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns SET_NOT_FOUND and leaves input unchanged', () => {
    const store = createPopulatedStore();
    store.undoState = {
      'stellar-drift': {
        setId: 'missing-set',
        runId: DEFAULT_RUN,
        guardedSetVersion: '2026.07.13',
        previous: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          DEFAULT_RUN,
          'Main Run',
          TS,
        ),
      },
    };
    const before = structuredClone(store);
    const result = undoLastRunMutation(store, 'stellar-drift');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('SET_NOT_FOUND');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns SET_VERSION_MISMATCH and leaves input unchanged', () => {
    const store = createPopulatedStore();
    store.undoState = {
      'stellar-drift': {
        setId: SET_PS,
        runId: DEFAULT_RUN,
        guardedSetVersion: 'different-version',
        previous: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          DEFAULT_RUN,
          'Main Run',
          TS,
        ),
      },
    };
    const before = structuredClone(store);
    const result = undoLastRunMutation(store, 'stellar-drift');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('SET_VERSION_MISMATCH');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns RUN_NOT_FOUND and leaves input unchanged', () => {
    const store = createPopulatedStore();
    store.undoState = {
      'stellar-drift': {
        setId: SET_PS,
        runId: 'missing-run',
        guardedSetVersion: '2026.07.13',
        previous: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          'missing-run',
          'Main Run',
          TS,
        ),
      },
    };
    const before = structuredClone(store);
    const result = undoLastRunMutation(store, 'stellar-drift');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('RUN_NOT_FOUND');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns UNDO_SNAPSHOT_INVALID and leaves input unchanged', () => {
    const store = createPopulatedStore();
    store.undoState = {
      'stellar-drift': {
        setId: SET_PS,
        runId: DEFAULT_RUN,
        guardedSetVersion: '2026.07.13',
        previous: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          'wrong-run',
          'Main Run',
          TS,
        ),
      },
    };
    const before = structuredClone(store);
    const result = undoLastRunMutation(store, 'stellar-drift');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('UNDO_SNAPSHOT_INVALID');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });
});

describe('mutation failures', () => {
  const failureCases: Array<{
    label: string;
    expected: HuntMemoryMutationFailureCode;
    call: (store: LocalProgressStoreV3) => HuntMemoryMutationResult;
  }> = [
    {
      label: 'invalid timestamp',
      expected: 'INVALID_TIMESTAMP',
      call: (store) =>
        setRunBinaryCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          true,
          'invalid',
        ),
    },
    {
      label: 'missing game',
      expected: 'GAME_NOT_FOUND',
      call: (store) =>
        setRunBinaryCompletion(
          store,
          gameRecord('missing', [mockGameStellarDrift.achievementSets[0]]),
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          true,
          TS2,
        ),
    },
    {
      label: 'missing set',
      expected: 'SET_NOT_FOUND',
      call: (store) =>
        setRunBinaryCompletion(
          store,
          mockGameStellarDrift,
          'missing-set',
          DEFAULT_RUN,
          'sd-ps-001',
          true,
          TS2,
        ),
    },
    {
      label: 'missing run',
      expected: 'RUN_NOT_FOUND',
      call: (store) =>
        setRunBinaryCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          'missing-run',
          'sd-ps-001',
          true,
          TS2,
        ),
    },
    {
      label: 'missing achievement definition',
      expected: 'ACHIEVEMENT_NOT_FOUND',
      call: (store) =>
        setRunBinaryCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'missing-achievement',
          true,
          TS2,
        ),
    },
    {
      label: 'binary called on counter achievement',
      expected: 'TRACKING_MODE_MISMATCH',
      call: (store) =>
        setRunBinaryCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-004',
          true,
          TS2,
        ),
    },
    {
      label: 'counter called on binary achievement',
      expected: 'TRACKING_MODE_MISMATCH',
      call: (store) =>
        setRunCounterProgress(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          { certainty: 'exact', value: 1 },
          TS2,
        ),
    },
    {
      label: 'checklist called on counter achievement',
      expected: 'TRACKING_MODE_MISMATCH',
      call: (store) =>
        setRunChecklistItemCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-004',
          'task-a',
          true,
          TS2,
        ),
    },
    {
      label: 'checklist item not found',
      expected: 'CHECKLIST_ITEM_NOT_FOUND',
      call: (store) =>
        setRunChecklistItemCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-005',
          'missing-task',
          true,
          TS2,
        ),
    },
    {
      label: 'override unsupported on binary',
      expected: 'COMPLETION_OVERRIDE_UNSUPPORTED',
      call: (store) =>
        setRunCompletionOverride(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          'sd-ps-001',
          true,
          TS2,
        ),
    },
  ];

  for (const { label, expected, call } of failureCases) {
    it(`returns ${expected} for ${label}`, () => {
      const store = createPopulatedStore();
      const before = structuredClone(store);
      const result = call(store);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe(expected);
      expect('store' in result).toBe(false);
      expect(store).toEqual(before);
    });
  }

  it('returns SET_RETIRED and leaves input unchanged', () => {
    const store = createPopulatedStore();
    store.gameProgress['stellar-drift'].retiredSets['retired'] = {
      setId: 'retired',
      retirementReason: 'removed_set',
      version: '1.0',
      activeRunId: DEFAULT_RUN,
      runs: {
        [DEFAULT_RUN]: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          DEFAULT_RUN,
          'Main Run',
          TS,
        ),
      },
    };
    const before = structuredClone(store);

    const result = setRunBinaryCompletion(
      store,
      mockGameStellarDrift,
      'retired',
      DEFAULT_RUN,
      'sd-ps-001',
      true,
      TS2,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('SET_RETIRED');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns SET_VERSION_MISMATCH and leaves input unchanged', () => {
    const store = createPopulatedStore();
    store.gameProgress['stellar-drift'].sets[SET_PS].version = 'stale';
    const before = structuredClone(store);

    const result = setRunBinaryCompletion(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-001',
      true,
      TS2,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('SET_VERSION_MISMATCH');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns SET_NOT_FOUND when the stored active set has no current definition', () => {
    const store = createPopulatedStore();
    const gameWithoutSet = gameRecord('stellar-drift', [
      mockGameStellarDrift.achievementSets[1],
    ]);
    const before = structuredClone(store);

    const result = setRunBinaryCompletion(
      store,
      gameWithoutSet,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-001',
      true,
      TS2,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('SET_NOT_FOUND');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('returns PROGRESS_NOT_FOUND and leaves input unchanged', () => {
    const store = createPopulatedStore();
    delete getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN).progress['sd-ps-001'];
    const before = structuredClone(store);

    const result = setRunBinaryCompletion(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-001',
      true,
      TS2,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('PROGRESS_NOT_FOUND');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('separates missing pin definitions from missing pin progress', () => {
    const missingDefinitionStore = createPopulatedStore();
    const missingDefinitionBefore = structuredClone(missingDefinitionStore);
    const missingDefinition = setRunPinned(
      missingDefinitionStore,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'missing-achievement',
      true,
      TS2,
    );
    expect(missingDefinition.success).toBe(false);
    if (!missingDefinition.success) {
      expect(missingDefinition.code).toBe('ACHIEVEMENT_NOT_FOUND');
    }
    expect('store' in missingDefinition).toBe(false);
    expect(missingDefinitionStore).toEqual(missingDefinitionBefore);

    const missingProgressStore = createPopulatedStore();
    delete getRun(
      missingProgressStore,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
    ).progress['sd-ps-001'];
    const missingProgressBefore = structuredClone(missingProgressStore);
    const missingProgress = setRunPinned(
      missingProgressStore,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-001',
      true,
      TS2,
    );
    expect(missingProgress.success).toBe(false);
    if (!missingProgress.success) {
      expect(missingProgress.code).toBe('PROGRESS_NOT_FOUND');
    }
    expect('store' in missingProgress).toBe(false);
    expect(missingProgressStore).toEqual(missingProgressBefore);
  });

  it('returns PIN_LIMIT_REACHED and leaves input unchanged', () => {
    const store = createPopulatedStore();
    getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN).pinnedAchievementIds = [
      'sd-ps-001',
      'sd-ps-002',
      'sd-ps-004',
      'sd-ps-005',
      'sd-ps-006',
    ];
    const before = structuredClone(store);

    const result = setRunPinned(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-007',
      true,
      TS2,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('PIN_LIMIT_REACHED');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });
});

describe('counter progress validation', () => {
  it('rejects invalid counter unions, negative values, fractional values, and bad timestamps', () => {
    const invalidCounters: CounterProgress[] = [
      { value: -1 } as unknown as CounterProgress,
      { certainty: 'exact', value: -1 },
      { certainty: 'exact', value: 1.5 },
      { certainty: 'at_least', minimum: -1 },
      { certainty: 'at_least', minimum: 1.5 },
      { certainty: 'estimated', estimate: -1 },
      { certainty: 'estimated', estimate: 1.5 },
      { certainty: 'unknown', observedSinceStart: -1, trackingStartedAt: TS },
      { certainty: 'unknown', observedSinceStart: 1, trackingStartedAt: 'invalid' },
      { certainty: 'exact', value: 1, extra: true } as unknown as CounterProgress,
      { certainty: 'at_least', minimum: 1, extra: true } as unknown as CounterProgress,
    ];

    for (const counter of invalidCounters) {
      const result = setRunCounterProgress(
        createPopulatedStore(),
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-004',
        counter,
        TS2,
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(result.code).toBe('INVALID_COUNTER_PROGRESS');
    }
  });
});

describe('progress shape mismatch', () => {
  it('distinguishes wrong operation mode from stored tracker-shape mismatch', () => {
    const validShapeWrongMode = setRunBinaryCompletion(
      createPopulatedStore(),
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
      true,
      TS2,
    );
    expect(validShapeWrongMode.success).toBe(false);
    if (!validShapeWrongMode.success) {
      expect(validShapeWrongMode.code).toBe('TRACKING_MODE_MISMATCH');
    }

    const store = createPopulatedStore();
    const progress = getProgress(
      store,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
    );
    progress.checklistCompletion = { a: true };
    delete (progress as Partial<AchievementProgressV3>).counter;

    const shapeInvalidWrongMode = setRunBinaryCompletion(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
      true,
      TS2,
    );
    expect(shapeInvalidWrongMode.success).toBe(false);
    if (!shapeInvalidWrongMode.success) {
      expect(shapeInvalidWrongMode.code).toBe('PROGRESS_SHAPE_MISMATCH');
    }

    const shapeMismatch = setRunCounterProgress(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
      { certainty: 'exact', value: 1 },
      TS2,
    );
    expect(shapeMismatch.success).toBe(false);
    if (!shapeMismatch.success)
      expect(shapeMismatch.code).toBe('PROGRESS_SHAPE_MISMATCH');
  });

  it('rejects pinning when the stored progress tracker shape is invalid', () => {
    const store = createPopulatedStore();
    const progress = getProgress(
      store,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
    );
    progress.checklistCompletion = { a: true };
    delete (progress as Partial<AchievementProgressV3>).counter;
    const before = structuredClone(store);

    const result = setRunPinned(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-004',
      true,
      TS2,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('PROGRESS_SHAPE_MISMATCH');
    expect('store' in result).toBe(false);
    expect(store).toEqual(before);
  });

  it('requires checklist keys to exactly match current item IDs', () => {
    const store = createPopulatedStore();
    const progress = getProgress(
      store,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-005',
    );
    progress.checklistCompletion = {
      'task-a': true,
      'task-b': false,
    };

    const result = setRunChecklistItemCompletion(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-005',
      'task-a',
      true,
      TS2,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('PROGRESS_SHAPE_MISMATCH');
  });
});

describe('pin behavior', () => {
  it('enforces five distinct pins, order, and no-op behavior', () => {
    let store = createPopulatedStore();
    const ids = ['sd-ps-001', 'sd-ps-002', 'sd-ps-004', 'sd-ps-005', 'sd-ps-006'];
    for (const id of ids) {
      store = expectChanged(
        setRunPinned(
          store,
          mockGameStellarDrift,
          SET_PS,
          DEFAULT_RUN,
          id,
          true,
          TS2,
        ),
      );
    }
    expect(
      getRun(store, 'stellar-drift', SET_PS, DEFAULT_RUN).pinnedAchievementIds,
    ).toEqual(ids);

    expectNoChange(
      setRunPinned(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        true,
        TS3,
      ),
      store,
    );

    const limit = setRunPinned(
      store,
      mockGameStellarDrift,
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-007',
      true,
      TS3,
    );
    expect(limit.success).toBe(false);
    if (!limit.success) expect(limit.code).toBe('PIN_LIMIT_REACHED');
  });
});

describe('provenance and timestamp behavior', () => {
  it('updates achievement provenance and timestamp only for progress mutations', () => {
    const store = createPopulatedStore();
    const progress = getProgress(
      store,
      'stellar-drift',
      SET_PS,
      DEFAULT_RUN,
      'sd-ps-001',
    );
    const originalLastUpdated = progress.lastUpdated;
    expect(originalLastUpdated).toBe(TS);

    const binary = expectChanged(
      setRunBinaryCompletion(
        store,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        true,
        TS2,
      ),
    );
    expect(
      getProgress(binary, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-001').lastUpdated,
    ).toBe(TS2);

    const pinned = expectChanged(
      setRunPinned(
        binary,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'sd-ps-001',
        true,
        TS3,
      ),
    );
    expect(
      getProgress(pinned, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-001').lastUpdated,
    ).toBe(TS2);

    const staged = expectChanged(
      setRunActiveStage(
        pinned,
        mockGameStellarDrift,
        SET_PS,
        DEFAULT_RUN,
        'missables',
        TS3,
      ),
    );
    expect(
      getProgress(staged, 'stellar-drift', SET_PS, DEFAULT_RUN, 'sd-ps-001').lastUpdated,
    ).toBe(TS2);
  });
});

describe('prototype-sensitive identifiers', () => {
  const PROTOTYPE_SENSITIVE_IDS = ['constructor', 'toString', '__proto__'] as const;

  it('treats constructor and toString as valid own IDs', () => {
    for (const id of PROTOTYPE_SENSITIVE_IDS) {
      if (id === '__proto__') {
        // __proto__ is handled in the dedicated prototype-safety test below.
        continue;
      }

      const set = achievementSet(id, '1.0', [achievementRecord(id, { mode: 'binary' })]);
      const game = gameRecord(id, [set]);
      const store = createDefaultHuntMemoryStore();
      store.gameProgress[id] = createDefaultGameProgressV3(game, TS);

      const result = setRunBinaryCompletion(store, game, id, DEFAULT_RUN, id, true, TS2);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(Object.hasOwn(result.store.gameProgress, id)).toBe(true);
      expect(
        Object.hasOwn(
          result.store.gameProgress[id].sets[id].runs[DEFAULT_RUN].progress,
          id,
        ),
      ).toBe(true);
      expect(result.store.gameProgress[id].sets[id].runs[DEFAULT_RUN].progress[id].completed).toBe(
        true,
      );
    }
  });

  it('mutates and no-ops own constructor and toString run IDs', () => {
    for (const runId of ['constructor', 'toString'] as const) {
      const store = createPopulatedStore();
      const setProgress = store.gameProgress['stellar-drift'].sets[SET_PS];
      setProgress.runs = {
        ...setProgress.runs,
        [runId]: createDefaultRunProgress(
          mockGameStellarDrift.achievementSets[0],
          runId,
          `Run ${runId}`,
          TS,
        ),
      };
      const defaultRunBefore = structuredClone(setProgress.runs[DEFAULT_RUN]);

      const next = expectChanged(
        setRunBinaryCompletion(
          store,
          mockGameStellarDrift,
          SET_PS,
          runId,
          'sd-ps-001',
          true,
          TS2,
        ),
      );
      const runs = next.gameProgress['stellar-drift'].sets[SET_PS].runs;
      expect(Object.hasOwn(runs, runId)).toBe(true);
      expect(runs[runId].progress['sd-ps-001'].completed).toBe(true);
      expect(runs[DEFAULT_RUN]).toEqual(defaultRunBefore);
      expect(next.undoState?.['stellar-drift']?.runId).toBe(runId);
      expect(Object.getPrototypeOf(runs)).toBe(Object.prototype);
      expect(LocalProgressStoreV3Schema.safeParse(next).success).toBe(true);

      expectNoChange(
        setRunBinaryCompletion(
          next,
          mockGameStellarDrift,
          SET_PS,
          runId,
          'sd-ps-001',
          true,
          TS3,
        ),
        next,
      );
    }
  });

  it('mutates and no-ops own constructor and toString checklist item IDs', () => {
    const checklistAchievement = achievementRecord('checklist-achievement', {
      mode: 'checklist',
      items: [
        { id: 'constructor', name: 'Constructor' },
        { id: 'toString', name: 'To String' },
      ],
    });
    const set = achievementSet('checklist-set', '1.0', [checklistAchievement]);
    const game = gameRecord('checklist-game', [set]);
    let store = createDefaultHuntMemoryStore();
    store.gameProgress[game.id] = createDefaultGameProgressV3(game, TS);

    const missingOwnStore = structuredClone(store);
    const missingOwnChecklist = getProgress(
      missingOwnStore,
      game.id,
      set.id,
      DEFAULT_RUN,
      checklistAchievement.id,
    ).checklistCompletion!;
    delete missingOwnChecklist['constructor'];
    const missingOwn = setRunChecklistItemCompletion(
      missingOwnStore,
      game,
      set.id,
      DEFAULT_RUN,
      checklistAchievement.id,
      'toString',
      true,
      TS2,
    );
    expect(missingOwn.success).toBe(false);
    if (!missingOwn.success) {
      expect(missingOwn.code).toBe('PROGRESS_SHAPE_MISMATCH');
    }

    for (const itemId of ['constructor', 'toString'] as const) {
      store = expectChanged(
        setRunChecklistItemCompletion(
          store,
          game,
          set.id,
          DEFAULT_RUN,
          checklistAchievement.id,
          itemId,
          true,
          TS2,
        ),
      );
      const checklist = getProgress(
        store,
        game.id,
        set.id,
        DEFAULT_RUN,
        checklistAchievement.id,
      ).checklistCompletion!;
      expect(Object.hasOwn(checklist, itemId)).toBe(true);
      expect(checklist[itemId]).toBe(true);
      expect(Object.getPrototypeOf(checklist)).toBe(Object.prototype);

      expectNoChange(
        setRunChecklistItemCompletion(
          store,
          game,
          set.id,
          DEFAULT_RUN,
          checklistAchievement.id,
          itemId,
          true,
          TS3,
        ),
        store,
      );
    }

    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
  });

  it('rejects the reserved __proto__ key and avoids prototype pollution', () => {
    const store = createDefaultHuntMemoryStore();
    const unrelatedObject = {};
    const protoGame = gameRecord('__proto__', [
      achievementSet('__proto__', '1.0', [
        achievementRecord('__proto__', { mode: 'binary' }),
      ]),
    ]);

    const result = setRunBinaryCompletion(
      store,
      protoGame,
      '__proto__',
      DEFAULT_RUN,
      '__proto__',
      true,
      TS2,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('GAME_NOT_FOUND');
    expect(Object.hasOwn(store.gameProgress, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(unrelatedObject)).toBe(Object.prototype);
  });
});

describe('deep immutability', () => {
  it('leaves inputs, unrelated runs, sets, games, orphans, and undo entries deeply unchanged', () => {
    const store = createPopulatedStore();
    const targetedRun = getRun(store, 'stellar-drift', SET_PS, 'second-run');
    targetedRun.orphanedProgress = {
      ...targetedRun.orphanedProgress,
      'removed-counter': [
        {
          achievementId: 'removed-counter',
          completed: false,
          manualOverride: false,
          counter: { certainty: 'at_least', minimum: 2 },
          lastUpdated: TS,
          provenance: 'manual',
          trackingModeAtRemoval: 'counter',
        },
      ],
    };
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
    const before = structuredClone(store);
    const gameBefore = structuredClone(mockGameStellarDrift);

    const result = setRunBinaryCompletion(
      store,
      mockGameStellarDrift,
      SET_PS,
      'second-run',
      'sd-ps-001',
      true,
      TS2,
    );
    const next = expectChanged(result);

    expect(mockGameStellarDrift).toEqual(gameBefore);
    expect(store).toEqual(before);
    expect(next.gameProgress['stellar-drift'].sets[SET_PS].runs[DEFAULT_RUN]).toEqual(
      before.gameProgress['stellar-drift'].sets[SET_PS].runs[DEFAULT_RUN],
    );
    expect(next.gameProgress['stellar-drift'].sets[SET_STEAM]).toEqual(
      before.gameProgress['stellar-drift'].sets[SET_STEAM],
    );
    expect(next.gameProgress['myth-harbor']).toEqual(
      before.gameProgress['myth-harbor'],
    );
    expect(
      getRun(next, 'stellar-drift', SET_PS, 'second-run').orphanedProgress,
    ).toEqual(
      before.gameProgress['stellar-drift'].sets[SET_PS].runs['second-run']
        .orphanedProgress,
    );
  });
});

describe('demo dataset integration', () => {
  it('uses the real fictional dataset without mutating trusted input', () => {
    const loaded = validateDemoGamesDataset(rawDemoGames);
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;

    const game = loaded.data.games[0];
    const set = game.achievementSets[0];
    const achievement = set.achievements[0];
    const beforeGame = structuredClone(game);

    const store = createDefaultHuntMemoryStore();
    store.gameProgress[game.id] = createDefaultGameProgressV3(game, TS);

    const result = setRunBinaryCompletion(
      store,
      game,
      set.id,
      DEFAULT_RUN,
      achievement.id,
      true,
      TS2,
    );
    const next = expectChanged(result);
    expect(game).toEqual(beforeGame);
    expect(next.gameProgress[game.id].sets[set.id].runs[DEFAULT_RUN].progress[achievement.id].completed).toBe(true);
    expect(LocalProgressStoreV3Schema.safeParse(next).success).toBe(true);
  });
});
