import type {
  AchievementRecord,
  AchievementSet,
} from './achievement-schema';
import type {
  AchievementProgress,
  AchievementSetProgress,
} from './progress-schema';

export type StageId = 'story' | 'missables' | 'cleanup';

export const CANONICAL_STAGE_ORDER: readonly StageId[] = [
  'story',
  'missables',
  'cleanup',
] as const;

export const STAGE_DISPLAY_LABELS: Record<StageId, string> = {
  story: 'Story',
  missables: 'Missables',
  cleanup: 'Grind/Cleanup',
};

export interface StageSummary {
  stage: StageId;
  label: string;
  totalCount: number;
  completedCount: number;
  remainingCount: number;
  fraction: number;
}

export function resolveActiveStage(
  setProgress?: AchievementSetProgress,
): StageId {
  return setProgress?.activeStage ?? 'story';
}

export function getStageSummaries(
  set: AchievementSet,
  setProgress?: AchievementSetProgress,
): StageSummary[] {
  const matchingProgress =
    setProgress?.setId === set.id ? setProgress : undefined;

  return CANONICAL_STAGE_ORDER.map((stage) => {
    const stageAchievements = set.achievements.filter(
      (achievement) => achievement.expectedStage === stage,
    );
    const totalCount = stageAchievements.length;
    const completedCount = stageAchievements.filter(
      (achievement) =>
        matchingProgress?.progress[achievement.id]?.completed === true,
    ).length;
    const remainingCount = totalCount - completedCount;
    const fraction = totalCount === 0 ? 0 : completedCount / totalCount;

    return {
      stage,
      label: STAGE_DISPLAY_LABELS[stage],
      totalCount,
      completedCount,
      remainingCount,
      fraction,
    };
  });
}

export function getPinnedAchievements(
  set: AchievementSet,
  setProgress?: AchievementSetProgress,
): AchievementRecord[] {
  if (
    !setProgress ||
    setProgress.setId !== set.id ||
    !setProgress.pinnedAchievementIds.length
  ) {
    return [];
  }
  const achievementMap = new Map(
    set.achievements.map((achievement) => [achievement.id, achievement]),
  );
  const pinned: AchievementRecord[] = [];
  for (const id of setProgress.pinnedAchievementIds) {
    const achievement = achievementMap.get(id);
    if (achievement) {
      pinned.push(achievement);
      if (pinned.length === 5) break;
    }
  }
  return pinned;
}

export function hasUrgency(achievement: AchievementRecord): boolean {
  return (
    (achievement.warning !== undefined &&
      achievement.warning.trim().length > 0) ||
    achievement.labels.includes('point_of_no_return') ||
    achievement.labels.includes('missable')
  );
}

export function hasPartialProgress(
  achievement: AchievementRecord,
  progress?: AchievementProgress,
): boolean {
  if (!progress || progress.completed) return false;
  if (achievement.tracking.mode === 'counter') {
    return (progress.counterValue ?? 0) > 0;
  }
  if (achievement.tracking.mode === 'checklist') {
    return (
      progress.checklistCompletion !== undefined &&
      Object.values(progress.checklistCompletion).some((v) => v === true)
    );
  }
  return false;
}

export function arePrerequisitesMet(
  achievement: AchievementRecord,
  setProgress?: AchievementSetProgress,
): boolean {
  if (!achievement.prerequisites || achievement.prerequisites.length === 0) {
    return true;
  }
  if (!setProgress) return false;
  return achievement.prerequisites.every(
    (prereqId) => setProgress.progress[prereqId]?.completed === true,
  );
}

export function getOracleFocus(
  set: AchievementSet,
  setProgress?: AchievementSetProgress,
): AchievementRecord[] {
  if (!setProgress || setProgress.setId !== set.id) return [];

  const activeStage = resolveActiveStage(setProgress);

  const eligible = set.achievements
    .map((achievement, sourceIndex) => ({
      achievement,
      sourceIndex,
      progress: setProgress.progress[achievement.id],
    }))
    .filter(({ achievement, progress }) => {
      if (!progress || progress.completed) return false;
      return arePrerequisitesMet(achievement, setProgress);
    });

  if (eligible.length === 0) return [];

  const stageOrderIndex: Record<StageId, number> = {
    story: 0,
    missables: 1,
    cleanup: 2,
  };

  const sorted = [...eligible].sort((a, b) => {
    // 1. Urgency (true before false)
    const aUrgent = hasUrgency(a.achievement);
    const bUrgent = hasUrgency(b.achievement);
    if (aUrgent !== bUrgent) {
      return aUrgent ? -1 : 1;
    }

    // 2. Active stage match (true before false)
    const aStageMatch = a.achievement.expectedStage === activeStage;
    const bStageMatch = b.achievement.expectedStage === activeStage;
    if (aStageMatch !== bStageMatch) {
      return aStageMatch ? -1 : 1;
    }

    // 3. Partial progress (true before false)
    const aPartial = hasPartialProgress(a.achievement, a.progress);
    const bPartial = hasPartialProgress(b.achievement, b.progress);
    if (aPartial !== bPartial) {
      return aPartial ? -1 : 1;
    }

    // 4. Canonical stage order
    const aStageOrder = stageOrderIndex[a.achievement.expectedStage] ?? 99;
    const bStageOrder = stageOrderIndex[b.achievement.expectedStage] ?? 99;
    if (aStageOrder !== bStageOrder) {
      return aStageOrder - bStageOrder;
    }

    // 5. Source order
    return a.sourceIndex - b.sourceIndex;
  });

  return sorted.slice(0, 3).map((item) => item.achievement);
}
