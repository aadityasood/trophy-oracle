import { useState } from 'react';
import {
  getPlatformRoadmapLabel,
  type AchievementRecord,
  type AchievementSet,
  type GameRecord,
  type PlatformId,
} from '../../domain/achievement-schema';
import type { LocalProgressStore } from '../../domain/progress-schema';
import {
  getOracleFocus,
  getPinnedAchievements,
  getStageSummaries,
  hasPartialProgress,
  hasUrgency,
  resolveActiveStage,
  type StageId,
} from '../../domain/progress-view';

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

const platformLabels: Record<PlatformId, string> = {
  playstation: 'PlayStation',
  xbox: 'Xbox',
  steam: 'Steam',
  other: 'Other',
};

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

      {/* 1. Roadmap Header & Stage Progress */}
      <section
        aria-labelledby="roadmap-heading"
        className="rounded-lg border border-slate-800 border-l-4 bg-slate-900 p-5 space-y-4"
        style={{ borderLeftColor: 'var(--theme-surface-glow)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Platform roadmap
            </div>
            <h3 id="roadmap-heading" className="text-base font-bold text-slate-100">
              {getPlatformRoadmapLabel(set.platform)}
            </h3>
          </div>
          <dl className="flex flex-wrap gap-4 text-xs">
            <div>
              <dt className="text-slate-400">Platform</dt>
              <dd className="font-medium text-slate-200">
                {platformLabels[set.platform]}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Edition</dt>
              <dd className="font-medium text-slate-200">
                {set.edition ?? 'Standard'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Achievements</dt>
              <dd className="font-medium text-slate-200">
                {set.achievements.length}
              </dd>
            </div>
          </dl>
        </div>

        {/* Stages list / selector */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-400">
            Roadmap Stages
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {stageSummaries.map((summary) => {
              const isActive = activeStage === summary.stage;
              const pct = Math.round(summary.fraction * 100);

              return (
                <button
                  key={summary.stage}
                  type="button"
                  aria-pressed={isActive}
                  aria-label={`Select ${summary.label} stage: ${summary.completedCount} of ${summary.totalCount} completed`}
                  disabled={isReadOnly}
                  onClick={() => onSelectActiveStage(summary.stage)}
                  className={`flex flex-col items-start justify-between rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-secondary)] disabled:cursor-not-allowed disabled:opacity-50 ${
                    isActive
                      ? 'border-[var(--theme-primary)] bg-slate-800/90 shadow-[inset_0_0_0_1px_var(--theme-secondary)]'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950'
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-100">
                      {summary.label}
                    </span>
                    {isActive && (
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-slate-300">
                    <span>
                      {summary.completedCount} / {summary.totalCount} completed
                    </span>
                    <span className="text-slate-500">
                      {' '}
                      ({summary.remainingCount} remaining)
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-slate-400">
                    {pct}% complete
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. Focus Board */}
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
              const counterTarget =
                achievement.tracking.mode === 'counter'
                  ? achievement.tracking.target
                  : undefined;
              const counterRemaining =
                counterTarget !== undefined
                  ? Math.max(0, counterTarget - counterValue)
                  : undefined;
              const counterPct =
                counterTarget !== undefined && counterTarget > 0
                  ? Math.min(
                      100,
                      Math.floor((counterValue / counterTarget) * 100),
                    )
                  : undefined;

              const checklistItems =
                achievement.tracking.mode === 'checklist'
                  ? achievement.tracking.items
                  : [];
              const checklistCompletedCount = checklistItems.filter(
                (item) => progress.checklistCompletion?.[item.id] === true,
              ).length;
              const checklistTotalCount = checklistItems.length;
              const checklistRemainingCount =
                checklistTotalCount - checklistCompletedCount;
              const checklistPct =
                checklistTotalCount > 0
                  ? Math.floor(
                      (checklistCompletedCount / checklistTotalCount) * 100,
                    )
                  : 0;

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

                  {/* Quick Controls */}
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
                          {counterTarget === undefined
                            ? `Progress: ${counterValue} ${achievement.tracking.unit} (open counter)`
                            : `Progress: ${counterValue} / ${counterTarget} (${counterRemaining} remaining, ${counterPct}%)`}
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
                          Progress: {checklistCompletedCount} /{' '}
                          {checklistTotalCount} items (
                          {checklistRemainingCount} remaining, {checklistPct}%)
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

      {/* 3. Oracle Focus (Recommendations) */}
      <section
        aria-labelledby="oracle-focus-heading"
        className="rounded-lg border border-slate-800 bg-slate-900 p-5 space-y-4"
      >
        <div className="border-b border-slate-800 pb-3">
          <h3
            id="oracle-focus-heading"
            className="text-base font-bold text-slate-100"
          >
            Oracle Focus
          </h3>
          <p className="text-xs text-slate-400">
            Deterministic recommendations prioritized by urgency, active stage,
            and partial progress.
          </p>
        </div>

        {oracleFocusAchievements.length === 0 ? (
          <p
            role="status"
            className="rounded border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400"
          >
            No Oracle Focus recommendations available. All qualifying
            achievements in this set are complete or waiting on prerequisites.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {oracleFocusAchievements.map((achievement) => {
              const isRevealed = revealed[achievement.id] === true;
              const displayLabel = getDisplayLabel(achievement, isRevealed);
              const progress = activeSetProgress.progress[achievement.id];
              const isPinned =
                activeSetProgress.pinnedAchievementIds.includes(
                  achievement.id,
                );
              const urgent = hasUrgency(achievement);
              const isStageMatch = achievement.expectedStage === activeStage;
              const partial = hasPartialProgress(achievement, progress);

              return (
                <article
                  key={achievement.id}
                  aria-label={`Oracle recommendation: ${displayLabel}`}
                  className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                        {achievement.expectedStage}
                      </span>
                      {urgent && (
                        <span className="rounded border border-amber-800 bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                          Urgent / Missable
                        </span>
                      )}
                      {isStageMatch && (
                        <span className="rounded border border-sky-800 bg-sky-950 px-1.5 py-0.5 text-[10px] text-sky-300">
                          Active Stage
                        </span>
                      )}
                      {partial && (
                        <span className="rounded border border-emerald-800 bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          In Progress
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-semibold text-slate-100">
                      {displayLabel}
                    </h4>

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

                    {isRevealed && achievement.warning && (
                      <p className="text-xs text-amber-400">
                        <span className="font-semibold">Warning: </span>
                        {achievement.warning}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                    <button
                      type="button"
                      aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${displayLabel} to focus board`}
                      aria-pressed={isPinned}
                      disabled={isReadOnly}
                      onClick={() => onTogglePin(achievement.id, !isPinned)}
                      className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        isPinned
                          ? 'border-amber-700 bg-amber-950/60 text-amber-200 hover:bg-amber-900/60'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {isPinned ? 'Pinned' : 'Pin'}
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
                      className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
                    >
                      {isRevealed ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
