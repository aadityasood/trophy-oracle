import type {
  AchievementRecord,
  AchievementSet,
  GameRecord,
} from './achievement-schema';
import {
  CURRENT_STORE_SCHEMA_VERSION,
  LocalProgressStoreSchema,
  isIsoUtcString,
} from './progress-schema';
import type {
  AchievementProgress,
  AchievementSetProgress,
  AchievementSetReconciliationDelta,
  GameProgress,
  LocalProgressStore,
  OrphanedAchievementProgress,
  ReconciliationDeltaReport,
} from './progress-schema';

type ActiveStage = 'story' | 'missables' | 'cleanup';

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function requireValidTimestamp(timestamp: string): void {
  if (!isIsoUtcString(timestamp)) {
    throw new Error(`Invalid ISO-8601 UTC timestamp: ${timestamp}`);
  }
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

export function createDefaultLocalProgressStore(): LocalProgressStore {
  return {
    schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
    gameProgress: {},
  };
}

export function createDefaultAchievementProgress(
  achievement: AchievementRecord,
  timestamp: string,
): AchievementProgress {
  requireValidTimestamp(timestamp);

  const progress: AchievementProgress = {
    achievementId: achievement.id,
    completed: false,
    manualOverride: false,
    lastUpdated: timestamp,
    provenance: 'manual',
  };

  if (achievement.tracking.mode === 'counter') {
    progress.counterValue = 0;
  } else if (achievement.tracking.mode === 'checklist') {
    progress.checklistCompletion = Object.fromEntries(
      achievement.tracking.items.map((item) => [item.id, false]),
    );
  }

  return progress;
}

export function createDefaultAchievementSetProgress(
  achievementSet: AchievementSet,
  timestamp: string,
): AchievementSetProgress {
  requireValidTimestamp(timestamp);

  return {
    setId: achievementSet.id,
    version: achievementSet.version,
    pinnedAchievementIds: [],
    progress: Object.fromEntries(
      achievementSet.achievements.map((achievement) => [
        achievement.id,
        createDefaultAchievementProgress(achievement, timestamp),
      ]),
    ),
  };
}

export function createDefaultGameProgress(
  game: GameRecord,
  timestamp: string,
): GameProgress {
  requireValidTimestamp(timestamp);

  return {
    gameId: game.id,
    sets: Object.fromEntries(
      game.achievementSets.map((achievementSet) => [
        achievementSet.id,
        createDefaultAchievementSetProgress(achievementSet, timestamp),
      ]),
    ),
    orphanedProgress: {},
  };
}

export function computeDerivedCompletion(
  achievement: AchievementRecord,
  progress: AchievementProgress,
): boolean {
  if (achievement.tracking.mode === 'binary') {
    return progress.completed;
  }

  if (progress.manualOverride) return true;

  if (achievement.tracking.mode === 'counter') {
    return achievement.tracking.target === undefined
      ? false
      : (progress.counterValue ?? 0) >= achievement.tracking.target;
  }

  return achievement.tracking.items.every(
    (item) => progress.checklistCompletion?.[item.id] === true,
  );
}

export function ensureGameAndSetInitialized(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string | undefined,
  timestamp: string,
): LocalProgressStore {
  if (!isIsoUtcString(timestamp) || !isNonBlank(game.id)) return store;

  const targetSet =
    setId === undefined
      ? undefined
      : game.achievementSets.find((candidate) => candidate.id === setId);
  if (setId !== undefined && !targetSet) return store;

  const existingGame = store.gameProgress[game.id];
  if (!existingGame) {
    const nextStore = deepClone(store);
    nextStore.gameProgress[game.id] = createDefaultGameProgress(game, timestamp);
    return nextStore;
  }

  const missingSets =
    targetSet === undefined
      ? game.achievementSets.filter(
          (achievementSet) => !existingGame.sets[achievementSet.id],
        )
      : existingGame.sets[targetSet.id]
        ? []
        : [targetSet];
  if (missingSets.length === 0) return store;

  const nextStore = deepClone(store);
  missingSets.forEach((achievementSet) => {
    nextStore.gameProgress[game.id].sets[achievementSet.id] =
      createDefaultAchievementSetProgress(achievementSet, timestamp);
  });
  return nextStore;
}

export function selectGame(
  store: LocalProgressStore,
  game: GameRecord,
  timestamp: string,
): LocalProgressStore;
export function selectGame(
  store: LocalProgressStore,
  game: undefined,
): LocalProgressStore;
export function selectGame(
  store: LocalProgressStore,
  game: GameRecord | undefined,
  timestamp?: string,
): LocalProgressStore {
  if (game === undefined) {
    if (store.lastGameId === undefined) return store;
    const nextStore = deepClone(store);
    delete nextStore.lastGameId;
    return nextStore;
  }

  if (timestamp === undefined || !isIsoUtcString(timestamp)) return store;
  const initializedStore = ensureGameAndSetInitialized(
    store,
    game,
    undefined,
    timestamp,
  );
  if (!initializedStore.gameProgress[game.id]) return store;
  if (initializedStore.lastGameId === game.id) return initializedStore;

  const nextStore = deepClone(initializedStore);
  nextStore.lastGameId = game.id;
  return nextStore;
}

export function selectPreferredSet(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  timestamp: string,
): LocalProgressStore;
export function selectPreferredSet(
  store: LocalProgressStore,
  game: GameRecord,
  setId: undefined,
): LocalProgressStore;
export function selectPreferredSet(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string | undefined,
  timestamp?: string,
): LocalProgressStore {
  if (setId === undefined) {
    const gameProgress = store.gameProgress[game.id];
    if (!gameProgress || gameProgress.preferredSetId === undefined) return store;
    const nextStore = deepClone(store);
    delete nextStore.gameProgress[game.id].preferredSetId;
    return nextStore;
  }

  if (timestamp === undefined || !isIsoUtcString(timestamp)) return store;
  if (!game.achievementSets.some((achievementSet) => achievementSet.id === setId)) {
    return store;
  }

  const initializedStore = ensureGameAndSetInitialized(
    store,
    game,
    setId,
    timestamp,
  );
  const gameProgress = initializedStore.gameProgress[game.id];
  if (!gameProgress?.sets[setId]) return store;
  if (gameProgress.preferredSetId === setId) return initializedStore;

  const nextStore = deepClone(initializedStore);
  nextStore.gameProgress[game.id].preferredSetId = setId;
  return nextStore;
}

export type MutationResult =
  | { success: true; store: LocalProgressStore; changed: boolean }
  | { success: false; error: string };

type MutationContextResult =
  | {
      success: true;
      initializedStore: LocalProgressStore;
      setDefinition: AchievementSet;
      achievementDefinition: AchievementRecord;
      currentProgress: AchievementProgress;
      currentSetProgress: AchievementSetProgress;
    }
  | { success: false; error: string };

function prepareMutationContext(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  achievementId: string,
  timestamp: string,
): MutationContextResult {
  if (!isIsoUtcString(timestamp)) {
    return {
      success: false,
      error: `Invalid ISO-8601 UTC timestamp: ${timestamp}`,
    };
  }

  const setDefinition = game.achievementSets.find(
    (achievementSet) => achievementSet.id === setId,
  );
  if (!setDefinition) {
    return {
      success: false,
      error: `Achievement set '${setId}' not found in game '${game.id}'`,
    };
  }

  const achievementDefinition = setDefinition.achievements.find(
    (achievement) => achievement.id === achievementId,
  );
  if (!achievementDefinition) {
    return {
      success: false,
      error: `Achievement '${achievementId}' not found in set '${setId}'`,
    };
  }

  const initializedStore = ensureGameAndSetInitialized(
    store,
    game,
    setId,
    timestamp,
  );
  const currentSetProgress = initializedStore.gameProgress[game.id]?.sets[setId];
  const currentProgress = currentSetProgress?.progress[achievementId];
  if (!currentSetProgress || !currentProgress) {
    return {
      success: false,
      error: `Active progress for achievement '${achievementId}' is missing from set '${setId}'`,
    };
  }

  return {
    success: true,
    initializedStore,
    setDefinition,
    achievementDefinition,
    currentProgress,
    currentSetProgress,
  };
}

function cloneWithUndoSnapshot(
  context: Extract<MutationContextResult, { success: true }>,
  gameId: string,
  setId: string,
): LocalProgressStore {
  const nextStore = deepClone(context.initializedStore);
  if (!nextStore.undoState) nextStore.undoState = {};
  nextStore.undoState[gameId] = {
    setId,
    previous: deepClone(context.currentSetProgress),
  };
  return nextStore;
}

function sameBooleanMap(
  left: Record<string, boolean> | undefined,
  right: Record<string, boolean>,
): boolean {
  if (!left) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    rightKeys.every((key) => left[key] === right[key])
  );
}

export function setBinaryCompletion(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  achievementId: string,
  completed: boolean,
  timestamp: string,
): MutationResult {
  const context = prepareMutationContext(
    store,
    game,
    setId,
    achievementId,
    timestamp,
  );
  if (!context.success) return context;
  if (context.achievementDefinition.tracking.mode !== 'binary') {
    return {
      success: false,
      error: `Achievement '${achievementId}' tracking mode is '${context.achievementDefinition.tracking.mode}', expected 'binary'`,
    };
  }

  const isEffectiveNoOp =
    context.currentProgress.completed === completed &&
    !context.currentProgress.manualOverride &&
    context.currentProgress.counterValue === undefined &&
    context.currentProgress.checklistCompletion === undefined;
  if (isEffectiveNoOp) return { success: true, store, changed: false };

  const nextStore = cloneWithUndoSnapshot(context, game.id, setId);
  const progress =
    nextStore.gameProgress[game.id].sets[setId].progress[achievementId];
  progress.completed = completed;
  progress.manualOverride = false;
  delete progress.counterValue;
  delete progress.checklistCompletion;
  progress.provenance = 'manual';
  progress.lastUpdated = timestamp;
  return { success: true, store: nextStore, changed: true };
}

export function setCounterValue(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  achievementId: string,
  value: number,
  timestamp: string,
): MutationResult {
  if (!Number.isInteger(value) || value < 0) {
    return {
      success: false,
      error: `Counter value must be a non-negative integer, got ${value}`,
    };
  }

  const context = prepareMutationContext(
    store,
    game,
    setId,
    achievementId,
    timestamp,
  );
  if (!context.success) return context;
  if (context.achievementDefinition.tracking.mode !== 'counter') {
    return {
      success: false,
      error: `Achievement '${achievementId}' tracking mode is '${context.achievementDefinition.tracking.mode}', expected 'counter'`,
    };
  }

  const projected = { ...context.currentProgress, counterValue: value };
  const completed = computeDerivedCompletion(
    context.achievementDefinition,
    projected,
  );
  const isEffectiveNoOp =
    context.currentProgress.counterValue === value &&
    context.currentProgress.checklistCompletion === undefined &&
    context.currentProgress.completed === completed;
  if (isEffectiveNoOp) return { success: true, store, changed: false };

  const nextStore = cloneWithUndoSnapshot(context, game.id, setId);
  const progress =
    nextStore.gameProgress[game.id].sets[setId].progress[achievementId];
  progress.counterValue = value;
  delete progress.checklistCompletion;
  progress.completed = completed;
  progress.provenance = 'manual';
  progress.lastUpdated = timestamp;
  return { success: true, store: nextStore, changed: true };
}

export function setChecklistItemCompletion(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  achievementId: string,
  itemId: string,
  completed: boolean,
  timestamp: string,
): MutationResult {
  const context = prepareMutationContext(
    store,
    game,
    setId,
    achievementId,
    timestamp,
  );
  if (!context.success) return context;
  if (context.achievementDefinition.tracking.mode !== 'checklist') {
    return {
      success: false,
      error: `Achievement '${achievementId}' tracking mode is '${context.achievementDefinition.tracking.mode}', expected 'checklist'`,
    };
  }
  if (
    !context.achievementDefinition.tracking.items.some(
      (item) => item.id === itemId,
    )
  ) {
    return {
      success: false,
      error: `Checklist item '${itemId}' not found in achievement '${achievementId}'`,
    };
  }

  const checklistCompletion = Object.fromEntries(
    context.achievementDefinition.tracking.items.map((item) => [
      item.id,
      item.id === itemId
        ? completed
        : context.currentProgress.checklistCompletion?.[item.id] === true,
    ]),
  );
  const projected = {
    ...context.currentProgress,
    checklistCompletion,
  };
  const derivedCompleted = computeDerivedCompletion(
    context.achievementDefinition,
    projected,
  );
  const isEffectiveNoOp =
    sameBooleanMap(
      context.currentProgress.checklistCompletion,
      checklistCompletion,
    ) &&
    context.currentProgress.counterValue === undefined &&
    context.currentProgress.completed === derivedCompleted;
  if (isEffectiveNoOp) return { success: true, store, changed: false };

  const nextStore = cloneWithUndoSnapshot(context, game.id, setId);
  const progress =
    nextStore.gameProgress[game.id].sets[setId].progress[achievementId];
  progress.checklistCompletion = checklistCompletion;
  delete progress.counterValue;
  progress.completed = derivedCompleted;
  progress.provenance = 'manual';
  progress.lastUpdated = timestamp;
  return { success: true, store: nextStore, changed: true };
}

export function setNotes(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  achievementId: string,
  notes: string | undefined,
  timestamp: string,
): MutationResult {
  const context = prepareMutationContext(
    store,
    game,
    setId,
    achievementId,
    timestamp,
  );
  if (!context.success) return context;
  if (context.currentProgress.notes === notes) {
    return { success: true, store, changed: false };
  }

  const nextStore = cloneWithUndoSnapshot(context, game.id, setId);
  const progress =
    nextStore.gameProgress[game.id].sets[setId].progress[achievementId];
  if (notes === undefined) delete progress.notes;
  else progress.notes = notes;
  progress.provenance = 'manual';
  progress.lastUpdated = timestamp;
  return { success: true, store: nextStore, changed: true };
}

export function setCompletionOverride(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  achievementId: string,
  override: boolean,
  timestamp: string,
): MutationResult {
  const context = prepareMutationContext(
    store,
    game,
    setId,
    achievementId,
    timestamp,
  );
  if (!context.success) return context;
  if (context.achievementDefinition.tracking.mode === 'binary') {
    return {
      success: false,
      error: `Binary achievement '${achievementId}' does not support completion override`,
    };
  }

  const projected = { ...context.currentProgress, manualOverride: override };
  const completed = override
    ? true
    : computeDerivedCompletion(context.achievementDefinition, projected);
  const trackerShapeIsValid =
    context.achievementDefinition.tracking.mode === 'counter'
      ? context.currentProgress.counterValue !== undefined &&
        context.currentProgress.checklistCompletion === undefined
      : context.currentProgress.counterValue === undefined &&
        context.currentProgress.checklistCompletion !== undefined;
  if (
    context.currentProgress.manualOverride === override &&
    context.currentProgress.completed === completed &&
    trackerShapeIsValid
  ) {
    return { success: true, store, changed: false };
  }

  const nextStore = cloneWithUndoSnapshot(context, game.id, setId);
  const progress =
    nextStore.gameProgress[game.id].sets[setId].progress[achievementId];
  progress.manualOverride = override;
  progress.completed = completed;
  progress.provenance = 'manual';
  progress.lastUpdated = timestamp;
  if (context.achievementDefinition.tracking.mode === 'counter') {
    progress.counterValue ??= 0;
    delete progress.checklistCompletion;
  } else {
    progress.checklistCompletion = Object.fromEntries(
      context.achievementDefinition.tracking.items.map((item) => [
        item.id,
        progress.checklistCompletion?.[item.id] === true,
      ]),
    );
    delete progress.counterValue;
  }
  return { success: true, store: nextStore, changed: true };
}

type SetMutationContextResult =
  | {
      success: true;
      initializedStore: LocalProgressStore;
      setDefinition: AchievementSet;
      currentSetProgress: AchievementSetProgress;
    }
  | { success: false; error: string };

function prepareSetMutationContext(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  timestamp: string,
): SetMutationContextResult {
  if (!isIsoUtcString(timestamp)) {
    return {
      success: false,
      error: `Invalid ISO-8601 UTC timestamp: ${timestamp}`,
    };
  }
  const setDefinition = game.achievementSets.find(
    (achievementSet) => achievementSet.id === setId,
  );
  if (!setDefinition) {
    return {
      success: false,
      error: `Achievement set '${setId}' not found in game '${game.id}'`,
    };
  }
  const initializedStore = ensureGameAndSetInitialized(
    store,
    game,
    setId,
    timestamp,
  );
  const currentSetProgress = initializedStore.gameProgress[game.id]?.sets[setId];
  if (!currentSetProgress) {
    return {
      success: false,
      error: `Active progress for set '${setId}' is missing`,
    };
  }
  return {
    success: true,
    initializedStore,
    setDefinition,
    currentSetProgress,
  };
}

function cloneSetMutationWithUndo(
  context: Extract<SetMutationContextResult, { success: true }>,
  gameId: string,
  setId: string,
): LocalProgressStore {
  const nextStore = deepClone(context.initializedStore);
  if (!nextStore.undoState) nextStore.undoState = {};
  nextStore.undoState[gameId] = {
    setId,
    previous: deepClone(context.currentSetProgress),
  };
  return nextStore;
}

export function togglePin(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  achievementId: string,
  pin: boolean,
  timestamp: string,
): MutationResult {
  const context = prepareSetMutationContext(store, game, setId, timestamp);
  if (!context.success) return context;
  if (
    !context.setDefinition.achievements.some(
      (achievement) => achievement.id === achievementId,
    )
  ) {
    return {
      success: false,
      error: `Achievement '${achievementId}' not found in set '${setId}'`,
    };
  }
  if (!context.currentSetProgress.progress[achievementId]) {
    return {
      success: false,
      error: `Active progress for achievement '${achievementId}' is missing from set '${setId}'`,
    };
  }

  const isPinned = context.currentSetProgress.pinnedAchievementIds.includes(
    achievementId,
  );
  if (pin === isPinned) return { success: true, store, changed: false };
  if (pin && context.currentSetProgress.pinnedAchievementIds.length >= 5) {
    return {
      success: false,
      error: 'Cannot pin more than 5 achievements per set',
    };
  }

  const nextStore = cloneSetMutationWithUndo(context, game.id, setId);
  const setProgress = nextStore.gameProgress[game.id].sets[setId];
  setProgress.pinnedAchievementIds = pin
    ? [...setProgress.pinnedAchievementIds, achievementId]
    : setProgress.pinnedAchievementIds.filter((id) => id !== achievementId);
  return { success: true, store: nextStore, changed: true };
}

export function setActiveStage(
  store: LocalProgressStore,
  game: GameRecord,
  setId: string,
  stage: ActiveStage | undefined,
  timestamp: string,
): MutationResult {
  const context = prepareSetMutationContext(store, game, setId, timestamp);
  if (!context.success) return context;
  if (context.currentSetProgress.activeStage === stage) {
    return { success: true, store, changed: false };
  }

  const nextStore = cloneSetMutationWithUndo(context, game.id, setId);
  const setProgress = nextStore.gameProgress[game.id].sets[setId];
  if (stage === undefined) delete setProgress.activeStage;
  else setProgress.activeStage = stage;
  return { success: true, store: nextStore, changed: true };
}

export type UndoResult =
  | { success: true; store: LocalProgressStore }
  | { success: false; error: string };

export function undoLastMutation(
  store: LocalProgressStore,
  gameId: string,
): UndoResult {
  const snapshot = store.undoState?.[gameId];
  if (!snapshot) {
    return {
      success: false,
      error: `No undo snapshot available for game '${gameId}'`,
    };
  }
  if (!store.gameProgress[gameId]?.sets[snapshot.setId]) {
    return {
      success: false,
      error: `Undo target set '${snapshot.setId}' is unavailable for game '${gameId}'`,
    };
  }

  const nextStore = deepClone(store);
  const nextUndoState = nextStore.undoState;
  if (!nextUndoState) {
    return {
      success: false,
      error: `No undo snapshot available for game '${gameId}'`,
    };
  }
  delete nextUndoState[gameId];
  if (Object.keys(nextUndoState).length === 0) delete nextStore.undoState;
  nextStore.gameProgress[gameId].sets[snapshot.setId] = deepClone(
    snapshot.previous,
  );
  return { success: true, store: nextStore };
}

export type SetCompletionSummary = {
  totalCount: number;
  completedCount: number;
  fraction: number;
};

export function getSetCompletionSummary(
  store: LocalProgressStore,
  gameId: string,
  achievementSet: AchievementSet,
): SetCompletionSummary {
  const totalCount = achievementSet.achievements.length;
  const setProgress = store.gameProgress[gameId]?.sets[achievementSet.id];
  const completedCount = achievementSet.achievements.filter(
    (achievement) => setProgress?.progress[achievement.id]?.completed === true,
  ).length;
  return {
    totalCount,
    completedCount,
    fraction: totalCount === 0 ? 0 : completedCount / totalCount,
  };
}

function createSetDelta(
  setId: string,
  previousSet: AchievementSet | undefined,
  nextSet: AchievementSet | undefined,
): AchievementSetReconciliationDelta {
  const delta: AchievementSetReconciliationDelta = {
    setId,
    addedAchievementIds: [],
    quarantinedAchievementIds: [],
    restoredOrphanedAchievementIds: [],
    addedChecklistItems: [],
    removedChecklistItems: [],
    removedPinnedAchievementIds: [],
  };
  if (previousSet) delta.fromVersion = previousSet.version;
  if (nextSet) delta.toVersion = nextSet.version;
  return delta;
}

function addDefaultChecklistDelta(
  delta: AchievementSetReconciliationDelta,
  achievement: AchievementRecord,
): void {
  if (achievement.tracking.mode === 'checklist') {
    delta.addedChecklistItems.push({
      achievementId: achievement.id,
      itemIds: achievement.tracking.items.map((item) => item.id),
    });
  }
}

function createEarlyReconciliationReport(
  previousGame: GameRecord,
  nextGame: GameRecord,
  schemaConflicts: string[],
): ReconciliationDeltaReport {
  return {
    gameId: nextGame.id,
    fromGameVersion: previousGame.version,
    toGameVersion: nextGame.version,
    setDeltas: [],
    schemaConflicts,
  };
}

function modeShapeConflict(
  setProgress: AchievementSetProgress,
  previousSet: AchievementSet,
): string | undefined {
  const previousAchievements = new Map(
    previousSet.achievements.map((achievement) => [achievement.id, achievement]),
  );
  for (const [achievementId, progress] of Object.entries(setProgress.progress)) {
    const definition = previousAchievements.get(achievementId);
    if (!definition) {
      return `Active achievement '${achievementId}' in set '${previousSet.id}' has no previous definition`;
    }

    if (definition.tracking.mode === 'binary') {
      if (
        progress.manualOverride ||
        progress.counterValue !== undefined ||
        progress.checklistCompletion !== undefined
      ) {
        return `Active binary progress '${achievementId}' has incompatible tracker state`;
      }
    } else if (definition.tracking.mode === 'counter') {
      if (
        progress.counterValue === undefined ||
        progress.checklistCompletion !== undefined
      ) {
        return `Active counter progress '${achievementId}' has incompatible tracker state`;
      }
    } else {
      const checklist = progress.checklistCompletion;
      const expectedIds = definition.tracking.items.map((item) => item.id);
      if (
        progress.counterValue !== undefined ||
        checklist === undefined ||
        Object.keys(checklist).length !== expectedIds.length ||
        !expectedIds.every((itemId) => checklist[itemId] !== undefined)
      ) {
        return `Active checklist progress '${achievementId}' has incompatible tracker state`;
      }
    }

    if (progress.manualOverride && !progress.completed) {
      return `Active progress '${achievementId}' has an incomplete completion override`;
    }
  }
  return undefined;
}

function previousSetVersionConflict(
  activeSet: AchievementSetProgress,
  previousSet: AchievementSet,
): string | undefined {
  if (activeSet.version === previousSet.version) return undefined;

  return `Set '${previousSet.id}' stored version '${activeSet.version}' does not match supplied previous-definition version '${previousSet.version}'; set state was left unchanged`;
}

function reconstructProgress(
  source: AchievementProgress,
  achievement: AchievementRecord,
): AchievementProgress {
  const progress: AchievementProgress = {
    achievementId: achievement.id,
    completed: source.completed,
    manualOverride: source.manualOverride,
    lastUpdated: source.lastUpdated,
    provenance: source.provenance,
  };
  if (Object.hasOwn(source, 'notes')) progress.notes = source.notes;

  if (achievement.tracking.mode === 'binary') {
    progress.manualOverride = false;
  } else if (achievement.tracking.mode === 'counter') {
    progress.counterValue = source.counterValue ?? 0;
    progress.completed = progress.manualOverride
      ? true
      : computeDerivedCompletion(achievement, progress);
  } else {
    progress.checklistCompletion = Object.fromEntries(
      achievement.tracking.items.map((item) => [
        item.id,
        source.checklistCompletion?.[item.id] === true,
      ]),
    );
    progress.completed = progress.manualOverride
      ? true
      : computeDerivedCompletion(achievement, progress);
  }
  return progress;
}

function recordChecklistChanges(
  delta: AchievementSetReconciliationDelta,
  achievement: AchievementRecord,
  source: AchievementProgress,
): void {
  if (achievement.tracking.mode !== 'checklist') return;
  const priorIds = Object.keys(source.checklistCompletion ?? {});
  const nextIds = achievement.tracking.items.map((item) => item.id);
  const addedIds = nextIds.filter((itemId) => !priorIds.includes(itemId));
  const removedIds = priorIds.filter((itemId) => !nextIds.includes(itemId));
  if (addedIds.length > 0) {
    delta.addedChecklistItems.push({
      achievementId: achievement.id,
      itemIds: addedIds,
    });
  }
  if (removedIds.length > 0) {
    delta.removedChecklistItems.push({
      achievementId: achievement.id,
      itemIds: removedIds,
    });
  }
}

function createOrphan(
  progress: AchievementProgress,
  achievement: AchievementRecord,
): OrphanedAchievementProgress {
  return {
    ...deepClone(progress),
    trackingModeAtRemoval: achievement.tracking.mode,
  };
}

function clearUndoForSet(
  store: LocalProgressStore,
  gameId: string,
  setId: string,
): boolean {
  const undoState = store.undoState;
  if (undoState?.[gameId]?.setId !== setId) return false;
  delete undoState[gameId];
  if (Object.keys(undoState).length === 0) delete store.undoState;
  return true;
}

function initializeOrRestoreSet(
  gameProgress: GameProgress,
  nextSet: AchievementSet,
  timestamp: string,
  delta: AchievementSetReconciliationDelta,
  schemaConflicts: string[],
): AchievementSetProgress {
  const setProgress = createDefaultAchievementSetProgress(nextSet, timestamp);
  const orphanMap = gameProgress.orphanedProgress[nextSet.id];

  nextSet.achievements.forEach((achievement) => {
    const orphan = orphanMap?.[achievement.id];
    if (!orphan) {
      delta.addedAchievementIds.push(achievement.id);
      addDefaultChecklistDelta(delta, achievement);
      return;
    }

    if (orphan.trackingModeAtRemoval !== achievement.tracking.mode) {
      delta.addedAchievementIds.push(achievement.id);
      addDefaultChecklistDelta(delta, achievement);
      schemaConflicts.push(
        `Incompatible orphan tracking mode for '${achievement.id}': removed as '${orphan.trackingModeAtRemoval}', reappeared as '${achievement.tracking.mode}'`,
      );
      return;
    }

    recordChecklistChanges(delta, achievement, orphan);
    setProgress.progress[achievement.id] = reconstructProgress(
      orphan,
      achievement,
    );
    if (orphanMap) delete orphanMap[achievement.id];
    delta.restoredOrphanedAchievementIds.push(achievement.id);
  });

  return setProgress;
}

export type ReconciliationResult = {
  store: LocalProgressStore;
  report: ReconciliationDeltaReport;
};

export function reconcileGameProgress(
  store: LocalProgressStore,
  previousGame: GameRecord,
  nextGame: GameRecord,
  timestamp: string,
): ReconciliationResult {
  const earlyConflicts: string[] = [];
  if (!isIsoUtcString(timestamp)) {
    earlyConflicts.push(`Invalid reconciliation timestamp: ${timestamp}`);
  }
  if (previousGame.id !== nextGame.id) {
    earlyConflicts.push(
      `Mismatched game identity: previous '${previousGame.id}', next '${nextGame.id}'`,
    );
  }
  if (store.schemaVersion !== CURRENT_STORE_SCHEMA_VERSION) {
    earlyConflicts.push(
      `Unsupported store schema version '${store.schemaVersion}', expected '${CURRENT_STORE_SCHEMA_VERSION}'`,
    );
  }
  if (earlyConflicts.length > 0) {
    return {
      store,
      report: createEarlyReconciliationReport(
        previousGame,
        nextGame,
        earlyConflicts,
      ),
    };
  }

  const validation = LocalProgressStoreSchema.safeParse(store);
  if (!validation.success) {
    const details = validation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return {
      store,
      report: createEarlyReconciliationReport(previousGame, nextGame, [
        `Invalid progress store structure: ${details}`,
      ]),
    };
  }

  const nextStore = deepClone(store);
  const schemaConflicts: string[] = [];
  const previousSets = new Map(
    previousGame.achievementSets.map((achievementSet) => [
      achievementSet.id,
      achievementSet,
    ]),
  );
  const nextSets = new Map(
    nextGame.achievementSets.map((achievementSet) => [
      achievementSet.id,
      achievementSet,
    ]),
  );
  const existingGameProgress = nextStore.gameProgress[nextGame.id];
  if (!existingGameProgress) {
    nextStore.gameProgress[nextGame.id] = createDefaultGameProgress(
      nextGame,
      timestamp,
    );
    const unionSetIds = Array.from(
      new Set([...previousSets.keys(), ...nextSets.keys()]),
    );
    const setDeltas = unionSetIds.map((setId) => {
      const previousSet = previousSets.get(setId);
      const nextSet = nextSets.get(setId);
      const delta = createSetDelta(setId, previousSet, nextSet);
      if (nextSet) {
        delta.addedAchievementIds.push(
          ...nextSet.achievements.map((achievement) => achievement.id),
        );
        nextSet.achievements.forEach((achievement) =>
          addDefaultChecklistDelta(delta, achievement),
        );
      }
      return delta;
    });
    return {
      store: nextStore,
      report: {
        gameId: nextGame.id,
        fromGameVersion: previousGame.version,
        toGameVersion: nextGame.version,
        setDeltas,
        schemaConflicts,
      },
    };
  }
  const gameProgress = nextStore.gameProgress[nextGame.id];
  const unionSetIds = Array.from(
    new Set([
      ...previousSets.keys(),
      ...nextSets.keys(),
      ...Object.keys(existingGameProgress?.sets ?? {}),
    ]),
  );
  const setDeltas: AchievementSetReconciliationDelta[] = [];
  let clearedPreferredSetId: string | undefined;
  let clearedUndoSetId: string | undefined;

  for (const setId of unionSetIds) {
    const previousSet = previousSets.get(setId);
    const nextSet = nextSets.get(setId);
    const delta = createSetDelta(setId, previousSet, nextSet);
    setDeltas.push(delta);

    if (!previousSet && existingGameProgress?.sets[setId]) {
      schemaConflicts.push(
        `Active set '${setId}' has no previous definition; state was left unchanged`,
      );
      continue;
    }

    if (previousSet && !nextSet) {
      const activeSet = gameProgress.sets[setId];
      if (activeSet) {
        const versionConflict = previousSetVersionConflict(
          activeSet,
          previousSet,
        );
        if (versionConflict) {
          schemaConflicts.push(versionConflict);
          continue;
        }

        const conflict = modeShapeConflict(activeSet, previousSet);
        if (conflict) {
          schemaConflicts.push(`${conflict}; set state was left unchanged`);
          continue;
        }

        const previousAchievements = new Map(
          previousSet.achievements.map((achievement) => [
            achievement.id,
            achievement,
          ]),
        );
        if (!gameProgress.orphanedProgress[setId]) {
          gameProgress.orphanedProgress[setId] = {};
        }
        Object.entries(activeSet.progress).forEach(
          ([achievementId, progress]) => {
            const achievement = previousAchievements.get(achievementId);
            if (!achievement) return;
            gameProgress.orphanedProgress[setId][achievementId] = createOrphan(
              progress,
              achievement,
            );
            delta.quarantinedAchievementIds.push(achievementId);
          },
        );
        delta.removedPinnedAchievementIds.push(
          ...activeSet.pinnedAchievementIds,
        );
        delete gameProgress.sets[setId];
      }

      if (gameProgress.preferredSetId === setId) {
        delete gameProgress.preferredSetId;
        clearedPreferredSetId = setId;
      }
      if (clearUndoForSet(nextStore, nextGame.id, setId)) {
        clearedUndoSetId = setId;
      }
      continue;
    }

    if (!previousSet && nextSet) {
      gameProgress.sets[setId] = initializeOrRestoreSet(
        gameProgress,
        nextSet,
        timestamp,
        delta,
        schemaConflicts,
      );
      if (clearUndoForSet(nextStore, nextGame.id, setId)) {
        clearedUndoSetId = setId;
      }
      continue;
    }

    if (!previousSet || !nextSet) continue;
    let activeSet = gameProgress.sets[setId];
    if (activeSet) {
      const versionConflict = previousSetVersionConflict(
        activeSet,
        previousSet,
      );
      if (versionConflict) {
        schemaConflicts.push(versionConflict);
        continue;
      }
    }

    if (clearUndoForSet(nextStore, nextGame.id, setId)) {
      clearedUndoSetId = setId;
    }

    if (!activeSet) {
      activeSet = createDefaultAchievementSetProgress(nextSet, timestamp);
      gameProgress.sets[setId] = activeSet;
      delta.addedAchievementIds.push(
        ...nextSet.achievements.map((achievement) => achievement.id),
      );
      nextSet.achievements.forEach((achievement) =>
        addDefaultChecklistDelta(delta, achievement),
      );
      continue;
    }

    const setConflict = modeShapeConflict(activeSet, previousSet);
    if (setConflict) {
      schemaConflicts.push(`${setConflict}; set state was left unchanged`);
      continue;
    }

    const previousAchievements = new Map(
      previousSet.achievements.map((achievement) => [
        achievement.id,
        achievement,
      ]),
    );
    const nextAchievements = new Map(
      nextSet.achievements.map((achievement) => [
        achievement.id,
        achievement,
      ]),
    );
    const unionAchievementIds = Array.from(
      new Set([...previousAchievements.keys(), ...nextAchievements.keys()]),
    );

    for (const achievementId of unionAchievementIds) {
      const previousAchievement = previousAchievements.get(achievementId);
      const nextAchievement = nextAchievements.get(achievementId);

      if (previousAchievement && !nextAchievement) {
        const progress = activeSet.progress[achievementId];
        if (progress) {
          if (!gameProgress.orphanedProgress[setId]) {
            gameProgress.orphanedProgress[setId] = {};
          }
          gameProgress.orphanedProgress[setId][achievementId] = createOrphan(
            progress,
            previousAchievement,
          );
          delete activeSet.progress[achievementId];
          delta.quarantinedAchievementIds.push(achievementId);
        }
        if (activeSet.pinnedAchievementIds.includes(achievementId)) {
          activeSet.pinnedAchievementIds =
            activeSet.pinnedAchievementIds.filter(
              (pinId) => pinId !== achievementId,
            );
          delta.removedPinnedAchievementIds.push(achievementId);
        }
        continue;
      }

      if (!previousAchievement && nextAchievement) {
        const orphan = gameProgress.orphanedProgress[setId]?.[achievementId];
        if (orphan?.trackingModeAtRemoval === nextAchievement.tracking.mode) {
          recordChecklistChanges(delta, nextAchievement, orphan);
          activeSet.progress[achievementId] = reconstructProgress(
            orphan,
            nextAchievement,
          );
          delete gameProgress.orphanedProgress[setId][achievementId];
          delta.restoredOrphanedAchievementIds.push(achievementId);
        } else {
          if (orphan) {
            schemaConflicts.push(
              `Incompatible orphan tracking mode for '${achievementId}': removed as '${orphan.trackingModeAtRemoval}', reappeared as '${nextAchievement.tracking.mode}'`,
            );
          }
          activeSet.progress[achievementId] = createDefaultAchievementProgress(
            nextAchievement,
            timestamp,
          );
          delta.addedAchievementIds.push(achievementId);
          addDefaultChecklistDelta(delta, nextAchievement);
        }
        continue;
      }

      if (!previousAchievement || !nextAchievement) continue;
      const progress = activeSet.progress[achievementId];
      if (!progress) {
        activeSet.progress[achievementId] = createDefaultAchievementProgress(
          nextAchievement,
          timestamp,
        );
        continue;
      }

      if (previousAchievement.tracking.mode !== nextAchievement.tracking.mode) {
        if (!gameProgress.orphanedProgress[setId]) {
          gameProgress.orphanedProgress[setId] = {};
        }
        gameProgress.orphanedProgress[setId][achievementId] = createOrphan(
          progress,
          previousAchievement,
        );
        activeSet.progress[achievementId] = createDefaultAchievementProgress(
          nextAchievement,
          timestamp,
        );
        delta.quarantinedAchievementIds.push(achievementId);
        if (activeSet.pinnedAchievementIds.includes(achievementId)) {
          activeSet.pinnedAchievementIds =
            activeSet.pinnedAchievementIds.filter(
              (pinId) => pinId !== achievementId,
            );
          delta.removedPinnedAchievementIds.push(achievementId);
        }
        schemaConflicts.push(
          `Incompatible tracking mode change for '${achievementId}': was '${previousAchievement.tracking.mode}', now '${nextAchievement.tracking.mode}'`,
        );
        continue;
      }

      recordChecklistChanges(delta, nextAchievement, progress);
      activeSet.progress[achievementId] = reconstructProgress(
        progress,
        nextAchievement,
      );
    }

    const validAchievementIds = new Set(
      nextSet.achievements.map((achievement) => achievement.id),
    );
    activeSet.pinnedAchievementIds = activeSet.pinnedAchievementIds.filter(
      (pinId) => {
        const valid =
          validAchievementIds.has(pinId) && activeSet.progress[pinId] !== undefined;
        if (!valid && !delta.removedPinnedAchievementIds.includes(pinId)) {
          delta.removedPinnedAchievementIds.push(pinId);
        }
        return valid;
      },
    );
    activeSet.version = nextSet.version;
  }

  const report: ReconciliationDeltaReport = {
    gameId: nextGame.id,
    fromGameVersion: previousGame.version,
    toGameVersion: nextGame.version,
    setDeltas,
    schemaConflicts,
  };
  if (clearedPreferredSetId !== undefined) {
    report.clearedPreferredSetId = clearedPreferredSetId;
  }
  if (clearedUndoSetId !== undefined) {
    report.clearedUndoSetId = clearedUndoSetId;
  }
  return { store: nextStore, report };
}
