import type {
  AchievementRecord,
  AchievementSet,
  GameRecord,
} from './achievement-schema';
import type {
  AchievementProgressV3,
  AchievementSetProgressV3,
  LocalProgressStoreV3,
  RunProgress,
} from './hunt-memory-schema';
import {
  getCounterDisplayMetrics,
  type CounterDisplayMetrics,
} from './hunt-memory-progress';
import { validateTrackerShape } from './hunt-memory-tracker-shape';
import {
  CANONICAL_STAGE_ORDER,
  STAGE_DISPLAY_LABELS,
  hasUrgency,
  type StageId,
  type StageSummary,
} from './progress-view';

export {
  CANONICAL_STAGE_ORDER,
  STAGE_DISPLAY_LABELS,
  type StageId,
  type StageSummary,
};

export type ActiveWorkspaceUnavailableReason =
  | 'GAME_NOT_FOUND'
  | 'SET_NOT_FOUND'
  | 'SET_RETIRED'
  | 'SET_VERSION_MISMATCH'
  | 'RUN_NOT_FOUND';

export interface ActiveWorkspaceReadyResult {
  status: 'ready';
  set: AchievementSet;
  activeRun: RunProgress;
  activeStage: StageId;
  stageSummaries: StageSummary[];
  pinnedAchievements: AchievementRecord[];
  savedAchievementIds: string[];
}

export interface ActiveWorkspaceUnavailableResult {
  status: 'unavailable';
  reason: ActiveWorkspaceUnavailableReason;
  message: string;
}

export type ActiveWorkspaceV3Result =
  | ActiveWorkspaceReadyResult
  | ActiveWorkspaceUnavailableResult;

export type TrackerPresentationUnavailableReason =
  | 'MISSING_PROGRESS'
  | 'TRACKER_SHAPE_MISMATCH';

export interface BinaryTrackerPresentationV3 {
  status: 'ready';
  mode: 'binary';
  completed: boolean;
  summary?: undefined;
}

export interface CounterTrackerPresentationV3 {
  status: 'ready';
  mode: 'counter';
  completed: boolean;
  manualOverride: boolean;
  unit: string;
  target?: number;
  metrics: CounterDisplayMetrics;
  summary: string;
}

export interface ChecklistItemPresentationV3 {
  id: string;
  completed: boolean;
}

export interface ChecklistTrackerPresentationV3 {
  status: 'ready';
  mode: 'checklist';
  completed: boolean;
  manualOverride: boolean;
  totalCount: number;
  completedCount: number;
  remainingCount: number;
  percentage: number;
  items: ChecklistItemPresentationV3[];
  summary: string;
}

export interface UnavailableTrackerPresentationV3 {
  status: 'unavailable';
  reason: TrackerPresentationUnavailableReason;
  summary?: undefined;
  mode?: never;
}

export type TrackerPresentationV3 =
  | BinaryTrackerPresentationV3
  | CounterTrackerPresentationV3
  | ChecklistTrackerPresentationV3
  | UnavailableTrackerPresentationV3;

export function resolveRunActiveStage(run: RunProgress): StageId {
  return run.activeStage ?? 'story';
}

export function getRunStageSummaries(
  set: AchievementSet,
  run: RunProgress,
): StageSummary[] {
  return CANONICAL_STAGE_ORDER.map((stage) => {
    const stageAchievements = set.achievements.filter(
      (achievement) => achievement.expectedStage === stage,
    );
    const totalCount = stageAchievements.length;
    const completedCount = stageAchievements.filter((achievement) => {
      if (!Object.hasOwn(run.progress, achievement.id)) return false;
      return run.progress[achievement.id].completed === true;
    }).length;
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

export function getRunPinnedAchievements(
  set: AchievementSet,
  run: RunProgress,
): AchievementRecord[] {
  if (!run.pinnedAchievementIds.length) return [];
  const achievementMap = new Map(
    set.achievements.map((achievement) => [achievement.id, achievement]),
  );
  const pinned: AchievementRecord[] = [];
  for (const id of run.pinnedAchievementIds) {
    const achievement = achievementMap.get(id);
    if (achievement) {
      pinned.push(achievement);
      if (pinned.length === 5) break;
    }
  }
  return pinned;
}

export function getRunSavedAchievementIds(
  setProgress: AchievementSetProgressV3,
  runId: string,
): string[] {
  const guideStateByRunId = setProgress.guideStateByRunId;
  if (!guideStateByRunId || !Object.hasOwn(guideStateByRunId, runId)) {
    return [];
  }
  const runGuide = guideStateByRunId[runId];
  if (!runGuide || !Array.isArray(runGuide.savedAchievementIds)) {
    return [];
  }
  return [...runGuide.savedAchievementIds];
}

export function selectActiveWorkspaceV3(
  game: GameRecord,
  selectedSetId: string,
  store: LocalProgressStoreV3,
): ActiveWorkspaceV3Result {
  if (!Object.hasOwn(store.gameProgress, game.id)) {
    return {
      status: 'unavailable',
      reason: 'GAME_NOT_FOUND',
      message: `Game '${game.id}' does not exist in store.`,
    };
  }
  const gameProgress = store.gameProgress[game.id];

  const setDefinition = game.achievementSets.find(
    (candidate) => candidate.id === selectedSetId,
  );
  if (!setDefinition) {
    return {
      status: 'unavailable',
      reason: 'SET_NOT_FOUND',
      message: `Achievement set '${selectedSetId}' does not exist in game '${game.id}' definition.`,
    };
  }

  if (Object.hasOwn(gameProgress.retiredSets, selectedSetId)) {
    return {
      status: 'unavailable',
      reason: 'SET_RETIRED',
      message: `Achievement set '${selectedSetId}' is retired in game '${game.id}'.`,
    };
  }

  if (!Object.hasOwn(gameProgress.sets, selectedSetId)) {
    return {
      status: 'unavailable',
      reason: 'SET_NOT_FOUND',
      message: `Achievement set '${selectedSetId}' does not exist as an active set in game '${game.id}'.`,
    };
  }
  const setProgress = gameProgress.sets[selectedSetId];

  if (setProgress.version !== setDefinition.version) {
    return {
      status: 'unavailable',
      reason: 'SET_VERSION_MISMATCH',
      message: `Set '${selectedSetId}' version mismatch: stored '${setProgress.version}', expected '${setDefinition.version}'.`,
    };
  }

  if (!Object.hasOwn(setProgress.runs, setProgress.activeRunId)) {
    return {
      status: 'unavailable',
      reason: 'RUN_NOT_FOUND',
      message: `Active run '${setProgress.activeRunId}' does not exist in set '${selectedSetId}'.`,
    };
  }
  const activeRun = setProgress.runs[setProgress.activeRunId];

  return {
    status: 'ready',
    set: setDefinition,
    activeRun,
    activeStage: resolveRunActiveStage(activeRun),
    stageSummaries: getRunStageSummaries(setDefinition, activeRun),
    pinnedAchievements: getRunPinnedAchievements(setDefinition, activeRun),
    savedAchievementIds: getRunSavedAchievementIds(
      setProgress,
      setProgress.activeRunId,
    ),
  };
}

function formatCounterSummary(
  tracking: Extract<AchievementRecord['tracking'], { mode: 'counter' }>,
  metrics: CounterDisplayMetrics,
): string {
  const target = tracking.target;
  switch (metrics.certainty) {
    case 'exact':
      return target === undefined
        ? `Progress: ${metrics.value} ${tracking.unit} (open counter)`
        : `Progress: ${metrics.value} / ${target} (${metrics.remaining} remaining, ${metrics.percentage}%)`;
    case 'at_least':
      return target === undefined
        ? `Progress: At least ${metrics.minimum} ${tracking.unit} (open counter)`
        : `Progress: At least ${metrics.minimum} / ${target} (at most ${metrics.atMostRemaining} remaining, >=${metrics.lowerBoundPercentage}%)`;
    case 'estimated':
      return target === undefined
        ? `Progress: ~${metrics.estimate} ${tracking.unit} (open counter)`
        : `Progress: ~${metrics.estimate} / ${target} (~${metrics.approximateRemaining} remaining, ~${metrics.approximatePercentage}%)`;
    case 'unknown':
      return `Progress: +${metrics.observedSinceStart} tracked since ${metrics.trackingStartedAt}`;
  }
}

export function getTrackerPresentationV3(
  achievement: AchievementRecord,
  progress?: AchievementProgressV3,
): TrackerPresentationV3 {
  if (!progress) {
    return {
      status: 'unavailable',
      reason: 'MISSING_PROGRESS',
    };
  }

  if (
    progress.achievementId !== achievement.id ||
    !validateTrackerShape(progress, achievement.tracking)
  ) {
    return {
      status: 'unavailable',
      reason: 'TRACKER_SHAPE_MISMATCH',
    };
  }

  const tracking = achievement.tracking;

  if (tracking.mode === 'binary') {
    return {
      status: 'ready',
      mode: 'binary',
      completed: progress.completed,
    };
  }

  if (tracking.mode === 'counter') {
    const metrics = getCounterDisplayMetrics(tracking, progress.counter!);
    return {
      status: 'ready',
      mode: 'counter',
      completed: progress.completed,
      manualOverride: progress.manualOverride,
      unit: tracking.unit,
      target: tracking.target,
      metrics,
      summary: formatCounterSummary(tracking, metrics),
    };
  }

  const definitionItems = tracking.items;
  const totalCount = definitionItems.length;
  const checklist = progress.checklistCompletion;
  let completedCount = 0;
  const items: ChecklistItemPresentationV3[] = [];

  for (const defItem of definitionItems) {
    const isCompleted =
      checklist !== undefined &&
      Object.hasOwn(checklist, defItem.id) &&
      checklist[defItem.id] === true;
    if (isCompleted) completedCount++;
    items.push({
      id: defItem.id,
      completed: isCompleted,
    });
  }

  const remainingCount = totalCount - completedCount;
  const percentage =
    totalCount > 0 ? Math.floor((completedCount / totalCount) * 100) : 0;
  const summary = `Progress: ${completedCount} / ${totalCount} items (${remainingCount} remaining, ${percentage}%)`;

  return {
    status: 'ready',
    mode: 'checklist',
    completed: progress.completed,
    manualOverride: progress.manualOverride,
    totalCount,
    completedCount,
    remainingCount,
    percentage,
    items,
    summary,
  };
}

export function getProgressSummaryV3(
  achievement: AchievementRecord,
  progress?: AchievementProgressV3,
): string | undefined {
  const presentation = getTrackerPresentationV3(achievement, progress);
  return presentation.status === 'ready' ? presentation.summary : undefined;
}

export function hasRunPartialProgress(
  achievement: AchievementRecord,
  progress?: AchievementProgressV3,
): boolean {
  const presentation = getTrackerPresentationV3(achievement, progress);
  if (presentation.status !== 'ready' || presentation.completed) {
    return false;
  }

  if (presentation.mode === 'counter') {
    switch (presentation.metrics.certainty) {
      case 'exact':
        return presentation.metrics.value > 0;
      case 'at_least':
        return presentation.metrics.minimum > 0;
      case 'estimated':
        return presentation.metrics.estimate > 0;
      case 'unknown':
        return presentation.metrics.observedSinceStart > 0;
    }
  }

  if (presentation.mode === 'checklist') {
    return presentation.completedCount > 0;
  }

  return false;
}

function areRunPrerequisitesMet(
  achievement: AchievementRecord,
  definitionMap: Map<string, AchievementRecord>,
  run: RunProgress,
): boolean {
  if (!achievement.prerequisites || achievement.prerequisites.length === 0) {
    return true;
  }

  for (const prereqId of achievement.prerequisites) {
    const prereqDef = definitionMap.get(prereqId);
    if (!prereqDef) {
      return false;
    }

    if (!Object.hasOwn(run.progress, prereqId)) {
      return false;
    }

    const prereqProgress = run.progress[prereqId];
    const prereqPresentation = getTrackerPresentationV3(
      prereqDef,
      prereqProgress,
    );
    if (
      prereqPresentation.status !== 'ready' ||
      prereqPresentation.completed !== true
    ) {
      return false;
    }
  }

  return true;
}

export function getRunOracleFocus(
  set: AchievementSet,
  run: RunProgress,
): AchievementRecord[] {
  const activeStage = resolveRunActiveStage(run);
  const definitionMap = new Map(
    set.achievements.map((achievement) => [achievement.id, achievement]),
  );

  const eligible: Array<{
    achievement: AchievementRecord;
    sourceIndex: number;
    progress: AchievementProgressV3;
  }> = [];

  for (let i = 0; i < set.achievements.length; i++) {
    const achievement = set.achievements[i];
    if (!Object.hasOwn(run.progress, achievement.id)) {
      continue;
    }

    const progress = run.progress[achievement.id];
    const presentation = getTrackerPresentationV3(achievement, progress);
    if (presentation.status !== 'ready' || presentation.completed === true) {
      continue;
    }

    if (!areRunPrerequisitesMet(achievement, definitionMap, run)) {
      continue;
    }

    eligible.push({ achievement, sourceIndex: i, progress });
  }

  if (eligible.length === 0) {
    return [];
  }

  const sorted = [...eligible].sort((a, b) => {
    const aUrgent = hasUrgency(a.achievement);
    const bUrgent = hasUrgency(b.achievement);
    if (aUrgent !== bUrgent) {
      return aUrgent ? -1 : 1;
    }

    const aStageMatch = a.achievement.expectedStage === activeStage;
    const bStageMatch = b.achievement.expectedStage === activeStage;
    if (aStageMatch !== bStageMatch) {
      return aStageMatch ? -1 : 1;
    }

    const aPartial = hasRunPartialProgress(a.achievement, a.progress);
    const bPartial = hasRunPartialProgress(b.achievement, b.progress);
    if (aPartial !== bPartial) {
      return aPartial ? -1 : 1;
    }

    const aStageOrder = CANONICAL_STAGE_ORDER.indexOf(
      a.achievement.expectedStage,
    );
    const bStageOrder = CANONICAL_STAGE_ORDER.indexOf(
      b.achievement.expectedStage,
    );
    if (aStageOrder !== bStageOrder) {
      return aStageOrder - bStageOrder;
    }

    return a.sourceIndex - b.sourceIndex;
  });

  return sorted.slice(0, 3).map((item) => item.achievement);
}
