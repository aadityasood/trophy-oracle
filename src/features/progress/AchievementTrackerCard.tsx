import { useState } from 'react';
import type {
  AchievementRecord,
  PlatformReward,
} from '../../domain/achievement-schema';
import type { AchievementProgress } from '../../domain/progress-schema';
import { getProgressSummary } from '../../domain/progress-view';

export interface AchievementTrackerCardProps {
  achievement: AchievementRecord;
  sourceIndex: number;
  progress?: AchievementProgress;
  isPinned: boolean;
  gameId: string;
  setId: string;
  onBinaryCompletionChange: (achievementId: string, completed: boolean) => void;
  onCounterValueChange: (achievementId: string, value: number) => void;
  onChecklistItemCompletionChange: (
    achievementId: string,
    itemId: string,
    completed: boolean,
  ) => void;
  onNotesChange: (achievementId: string, notes: string | undefined) => void;
  onCompletionOverrideChange: (
    achievementId: string,
    override: boolean,
  ) => void;
  onTogglePin: (achievementId: string, pin: boolean) => void;
  isReadOnly?: boolean;
}

function formatReward(reward: PlatformReward): string {
  if (reward.type === 'trophy') return `${reward.grade} trophy`;
  if (reward.type === 'gamerscore') return `${reward.points} Gamerscore`;
  return 'platform achievement';
}

export function AchievementTrackerCard({
  achievement,
  sourceIndex,
  progress,
  isPinned,
  gameId,
  setId,
  onBinaryCompletionChange,
  onCounterValueChange,
  onChecklistItemCompletionChange,
  onNotesChange,
  onCompletionOverrideChange,
  onTogglePin,
  isReadOnly = false,
}: AchievementTrackerCardProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [isConfirmingOverride, setIsConfirmingOverride] = useState(false);
  const [counterDraft, setCounterDraft] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  if (!progress) {
    return (
      <article
        aria-label={`Unavailable progress for Achievement ${sourceIndex + 1}`}
        className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400"
      >
        Progress is unavailable for Achievement {sourceIndex + 1}. Saved data
        has not been changed.
      </article>
    );
  }

  const displayLabel = isRevealed
    ? achievement.name
    : `Achievement ${sourceIndex + 1}`;
  const identity = `${gameId}-${setId}-${achievement.id}`;

  const counterValue = progress.counterValue ?? 0;
  const progressSummary = getProgressSummary(achievement, progress);
  const displayedCounterDraft = counterDraft ?? String(counterValue);
  const displayedNotesDraft = notesDraft ?? progress.notes ?? '';

  const clearCounterDraft = (): void => {
    setCounterDraft(null);
    setValidationMessage(null);
  };

  const applyCounterDraft = (): void => {
    if (displayedCounterDraft.trim() === '') {
      setValidationMessage('Enter a non-negative whole number.');
      return;
    }
    const value = Number(displayedCounterDraft);
    if (!Number.isInteger(value) || value < 0) {
      setValidationMessage('Enter a non-negative whole number.');
      return;
    }
    clearCounterDraft();
    onCounterValueChange(achievement.id, value);
  };

  return (
    <article
      aria-labelledby={`${identity}-heading`}
      className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/90 p-4"
    >
      <div className="flex flex-col items-start justify-between gap-2 border-b border-slate-800/80 pb-2 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4
              id={`${identity}-heading`}
              className="text-sm font-semibold text-slate-100"
            >
              {displayLabel}
            </h4>
            <span className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-300">
              {achievement.expectedStage}
            </span>
            <span className="rounded border border-slate-800 bg-slate-800 px-2 py-0.5 font-mono text-[10px] capitalize text-slate-400">
              {achievement.tracking.mode}
            </span>
            <span className="rounded border border-slate-800 bg-slate-800 px-2 py-0.5 text-[10px] capitalize text-slate-400">
              {formatReward(achievement.reward)}
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
            aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${displayLabel}`}
            aria-pressed={isPinned}
            disabled={isReadOnly}
            onClick={() => onTogglePin(achievement.id, !isPinned)}
            className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isPinned
                ? 'border-amber-700 bg-amber-950/60 text-amber-200 hover:bg-amber-900/60'
                : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {isPinned ? 'Pinned' : 'Pin'}
          </button>
          <button
            type="button"
            aria-label={`${isRevealed ? 'Hide' : 'Reveal'} details for ${displayLabel}`}
            onClick={() => setIsRevealed((current) => !current)}
            className="shrink-0 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800"
          >
            {isRevealed ? 'Hide details' : 'Reveal details'}
          </button>
        </div>
      </div>

      {isRevealed && (
        <div className="space-y-2 rounded border border-slate-800/60 bg-slate-950/60 p-3 text-xs">
          <p>
            <span className="font-semibold text-slate-400">Evidence: </span>
            <span className="text-slate-300">{achievement.evidence}</span>
          </p>
          {achievement.warning && (
            <p className="text-amber-400">
              <span className="font-semibold">Warning: </span>
              {achievement.warning}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3 pt-1">
        {achievement.tracking.mode === 'binary' && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={progress.completed}
              disabled={isReadOnly}
              onChange={(event) =>
                onBinaryCompletionChange(
                  achievement.id,
                  event.target.checked,
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
            <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                aria-label={`Decrease counter for ${displayLabel}`}
                disabled={isReadOnly || counterValue === 0}
                onClick={() => {
                  clearCounterDraft();
                  onCounterValueChange(
                    achievement.id,
                    Math.max(0, counterValue - 1),
                  );
                }}
                className="min-w-10 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 disabled:opacity-50"
              >
                -1
              </button>
              {(achievement.tracking.quickSteps ?? [1]).map((step) => (
                <button
                  key={step}
                  type="button"
                  aria-label={`Add ${step} to counter for ${displayLabel}`}
                  disabled={isReadOnly}
                  onClick={() => {
                    clearCounterDraft();
                    onCounterValueChange(
                      achievement.id,
                      counterValue + step,
                    );
                  }}
                  className="min-w-10 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 disabled:opacity-50"
                >
                  +{step}
                </button>
              ))}
              <label
                htmlFor={`${identity}-counter`}
                className="flex flex-col gap-1 text-[11px] text-slate-400"
              >
                Set counter for {displayLabel}
                <input
                  id={`${identity}-counter`}
                  type="number"
                  min="0"
                  step="1"
                  value={displayedCounterDraft}
                  disabled={isReadOnly}
                  onChange={(event) =>
                    setCounterDraft(event.target.value)
                  }
                  className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                />
              </label>
              <button
                type="button"
                aria-label={`Apply counter for ${displayLabel}`}
                disabled={isReadOnly}
                onClick={applyCounterDraft}
                className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
            {validationMessage && (
              <p role="status" className="text-xs text-amber-300">
                {validationMessage}
              </p>
            )}
          </div>
        )}

        {achievement.tracking.mode === 'checklist' && (
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-400">
              Checklist for {displayLabel}
            </legend>
            <p className="text-xs font-medium text-slate-300">
              {progressSummary}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {achievement.tracking.items.map((item, itemIndex) => {
                const itemLabel = isRevealed
                  ? item.name
                  : `Item ${itemIndex + 1}`;
                return (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-2 rounded border border-slate-800 bg-slate-950 p-1.5 text-xs text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={
                        progress.checklistCompletion?.[item.id] === true
                      }
                      disabled={isReadOnly}
                      onChange={(event) =>
                        onChecklistItemCompletionChange(
                          achievement.id,
                          item.id,
                          event.target.checked,
                        )
                      }
                    />
                    <span>{itemLabel} for {displayLabel}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {achievement.tracking.mode !== 'binary' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 pt-2 text-xs">
            {progress.manualOverride ? (
              <>
                <span className="font-medium text-emerald-400">
                  Manual completion override active
                </span>
                <button
                  type="button"
                  aria-label={`Return ${displayLabel} to tracker-derived completion`}
                  disabled={isReadOnly}
                  onClick={() =>
                    onCompletionOverrideChange(achievement.id, false)
                  }
                  className="rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-300 disabled:opacity-50"
                >
                  Return to tracker-derived completion
                </button>
              </>
            ) : isConfirmingOverride ? (
              <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded border border-amber-800/80 bg-slate-950 p-2 text-amber-300">
                <span>Manually mark {displayLabel} as complete?</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label={`Confirm completion override for ${displayLabel}`}
                    disabled={isReadOnly}
                    onClick={() => {
                      setIsConfirmingOverride(false);
                      onCompletionOverrideChange(achievement.id, true);
                    }}
                    className="rounded bg-amber-900 px-2.5 py-1 text-xs font-semibold text-amber-100 disabled:opacity-50"
                  >
                    Confirm override
                  </button>
                  <button
                    type="button"
                    aria-label={`Cancel completion override for ${displayLabel}`}
                    onClick={() => setIsConfirmingOverride(false)}
                    className="px-2 py-1 text-xs text-slate-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                aria-label={`Override completion for ${displayLabel}`}
                disabled={isReadOnly}
                onClick={() => setIsConfirmingOverride(true)}
                className="rounded border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-400 disabled:opacity-50"
              >
                Override completion
              </button>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-slate-800/60 pt-2">
          <label
            htmlFor={`${identity}-notes`}
            className="text-xs text-slate-400"
          >
            Manual notes for {displayLabel}
          </label>
          <textarea
            id={`${identity}-notes`}
            rows={2}
            value={displayedNotesDraft}
            disabled={isReadOnly}
            onChange={(event) =>
              setNotesDraft(event.target.value)
            }
            placeholder="Add manual notes..."
            className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-label={`Save notes for ${displayLabel}`}
              disabled={isReadOnly}
              onClick={() => {
                const valueToSave = displayedNotesDraft;
                onNotesChange(achievement.id, valueToSave);
                setNotesDraft(null);
              }}
              className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 disabled:opacity-50"
            >
              Save Notes
            </button>
            <button
              type="button"
              aria-label={`Clear notes for ${displayLabel}`}
              disabled={isReadOnly || progress.notes === undefined}
              onClick={() => {
                setNotesDraft(null);
                onNotesChange(achievement.id, undefined);
              }}
              className="rounded px-2.5 py-1 text-xs text-slate-400 disabled:opacity-50"
            >
              Clear Notes
            </button>
          </div>
        </div>

        <div className="grid gap-1 pt-1 font-mono text-[11px] text-slate-500 sm:grid-cols-3">
          <p>State: {progress.completed ? 'Complete' : 'Incomplete'}</p>
          <p>Provenance: {progress.provenance}</p>
          <p>Updated: {progress.lastUpdated}</p>
        </div>
      </div>
    </article>
  );
}
