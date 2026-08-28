import type {
  AchievementRecord,
  AchievementSet,
  GameRecord,
  TrackingConfiguration,
} from './achievement-schema';
import {
  CounterProgressSchema,
  type AchievementProgressV3,
  type AchievementSetProgressV3,
  type CounterProgress,
  type GameProgressV3,
  type LocalProgressStoreV3,
  type ProgressUndoSnapshotV3,
  type RunProgress,
} from './hunt-memory-schema';
import { isIsoUtcString } from './progress-schema-common';

export type HuntMemoryMutationFailureCode =
  | 'INVALID_TIMESTAMP'
  | 'INVALID_COUNTER_PROGRESS'
  | 'GAME_NOT_FOUND'
  | 'SET_RETIRED'
  | 'SET_NOT_FOUND'
  | 'SET_VERSION_MISMATCH'
  | 'RUN_NOT_FOUND'
  | 'ACHIEVEMENT_NOT_FOUND'
  | 'PROGRESS_NOT_FOUND'
  | 'PROGRESS_SHAPE_MISMATCH'
  | 'TRACKING_MODE_MISMATCH'
  | 'CHECKLIST_ITEM_NOT_FOUND'
  | 'PIN_LIMIT_REACHED'
  | 'COMPLETION_OVERRIDE_UNSUPPORTED';

export type HuntMemoryMutationResult =
  | { success: true; store: LocalProgressStoreV3; changed: boolean }
  | { success: false; code: HuntMemoryMutationFailureCode; message: string };

export type HuntMemoryUndoFailureCode =
  | 'NO_UNDO_SNAPSHOT'
  | 'GAME_NOT_FOUND'
  | 'SET_RETIRED'
  | 'SET_NOT_FOUND'
  | 'SET_VERSION_MISMATCH'
  | 'RUN_NOT_FOUND'
  | 'UNDO_SNAPSHOT_INVALID';

export type HuntMemoryUndoResult =
  | { success: true; store: LocalProgressStoreV3 }
  | { success: false; code: HuntMemoryUndoFailureCode; message: string };

export type CounterDisplayMetrics =
  | {
      certainty: 'exact';
      value: number;
      remaining?: number;
      percentage?: number;
    }
  | {
      certainty: 'at_least';
      minimum: number;
      atMostRemaining?: number;
      lowerBoundPercentage?: number;
    }
  | {
      certainty: 'estimated';
      estimate: number;
      approximateRemaining?: number;
      approximatePercentage?: number;
    }
  | {
      certainty: 'unknown';
      observedSinceStart: number;
      trackingStartedAt: string;
    };

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function mutationFailure(
  code: HuntMemoryMutationFailureCode,
  message: string,
): HuntMemoryMutationResult {
  return { success: false, code, message };
}

function undoFailure(
  code: HuntMemoryUndoFailureCode,
  message: string,
): HuntMemoryUndoResult {
  return { success: false, code, message };
}

function successResult(
  store: LocalProgressStoreV3,
  changed: boolean,
): HuntMemoryMutationResult {
  return { success: true, store, changed };
}

function validateTrackerShape(
  progress: AchievementProgressV3,
  tracking: TrackingConfiguration,
): boolean {
  if (tracking.mode === 'binary') {
    return progress.counter === undefined && progress.checklistCompletion === undefined;
  }

  if (tracking.mode === 'counter') {
    return progress.counter !== undefined && progress.checklistCompletion === undefined;
  }

  const checklist = progress.checklistCompletion;
  if (progress.counter !== undefined || checklist === undefined) {
    return false;
  }
  const expectedIds = tracking.items.map((item) => item.id);
  const actualIds = Object.keys(checklist);
  return (
    actualIds.length === expectedIds.length &&
    expectedIds.every((id) => Object.hasOwn(checklist, id))
  );
}

type RunMutationContext = {
  gameProgress: GameProgressV3;
  setDefinition: AchievementSet;
  setProgress: AchievementSetProgressV3;
  runProgress: RunProgress;
};

function prepareRunMutationContext(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  timestamp: string,
): RunMutationContext | HuntMemoryMutationResult {
  if (!isIsoUtcString(timestamp)) {
    return mutationFailure(
      'INVALID_TIMESTAMP',
      `Invalid ISO-8601 UTC timestamp: ${timestamp}`,
    );
  }

  if (!Object.hasOwn(store.gameProgress, game.id)) {
    return mutationFailure(
      'GAME_NOT_FOUND',
      `Game '${game.id}' does not exist in the store`,
    );
  }
  const gameProgress = store.gameProgress[game.id];

  if (Object.hasOwn(gameProgress.retiredSets, setId)) {
    return mutationFailure(
      'SET_RETIRED',
      `Set '${setId}' is retired in game '${game.id}'`,
    );
  }

  const setDefinition = game.achievementSets.find((candidate) => candidate.id === setId);
  if (!Object.hasOwn(gameProgress.sets, setId) || !setDefinition) {
    return mutationFailure(
      'SET_NOT_FOUND',
      `Set '${setId}' does not exist as an active set in game '${game.id}'`,
    );
  }
  const setProgress = gameProgress.sets[setId];

  if (setProgress.version !== setDefinition.version) {
    return mutationFailure(
      'SET_VERSION_MISMATCH',
      `Set '${setId}' version mismatch: stored '${setProgress.version}', expected '${setDefinition.version}'`,
    );
  }

  if (!Object.hasOwn(setProgress.runs, runId)) {
    return mutationFailure(
      'RUN_NOT_FOUND',
      `Run '${runId}' does not exist in set '${setId}'`,
    );
  }
  const runProgress = setProgress.runs[runId];

  return { gameProgress, setDefinition, setProgress, runProgress };
}

type AchievementMutationContext = RunMutationContext & {
  achievementDefinition: AchievementRecord;
  progress: AchievementProgressV3;
};

function prepareAchievementMutationContext(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  achievementId: string,
  timestamp: string,
): AchievementMutationContext | HuntMemoryMutationResult {
  const runContext = prepareRunMutationContext(store, game, setId, runId, timestamp);
  if (!('gameProgress' in runContext)) {
    return runContext;
  }

  const achievementDefinition = runContext.setDefinition.achievements.find(
    (candidate) => candidate.id === achievementId,
  );
  if (!achievementDefinition) {
    return mutationFailure(
      'ACHIEVEMENT_NOT_FOUND',
      `Achievement '${achievementId}' not found in set '${setId}'`,
    );
  }

  if (!Object.hasOwn(runContext.runProgress.progress, achievementId)) {
    return mutationFailure(
      'PROGRESS_NOT_FOUND',
      `Progress for achievement '${achievementId}' is missing from run '${runId}'`,
    );
  }
  const progress = runContext.runProgress.progress[achievementId];

  if (!validateTrackerShape(progress, achievementDefinition.tracking)) {
    return mutationFailure(
      'PROGRESS_SHAPE_MISMATCH',
      `Progress shape for achievement '${achievementId}' does not match tracking mode '${achievementDefinition.tracking.mode}'`,
    );
  }

  return { ...runContext, achievementDefinition, progress };
}

function createRunSnapshot(
  setProgress: AchievementSetProgressV3,
  runProgress: RunProgress,
): ProgressUndoSnapshotV3 {
  return {
    setId: setProgress.setId,
    runId: runProgress.runId,
    guardedSetVersion: setProgress.version,
    previous: deepClone(runProgress),
  };
}

function cloneStoreForRunMutation(
  store: LocalProgressStoreV3,
  gameProgress: GameProgressV3,
  setProgress: AchievementSetProgressV3,
  runProgress: RunProgress,
): LocalProgressStoreV3 {
  const nextStore = deepClone(store);
  nextStore.undoState = {
    ...nextStore.undoState,
    [gameProgress.gameId]: createRunSnapshot(setProgress, runProgress),
  };
  return nextStore;
}

function replaceRun(
  store: LocalProgressStoreV3,
  gameId: string,
  setId: string,
  runId: string,
  nextRun: RunProgress,
): void {
  store.gameProgress[gameId].sets[setId].runs = {
    ...store.gameProgress[gameId].sets[setId].runs,
    [runId]: nextRun,
  };
}

function replaceProgress(
  run: RunProgress,
  achievementId: string,
  nextProgress: AchievementProgressV3,
): void {
  run.progress = {
    ...run.progress,
    [achievementId]: nextProgress,
  };
}

function sameBooleanMap(
  left: Record<string, boolean> | undefined,
  right: Record<string, boolean>,
): boolean {
  if (left === undefined) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    rightKeys.every(
      (key) => Object.hasOwn(left, key) && left[key] === right[key],
    )
  );
}

function counterValuesEqual(
  left: CounterProgress | undefined,
  right: CounterProgress,
): boolean {
  if (left === undefined) return false;
  if (left.certainty !== right.certainty) return false;

  switch (left.certainty) {
    case 'exact':
      return left.value === (right as Extract<CounterProgress, { certainty: 'exact' }>).value;
    case 'at_least':
      return (
        left.minimum ===
        (right as Extract<CounterProgress, { certainty: 'at_least' }>).minimum
      );
    case 'estimated':
      return (
        left.estimate ===
        (right as Extract<CounterProgress, { certainty: 'estimated' }>).estimate
      );
    case 'unknown':
      return (
        left.observedSinceStart ===
          (right as Extract<CounterProgress, { certainty: 'unknown' }>)
            .observedSinceStart &&
        left.trackingStartedAt ===
          (right as Extract<CounterProgress, { certainty: 'unknown' }>).trackingStartedAt
      );
  }
}

export function computeDerivedCompletionV3(
  achievement: AchievementRecord,
  progress: AchievementProgressV3,
): boolean {
  if (achievement.tracking.mode === 'binary') {
    return progress.completed;
  }

  if (progress.manualOverride) return true;

  if (achievement.tracking.mode === 'counter') {
    const target = achievement.tracking.target;
    if (target === undefined) return false;

    const counter = progress.counter;
    if (!counter) return false;

    if (counter.certainty === 'exact') {
      return counter.value >= target;
    }
    if (counter.certainty === 'at_least') {
      return counter.minimum >= target;
    }
    return false;
  }

  return achievement.tracking.items.every(
    (item) => progress.checklistCompletion?.[item.id] === true,
  );
}

export function getCounterDisplayMetrics(
  tracking: Extract<TrackingConfiguration, { mode: 'counter' }>,
  counter: CounterProgress,
): CounterDisplayMetrics {
  const target = tracking.target;

  switch (counter.certainty) {
    case 'exact': {
      if (target === undefined) {
        return { certainty: 'exact', value: counter.value };
      }
      return {
        certainty: 'exact',
        value: counter.value,
        remaining: Math.max(0, target - counter.value),
        percentage: Math.min(100, Math.floor((counter.value / target) * 100)),
      };
    }
    case 'at_least': {
      if (target === undefined) {
        return { certainty: 'at_least', minimum: counter.minimum };
      }
      return {
        certainty: 'at_least',
        minimum: counter.minimum,
        atMostRemaining: Math.max(0, target - counter.minimum),
        lowerBoundPercentage: Math.min(
          100,
          Math.floor((counter.minimum / target) * 100),
        ),
      };
    }
    case 'estimated': {
      if (target === undefined) {
        return { certainty: 'estimated', estimate: counter.estimate };
      }
      return {
        certainty: 'estimated',
        estimate: counter.estimate,
        approximateRemaining: Math.max(0, target - counter.estimate),
        approximatePercentage: Math.min(
          100,
          Math.floor((counter.estimate / target) * 100),
        ),
      };
    }
    case 'unknown': {
      return {
        certainty: 'unknown',
        observedSinceStart: counter.observedSinceStart,
        trackingStartedAt: counter.trackingStartedAt,
      };
    }
  }
}

export function setRunBinaryCompletion(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  achievementId: string,
  completed: boolean,
  timestamp: string,
): HuntMemoryMutationResult {
  const context = prepareAchievementMutationContext(
    store,
    game,
    setId,
    runId,
    achievementId,
    timestamp,
  );
  if (!('progress' in context)) return context;

  if (context.achievementDefinition.tracking.mode !== 'binary') {
    return mutationFailure(
      'TRACKING_MODE_MISMATCH',
      `Achievement '${achievementId}' tracking mode is '${context.achievementDefinition.tracking.mode}', expected 'binary'`,
    );
  }

  const progress = context.progress;
  const isEffectiveNoOp =
    progress.completed === completed &&
    progress.manualOverride === false &&
    progress.counter === undefined &&
    progress.checklistCompletion === undefined;
  if (isEffectiveNoOp) {
    return successResult(store, false);
  }

  const nextStore = cloneStoreForRunMutation(
    store,
    context.gameProgress,
    context.setProgress,
    context.runProgress,
  );
  const nextRun = nextStore.gameProgress[game.id].sets[setId].runs[runId];
  const nextProgress: AchievementProgressV3 = {
    ...progress,
    completed,
    manualOverride: false,
    provenance: 'manual',
    lastUpdated: timestamp,
  };
  delete nextProgress.counter;
  delete nextProgress.checklistCompletion;
  replaceProgress(nextRun, achievementId, nextProgress);
  replaceRun(nextStore, game.id, setId, runId, nextRun);

  return successResult(nextStore, true);
}

export function setRunCounterProgress(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  achievementId: string,
  counter: CounterProgress,
  timestamp: string,
): HuntMemoryMutationResult {
  const context = prepareAchievementMutationContext(
    store,
    game,
    setId,
    runId,
    achievementId,
    timestamp,
  );
  if (!('progress' in context)) return context;

  if (context.achievementDefinition.tracking.mode !== 'counter') {
    return mutationFailure(
      'TRACKING_MODE_MISMATCH',
      `Achievement '${achievementId}' tracking mode is '${context.achievementDefinition.tracking.mode}', expected 'counter'`,
    );
  }

  const counterValidation = CounterProgressSchema.safeParse(counter);
  if (!counterValidation.success) {
    return mutationFailure(
      'INVALID_COUNTER_PROGRESS',
      `Invalid counter progress for achievement '${achievementId}': ${counterValidation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const acceptedCounter = deepClone(counterValidation.data);

  const progress = context.progress;
  const derivedCompleted = computeDerivedCompletionV3(context.achievementDefinition, {
    ...progress,
    counter: acceptedCounter,
  });
  const completed = progress.manualOverride ? true : derivedCompleted;

  const isEffectiveNoOp =
    counterValuesEqual(progress.counter, acceptedCounter) &&
    progress.checklistCompletion === undefined &&
    progress.completed === completed;
  if (isEffectiveNoOp) {
    return successResult(store, false);
  }

  const nextStore = cloneStoreForRunMutation(
    store,
    context.gameProgress,
    context.setProgress,
    context.runProgress,
  );
  const nextRun = nextStore.gameProgress[game.id].sets[setId].runs[runId];
  const nextProgress: AchievementProgressV3 = {
    ...progress,
    counter: acceptedCounter,
    completed,
    provenance: 'manual',
    lastUpdated: timestamp,
  };
  delete nextProgress.checklistCompletion;
  replaceProgress(nextRun, achievementId, nextProgress);
  replaceRun(nextStore, game.id, setId, runId, nextRun);

  return successResult(nextStore, true);
}

export function setRunChecklistItemCompletion(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  achievementId: string,
  itemId: string,
  completed: boolean,
  timestamp: string,
): HuntMemoryMutationResult {
  const context = prepareAchievementMutationContext(
    store,
    game,
    setId,
    runId,
    achievementId,
    timestamp,
  );
  if (!('progress' in context)) return context;

  const tracking = context.achievementDefinition.tracking;
  if (tracking.mode !== 'checklist') {
    return mutationFailure(
      'TRACKING_MODE_MISMATCH',
      `Achievement '${achievementId}' tracking mode is '${tracking.mode}', expected 'checklist'`,
    );
  }

  if (!tracking.items.some((item) => item.id === itemId)) {
    return mutationFailure(
      'CHECKLIST_ITEM_NOT_FOUND',
      `Checklist item '${itemId}' not found in achievement '${achievementId}'`,
    );
  }

  const progress = context.progress;
  const checklistCompletion = Object.fromEntries(
    tracking.items.map((item) => [
      item.id,
      item.id === itemId
        ? completed
        : progress.checklistCompletion?.[item.id] === true,
    ]),
  );
  const derivedCompleted = computeDerivedCompletionV3(context.achievementDefinition, {
    ...progress,
    checklistCompletion,
  });
  const nextCompleted = progress.manualOverride ? true : derivedCompleted;

  const isEffectiveNoOp =
    sameBooleanMap(progress.checklistCompletion, checklistCompletion) &&
    progress.counter === undefined &&
    progress.completed === nextCompleted;
  if (isEffectiveNoOp) {
    return successResult(store, false);
  }

  const nextStore = cloneStoreForRunMutation(
    store,
    context.gameProgress,
    context.setProgress,
    context.runProgress,
  );
  const nextRun = nextStore.gameProgress[game.id].sets[setId].runs[runId];
  const nextProgress: AchievementProgressV3 = {
    ...progress,
    checklistCompletion,
    completed: nextCompleted,
    provenance: 'manual',
    lastUpdated: timestamp,
  };
  delete nextProgress.counter;
  replaceProgress(nextRun, achievementId, nextProgress);
  replaceRun(nextStore, game.id, setId, runId, nextRun);

  return successResult(nextStore, true);
}

export function setRunNotes(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  achievementId: string,
  notes: string | undefined,
  timestamp: string,
): HuntMemoryMutationResult {
  const context = prepareAchievementMutationContext(
    store,
    game,
    setId,
    runId,
    achievementId,
    timestamp,
  );
  if (!('progress' in context)) return context;

  const progress = context.progress;
  if (progress.notes === notes) {
    return successResult(store, false);
  }

  const nextStore = cloneStoreForRunMutation(
    store,
    context.gameProgress,
    context.setProgress,
    context.runProgress,
  );
  const nextRun = nextStore.gameProgress[game.id].sets[setId].runs[runId];
  const nextProgress: AchievementProgressV3 = {
    ...progress,
    provenance: 'manual',
    lastUpdated: timestamp,
  };
  if (notes === undefined) {
    delete nextProgress.notes;
  } else {
    nextProgress.notes = notes;
  }
  replaceProgress(nextRun, achievementId, nextProgress);
  replaceRun(nextStore, game.id, setId, runId, nextRun);

  return successResult(nextStore, true);
}

export function setRunCompletionOverride(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  achievementId: string,
  override: boolean,
  timestamp: string,
): HuntMemoryMutationResult {
  const context = prepareAchievementMutationContext(
    store,
    game,
    setId,
    runId,
    achievementId,
    timestamp,
  );
  if (!('progress' in context)) return context;

  if (context.achievementDefinition.tracking.mode === 'binary') {
    return mutationFailure(
      'COMPLETION_OVERRIDE_UNSUPPORTED',
      `Binary achievement '${achievementId}' does not support completion override`,
    );
  }

  const progress = context.progress;
  const derivedCompleted = computeDerivedCompletionV3(
    context.achievementDefinition,
    { ...progress, manualOverride: false },
  );
  const nextCompleted = override ? true : derivedCompleted;

  const isEffectiveNoOp =
    progress.manualOverride === override &&
    progress.completed === nextCompleted &&
    validateTrackerShape(progress, context.achievementDefinition.tracking);
  if (isEffectiveNoOp) {
    return successResult(store, false);
  }

  const nextStore = cloneStoreForRunMutation(
    store,
    context.gameProgress,
    context.setProgress,
    context.runProgress,
  );
  const nextRun = nextStore.gameProgress[game.id].sets[setId].runs[runId];
  const nextProgress: AchievementProgressV3 = {
    ...progress,
    manualOverride: override,
    completed: nextCompleted,
    provenance: 'manual',
    lastUpdated: timestamp,
  };
  replaceProgress(nextRun, achievementId, nextProgress);
  replaceRun(nextStore, game.id, setId, runId, nextRun);

  return successResult(nextStore, true);
}

export function setRunPinned(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  achievementId: string,
  pinned: boolean,
  timestamp: string,
): HuntMemoryMutationResult {
  const context = prepareAchievementMutationContext(
    store,
    game,
    setId,
    runId,
    achievementId,
    timestamp,
  );
  if (!('progress' in context)) return context;

  const runProgress = context.runProgress;
  const isPinned = runProgress.pinnedAchievementIds.includes(achievementId);
  if (pinned === isPinned) {
    return successResult(store, false);
  }

  if (pinned && runProgress.pinnedAchievementIds.length >= 5) {
    return mutationFailure(
      'PIN_LIMIT_REACHED',
      `Cannot pin more than 5 achievements in run '${runId}'`,
    );
  }

  const nextPinnedIds = pinned
    ? [...runProgress.pinnedAchievementIds, achievementId]
    : runProgress.pinnedAchievementIds.filter((id) => id !== achievementId);

  const nextStore = cloneStoreForRunMutation(
    store,
    context.gameProgress,
    context.setProgress,
    context.runProgress,
  );
  const nextRun = nextStore.gameProgress[game.id].sets[setId].runs[runId];
  nextRun.pinnedAchievementIds = nextPinnedIds;
  replaceRun(nextStore, game.id, setId, runId, nextRun);

  return successResult(nextStore, true);
}

export function setRunActiveStage(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  stage: 'story' | 'missables' | 'cleanup' | undefined,
  timestamp: string,
): HuntMemoryMutationResult {
  const context = prepareRunMutationContext(store, game, setId, runId, timestamp);
  if (!('gameProgress' in context)) return context;

  const runProgress = context.runProgress;
  if (runProgress.activeStage === stage) {
    return successResult(store, false);
  }

  const nextStore = cloneStoreForRunMutation(
    store,
    context.gameProgress,
    context.setProgress,
    context.runProgress,
  );
  const nextRun = nextStore.gameProgress[game.id].sets[setId].runs[runId];
  if (stage === undefined) {
    delete nextRun.activeStage;
  } else {
    nextRun.activeStage = stage;
  }
  replaceRun(nextStore, game.id, setId, runId, nextRun);

  return successResult(nextStore, true);
}

export function undoLastRunMutation(
  store: LocalProgressStoreV3,
  gameId: string,
): HuntMemoryUndoResult {
  if (!Object.hasOwn(store.undoState ?? {}, gameId)) {
    return undoFailure(
      'NO_UNDO_SNAPSHOT',
      `No undo snapshot available for game '${gameId}'`,
    );
  }
  const snapshot = store.undoState![gameId];

  if (!Object.hasOwn(store.gameProgress, gameId)) {
    return undoFailure(
      'GAME_NOT_FOUND',
      `Game '${gameId}' does not exist in the store`,
    );
  }
  const gameProgress = store.gameProgress[gameId];

  if (Object.hasOwn(gameProgress.retiredSets, snapshot.setId)) {
    return undoFailure(
      'SET_RETIRED',
      `Set '${snapshot.setId}' is retired in game '${gameId}'`,
    );
  }

  if (!Object.hasOwn(gameProgress.sets, snapshot.setId)) {
    return undoFailure(
      'SET_NOT_FOUND',
      `Set '${snapshot.setId}' does not exist as an active set in game '${gameId}'`,
    );
  }
  const setProgress = gameProgress.sets[snapshot.setId];

  if (setProgress.version !== snapshot.guardedSetVersion) {
    return undoFailure(
      'SET_VERSION_MISMATCH',
      `Set '${snapshot.setId}' version mismatch: current '${setProgress.version}', guarded '${snapshot.guardedSetVersion}'`,
    );
  }

  if (!Object.hasOwn(setProgress.runs, snapshot.runId)) {
    return undoFailure(
      'RUN_NOT_FOUND',
      `Run '${snapshot.runId}' does not exist in set '${snapshot.setId}'`,
    );
  }

  if (snapshot.previous.runId !== snapshot.runId) {
    return undoFailure(
      'UNDO_SNAPSHOT_INVALID',
      `Undo snapshot runId mismatch: previous '${snapshot.previous.runId}', snapshot '${snapshot.runId}'`,
    );
  }

  const nextStore = deepClone(store);
  const nextUndoState = nextStore.undoState!;
  delete nextUndoState[gameId];
  if (Object.keys(nextUndoState).length === 0) {
    delete nextStore.undoState;
  }

  nextStore.gameProgress[gameId].sets[snapshot.setId].runs = {
    ...nextStore.gameProgress[gameId].sets[snapshot.setId].runs,
    [snapshot.runId]: deepClone(snapshot.previous),
  };

  return { success: true, store: nextStore };
}
