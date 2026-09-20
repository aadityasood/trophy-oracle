import type { AchievementRecord } from '../../domain/achievement-schema';
import type { AchievementProgress } from '../../domain/progress-schema';
import {
  getRiskLabel,
  hasPartialProgress,
  type StageId,
} from '../../domain/progress-view';

export interface OracleFocusProps {
  recommendations: AchievementRecord[];
  activeStage: StageId;
  progressMap: Record<string, AchievementProgress>;
  pinnedAchievementIds: string[];
  revealed: Record<string, boolean>;
  getDisplayLabel: (achievement: AchievementRecord, isRevealed: boolean) => string;
  onTogglePin: (achievementId: string, pin: boolean) => void;
  onToggleReveal: (achievementId: string) => void;
  isReadOnly?: boolean;
}

export function OracleFocus({
  recommendations,
  activeStage,
  progressMap,
  pinnedAchievementIds,
  revealed,
  getDisplayLabel,
  onTogglePin,
  onToggleReveal,
  isReadOnly = false,
}: OracleFocusProps) {
  return (
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

      {recommendations.length === 0 ? (
        <p
          role="status"
          className="rounded border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400"
        >
          No Oracle Focus recommendations available. All qualifying
          achievements in this set are complete or waiting on prerequisites.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {recommendations.map((achievement) => {
            const isRevealed = revealed[achievement.id] === true;
            const displayLabel = getDisplayLabel(achievement, isRevealed);
            const progress = progressMap[achievement.id];
            const isPinned = pinnedAchievementIds.includes(achievement.id);
            const riskLabel = getRiskLabel(achievement);
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
                    {riskLabel && (
                      <span className="rounded border border-amber-800 bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                        {riskLabel}
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
                    onClick={() => onToggleReveal(achievement.id)}
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
  );
}
