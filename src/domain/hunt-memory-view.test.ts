import { describe, expect, it } from 'vitest';
import type {
  AchievementSet,
  GameRecord,
} from './achievement-schema';
import {
  AchievementProgressV3Schema,
  HUNT_MEMORY_STORE_SCHEMA_VERSION,
  LocalProgressStoreV3Schema,
  RunProgressSchema,
  type CounterProgress,
  type LocalProgressStoreV3,
  type RunProgress,
  type AchievementProgressV3,
} from './hunt-memory-schema';
import { validateTrackerShape } from './hunt-memory-tracker-shape';
import {
  CANONICAL_STAGE_ORDER,
  STAGE_DISPLAY_LABELS,
  getRunPinnedAchievements,
  getRunSavedAchievementIds,
  getRunStageSummaries,
  getTrackerPresentationV3,
  getProgressSummaryV3,
  resolveRunActiveStage,
  selectActiveWorkspaceV3,
  type ActiveWorkspaceReadyResult,
  type ActiveWorkspaceUnavailableReason,
  type ActiveWorkspaceV3Result,
  type CounterTrackerPresentationV3,
  type ChecklistTrackerPresentationV3,
  type TrackerPresentationV3,
} from './hunt-memory-view';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID,
  createDefaultAchievementProgressV3,
  createDefaultGameProgressV3,
  createDefaultHuntMemoryStore,
  createDefaultRunProgress,
} from './hunt-memory-lifecycle';
import {
  mockGameStellarDrift,
  MOCK_TIMESTAMP,
  MOCK_TIMESTAMP_2,
} from '../test/progress-fixtures';

const TS = MOCK_TIMESTAMP;
const TS2 = MOCK_TIMESTAMP_2;
const SET_PS = 'stellar-drift-ps';
const SET_STEAM = 'stellar-drift-steam';

function createValidStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.gameProgress[mockGameStellarDrift.id] = createDefaultGameProgressV3(
    mockGameStellarDrift,
    TS,
  );
  return store;
}

function expectReady(result: ActiveWorkspaceV3Result): ActiveWorkspaceReadyResult {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(result.message);
  return result;
}

function expectUnavailable(
  result: ActiveWorkspaceV3Result,
  reason: ActiveWorkspaceUnavailableReason,
): void {
  expect(result.status).toBe('unavailable');
  if (result.status !== 'unavailable') throw new Error('Expected unavailable');
  expect(result.reason).toBe(reason);
}

function makeCounterProgress(
  counter: CounterProgress,
  achievementId: string,
): AchievementProgressV3 {
  return {
    achievementId,
    completed: false,
    manualOverride: false,
    counter,
    lastUpdated: TS,
    provenance: 'manual',
  };
}

function expectCounterPresentation(
  presentation: TrackerPresentationV3,
): CounterTrackerPresentationV3 {
  expect(presentation.status).toBe('ready');
  if (presentation.status !== 'ready' || presentation.mode !== 'counter') {
    throw new Error('Expected ready counter presentation');
  }
  return presentation;
}

function expectChecklistPresentation(
  presentation: TrackerPresentationV3,
): ChecklistTrackerPresentationV3 {
  expect(presentation.status).toBe('ready');
  if (presentation.status !== 'ready' || presentation.mode !== 'checklist') {
    throw new Error('Expected ready checklist presentation');
  }
  return presentation;
}

describe('hunt-memory-view pure selectors', () => {
  describe('selectActiveWorkspaceV3', () => {
    it('returns ready workspace with matching set, active run, canonical stage summaries, pinned achievements, and saved IDs', () => {
      const store = createValidStore();
      const setProgress = store.gameProgress[mockGameStellarDrift.id].sets[SET_PS];
      const activeRun = setProgress.runs[DEFAULT_HUNT_MEMORY_RUN_ID];
      activeRun.activeStage = 'missables';
      activeRun.pinnedAchievementIds = ['sd-ps-002', 'sd-ps-001'];
      setProgress.guideStateByRunId = {
        [DEFAULT_HUNT_MEMORY_RUN_ID]: {
          savedAchievementIds: ['sd-ps-004', 'sd-ps-001'],
        },
      };

      const ready = expectReady(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store),
      );
      expect(ready.set.id).toBe(SET_PS);
      expect(ready.activeRun.runId).toBe(DEFAULT_HUNT_MEMORY_RUN_ID);
      expect(ready.activeStage).toBe('missables');
      expect(ready.pinnedAchievements.map((a) => a.id)).toEqual(['sd-ps-002', 'sd-ps-001']);
      expect(ready.savedAchievementIds).toEqual(['sd-ps-004', 'sd-ps-001']);
      expect(ready.stageSummaries.map((s) => s.stage)).toEqual(CANONICAL_STAGE_ORDER);
    });

    it('returns GAME_NOT_FOUND when game is missing from store', () => {
      expectUnavailable(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, createDefaultHuntMemoryStore()),
        'GAME_NOT_FOUND',
      );
    });

    it('returns SET_NOT_FOUND when set ID is missing from game definition', () => {
      expectUnavailable(
        selectActiveWorkspaceV3(mockGameStellarDrift, 'nonexistent-set', createValidStore()),
        'SET_NOT_FOUND',
      );
    });

    it('returns SET_NOT_FOUND when set ID is missing from active sets', () => {
      const store = createValidStore();
      delete store.gameProgress[mockGameStellarDrift.id].sets[SET_PS];
      expectUnavailable(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store),
        'SET_NOT_FOUND',
      );
    });

    it('returns SET_RETIRED when set is in retiredSets (retired set is never active)', () => {
      const store = createValidStore();
      const gameProgress = store.gameProgress[mockGameStellarDrift.id];
      const setProgress = gameProgress.sets[SET_PS];
      delete gameProgress.sets[SET_PS];
      gameProgress.retiredSets[SET_PS] = {
        ...setProgress,
        retirementReason: 'removed_set',
      };
      expectUnavailable(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store),
        'SET_RETIRED',
      );
    });

    it('returns SET_VERSION_MISMATCH when stored set version differs from definition', () => {
      const store = createValidStore();
      store.gameProgress[mockGameStellarDrift.id].sets[SET_PS].version = 'older.version.1';
      expectUnavailable(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store),
        'SET_VERSION_MISMATCH',
      );
    });

    it('returns RUN_NOT_FOUND when activeRunId references non-existent run', () => {
      // DEFENSIVE-INVALID FIXTURE: activeRunId references non-existent run in store
      const store = createValidStore();
      store.gameProgress[mockGameStellarDrift.id].sets[SET_PS].activeRunId = 'missing-run-id';
      expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(false);

      expectUnavailable(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store),
        'RUN_NOT_FOUND',
      );
    });

    it('handles prototype-sensitive own keys without inherited lookup collisions', () => {
      const customGame: GameRecord = {
        id: 'constructor',
        title: 'Edge Game',
        aliases: [],
        sourceType: 'fictional_demo',
        version: '1.0',
        theme: {
          primary: '#fff',
          secondary: '#000',
          surfaceGlow: '#aaa',
          mood: 'dark',
        },
        summary: 'Edge',
        achievementSets: [
          {
            id: 'toString',
            platform: 'steam',
            version: '1.0',
            achievements: [
              {
                id: 'valueOf',
                name: 'Val',
                description: 'D',
                evidence: 'E',
                reward: { type: 'achievement' },
                tracking: { mode: 'binary' },
                labels: ['story'],
                expectedStage: 'story',
                confidence: 1,
                prerequisites: [],
              },
            ],
          },
        ],
      };
      const setDef = customGame.achievementSets[0];
      const customStore: LocalProgressStoreV3 = {
        schemaVersion: HUNT_MEMORY_STORE_SCHEMA_VERSION,
        gameProgress: {
          ['constructor']: {
            gameId: 'constructor',
            sets: {
              ['toString']: {
                setId: 'toString',
                version: '1.0',
                activeRunId: 'isPrototypeOf',
                runs: {
                  ['isPrototypeOf']: createDefaultRunProgress(
                    setDef,
                    'isPrototypeOf',
                    'Special',
                    TS,
                  ),
                },
              },
            },
            retiredSets: {},
          },
        },
      };
      expect(
        selectActiveWorkspaceV3(customGame, 'toString', customStore).status,
      ).toBe('ready');

      expectUnavailable(
        selectActiveWorkspaceV3(customGame, 'toString', {
          schemaVersion: HUNT_MEMORY_STORE_SCHEMA_VERSION,
          gameProgress: {},
        }),
        'GAME_NOT_FOUND',
      );

      // DEFENSIVE-INVALID FIXTURE: activeRunId references missing run in runs record
      const inheritedRunStore: LocalProgressStoreV3 = {
        schemaVersion: HUNT_MEMORY_STORE_SCHEMA_VERSION,
        gameProgress: {
          ['constructor']: {
            gameId: 'constructor',
            sets: {
              ['toString']: {
                setId: 'toString',
                version: '1.0',
                activeRunId: 'toString',
                runs: {},
              },
            },
            retiredSets: {},
          },
        },
      };
      expect(LocalProgressStoreV3Schema.safeParse(inheritedRunStore).success).toBe(false);
      expectUnavailable(
        selectActiveWorkspaceV3(customGame, 'toString', inheritedRunStore),
        'RUN_NOT_FOUND',
      );
    });

    it('isolates two sets and two runs with divergent progress', () => {
      const store = createValidStore();
      const psSet = store.gameProgress[mockGameStellarDrift.id].sets[SET_PS];
      const steamSet = store.gameProgress[mockGameStellarDrift.id].sets[SET_STEAM];
      const psSetDef = mockGameStellarDrift.achievementSets[0];
      psSet.runs['cleanup-run'] = createDefaultRunProgress(
        psSetDef,
        'cleanup-run',
        'Cleanup Run',
        TS2,
      );

      psSet.runs[DEFAULT_HUNT_MEMORY_RUN_ID].progress['sd-ps-001'].completed = true;
      psSet.runs[DEFAULT_HUNT_MEMORY_RUN_ID].pinnedAchievementIds = ['sd-ps-001'];
      psSet.guideStateByRunId = {
        [DEFAULT_HUNT_MEMORY_RUN_ID]: { savedAchievementIds: ['sd-ps-001'] },
        ['cleanup-run']: { savedAchievementIds: ['sd-ps-004'] },
      };
      steamSet.runs[DEFAULT_HUNT_MEMORY_RUN_ID].progress['sd-steam-001'].completed = true;

      psSet.activeRunId = DEFAULT_HUNT_MEMORY_RUN_ID;
      const res1 = expectReady(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store),
      );
      expect(res1.activeRun.runId).toBe(DEFAULT_HUNT_MEMORY_RUN_ID);
      expect(res1.stageSummaries.find((s) => s.stage === 'story')?.completedCount).toBe(1);
      expect(res1.pinnedAchievements.map((a) => a.id)).toEqual(['sd-ps-001']);
      expect(res1.savedAchievementIds).toEqual(['sd-ps-001']);

      psSet.activeRunId = 'cleanup-run';
      const res2 = expectReady(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store),
      );
      expect(res2.activeRun.runId).toBe('cleanup-run');
      expect(res2.stageSummaries.find((s) => s.stage === 'story')?.completedCount).toBe(0);
      expect(res2.pinnedAchievements).toEqual([]);
      expect(res2.savedAchievementIds).toEqual(['sd-ps-004']);
    });

    it('asserts input immutability', () => {
      const store = createValidStore();
      const storeSnapshot = JSON.stringify(store);
      const gameSnapshot = JSON.stringify(mockGameStellarDrift);

      expect(
        selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store).status,
      ).toBe('ready');
      expect(JSON.stringify(store)).toBe(storeSnapshot);
      expect(JSON.stringify(mockGameStellarDrift)).toBe(gameSnapshot);
    });
  });

  describe('stage totals and pin order', () => {
    const setDef: AchievementSet = mockGameStellarDrift.achievementSets[0];

    it('keeps canonical stage order and defaults to story when run lacks activeStage', () => {
      const run: RunProgress = createDefaultRunProgress(setDef, 'test-run', 'Test Run', TS);
      delete run.activeStage;

      expect(resolveRunActiveStage(run)).toBe('story');

      run.activeStage = 'cleanup';
      expect(resolveRunActiveStage(run)).toBe('cleanup');

      const summaries = getRunStageSummaries(setDef, run);
      expect(summaries.map((s) => s.stage)).toEqual(CANONICAL_STAGE_ORDER);
      expect(summaries.map((s) => s.label)).toEqual([
        STAGE_DISPLAY_LABELS.story,
        STAGE_DISPLAY_LABELS.missables,
        STAGE_DISPLAY_LABELS.cleanup,
      ]);
    });

    it('stage totals use only current set achievements and active-run completed booleans', () => {
      const run: RunProgress = createDefaultRunProgress(setDef, 'test-run', 'Test Run', TS);
      run.progress['sd-ps-004'].counter = { certainty: 'exact', value: 24 };
      run.progress['sd-ps-006'].counter = { certainty: 'estimated', estimate: 10 };
      run.progress['sd-ps-001'].completed = true;

      const summaries = getRunStageSummaries(setDef, run);
      const story = summaries.find((s) => s.stage === 'story')!;
      expect(story.totalCount).toBe(2);
      expect(story.completedCount).toBe(1);
      expect(story.remainingCount).toBe(1);
      expect(story.fraction).toBe(0.5);

      const cleanup = summaries.find((s) => s.stage === 'cleanup')!;
      expect(cleanup.totalCount).toBe(3);
      expect(cleanup.completedCount).toBe(0);
      expect(cleanup.remainingCount).toBe(3);
      expect(cleanup.fraction).toBe(0);
    });

    it('defensively excludes inherited completion from stage totals', () => {
      const run = createDefaultRunProgress(setDef, 'test-run', 'Test Run', TS);
      // DEFENSIVE FIXTURE: direct in-memory prototype; not schema-parsed data.
      const inherited = { ...run.progress['sd-ps-001'], completed: true };
      delete run.progress['sd-ps-001'];
      Object.setPrototypeOf(run.progress, { 'sd-ps-001': inherited });
      expect(Object.hasOwn(run.progress, 'sd-ps-001')).toBe(false);
      expect(run.progress['sd-ps-001'].completed).toBe(true);

      const summaries = getRunStageSummaries(setDef, run);
      expect(summaries.map((stage) => stage.completedCount)).toEqual([0, 0, 0]);
      expect(summaries.find((stage) => stage.stage === 'story')?.totalCount).toBe(2);
    });

    it('pins retain saved order for schema-valid run progress', () => {
      const run: RunProgress = createDefaultRunProgress(setDef, 'test-run', 'Test Run', TS);
      run.pinnedAchievementIds = ['sd-ps-004', 'sd-ps-002', 'sd-ps-001'];
      expect(RunProgressSchema.safeParse(run).success).toBe(true);

      const pinned = getRunPinnedAchievements(setDef, run);
      expect(pinned.map((a) => a.id)).toEqual(['sd-ps-004', 'sd-ps-002', 'sd-ps-001']);
    });

    it('defensive: caps pins at five and ignores unresolvable IDs if given schema-invalid run', () => {
      // DEFENSIVE-INVALID FIXTURE: exceeds 5 pins and contains nonexistent achievement ID
      const run: RunProgress = createDefaultRunProgress(setDef, 'test-run', 'Test Run', TS);
      run.pinnedAchievementIds = [
        'sd-ps-004',
        'missing-id-999',
        'sd-ps-002',
        'sd-ps-001',
        'sd-ps-005',
        'sd-ps-006',
        'sd-ps-007',
      ];
      expect(RunProgressSchema.safeParse(run).success).toBe(false);

      const pinned = getRunPinnedAchievements(setDef, run);
      expect(pinned.length).toBe(5);
      expect(pinned.map((a) => a.id)).toEqual([
        'sd-ps-004',
        'sd-ps-002',
        'sd-ps-001',
        'sd-ps-005',
        'sd-ps-006',
      ]);
    });

    it('returns empty array when run has no pins', () => {
      const run = createDefaultRunProgress(setDef, 'test-run', 'Test Run', TS);
      expect(getRunPinnedAchievements(setDef, run)).toEqual([]);
    });
  });

  describe('active-run saved IDs (guide sidecar)', () => {
    it('exposes only active run saved achievement IDs, preserving saved order in valid store', () => {
      const store = createValidStore();
      const setProgress = store.gameProgress[mockGameStellarDrift.id].sets[SET_PS];
      setProgress.runs['other-run'] = createDefaultRunProgress(
        mockGameStellarDrift.achievementSets[0],
        'other-run',
        'Other Run',
        TS,
      );
      setProgress.guideStateByRunId = {
        [DEFAULT_HUNT_MEMORY_RUN_ID]: {
          savedAchievementIds: ['sd-ps-005', 'sd-ps-002'],
        },
        ['other-run']: {
          savedAchievementIds: ['sd-ps-001'],
        },
      };

      expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
      expect(
        getRunSavedAchievementIds(setProgress, DEFAULT_HUNT_MEMORY_RUN_ID),
      ).toEqual(['sd-ps-005', 'sd-ps-002']);
    });

    it('preserves saved IDs no longer in definition so they remain findable/removable', () => {
      const store = createValidStore();
      const setProgress = store.gameProgress[mockGameStellarDrift.id].sets[SET_PS];
      setProgress.guideStateByRunId = {
        [DEFAULT_HUNT_MEMORY_RUN_ID]: {
          savedAchievementIds: ['sd-ps-001', 'disappeared-from-pack', 'sd-ps-004'],
        },
      };

      expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
      expect(
        getRunSavedAchievementIds(setProgress, DEFAULT_HUNT_MEMORY_RUN_ID),
      ).toEqual(['sd-ps-001', 'disappeared-from-pack', 'sd-ps-004']);
    });

    it('accepts own guide entries for a prototype-sensitive run ID and rejects inherited entries', () => {
      const store = createValidStore();
      const setProgress = store.gameProgress[mockGameStellarDrift.id].sets[SET_PS];
      const runId = 'constructor';
      setProgress.runs[runId] = createDefaultRunProgress(
        mockGameStellarDrift.achievementSets[0], runId, 'Special Run', TS,
      );
      setProgress.activeRunId = runId;
      const entry = { savedAchievementIds: ['sd-ps-002', 'disappeared-from-pack'] };
      setProgress.guideStateByRunId = { [runId]: entry };
      expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
      expect(Object.hasOwn(setProgress.guideStateByRunId, runId)).toBe(true);
      expect(getRunSavedAchievementIds(setProgress, runId)).toEqual(entry.savedAchievementIds);

      // DEFENSIVE FIXTURE: direct in-memory prototype; not schema-parsed data.
      setProgress.guideStateByRunId = Object.create({ [runId]: entry });
      expect(Object.hasOwn(setProgress.guideStateByRunId!, runId)).toBe(false);
      expect(getRunSavedAchievementIds(setProgress, runId)).toEqual([]);
    });

    it('returns savedAchievementIds detached from the stored guide list', () => {
      const store = createValidStore();
      const setProgress = store.gameProgress[mockGameStellarDrift.id].sets[SET_PS];
      const savedAchievementIds = ['sd-ps-002', 'disappeared-from-pack'];
      setProgress.guideStateByRunId = {
        [DEFAULT_HUNT_MEMORY_RUN_ID]: { savedAchievementIds },
      };
      expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
      const snapshot = JSON.stringify(store);
      const ready = expectReady(selectActiveWorkspaceV3(mockGameStellarDrift, SET_PS, store));
      expect(ready.savedAchievementIds).toEqual(savedAchievementIds);
      expect(ready.savedAchievementIds).not.toBe(savedAchievementIds);
      ready.savedAchievementIds.splice(0, 1, 'changed-id');
      ready.savedAchievementIds.push('added-id');
      expect(savedAchievementIds).toEqual(['sd-ps-002', 'disappeared-from-pack']);
      expect(JSON.stringify(store)).toBe(snapshot);
    });

    it('returns empty array when guide sidecar is absent or active run has no entry', () => {
      const store = createValidStore();
      const setProgress = store.gameProgress[mockGameStellarDrift.id].sets[SET_PS];
      expect(
        getRunSavedAchievementIds(setProgress, DEFAULT_HUNT_MEMORY_RUN_ID),
      ).toEqual([]);
      setProgress.guideStateByRunId = {};
      expect(
        getRunSavedAchievementIds(setProgress, DEFAULT_HUNT_MEMORY_RUN_ID),
      ).toEqual([]);
    });
  });

  describe('getTrackerPresentationV3 and getProgressSummaryV3', () => {
    const binaryAch = mockGameStellarDrift.achievementSets[0].achievements[0];
    const counterAch = mockGameStellarDrift.achievementSets[0].achievements[2];
    const checklistAch = mockGameStellarDrift.achievementSets[0].achievements[3];
    const openCounterAch = mockGameStellarDrift.achievementSets[0].achievements[4];

    it('binary tracking presents direct completion with no summary string', () => {
      const progress = createDefaultAchievementProgressV3(binaryAch, TS);
      progress.completed = true;
      expect(getTrackerPresentationV3(binaryAch, progress)).toEqual({
        status: 'ready',
        mode: 'binary',
        completed: true,
      });
      expect(getProgressSummaryV3(binaryAch, progress)).toBeUndefined();
    });

    it('returns MISSING_PROGRESS when achievement progress record is absent', () => {
      expect(getTrackerPresentationV3(binaryAch, undefined)).toEqual({
        status: 'unavailable',
        reason: 'MISSING_PROGRESS',
      });
      expect(getProgressSummaryV3(binaryAch, undefined)).toBeUndefined();
    });

    it('returns TRACKER_SHAPE_MISMATCH when present progress achievementId does not match definition', () => {
      const counterProgress = createDefaultAchievementProgressV3(counterAch, TS);
      expect(getTrackerPresentationV3(binaryAch, counterProgress)).toEqual({
        status: 'unavailable',
        reason: 'TRACKER_SHAPE_MISMATCH',
      });
      expect(getProgressSummaryV3(binaryAch, counterProgress)).toBeUndefined();
    });

    it('returns unavailable on tracker shape mismatch without inventing zeros', () => {
      // DEFENSIVE-INVALID FIXTURE: counter progress paired with binary achievement tracking
      const invalidBinary: AchievementProgressV3 = {
        achievementId: binaryAch.id,
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 5 },
        lastUpdated: TS,
        provenance: 'manual',
      };
      expect(validateTrackerShape(invalidBinary, binaryAch.tracking)).toBe(false);
      expect(getTrackerPresentationV3(binaryAch, invalidBinary)).toEqual({
        status: 'unavailable',
        reason: 'TRACKER_SHAPE_MISMATCH',
      });

      // DEFENSIVE-INVALID FIXTURE: progress without counter field paired with counter achievement tracking
      const invalidCounter: AchievementProgressV3 = {
        achievementId: counterAch.id,
        completed: false,
        manualOverride: false,
        lastUpdated: TS,
        provenance: 'manual',
      };
      expect(validateTrackerShape(invalidCounter, counterAch.tracking)).toBe(false);
      expect(getTrackerPresentationV3(counterAch, invalidCounter)).toEqual({
        status: 'unavailable',
        reason: 'TRACKER_SHAPE_MISMATCH',
      });
    });

    describe('counter certainty modes (bounded)', () => {
      it('exact bounded counter provides exact metrics and summary', () => {
        const p = makeCounterProgress({ certainty: 'exact', value: 12 }, counterAch.id);
        const r = expectCounterPresentation(getTrackerPresentationV3(counterAch, p));
        expect(r.metrics).toEqual({
          certainty: 'exact',
          value: 12,
          remaining: 36,
          percentage: 25,
        });
        expect(r.summary).toBe('Progress: 12 / 48 (36 remaining, 25%)');
        expect(getProgressSummaryV3(counterAch, p)).toBe('Progress: 12 / 48 (36 remaining, 25%)');
      });

      it('at_least bounded counter provides lower-bound metrics without claiming exactness', () => {
        const p = makeCounterProgress({ certainty: 'at_least', minimum: 24 }, counterAch.id);
        const r = expectCounterPresentation(getTrackerPresentationV3(counterAch, p));
        expect(r.metrics).toEqual({
          certainty: 'at_least',
          minimum: 24,
          atMostRemaining: 24,
          lowerBoundPercentage: 50,
        });
        expect(r.summary).toBe('Progress: At least 24 / 48 (at most 24 remaining, >=50%)');
      });

      it('estimated bounded counter provides approximate metrics without claiming exactness', () => {
        const p = makeCounterProgress({ certainty: 'estimated', estimate: 36 }, counterAch.id);
        const r = expectCounterPresentation(getTrackerPresentationV3(counterAch, p));
        expect(r.metrics).toEqual({
          certainty: 'estimated',
          estimate: 36,
          approximateRemaining: 12,
          approximatePercentage: 75,
        });
        expect(r.summary).toBe('Progress: ~36 / 48 (~12 remaining, ~75%)');
      });

      it('unknown bounded counter has no invented remaining or percentage', () => {
        const p = makeCounterProgress(
          {
            certainty: 'unknown',
            observedSinceStart: 7,
            trackingStartedAt: TS,
          },
          counterAch.id,
        );
        const r = expectCounterPresentation(getTrackerPresentationV3(counterAch, p));
        expect(r.metrics).toEqual({
          certainty: 'unknown',
          observedSinceStart: 7,
          trackingStartedAt: TS,
        });
        expect('remaining' in r.metrics).toBe(false);
        expect('percentage' in r.metrics).toBe(false);
        expect(r.summary).toBe(`Progress: +7 tracked since ${TS}`);
      });
    });

    describe('counter certainty modes (open)', () => {
      it('open counters have no invented remaining count or percentage in any certainty mode', () => {
        const pExact = makeCounterProgress({ certainty: 'exact', value: 15 }, openCounterAch.id);
        const rExact = expectCounterPresentation(getTrackerPresentationV3(openCounterAch, pExact));
        expect(rExact.metrics).toEqual({ certainty: 'exact', value: 15 });
        expect(rExact.summary).toBe('Progress: 15 duels (open counter)');

        const pAtLeast = makeCounterProgress({ certainty: 'at_least', minimum: 10 }, openCounterAch.id);
        const rAtLeast = expectCounterPresentation(getTrackerPresentationV3(openCounterAch, pAtLeast));
        expect(rAtLeast.metrics).toEqual({ certainty: 'at_least', minimum: 10 });
        expect(rAtLeast.summary).toBe('Progress: At least 10 duels (open counter)');

        const pEst = makeCounterProgress({ certainty: 'estimated', estimate: 8 }, openCounterAch.id);
        const rEst = expectCounterPresentation(getTrackerPresentationV3(openCounterAch, pEst));
        expect(rEst.metrics).toEqual({ certainty: 'estimated', estimate: 8 });
        expect(rEst.summary).toBe('Progress: ~8 duels (open counter)');

        const pUnk = makeCounterProgress(
          {
            certainty: 'unknown',
            observedSinceStart: 3,
            trackingStartedAt: TS,
          },
          openCounterAch.id,
        );
        const rUnk = expectCounterPresentation(getTrackerPresentationV3(openCounterAch, pUnk));
        expect(rUnk.metrics).toEqual({
          certainty: 'unknown',
          observedSinceStart: 3,
          trackingStartedAt: TS,
        });
        expect(rUnk.summary).toBe(`Progress: +3 tracked since ${TS}`);
      });
    });

    describe('checklist tracking', () => {
      it('counts definition item completions and ignores unrelated inherited keys', () => {
        // Shape validation already requires every definition ID as an own key.
        // These unrelated inherited keys do not isolate the counting loop's own-key guard.
        const completionMap = Object.create({
          'task-inherited': true,
          toString: true,
        });
        completionMap['task-a'] = true;
        completionMap['task-b'] = false;
        completionMap['task-c'] = true;

        const progress: AchievementProgressV3 = {
          achievementId: checklistAch.id,
          completed: false,
          manualOverride: false,
          checklistCompletion: completionMap,
          lastUpdated: TS,
          provenance: 'manual',
        };

        const res = expectChecklistPresentation(
          getTrackerPresentationV3(checklistAch, progress),
        );
        expect(res.totalCount).toBe(3);
        expect(res.completedCount).toBe(2);
        expect(res.remainingCount).toBe(1);
        expect(res.percentage).toBe(66);
        expect(res.items).toEqual([
          { id: 'task-a', completed: true },
          { id: 'task-b', completed: false },
          { id: 'task-c', completed: true },
        ]);
        expect(res.summary).toBe('Progress: 2 / 3 items (1 remaining, 66%)');
      });

      it('omits exact checklist item names from the tracker projection', () => {
        if (checklistAch.tracking.mode !== 'checklist') throw new Error('Expected checklist');
        const progress = createDefaultAchievementProgressV3(checklistAch, TS);
        const res = expectChecklistPresentation(getTrackerPresentationV3(checklistAch, progress));
        expect(res.items.map((item) => item.id)).toEqual(['task-a', 'task-b', 'task-c']);
        for (const item of res.items) {
          expect(Object.hasOwn(item, 'name')).toBe(false);
        }
        for (const item of checklistAch.tracking.items) {
          expect(JSON.stringify(res)).not.toContain(item.name);
        }
      });

      it('requires exact-true completion and does not treat truthy non-booleans as complete', () => {
        // DEFENSIVE-INVALID FIXTURE: truthy non-boolean values in checklistCompletion violate schema
        const completionMap: Record<string, boolean> = {
          'task-a': true,
          'task-b': 'true' as unknown as boolean,
          'task-c': 1 as unknown as boolean,
        };
        const progress: AchievementProgressV3 = {
          achievementId: checklistAch.id,
          completed: false,
          manualOverride: false,
          checklistCompletion: completionMap,
          lastUpdated: TS,
          provenance: 'manual',
        };
        expect(AchievementProgressV3Schema.safeParse(progress).success).toBe(false);

        const res = expectChecklistPresentation(
          getTrackerPresentationV3(checklistAch, progress),
        );
        expect(res.completedCount).toBe(1);
        expect(res.items).toEqual([
          { id: 'task-a', completed: true },
          { id: 'task-b', completed: false },
          { id: 'task-c', completed: false },
        ]);
      });

      it('returns TRACKER_SHAPE_MISMATCH when checklist completion has mismatched keys', () => {
        // DEFENSIVE-INVALID FIXTURE: checklist completion includes extraneous key not in achievement definition
        const extraProgress: AchievementProgressV3 = {
          achievementId: checklistAch.id,
          completed: false,
          manualOverride: false,
          checklistCompletion: {
            'task-a': true,
            'task-b': false,
            'task-c': true,
            'stale-extra': true,
          },
          lastUpdated: TS,
          provenance: 'manual',
        };
        expect(validateTrackerShape(extraProgress, checklistAch.tracking)).toBe(false);
        expect(getTrackerPresentationV3(checklistAch, extraProgress)).toEqual({
          status: 'unavailable',
          reason: 'TRACKER_SHAPE_MISMATCH',
        });

        // DEFENSIVE-INVALID FIXTURE: checklist completion is missing an item key from achievement definition
        const missingProgress: AchievementProgressV3 = {
          achievementId: checklistAch.id,
          completed: false,
          manualOverride: false,
          checklistCompletion: { 'task-a': true, 'task-b': false },
          lastUpdated: TS,
          provenance: 'manual',
        };
        expect(validateTrackerShape(missingProgress, checklistAch.tracking)).toBe(false);
        expect(getTrackerPresentationV3(checklistAch, missingProgress)).toEqual({
          status: 'unavailable',
          reason: 'TRACKER_SHAPE_MISMATCH',
        });
      });
    });
  });
});
