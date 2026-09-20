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
  getProgressSummary,
  getStageSummaries,
  resolveActiveStage,
  type StageId,
} from '../../domain/progress-view';
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

      <section
        aria-labelledby="focus-board-heading"
        className="rounded-lg border border-slate-800 bg-slate-900 p-5 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3
            id="focus-board-heading"
            className="text-base font-bold text-slate-100"
          >
            Focus Board ({pinnedAchievements.length} / 5 pinned)
          </h3>
        </div>

        {pinnedAchievements.length === 0 ? (
          <p
            role="status"
            className="rounded border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400"
          >
            No achievements pinned to the Focus Board. Pin up to 5 achievements
            from the tracker workbench to focus on them here.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {pinnedAchievements.map((achievement) => {
              const progress = activeSetProgress.progress[achievement.id];
              const isRevealed = revealed[achievement.id] === true;
              const displayLabel = getDisplayLabel(achievement, isRevealed);

              if (!progress) {
                const unavailableLabel = getDisplayLabel(achievement, false);
                return (
                  <article
                    key={achievement.id}
                    aria-label={`Unavailable progress for ${unavailableLabel}`}
                    className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400"
                  >
                    Progress is unavailable for {unavailableLabel}. Saved data
                    has not been changed.
                  </article>
                );
              }

              const counterValue = progress.counterValue ?? 0;
              const checklistItems =
                achievement.tracking.mode === 'checklist'
                  ? achievement.tracking.items
                  : [];
              const progressSummary = getProgressSummary(achievement, progress);

              return (
                <article
                  key={achievement.id}
                  aria-label={`Focus item: ${displayLabel}`}
                  className="space-y-3 rounded-lg border border-slate-800 bg-slate-950 p-4"
                >
                  <div className="flex flex-col items-start justify-between gap-2 border-b border-slate-800/80 pb-2 sm:flex-row sm:items-center">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-100">
                          {displayLabel}
                        </h4>
                        <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                          {achievement.expectedStage}
                        </span>
                        <span className="rounded border border-slate-800 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] capitalize text-slate-400">
                          {achievement.tracking.mode}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300">
                        {isRevealed ? (
                          achievement.description
                        ) : (
                          <span className="italic text-slate-400">
                            Spoiler protected
                            {achievement.spoilerSafeHint
                              ? ` - Hint: ${achievement.spoilerSafeHint}`
                              : ''}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Unpin ${displayLabel} from focus board`}
                        disabled={isReadOnly}
                        onClick={() => onTogglePin(achievement.id, false)}
                        className="rounded border border-amber-800/60 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200 transition-colors hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Unpin
                      </button>
                      <button
                        type="button"
                        aria-label={`${isRevealed ? 'Hide' : 'Reveal'} details for ${displayLabel}`}
                        onClick={() =>
                          setRevealed((current) => ({
                            ...current,
                            [achievement.id]: !current[achievement.id],
                          }))
                        }
                        className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800"
                      >
                        {isRevealed ? 'Hide' : 'Reveal'}
                      </button>
                    </div>
                  </div>

                  {isRevealed && (
                    <div className="space-y-1 rounded border border-slate-800/60 bg-slate-900/60 p-2.5 text-xs text-slate-300">
                      <p>
                        <span className="font-semibold text-slate-400">
                          Evidence:{' '}
                        </span>
                        {achievement.evidence}
                      </p>
                      {achievement.warning && (
                        <p className="text-amber-400">
                          <span className="font-semibold">Warning: </span>
                          {achievement.warning}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2 pt-1">
                    {achievement.tracking.mode === 'binary' && (
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={progress.completed}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            onBinaryCompletionChange(
                              achievement.id,
                              e.target.checked,
                            )
                          }
                        />
                        <span>Mark {displayLabel} complete</span>
                      </label>
                    )}

                    {achievement.tracking.mode === 'counter' && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-300">
                          {progressSummary}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Decrease counter for ${displayLabel}`}
                            disabled={isReadOnly || counterValue === 0}
                            onClick={() =>
                              onCounterValueChange(
                                achievement.id,
                                Math.max(0, counterValue - 1),
                              )
                            }
                            className="min-w-9 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 disabled:opacity-50"
                          >
                            -1
                          </button>
                          {(achievement.tracking.quickSteps ?? [1]).map(
                            (step) => (
                              <button
                                key={step}
                                type="button"
                                aria-label={`Add ${step} to counter for ${displayLabel}`}
                                disabled={isReadOnly}
                                onClick={() =>
                                  onCounterValueChange(
                                    achievement.id,
                                    counterValue + step,
                                  )
                                }
                                className="min-w-9 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 disabled:opacity-50"
                              >
                                +{step}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                    )}

                    {achievement.tracking.mode === 'checklist' && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-slate-300">
                          {progressSummary}
                        </p>
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {checklistItems.map((item, itemIdx) => {
                            const itemLabel = isRevealed
                              ? item.name
                              : `Item ${itemIdx + 1}`;
                            return (
                              <label
                                key={item.id}
                                className="flex cursor-pointer items-center gap-2 rounded border border-slate-800/80 bg-slate-900/60 p-1.5 text-xs text-slate-200"
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    progress.checklistCompletion?.[item.id] ===
                                    true
                                  }
                                  disabled={isReadOnly}
                                  onChange={(e) =>
                                    onChecklistItemCompletionChange(
                                      achievement.id,
                                      item.id,
                                      e.target.checked,
                                    )
                                  }
                                />
                                <span>
                                  {itemLabel} for {displayLabel}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-1 border-t border-slate-800/60 pt-2 font-mono text-[11px] text-slate-500 sm:grid-cols-3">
                      <p>
                        State:{' '}
                        {progress.completed ? 'Complete' : 'Incomplete'}
                      </p>
                      <p>Provenance: {progress.provenance}</p>
                      <p>Updated: {progress.lastUpdated}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

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
