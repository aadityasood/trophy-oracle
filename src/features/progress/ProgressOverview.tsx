import { useState } from 'react';
import type {
  AchievementRecord,
  AchievementSet,
  GameRecord,
} from '../../domain/achievement-schema';
import type { LocalProgressStore } from '../../domain/progress-schema';
import {
  getOracleFocus,
  getPinnedAchievements,
  getStageSummaries,
  resolveActiveStage,
  type StageId,
} from '../../domain/progress-view';
import { FocusBoard } from './FocusBoard';
import { OracleFocus } from './OracleFocus';
import { RoadmapProgress } from './RoadmapProgress';

export interface ProgressOverviewProps {
  game: GameRecord;
  set: AchievementSet;
  store: LocalProgressStore;
  onBinaryCompletionChange: (achievementId: string, completed: boolean) => void;
  onCounterValueChange: (achievementId: string, value: number) => void;
  onChecklistItemCompletionChange: (
    achievementId: string,
    itemId: string,
    completed: boolean,
  ) => void;
  onTogglePin: (achievementId: string, pin: boolean) => void;
  onSelectActiveStage: (stage: StageId) => void;
  actionStatus?: string | null;
  isReadOnly?: boolean;
}

export function ProgressOverview({
  game,
  set,
  store,
  onBinaryCompletionChange,
  onCounterValueChange,
  onChecklistItemCompletionChange,
  onTogglePin,
  onSelectActiveStage,
  actionStatus,
  isReadOnly = false,
}: ProgressOverviewProps) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const handleToggleReveal = (achievementId: string) => {
    setRevealed((current) => ({
      ...current,
      [achievementId]: !current[achievementId],
    }));
  };

  const gameProgress = store.gameProgress[game.id];
  const activeSetProgress = gameProgress?.sets[set.id];

  if (!activeSetProgress) {
    return (
      <section
        aria-labelledby="progress-overview-unavailable-heading"
        className="rounded-lg border border-slate-800 bg-slate-900 p-5 space-y-3"
      >
        <h3
          id="progress-overview-unavailable-heading"
          className="text-base font-bold text-slate-100"
        >
          Progress overview unavailable
        </h3>
        <article
          aria-label="Progress overview unavailable"
          className="rounded border border-slate-800 bg-slate-950 p-4 text-sm text-slate-300"
        >
          Progress for this platform is unavailable. Roadmap, Focus Board, and
          Oracle actions are hidden so your saved data stays unchanged.
        </article>
      </section>
    );
  }

  const activeStage = resolveActiveStage(activeSetProgress);
  const stageSummaries = getStageSummaries(set, activeSetProgress);
  const pinnedAchievements = getPinnedAchievements(set, activeSetProgress);
  const oracleFocusAchievements = getOracleFocus(set, activeSetProgress);

  const getSourceIndex = (achievementId: string): number => {
    const index = set.achievements.findIndex((a) => a.id === achievementId);
    return index >= 0 ? index : 0;
  };

  const getDisplayLabel = (
    achievement: AchievementRecord,
    isRevealed: boolean,
  ): string => {
    if (isRevealed) return achievement.name;
    const index = getSourceIndex(achievement.id);
    return `Achievement ${index + 1}`;
  };

  return (
    <div className="space-y-6">
      {actionStatus && (
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300"
        >
          {actionStatus}
        </p>
      )}

      <RoadmapProgress
        platform={set.platform}
        edition={set.edition}
        achievementCount={set.achievements.length}
        activeStage={activeStage}
        stageSummaries={stageSummaries}
        onSelectActiveStage={onSelectActiveStage}
        isReadOnly={isReadOnly}
      />

      <FocusBoard
        pinnedAchievements={pinnedAchievements}
        progressMap={activeSetProgress.progress}
        revealed={revealed}
        getDisplayLabel={getDisplayLabel}
        onBinaryCompletionChange={onBinaryCompletionChange}
        onCounterValueChange={onCounterValueChange}
        onChecklistItemCompletionChange={onChecklistItemCompletionChange}
        onTogglePin={onTogglePin}
        onToggleReveal={handleToggleReveal}
        isReadOnly={isReadOnly}
      />

      <OracleFocus
        recommendations={oracleFocusAchievements}
        activeStage={activeStage}
        progressMap={activeSetProgress.progress}
        pinnedAchievementIds={activeSetProgress.pinnedAchievementIds}
        revealed={revealed}
        getDisplayLabel={getDisplayLabel}
        onTogglePin={onTogglePin}
        onToggleReveal={handleToggleReveal}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}
