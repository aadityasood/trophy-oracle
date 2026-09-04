import type { GameRecord } from './achievement-schema';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID,
  createDefaultAchievementSetProgressV3,
  createDefaultGameProgressV3,
} from './hunt-memory-lifecycle';
import {
  LocalProgressStoreV3Schema,
  type AchievementSetProgressV3,
  type LocalProgressStoreV3,
  type RetiredAchievementSetProgressV3,
  type RunProgress,
} from './hunt-memory-schema';
import { isIsoUtcString } from './progress-schema-common';
import {
  createEmptyRunDelta,
  groupChecklistDeltas,
  reconcileSingleRunProgress,
  restoreSchema2AbsentOrphansRun,
  validateTrackerShape,
} from './hunt-memory-reconciliation-run';
import type {
  AchievementSetReconciliationDeltaV3,
  HuntMemoryReconciliationResult,
  ReconciliationDeltaReportV3,
  RunReconciliationDelta,
  TrackedSchemaConflict,
} from './hunt-memory-reconciliation-types';

export type {
  AchievementSetReconciliationDeltaV3,
  ChecklistItemDeltaV3,
  HuntMemoryReconciliationResult,
  ReconciliationDeltaReportV3,
  RunReconciliationDelta,
} from './hunt-memory-reconciliation-types';

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function createEarlyReport(
  previousGame: GameRecord,
  nextGame: GameRecord,
  conflict: string,
): ReconciliationDeltaReportV3 {
  return {
    gameId: nextGame.id,
    fromGameVersion: previousGame.version,
    toGameVersion: nextGame.version,
    setDeltas: [],
    retiredSetIds: [],
    restoredRetiredSetIds: [],
    retainedRetiredSetIds: [],
    schemaConflicts: [conflict],
  };
}

function initializeMissingGameProgress(
  store: LocalProgressStoreV3,
  previousGame: GameRecord,
  nextGame: GameRecord,
  timestamp: string,
): HuntMemoryReconciliationResult {
  const nextStore = deepClone(store);
  nextStore.gameProgress = {
    ...nextStore.gameProgress,
    [nextGame.id]: createDefaultGameProgressV3(nextGame, timestamp),
  };

  const previousSets = new Map(
    previousGame.achievementSets.map((item) => [item.id, item]),
  );
  const nextSets = new Map(
    nextGame.achievementSets.map((item) => [item.id, item]),
  );
  const unionSetIds = Array.from(
    new Set([...previousSets.keys(), ...nextSets.keys()]),
  ).sort();

  const setDeltas: AchievementSetReconciliationDeltaV3[] = [];

  for (const setId of unionSetIds) {
    const previousSet = previousSets.get(setId);
    const nextSet = nextSets.get(setId);

    if (nextSet) {
      const checklistMap = new Map<string, string[]>();
      for (const achievement of nextSet.achievements) {
        if (achievement.tracking.mode === 'checklist') {
          checklistMap.set(
            achievement.id,
            achievement.tracking.items.map((item) => item.id),
          );
        }
      }

      const runDelta: RunReconciliationDelta = {
        runId: DEFAULT_HUNT_MEMORY_RUN_ID,
        addedAchievementIds: nextSet.achievements.map((item) => item.id).sort(),
        quarantinedAchievementIds: [],
        restoredOrphanedAchievementIds: [],
        addedChecklistItems: groupChecklistDeltas(checklistMap),
        removedChecklistItems: [],
        removedPinnedAchievementIds: [],
      };

      setDeltas.push({
        setId,
        fromVersion: previousSet?.version,
        toVersion: nextSet.version,
        runDeltas: [runDelta],
      });
    } else if (previousSet) {
      setDeltas.push({
        setId,
        fromVersion: previousSet.version,
        toVersion: undefined,
        runDeltas: [],
      });
    }
  }

  const report: ReconciliationDeltaReportV3 = {
    gameId: nextGame.id,
    fromGameVersion: previousGame.version,
    toGameVersion: nextGame.version,
    setDeltas,
    retiredSetIds: [],
    restoredRetiredSetIds: [],
    retainedRetiredSetIds: [],
    schemaConflicts: [],
  };

  const targetValidation = LocalProgressStoreV3Schema.safeParse(nextStore);
  if (!targetValidation.success) {
    const details = targetValidation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return {
      store,
      report: createEarlyReport(
        previousGame,
        nextGame,
        `Invalid target progress store structure: ${details}`,
      ),
    };
  }

  return { store: nextStore, report };
}

export function reconcileHuntMemoryGameProgress(
  store: LocalProgressStoreV3,
  previousGame: GameRecord,
  nextGame: GameRecord,
  timestamp: string,
): HuntMemoryReconciliationResult {
  if (!isIsoUtcString(timestamp)) {
    return {
      store,
      report: createEarlyReport(
        previousGame,
        nextGame,
        `Invalid reconciliation timestamp: ${timestamp}`,
      ),
    };
  }

  if (previousGame.id !== nextGame.id) {
    return {
      store,
      report: createEarlyReport(
        previousGame,
        nextGame,
        `Mismatched game identity: previous '${previousGame.id}', next '${nextGame.id}'`,
      ),
    };
  }

  const sourceValidation = LocalProgressStoreV3Schema.safeParse(store);
  if (!sourceValidation.success) {
    const details = sourceValidation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return {
      store,
      report: createEarlyReport(
        previousGame,
        nextGame,
        `Invalid progress store structure: ${details}`,
      ),
    };
  }

  if (!Object.hasOwn(store.gameProgress, nextGame.id)) {
    return initializeMissingGameProgress(
      store,
      previousGame,
      nextGame,
      timestamp,
    );
  }

  const nextStore = deepClone(store);
  const gameProgress = nextStore.gameProgress[nextGame.id];

  const previousSets = new Map(
    previousGame.achievementSets.map((item) => [item.id, item]),
  );
  const nextSets = new Map(
    nextGame.achievementSets.map((item) => [item.id, item]),
  );

  const preExistingRetiredSetIds = new Set(Object.keys(gameProgress.retiredSets));
  const unionSetIds = Array.from(
    new Set([
      ...previousSets.keys(),
      ...nextSets.keys(),
      ...Object.keys(gameProgress.sets),
      ...Object.keys(gameProgress.retiredSets),
    ]),
  ).sort();

  const setDeltas: AchievementSetReconciliationDeltaV3[] = [];
  const retiredSetIds: string[] = [];
  const restoredRetiredSetIds: string[] = [];
  const retainedRetiredSetIds: string[] = [];
  let clearedPreferredSetId: string | undefined;
  let clearedUndoTarget: { setId: string; runId: string } | undefined;
  let shouldClearUndo = false;
  const conflicts: TrackedSchemaConflict[] = [];

  const existingUndoSnapshot =
    nextStore.undoState && Object.hasOwn(nextStore.undoState, nextGame.id)
      ? nextStore.undoState[nextGame.id]
      : undefined;

  for (const setId of unionSetIds) {
    const previousSet = previousSets.get(setId);
    const nextSet = nextSets.get(setId);
    const isActive = Object.hasOwn(gameProgress.sets, setId);
    const isRetired = Object.hasOwn(gameProgress.retiredSets, setId);

    if (isRetired) {
      const retiredSet = gameProgress.retiredSets[setId];

      if (!nextSet) {
        continue;
      }

      if (retiredSet.retirementReason === 'removed_set') {
        if (retiredSet.version !== nextSet.version) {
          conflicts.push({
            rule: 11,
            identityKey: setId,
            message: `Retired set '${setId}' version mismatch: stored '${retiredSet.version}', expected '${nextSet.version}'`,
          });
          continue;
        }

        let allCompatible = true;
        for (const run of Object.values(retiredSet.runs)) {
          for (const [achievementId, progress] of Object.entries(run.progress)) {
            const achievementDefinition = nextSet.achievements.find(
              (item) => item.id === achievementId,
            );
            if (!achievementDefinition) {
              allCompatible = false;
              break;
            }
            if (
              !validateTrackerShape(progress, achievementDefinition.tracking)
            ) {
              allCompatible = false;
              break;
            }
          }
          if (!allCompatible) break;
        }

        if (!allCompatible) {
          conflicts.push({
            rule: 11,
            identityKey: setId,
            message: `Retired set '${setId}' has incompatible progress for returning definition`,
          });
          continue;
        }

        const restoredSet: AchievementSetProgressV3 = {
          setId: retiredSet.setId,
          version: retiredSet.version,
          activeRunId: retiredSet.activeRunId,
          runs: retiredSet.runs,
        };
        gameProgress.sets[setId] = restoredSet;
        delete gameProgress.retiredSets[setId];
        restoredRetiredSetIds.push(setId);

        const runDeltas = Object.keys(retiredSet.runs)
          .sort()
          .map((runId) => createEmptyRunDelta(runId));

        setDeltas.push({
          setId,
          fromVersion: previousSet?.version,
          toVersion: nextSet.version,
          runDeltas,
        });
        continue;
      }

      if (retiredSet.retirementReason === 'schema_2_absent_orphans') {
        const restoredRuns: Record<string, RunProgress> = {};
        const runDeltas: RunReconciliationDelta[] = [];

        for (const runId of Object.keys(retiredSet.runs).sort()) {
          const retiredRun = retiredSet.runs[runId];
          const { restoredRun, runDelta } = restoreSchema2AbsentOrphansRun(
            setId,
            retiredRun,
            nextSet,
            timestamp,
            conflicts,
          );
          restoredRuns[runId] = restoredRun;
          runDeltas.push(runDelta);
        }

        const restoredSet: AchievementSetProgressV3 = {
          setId: retiredSet.setId,
          version: nextSet.version,
          activeRunId: retiredSet.activeRunId,
          runs: restoredRuns,
        };
        gameProgress.sets[setId] = restoredSet;
        delete gameProgress.retiredSets[setId];
        restoredRetiredSetIds.push(setId);

        setDeltas.push({
          setId,
          fromVersion: undefined,
          toVersion: nextSet.version,
          runDeltas,
        });
        continue;
      }
    }

    if (isActive) {
      const activeSet = gameProgress.sets[setId];

      if (!previousSet) {
        conflicts.push({
          rule: 1,
          identityKey: setId,
          message: `Active set '${setId}' has no previous definition; state was left unchanged`,
        });
        setDeltas.push({
          setId,
          fromVersion: undefined,
          toVersion: nextSet?.version,
          runDeltas: [],
        });
        continue;
      }

      if (!nextSet) {
        const retiredEntry: RetiredAchievementSetProgressV3 = {
          setId: activeSet.setId,
          version: activeSet.version,
          retirementReason: 'removed_set',
          activeRunId: activeSet.activeRunId,
          runs: activeSet.runs,
        };
        gameProgress.retiredSets[setId] = retiredEntry;
        delete gameProgress.sets[setId];
        retiredSetIds.push(setId);

        if (gameProgress.preferredSetId === setId) {
          delete gameProgress.preferredSetId;
          clearedPreferredSetId = setId;
        }

        if (existingUndoSnapshot && existingUndoSnapshot.setId === setId) {
          shouldClearUndo = true;
        }

        setDeltas.push({
          setId,
          fromVersion: previousSet.version,
          toVersion: undefined,
          runDeltas: [],
        });
        continue;
      }

      if (activeSet.version !== previousSet.version) {
        conflicts.push({
          rule: 1,
          identityKey: setId,
          message: `Set '${setId}' version mismatch: stored '${activeSet.version}', expected '${previousSet.version}'`,
        });

        if (
          existingUndoSnapshot &&
          existingUndoSnapshot.setId === setId &&
          existingUndoSnapshot.guardedSetVersion !== nextSet.version
        ) {
          shouldClearUndo = true;
        }

        setDeltas.push({
          setId,
          fromVersion: previousSet.version,
          toVersion: nextSet.version,
          runDeltas: [],
        });
        continue;
      }

      if (
        existingUndoSnapshot &&
        existingUndoSnapshot.setId === setId &&
        existingUndoSnapshot.guardedSetVersion !== nextSet.version
      ) {
        shouldClearUndo = true;
      }

      const runDeltas: RunReconciliationDelta[] = [];
      const runIds = Object.keys(activeSet.runs).sort();

      for (const runId of runIds) {
        const runProgress = activeSet.runs[runId];
        const runDelta = reconcileSingleRunProgress(
          setId,
          runProgress,
          previousSet,
          nextSet,
          timestamp,
          conflicts,
        );
        runDeltas.push(runDelta);

        if (
          existingUndoSnapshot &&
          existingUndoSnapshot.setId === setId &&
          existingUndoSnapshot.runId === runId
        ) {
          const didRunMutate =
            runDelta.addedAchievementIds.length > 0 ||
            runDelta.quarantinedAchievementIds.length > 0 ||
            runDelta.restoredOrphanedAchievementIds.length > 0 ||
            runDelta.addedChecklistItems.length > 0 ||
            runDelta.removedChecklistItems.length > 0 ||
            runDelta.removedPinnedAchievementIds.length > 0;
          if (didRunMutate) {
            shouldClearUndo = true;
          }
        }
      }

      activeSet.version = nextSet.version;
      setDeltas.push({
        setId,
        fromVersion: previousSet.version,
        toVersion: nextSet.version,
        runDeltas,
      });
      continue;
    }

    if (!isActive && !isRetired) {
      if (!previousSet && nextSet) {
        const newSetProgress = createDefaultAchievementSetProgressV3(
          nextSet,
          timestamp,
        );
        gameProgress.sets[setId] = newSetProgress;

        const checklistMap = new Map<string, string[]>();
        for (const achievement of nextSet.achievements) {
          if (achievement.tracking.mode === 'checklist') {
            checklistMap.set(
              achievement.id,
              achievement.tracking.items.map((item) => item.id),
            );
          }
        }

        const runDelta: RunReconciliationDelta = {
          runId: DEFAULT_HUNT_MEMORY_RUN_ID,
          addedAchievementIds: nextSet.achievements
            .map((item) => item.id)
            .sort(),
          quarantinedAchievementIds: [],
          restoredOrphanedAchievementIds: [],
          addedChecklistItems: groupChecklistDeltas(checklistMap),
          removedChecklistItems: [],
          removedPinnedAchievementIds: [],
        };

        setDeltas.push({
          setId,
          fromVersion: undefined,
          toVersion: nextSet.version,
          runDeltas: [runDelta],
        });
        continue;
      }

      if (previousSet && !nextSet) {
        setDeltas.push({
          setId,
          fromVersion: previousSet.version,
          toVersion: undefined,
          runDeltas: [],
        });
        continue;
      }

      if (previousSet && nextSet) {
        const newSetProgress = createDefaultAchievementSetProgressV3(
          nextSet,
          timestamp,
        );
        gameProgress.sets[setId] = newSetProgress;

        const checklistMap = new Map<string, string[]>();
        for (const achievement of nextSet.achievements) {
          if (achievement.tracking.mode === 'checklist') {
            checklistMap.set(
              achievement.id,
              achievement.tracking.items.map((item) => item.id),
            );
          }
        }

        const runDelta: RunReconciliationDelta = {
          runId: DEFAULT_HUNT_MEMORY_RUN_ID,
          addedAchievementIds: nextSet.achievements
            .map((item) => item.id)
            .sort(),
          quarantinedAchievementIds: [],
          restoredOrphanedAchievementIds: [],
          addedChecklistItems: groupChecklistDeltas(checklistMap),
          removedChecklistItems: [],
          removedPinnedAchievementIds: [],
        };

        setDeltas.push({
          setId,
          fromVersion: previousSet.version,
          toVersion: nextSet.version,
          runDeltas: [runDelta],
        });
      }
    }
  }

  for (const retiredId of preExistingRetiredSetIds) {
    if (Object.hasOwn(gameProgress.retiredSets, retiredId)) {
      retainedRetiredSetIds.push(retiredId);
    }
  }

  if (existingUndoSnapshot) {
    if (shouldClearUndo) {
      clearedUndoTarget = {
        setId: existingUndoSnapshot.setId,
        runId: existingUndoSnapshot.runId,
      };
      delete nextStore.undoState![nextGame.id];
      if (Object.keys(nextStore.undoState!).length === 0) {
        delete nextStore.undoState;
      }
    } else if (!Object.hasOwn(gameProgress.sets, existingUndoSnapshot.setId)) {
      clearedUndoTarget = {
        setId: existingUndoSnapshot.setId,
        runId: existingUndoSnapshot.runId,
      };
      delete nextStore.undoState![nextGame.id];
      if (Object.keys(nextStore.undoState!).length === 0) {
        delete nextStore.undoState;
      }
    }
  }

  const sortedConflicts = conflicts
    .sort((left, right) => {
      if (left.rule !== right.rule) return left.rule - right.rule;
      return left.identityKey.localeCompare(right.identityKey);
    })
    .map((item) => item.message);

  setDeltas.sort((left, right) => left.setId.localeCompare(right.setId));
  retiredSetIds.sort();
  restoredRetiredSetIds.sort();
  retainedRetiredSetIds.sort();

  const report: ReconciliationDeltaReportV3 = {
    gameId: nextGame.id,
    fromGameVersion: previousGame.version,
    toGameVersion: nextGame.version,
    setDeltas,
    retiredSetIds,
    restoredRetiredSetIds,
    retainedRetiredSetIds,
    schemaConflicts: sortedConflicts,
  };
  if (clearedPreferredSetId !== undefined) {
    report.clearedPreferredSetId = clearedPreferredSetId;
  }
  if (clearedUndoTarget !== undefined) {
    report.clearedUndoTarget = clearedUndoTarget;
  }

  const targetValidation = LocalProgressStoreV3Schema.safeParse(nextStore);
  if (!targetValidation.success) {
    const details = targetValidation.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return {
      store,
      report: createEarlyReport(
        previousGame,
        nextGame,
        `Invalid target progress store structure: ${details}`,
      ),
    };
  }

  return { store: nextStore, report };
}
