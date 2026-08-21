import {
  HUNT_MEMORY_STORE_SCHEMA_VERSION,
  LocalProgressStoreV3Schema,
} from './hunt-memory-schema';
import type {
  AchievementProgressV3,
  GameProgressV3,
  LocalProgressStoreV3,
  MigratedCounterAssumption,
  MigratedRunTarget,
  MigratedSetTarget,
  OrphanedAchievementProgressV3,
  PreservedUndoTarget,
  ProgressMigrationReport,
  ProgressMigrationTransformResult,
  RunProgress,
} from './hunt-memory-schema';
import {
  CURRENT_STORE_SCHEMA_VERSION,
  LocalProgressStoreSchema,
} from './progress-schema';
import { isIsoUtcString } from './progress-schema-common';
import type {
  AchievementProgress,
  AchievementSetProgress,
  OrphanedAchievementProgress,
} from './progress-schema';

type CounterLocation = 'active' | 'orphan' | 'undo';

const LOCATION_ORDER: Record<CounterLocation, number> = {
  active: 0,
  orphan: 1,
  undo: 2,
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedKeys<T>(record: Record<string, T> | undefined): string[] {
  return Object.keys(record ?? {}).sort(compareStrings);
}

function sortMigratedSets(items: MigratedSetTarget[]): MigratedSetTarget[] {
  return [...items].sort(
    (left, right) =>
      compareStrings(left.gameId, right.gameId) ||
      compareStrings(left.setId, right.setId) ||
      compareStrings(left.destination, right.destination),
  );
}

function sortCreatedRuns(items: MigratedRunTarget[]): MigratedRunTarget[] {
  return [...items].sort(
    (left, right) =>
      compareStrings(left.gameId, right.gameId) ||
      compareStrings(left.setId, right.setId) ||
      compareStrings(left.runId, right.runId) ||
      compareStrings(left.destination, right.destination),
  );
}

function sortCounterAssumptions(
  items: MigratedCounterAssumption[],
): MigratedCounterAssumption[] {
  return [...items].sort(
    (left, right) =>
      compareStrings(left.gameId, right.gameId) ||
      compareStrings(left.setId, right.setId) ||
      compareStrings(left.achievementId, right.achievementId) ||
      LOCATION_ORDER[left.location] - LOCATION_ORDER[right.location],
  );
}

function sortPreservedUndoTargets(
  items: PreservedUndoTarget[],
): PreservedUndoTarget[] {
  return [...items].sort(
    (left, right) =>
      compareStrings(left.gameId, right.gameId) ||
      compareStrings(left.setId, right.setId) ||
      compareStrings(left.runId, right.runId),
  );
}

function convertAchievementProgress(
  progress: AchievementProgress,
): AchievementProgressV3 {
  const converted: AchievementProgressV3 = {
    achievementId: progress.achievementId,
    completed: progress.completed,
    manualOverride: progress.manualOverride,
    lastUpdated: progress.lastUpdated,
    provenance: progress.provenance,
  };
  if (progress.counterValue !== undefined) {
    converted.counter = { certainty: 'exact', value: progress.counterValue };
  }
  if (progress.checklistCompletion !== undefined) {
    converted.checklistCompletion = structuredClone(progress.checklistCompletion);
  }
  if (progress.notes !== undefined) {
    converted.notes = progress.notes;
  }
  return converted;
}

function convertOrphanedAchievementProgress(
  orphan: OrphanedAchievementProgress,
): OrphanedAchievementProgressV3 {
  return {
    ...convertAchievementProgress(orphan),
    trackingModeAtRemoval: orphan.trackingModeAtRemoval,
  };
}

export function transformProgressStoreV2ToV3(
  source: unknown,
  migratedAt: string,
): ProgressMigrationTransformResult {
  const sourceValidation = LocalProgressStoreSchema.safeParse(source);
  if (!sourceValidation.success) {
    return {
      success: false,
      code: 'INVALID_SOURCE_STORE',
      message: 'Source store is not a valid Schema 2.0 store',
      conflicts: sourceValidation.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }

  if (!isIsoUtcString(migratedAt)) {
    return {
      success: false,
      code: 'TRANSFORMATION_ERROR',
      message: 'Migration timestamp is not a valid ISO-8601 UTC timestamp',
      conflicts: [`migratedAt: '${migratedAt}' is not a valid ISO-8601 UTC timestamp`],
    };
  }

  const sourceStore = sourceValidation.data;

  const migratedSets: MigratedSetTarget[] = [];
  const createdRuns: MigratedRunTarget[] = [];
  const counterAssumptions: MigratedCounterAssumption[] = [];
  const preservedUndoTargets: PreservedUndoTarget[] = [];
  const migratedGameIds: string[] = [];

  const v3Store: LocalProgressStoreV3 = {
    schemaVersion: HUNT_MEMORY_STORE_SCHEMA_VERSION,
    gameProgress: {},
  };
  if (sourceStore.lastGameId !== undefined) {
    v3Store.lastGameId = sourceStore.lastGameId;
  }

  function buildLegacyRun(
    setProgress: AchievementSetProgress,
    orphanMap: Record<string, OrphanedAchievementProgress> | undefined,
    gameId: string,
    setId: string,
  ): RunProgress {
    const run: RunProgress = {
      runId: 'legacy-v2',
      name: 'Existing Progress',
      createdAt: migratedAt,
      pinnedAchievementIds: [...setProgress.pinnedAchievementIds],
      progress: {},
      orphanedProgress: {},
    };
    if (setProgress.activeStage !== undefined) {
      run.activeStage = setProgress.activeStage;
    }
    for (const achievementId of sortedKeys(setProgress.progress)) {
      const progress = setProgress.progress[achievementId];
      run.progress[achievementId] = convertAchievementProgress(progress);
      if (progress.counterValue !== undefined) {
        counterAssumptions.push({
          gameId,
          setId,
          achievementId,
          location: 'active',
          assumedCertainty: 'exact',
          value: progress.counterValue,
        });
      }
    }
    if (orphanMap) {
      for (const achievementId of sortedKeys(orphanMap)) {
        const orphan = orphanMap[achievementId];
        run.orphanedProgress[achievementId] = [
          convertOrphanedAchievementProgress(orphan),
        ];
        if (orphan.counterValue !== undefined) {
          counterAssumptions.push({
            gameId,
            setId,
            achievementId,
            location: 'orphan',
            assumedCertainty: 'exact',
            value: orphan.counterValue,
          });
        }
      }
    }
    return run;
  }

  function buildAbsentSetRun(
    orphanMap: Record<string, OrphanedAchievementProgress>,
    gameId: string,
    setId: string,
  ): RunProgress {
    const run: RunProgress = {
      runId: 'legacy-v2',
      name: 'Existing Progress',
      createdAt: migratedAt,
      pinnedAchievementIds: [],
      progress: {},
      orphanedProgress: {},
    };
    for (const achievementId of sortedKeys(orphanMap)) {
      const orphan = orphanMap[achievementId];
      run.orphanedProgress[achievementId] = [
        convertOrphanedAchievementProgress(orphan),
      ];
      if (orphan.counterValue !== undefined) {
        counterAssumptions.push({
          gameId,
          setId,
          achievementId,
          location: 'orphan',
          assumedCertainty: 'exact',
          value: orphan.counterValue,
        });
      }
    }
    return run;
  }

  for (const gameId of sortedKeys(sourceStore.gameProgress)) {
    const game = sourceStore.gameProgress[gameId];
    const v3Game: GameProgressV3 = {
      gameId: game.gameId,
      sets: {},
      retiredSets: {},
    };
    if (game.preferredSetId !== undefined) {
      v3Game.preferredSetId = game.preferredSetId;
    }

    for (const setId of sortedKeys(game.sets)) {
      const setProgress = game.sets[setId];
      const run = buildLegacyRun(
        setProgress,
        game.orphanedProgress[setId],
        gameId,
        setId,
      );
      v3Game.sets[setId] = {
        setId: setProgress.setId,
        version: setProgress.version,
        activeRunId: 'legacy-v2',
        runs: { 'legacy-v2': run },
      };
      migratedSets.push({ gameId, setId, destination: 'active' });
      createdRuns.push({
        gameId,
        setId,
        destination: 'active',
        runId: 'legacy-v2',
      });
    }

    for (const setId of sortedKeys(game.orphanedProgress)) {
      if (game.sets[setId]) continue;
      const orphanMap = game.orphanedProgress[setId];
      const run = buildAbsentSetRun(orphanMap, gameId, setId);
      v3Game.retiredSets[setId] = {
        setId,
        activeRunId: 'legacy-v2',
        runs: { 'legacy-v2': run },
        retirementReason: 'schema_2_absent_orphans',
      };
      migratedSets.push({ gameId, setId, destination: 'retired' });
      createdRuns.push({
        gameId,
        setId,
        destination: 'retired',
        runId: 'legacy-v2',
      });
    }

    v3Store.gameProgress[gameId] = v3Game;
    migratedGameIds.push(gameId);
  }

  for (const gameId of sortedKeys(sourceStore.undoState)) {
    const snapshot = sourceStore.undoState?.[gameId];
    if (!snapshot) continue;

    const targetSet = sourceStore.gameProgress[gameId]?.sets[snapshot.setId];
    if (!targetSet) {
      return {
        success: false,
        code: 'TRANSFORMATION_ERROR',
        message: `Undo snapshot for game '${gameId}' cannot be migrated safely`,
        conflicts: [
          `undoState.${gameId}: target set '${snapshot.setId}' does not exist in game '${gameId}'`,
        ],
      };
    }
    if (snapshot.previous.version !== targetSet.version) {
      return {
        success: false,
        code: 'TRANSFORMATION_ERROR',
        message: `Undo snapshot for game '${gameId}' cannot be migrated safely`,
        conflicts: [
          `undoState.${gameId}: previous.version '${snapshot.previous.version}' does not match current set version '${targetSet.version}'`,
        ],
      };
    }

    const previousRun: RunProgress = {
      runId: 'legacy-v2',
      name: 'Existing Progress',
      createdAt: migratedAt,
      pinnedAchievementIds: [...snapshot.previous.pinnedAchievementIds],
      progress: {},
      orphanedProgress: {},
    };
    if (snapshot.previous.activeStage !== undefined) {
      previousRun.activeStage = snapshot.previous.activeStage;
    }
    for (const achievementId of sortedKeys(snapshot.previous.progress)) {
      const progress = snapshot.previous.progress[achievementId];
      previousRun.progress[achievementId] = convertAchievementProgress(progress);
      if (progress.counterValue !== undefined) {
        counterAssumptions.push({
          gameId,
          setId: snapshot.setId,
          achievementId,
          location: 'undo',
          assumedCertainty: 'exact',
          value: progress.counterValue,
        });
      }
    }

    const targetV3Run =
      v3Store.gameProgress[gameId].sets[snapshot.setId].runs['legacy-v2'];
    previousRun.orphanedProgress = structuredClone(targetV3Run.orphanedProgress);

    if (v3Store.undoState === undefined) v3Store.undoState = {};
    v3Store.undoState[gameId] = {
      setId: snapshot.setId,
      runId: 'legacy-v2',
      guardedSetVersion: snapshot.previous.version,
      previous: previousRun,
    };
    preservedUndoTargets.push({
      gameId,
      setId: snapshot.setId,
      runId: 'legacy-v2',
      guardedSetVersion: snapshot.previous.version,
    });
  }

  const report: ProgressMigrationReport = {
    sourceSchemaVersion: CURRENT_STORE_SCHEMA_VERSION,
    targetSchemaVersion: HUNT_MEMORY_STORE_SCHEMA_VERSION,
    migratedAt,
    migratedGameIds: [...migratedGameIds].sort(compareStrings),
    migratedSets: sortMigratedSets(migratedSets),
    createdRuns: sortCreatedRuns(createdRuns),
    counterAssumptions: sortCounterAssumptions(counterAssumptions),
    preservedUndoTargets: sortPreservedUndoTargets(preservedUndoTargets),
    warnings: [],
  };

  const targetValidation = LocalProgressStoreV3Schema.safeParse(v3Store);
  if (!targetValidation.success) {
    return {
      success: false,
      code: 'INVALID_TARGET_STORE',
      message: 'Transformed store failed Schema 3.0 validation',
      conflicts: targetValidation.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }

  return {
    success: true,
    store: targetValidation.data,
    report,
  };
}
