import type {
  AchievementRecord,
  AchievementSet,
  GameRecord,
} from './achievement-schema';
import { HUNT_MEMORY_STORE_SCHEMA_VERSION } from './hunt-memory-schema';
import type {
  AchievementProgressV3,
  AchievementSetProgressV3,
  GameProgressV3,
  LocalProgressStoreV3,
  RunProgress,
} from './hunt-memory-schema';
import { isIsoUtcString } from './progress-schema-common';

export const DEFAULT_HUNT_MEMORY_RUN_ID = 'default-run';
export const DEFAULT_HUNT_MEMORY_RUN_NAME = 'Main Run';

export type CreateRunFailureCode =
  | 'INVALID_RUN_ID'
  | 'INVALID_RUN_NAME'
  | 'INVALID_TIMESTAMP'
  | 'DUPLICATE_RUN_ID'
  | 'GAME_NOT_FOUND'
  | 'SET_NOT_FOUND'
  | 'SET_RETIRED';

export type CreateRunResult =
  | { success: true; store: LocalProgressStoreV3; runId: string }
  | { success: false; code: CreateRunFailureCode; message: string };

export type SelectRunFailureCode =
  | 'GAME_NOT_FOUND'
  | 'SET_NOT_FOUND'
  | 'SET_RETIRED'
  | 'RUN_NOT_FOUND';

export type SelectRunResult =
  | { success: true; store: LocalProgressStoreV3; runId: string }
  | { success: false; code: SelectRunFailureCode; message: string };

function requireValidTimestamp(timestamp: string): void {
  if (!isIsoUtcString(timestamp)) {
    throw new Error(`Invalid ISO-8601 UTC timestamp: ${timestamp}`);
  }
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

export function createDefaultHuntMemoryStore(): LocalProgressStoreV3 {
  return {
    schemaVersion: HUNT_MEMORY_STORE_SCHEMA_VERSION,
    gameProgress: {},
  };
}

export function createDefaultAchievementProgressV3(
  achievement: AchievementRecord,
  timestamp: string,
): AchievementProgressV3 {
  requireValidTimestamp(timestamp);

  const progress: AchievementProgressV3 = {
    achievementId: achievement.id,
    completed: false,
    manualOverride: false,
    lastUpdated: timestamp,
    provenance: 'manual',
  };

  if (achievement.tracking.mode === 'counter') {
    progress.counter = { certainty: 'exact', value: 0 };
  } else if (achievement.tracking.mode === 'checklist') {
    progress.checklistCompletion = Object.fromEntries(
      achievement.tracking.items.map((item) => [item.id, false]),
    );
  }

  return progress;
}

export function createDefaultRunProgress(
  achievementSet: AchievementSet,
  runId: string,
  name: string,
  timestamp: string,
): RunProgress {
  if (!isNonBlank(runId)) {
    throw new Error('Run ID must contain at least one non-whitespace character');
  }
  if (!isNonBlank(name)) {
    throw new Error('Run name must contain at least one non-whitespace character');
  }
  requireValidTimestamp(timestamp);

  return {
    runId,
    name,
    createdAt: timestamp,
    pinnedAchievementIds: [],
    progress: Object.fromEntries(
      achievementSet.achievements.map((achievement) => [
        achievement.id,
        createDefaultAchievementProgressV3(achievement, timestamp),
      ]),
    ),
    orphanedProgress: {},
  };
}

export function createDefaultAchievementSetProgressV3(
  achievementSet: AchievementSet,
  timestamp: string,
): AchievementSetProgressV3 {
  requireValidTimestamp(timestamp);

  return {
    setId: achievementSet.id,
    version: achievementSet.version,
    activeRunId: DEFAULT_HUNT_MEMORY_RUN_ID,
    runs: {
      [DEFAULT_HUNT_MEMORY_RUN_ID]: createDefaultRunProgress(
        achievementSet,
        DEFAULT_HUNT_MEMORY_RUN_ID,
        DEFAULT_HUNT_MEMORY_RUN_NAME,
        timestamp,
      ),
    },
  };
}

export function createDefaultGameProgressV3(
  game: GameRecord,
  timestamp: string,
): GameProgressV3 {
  requireValidTimestamp(timestamp);

  return {
    gameId: game.id,
    sets: Object.fromEntries(
      game.achievementSets.map((achievementSet) => [
        achievementSet.id,
        createDefaultAchievementSetProgressV3(achievementSet, timestamp),
      ]),
    ),
    retiredSets: {},
  };
}

export function createRun(
  store: LocalProgressStoreV3,
  game: GameRecord,
  setId: string,
  runId: string,
  name: string,
  timestamp: string,
): CreateRunResult {
  if (!isNonBlank(runId)) {
    return {
      success: false,
      code: 'INVALID_RUN_ID',
      message: 'Run ID must contain at least one non-whitespace character',
    };
  }

  if (!isNonBlank(name)) {
    return {
      success: false,
      code: 'INVALID_RUN_NAME',
      message: 'Run name must contain at least one non-whitespace character',
    };
  }

  if (!isIsoUtcString(timestamp)) {
    return {
      success: false,
      code: 'INVALID_TIMESTAMP',
      message: `Invalid ISO-8601 UTC timestamp: ${timestamp}`,
    };
  }

  if (!Object.hasOwn(store.gameProgress, game.id)) {
    return {
      success: false,
      code: 'GAME_NOT_FOUND',
      message: `Game '${game.id}' does not exist in the store`,
    };
  }
  const gameProgress = store.gameProgress[game.id];

  if (Object.hasOwn(gameProgress.retiredSets, setId)) {
    return {
      success: false,
      code: 'SET_RETIRED',
      message: `Set '${setId}' is retired in game '${game.id}'`,
    };
  }

  const setDefinition = game.achievementSets.find(
    (achievementSet) => achievementSet.id === setId,
  );
  if (!Object.hasOwn(gameProgress.sets, setId) || !setDefinition) {
    return {
      success: false,
      code: 'SET_NOT_FOUND',
      message: `Set '${setId}' does not exist as an active set in game '${game.id}'`,
    };
  }
  const setProgress = gameProgress.sets[setId];

  if (Object.hasOwn(setProgress.runs, runId)) {
    return {
      success: false,
      code: 'DUPLICATE_RUN_ID',
      message: `Run '${runId}' already exists in set '${setId}'`,
    };
  }

  const nextStore = deepClone(store);
  const nextSet = nextStore.gameProgress[game.id].sets[setId];
  nextSet.runs = {
    ...nextSet.runs,
    [runId]: createDefaultRunProgress(setDefinition, runId, name, timestamp),
  };
  nextSet.activeRunId = runId;

  return { success: true, store: nextStore, runId };
}

export function selectRun(
  store: LocalProgressStoreV3,
  gameId: string,
  setId: string,
  runId: string,
): SelectRunResult {
  if (!Object.hasOwn(store.gameProgress, gameId)) {
    return {
      success: false,
      code: 'GAME_NOT_FOUND',
      message: `Game '${gameId}' does not exist in the store`,
    };
  }
  const gameProgress = store.gameProgress[gameId];

  if (Object.hasOwn(gameProgress.retiredSets, setId)) {
    return {
      success: false,
      code: 'SET_RETIRED',
      message: `Set '${setId}' is retired in game '${gameId}'`,
    };
  }

  if (!Object.hasOwn(gameProgress.sets, setId)) {
    return {
      success: false,
      code: 'SET_NOT_FOUND',
      message: `Set '${setId}' does not exist as an active set in game '${gameId}'`,
    };
  }
  const setProgress = gameProgress.sets[setId];

  if (!Object.hasOwn(setProgress.runs, runId)) {
    return {
      success: false,
      code: 'RUN_NOT_FOUND',
      message: `Run '${runId}' does not exist in set '${setId}'`,
    };
  }

  if (setProgress.activeRunId === runId) {
    return { success: true, store, runId };
  }

  const nextStore = deepClone(store);
  nextStore.gameProgress[gameId].sets[setId].activeRunId = runId;

  return { success: true, store: nextStore, runId };
}
