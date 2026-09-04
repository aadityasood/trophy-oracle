import type {
  AchievementRecord,
  AchievementSet,
  TrackingConfiguration,
} from './achievement-schema';
import { createDefaultAchievementProgressV3 } from './hunt-memory-lifecycle';
import { computeDerivedCompletionV3 } from './hunt-memory-progress';
import type {
  AchievementProgressV3,
  OrphanedAchievementProgressV3,
  RunProgress,
} from './hunt-memory-schema';
import type {
  ChecklistItemDeltaV3,
  RunReconciliationDelta,
  TrackedSchemaConflict,
} from './hunt-memory-reconciliation-types';

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

export function validateTrackerShape(
  progress: AchievementProgressV3,
  tracking: TrackingConfiguration,
): boolean {
  if (tracking.mode === 'binary') {
    return (
      progress.counter === undefined &&
      progress.checklistCompletion === undefined &&
      !progress.manualOverride
    );
  }

  if (tracking.mode === 'counter') {
    return (
      progress.counter !== undefined &&
      progress.checklistCompletion === undefined
    );
  }

  const checklist = progress.checklistCompletion;
  if (progress.counter !== undefined || checklist === undefined) {
    return false;
  }
  const expectedIds = tracking.items.map((item) => item.id);
  const actualKeys = Object.keys(checklist);
  return (
    actualKeys.length === expectedIds.length &&
    expectedIds.every((id) => Object.hasOwn(checklist, id))
  );
}

export function createEmptyRunDelta(runId: string): RunReconciliationDelta {
  return {
    runId,
    addedAchievementIds: [],
    quarantinedAchievementIds: [],
    restoredOrphanedAchievementIds: [],
    addedChecklistItems: [],
    removedChecklistItems: [],
    removedPinnedAchievementIds: [],
  };
}

export function groupChecklistDeltas(
  itemsMap: Map<string, string[]>,
): ChecklistItemDeltaV3[] {
  const result: ChecklistItemDeltaV3[] = [];
  const sortedAchievementIds = Array.from(itemsMap.keys()).sort();
  for (const achievementId of sortedAchievementIds) {
    const itemIds = itemsMap.get(achievementId);
    if (itemIds && itemIds.length > 0) {
      result.push({
        achievementId,
        itemIds: [...itemIds].sort(),
      });
    }
  }
  return result;
}

function createOrphanFromActiveProgress(
  progress: AchievementProgressV3,
  trackingMode: 'binary' | 'counter' | 'checklist',
): OrphanedAchievementProgressV3 {
  const orphan: OrphanedAchievementProgressV3 = {
    achievementId: progress.achievementId,
    completed: progress.completed,
    manualOverride: progress.manualOverride,
    lastUpdated: progress.lastUpdated,
    provenance: progress.provenance,
    trackingModeAtRemoval: trackingMode,
  };
  if (progress.notes !== undefined) {
    orphan.notes = progress.notes;
  }
  if (trackingMode === 'counter' && progress.counter !== undefined) {
    orphan.counter = deepClone(progress.counter);
  } else if (
    trackingMode === 'checklist' &&
    progress.checklistCompletion !== undefined
  ) {
    orphan.checklistCompletion = deepClone(progress.checklistCompletion);
  }
  return orphan;
}

function findNewestCompatibleOrphanIndex(
  history: OrphanedAchievementProgressV3[] | undefined,
  expectedMode: 'binary' | 'counter' | 'checklist',
): number {
  if (!history || history.length === 0) return -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].trackingModeAtRemoval === expectedMode) {
      return index;
    }
  }
  return -1;
}

function restoreBinaryOrphanProgress(
  achievement: AchievementRecord,
  orphan: OrphanedAchievementProgressV3,
): AchievementProgressV3 {
  const restored: AchievementProgressV3 = {
    achievementId: achievement.id,
    completed: orphan.completed,
    manualOverride: false,
    lastUpdated: orphan.lastUpdated,
    provenance: orphan.provenance,
  };
  if (orphan.notes !== undefined) {
    restored.notes = orphan.notes;
  }
  return restored;
}

function restoreCounterOrphanProgress(
  achievement: AchievementRecord,
  orphan: OrphanedAchievementProgressV3,
): AchievementProgressV3 {
  const restored: AchievementProgressV3 = {
    achievementId: achievement.id,
    completed: orphan.completed,
    manualOverride: orphan.manualOverride,
    counter: deepClone(orphan.counter),
    lastUpdated: orphan.lastUpdated,
    provenance: orphan.provenance,
  };
  if (orphan.notes !== undefined) {
    restored.notes = orphan.notes;
  }

  if (restored.manualOverride) {
    restored.completed = true;
  } else {
    restored.completed = computeDerivedCompletionV3(achievement, restored);
  }

  return restored;
}

function restoreChecklistOrphanProgress(
  achievement: AchievementRecord,
  orphan: OrphanedAchievementProgressV3,
  addedChecklistMap: Map<string, string[]>,
  removedChecklistMap: Map<string, string[]>,
): AchievementProgressV3 {
  const orphanCompletion = orphan.checklistCompletion ?? {};
  const trackingItems = (
    achievement.tracking as Extract<TrackingConfiguration, { mode: 'checklist' }>
  ).items;
  const nextItemSet = new Set(trackingItems.map((item) => item.id));

  const nextCompletion: Record<string, boolean> = {};
  const addedIds: string[] = [];
  const removedIds: string[] = [];

  for (const item of trackingItems) {
    if (Object.hasOwn(orphanCompletion, item.id)) {
      nextCompletion[item.id] = orphanCompletion[item.id];
    } else {
      nextCompletion[item.id] = false;
      addedIds.push(item.id);
    }
  }

  for (const existingKey of Object.keys(orphanCompletion)) {
    if (!nextItemSet.has(existingKey)) {
      removedIds.push(existingKey);
    }
  }

  if (addedIds.length > 0) {
    addedChecklistMap.set(achievement.id, addedIds);
  }
  if (removedIds.length > 0) {
    removedChecklistMap.set(achievement.id, removedIds);
  }

  const restored: AchievementProgressV3 = {
    achievementId: achievement.id,
    completed: orphan.completed,
    manualOverride: orphan.manualOverride,
    checklistCompletion: nextCompletion,
    lastUpdated: orphan.lastUpdated,
    provenance: orphan.provenance,
  };
  if (orphan.notes !== undefined) {
    restored.notes = orphan.notes;
  }

  if (restored.manualOverride) {
    restored.completed = true;
  } else {
    restored.completed = computeDerivedCompletionV3(achievement, restored);
  }

  return restored;
}

function reconcileActiveChecklistProgress(
  achievement: AchievementRecord,
  progress: AchievementProgressV3,
  addedChecklistMap: Map<string, string[]>,
  removedChecklistMap: Map<string, string[]>,
): void {
  const existingCompletion = progress.checklistCompletion ?? {};
  const trackingItems = (
    achievement.tracking as Extract<TrackingConfiguration, { mode: 'checklist' }>
  ).items;
  const nextItemSet = new Set(trackingItems.map((item) => item.id));

  const nextCompletion: Record<string, boolean> = {};
  const addedIds: string[] = [];
  const removedIds: string[] = [];

  for (const item of trackingItems) {
    if (Object.hasOwn(existingCompletion, item.id)) {
      nextCompletion[item.id] = existingCompletion[item.id];
    } else {
      nextCompletion[item.id] = false;
      addedIds.push(item.id);
    }
  }

  for (const existingKey of Object.keys(existingCompletion)) {
    if (!nextItemSet.has(existingKey)) {
      removedIds.push(existingKey);
    }
  }

  if (addedIds.length > 0) {
    addedChecklistMap.set(achievement.id, addedIds);
  }
  if (removedIds.length > 0) {
    removedChecklistMap.set(achievement.id, removedIds);
  }

  progress.checklistCompletion = nextCompletion;
  delete progress.counter;

  if (progress.manualOverride) {
    progress.completed = true;
  } else {
    progress.completed = computeDerivedCompletionV3(achievement, progress);
  }
}

function repairRunPins(
  runProgress: RunProgress,
  nextSet: AchievementSet,
  removedPinnedAchievementIds: string[],
): void {
  const validAchievementIds = new Set(nextSet.achievements.map((item) => item.id));
  const survivingPins: string[] = [];

  for (const pinId of runProgress.pinnedAchievementIds) {
    const isValid =
      validAchievementIds.has(pinId) &&
      Object.hasOwn(runProgress.progress, pinId) &&
      !survivingPins.includes(pinId) &&
      survivingPins.length < 5;

    if (isValid) {
      survivingPins.push(pinId);
    } else {
      if (!removedPinnedAchievementIds.includes(pinId)) {
        removedPinnedAchievementIds.push(pinId);
      }
    }
  }

  runProgress.pinnedAchievementIds = survivingPins;
}

export function reconcileSingleRunProgress(
  setId: string,
  runProgress: RunProgress,
  previousSet: AchievementSet,
  nextSet: AchievementSet,
  timestamp: string,
  conflicts: TrackedSchemaConflict[],
): RunReconciliationDelta {
  const previousAchievements = new Map(
    previousSet.achievements.map((item) => [item.id, item]),
  );
  const nextAchievements = new Map(
    nextSet.achievements.map((item) => [item.id, item]),
  );

  const unionAchievementIds = Array.from(
    new Set([
      ...previousAchievements.keys(),
      ...nextAchievements.keys(),
      ...Object.keys(runProgress.progress),
    ]),
  ).sort();

  const addedAchievementIds: string[] = [];
  const quarantinedAchievementIds: string[] = [];
  const restoredOrphanedAchievementIds: string[] = [];
  const addedChecklistMap = new Map<string, string[]>();
  const removedChecklistMap = new Map<string, string[]>();
  const removedPinnedAchievementIds: string[] = [];

  for (const achievementId of unionAchievementIds) {
    const previousAchievement = previousAchievements.get(achievementId);
    const nextAchievement = nextAchievements.get(achievementId);
    const hasActiveProgress = Object.hasOwn(runProgress.progress, achievementId);

    if (previousAchievement && !nextAchievement) {
      if (hasActiveProgress) {
        const progress = runProgress.progress[achievementId];
        const orphan = createOrphanFromActiveProgress(
          progress,
          previousAchievement.tracking.mode,
        );
        if (!Object.hasOwn(runProgress.orphanedProgress, achievementId)) {
          runProgress.orphanedProgress[achievementId] = [];
        }
        runProgress.orphanedProgress[achievementId].push(orphan);
        delete runProgress.progress[achievementId];
        quarantinedAchievementIds.push(achievementId);
      }

      if (runProgress.pinnedAchievementIds.includes(achievementId)) {
        runProgress.pinnedAchievementIds = runProgress.pinnedAchievementIds.filter(
          (pinId) => pinId !== achievementId,
        );
        removedPinnedAchievementIds.push(achievementId);
      }
      continue;
    }

    if (!previousAchievement && nextAchievement) {
      const history = Object.hasOwn(runProgress.orphanedProgress, achievementId)
        ? runProgress.orphanedProgress[achievementId]
        : undefined;

      const newestCompatibleIndex = findNewestCompatibleOrphanIndex(
        history,
        nextAchievement.tracking.mode,
      );

      if (history && newestCompatibleIndex >= 0) {
        const orphan = history[newestCompatibleIndex];
        history.splice(newestCompatibleIndex, 1);
        if (history.length === 0) {
          delete runProgress.orphanedProgress[achievementId];
        }

        let restoredProgress: AchievementProgressV3;
        if (nextAchievement.tracking.mode === 'binary') {
          restoredProgress = restoreBinaryOrphanProgress(nextAchievement, orphan);
        } else if (nextAchievement.tracking.mode === 'counter') {
          restoredProgress = restoreCounterOrphanProgress(nextAchievement, orphan);
        } else {
          restoredProgress = restoreChecklistOrphanProgress(
            nextAchievement,
            orphan,
            addedChecklistMap,
            removedChecklistMap,
          );
        }

        runProgress.progress[achievementId] = restoredProgress;
        restoredOrphanedAchievementIds.push(achievementId);
      } else {
        if (history && history.length > 0) {
          const newestIncompatibleOrphan = history[history.length - 1];
          conflicts.push({
            rule: 6,
            identityKey: `${setId}:${runProgress.runId}:${achievementId}`,
            message: `Incompatible orphan tracking mode in set '${setId}', run '${runProgress.runId}' for '${achievementId}': removed as '${newestIncompatibleOrphan.trackingModeAtRemoval}', reappeared as '${nextAchievement.tracking.mode}'`,
          });
        }

        runProgress.progress[achievementId] = createDefaultAchievementProgressV3(
          nextAchievement,
          timestamp,
        );
        addedAchievementIds.push(achievementId);
        if (nextAchievement.tracking.mode === 'checklist') {
          addedChecklistMap.set(
            achievementId,
            nextAchievement.tracking.items.map((item) => item.id),
          );
        }
      }
      continue;
    }

    if (previousAchievement && nextAchievement) {
      if (!hasActiveProgress) {
        runProgress.progress[achievementId] = createDefaultAchievementProgressV3(
          nextAchievement,
          timestamp,
        );
        addedAchievementIds.push(achievementId);
        if (nextAchievement.tracking.mode === 'checklist') {
          addedChecklistMap.set(
            achievementId,
            nextAchievement.tracking.items.map((item) => item.id),
          );
        }
        continue;
      }

      const currentProgress = runProgress.progress[achievementId];

      if (previousAchievement.tracking.mode !== nextAchievement.tracking.mode) {
        const orphan = createOrphanFromActiveProgress(
          currentProgress,
          previousAchievement.tracking.mode,
        );
        if (!Object.hasOwn(runProgress.orphanedProgress, achievementId)) {
          runProgress.orphanedProgress[achievementId] = [];
        }
        runProgress.orphanedProgress[achievementId].push(orphan);
        quarantinedAchievementIds.push(achievementId);

        if (runProgress.pinnedAchievementIds.includes(achievementId)) {
          runProgress.pinnedAchievementIds = runProgress.pinnedAchievementIds.filter(
            (pinId) => pinId !== achievementId,
          );
          removedPinnedAchievementIds.push(achievementId);
        }

        runProgress.progress[achievementId] = createDefaultAchievementProgressV3(
          nextAchievement,
          timestamp,
        );

        conflicts.push({
          rule: 8,
          identityKey: `${setId}:${runProgress.runId}:${achievementId}`,
          message: `Incompatible tracking mode change for '${achievementId}' in set '${setId}', run '${runProgress.runId}': was '${previousAchievement.tracking.mode}', now '${nextAchievement.tracking.mode}'`,
        });
        continue;
      }

      if (nextAchievement.tracking.mode === 'binary') {
        currentProgress.manualOverride = false;
        delete currentProgress.counter;
        delete currentProgress.checklistCompletion;
      } else if (nextAchievement.tracking.mode === 'counter') {
        delete currentProgress.checklistCompletion;
        if (currentProgress.manualOverride) {
          currentProgress.completed = true;
        } else {
          currentProgress.completed = computeDerivedCompletionV3(
            nextAchievement,
            currentProgress,
          );
        }
      } else {
        reconcileActiveChecklistProgress(
          nextAchievement,
          currentProgress,
          addedChecklistMap,
          removedChecklistMap,
        );
      }
    }
  }

  repairRunPins(runProgress, nextSet, removedPinnedAchievementIds);

  return {
    runId: runProgress.runId,
    addedAchievementIds: addedAchievementIds.sort(),
    quarantinedAchievementIds: quarantinedAchievementIds.sort(),
    restoredOrphanedAchievementIds: restoredOrphanedAchievementIds.sort(),
    addedChecklistItems: groupChecklistDeltas(addedChecklistMap),
    removedChecklistItems: groupChecklistDeltas(removedChecklistMap),
    removedPinnedAchievementIds: removedPinnedAchievementIds.sort(),
  };
}

export function restoreSchema2AbsentOrphansRun(
  setId: string,
  retiredRun: RunProgress,
  nextSet: AchievementSet,
  timestamp: string,
  conflicts: TrackedSchemaConflict[],
): { restoredRun: RunProgress; runDelta: RunReconciliationDelta } {
  const restoredRun: RunProgress = {
    runId: retiredRun.runId,
    name: retiredRun.name,
    createdAt: retiredRun.createdAt,
    pinnedAchievementIds: [],
    progress: {},
    orphanedProgress: deepClone(retiredRun.orphanedProgress),
  };
  if (retiredRun.activeStage !== undefined) {
    restoredRun.activeStage = retiredRun.activeStage;
  }

  const addedAchievementIds: string[] = [];
  const restoredOrphanedAchievementIds: string[] = [];
  const addedChecklistMap = new Map<string, string[]>();
  const removedChecklistMap = new Map<string, string[]>();

  for (const achievement of nextSet.achievements) {
    const history = Object.hasOwn(restoredRun.orphanedProgress, achievement.id)
      ? restoredRun.orphanedProgress[achievement.id]
      : undefined;

    const newestCompatibleIndex = findNewestCompatibleOrphanIndex(
      history,
      achievement.tracking.mode,
    );

    if (history && newestCompatibleIndex >= 0) {
      const orphan = history[newestCompatibleIndex];
      history.splice(newestCompatibleIndex, 1);
      if (history.length === 0) {
        delete restoredRun.orphanedProgress[achievement.id];
      }

      let restoredProgress: AchievementProgressV3;
      if (achievement.tracking.mode === 'binary') {
        restoredProgress = restoreBinaryOrphanProgress(achievement, orphan);
      } else if (achievement.tracking.mode === 'counter') {
        restoredProgress = restoreCounterOrphanProgress(achievement, orphan);
      } else {
        restoredProgress = restoreChecklistOrphanProgress(
          achievement,
          orphan,
          addedChecklistMap,
          removedChecklistMap,
        );
      }

      restoredRun.progress[achievement.id] = restoredProgress;
      restoredOrphanedAchievementIds.push(achievement.id);
    } else {
      if (history && history.length > 0) {
        const newestIncompatibleOrphan = history[history.length - 1];
        conflicts.push({
          rule: 6,
          identityKey: `${setId}:${restoredRun.runId}:${achievement.id}`,
          message: `Incompatible orphan tracking mode in set '${setId}', run '${restoredRun.runId}' for '${achievement.id}': removed as '${newestIncompatibleOrphan.trackingModeAtRemoval}', reappeared as '${achievement.tracking.mode}'`,
        });
      }

      restoredRun.progress[achievement.id] = createDefaultAchievementProgressV3(
        achievement,
        timestamp,
      );
      addedAchievementIds.push(achievement.id);
      if (achievement.tracking.mode === 'checklist') {
        addedChecklistMap.set(
          achievement.id,
          achievement.tracking.items.map((item) => item.id),
        );
      }
    }
  }

  const runDelta: RunReconciliationDelta = {
    runId: restoredRun.runId,
    addedAchievementIds: addedAchievementIds.sort(),
    quarantinedAchievementIds: [],
    restoredOrphanedAchievementIds: restoredOrphanedAchievementIds.sort(),
    addedChecklistItems: groupChecklistDeltas(addedChecklistMap),
    removedChecklistItems: groupChecklistDeltas(removedChecklistMap),
    removedPinnedAchievementIds: [],
  };

  return { restoredRun, runDelta };
}
