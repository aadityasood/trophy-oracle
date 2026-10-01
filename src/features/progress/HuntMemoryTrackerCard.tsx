import { useEffect, useId, useRef, useState } from 'react';
import type {
  AchievementRecord,
  PlatformReward,
} from '../../domain/achievement-schema';
import type {
  AchievementProgressV3,
  CounterProgress,
} from '../../domain/hunt-memory-schema';
import { getTrackerPresentationV3 } from '../../domain/hunt-memory-view';
import { HuntMemoryCounterEditor } from './HuntMemoryCounterEditor';
import type { HuntMemoryActionResult } from './use-hunt-memory-store';

export interface HuntMemoryTrackerCardProps {
  achievement: AchievementRecord;
  sourceIndex: number;
  progress?: AchievementProgressV3;
  isPinned: boolean;
  gameId: string;
  setId: string;
  runId: string;
  isReadOnly?: boolean;
  getTimestamp: () => string;
  onBinaryCompletionChange: (
    achievementId: string,
    completed: boolean,
  ) => Promise<HuntMemoryActionResult>;
  onCounterProgressChange: (
    achievementId: string,
    counter: CounterProgress,
  ) => Promise<HuntMemoryActionResult>;
  onChecklistItemCompletionChange: (
    achievementId: string,
    itemId: string,
    completed: boolean,
  ) => Promise<HuntMemoryActionResult>;
  onNotesChange: (
    achievementId: string,
    notes: string | undefined,
  ) => Promise<HuntMemoryActionResult>;
  onCompletionOverrideChange: (
    achievementId: string,
    override: boolean,
  ) => Promise<HuntMemoryActionResult>;
  onTogglePin: (
    achievementId: string,
    pin: boolean,
  ) => Promise<HuntMemoryActionResult>;
}

function formatReward(reward: PlatformReward): string {
  if (reward.type === 'trophy') return `${reward.grade} trophy`;
  if (reward.type === 'gamerscore') return `${reward.points} Gamerscore`;
  return 'platform achievement';
}

function HuntMemoryTrackerCardInner({
  achievement,
  sourceIndex,
  progress,
  isPinned,
  gameId,
  setId,
  runId,
  isReadOnly = false,
  getTimestamp,
  onBinaryCompletionChange,
  onCounterProgressChange,
  onChecklistItemCompletionChange,
  onNotesChange,
  onCompletionOverrideChange,
  onTogglePin,
}: HuntMemoryTrackerCardProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const notesId = `${baseId}-notes`;
  const errorId = `${baseId}-error`;

  const [isRevealed, setIsRevealed] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [isConfirmingOverride, setIsConfirmingOverride] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const isPendingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const presentation = getTrackerPresentationV3(achievement, progress);
  const isReady = presentation.status === 'ready';
  const binaryPresentation =
    presentation.status === 'ready' && presentation.mode === 'binary'
      ? presentation
      : null;
  const checklistPresentation =
    presentation.status === 'ready' && presentation.mode === 'checklist'
      ? presentation
      : null;
  const isManualOverrideActive =
    presentation.status === 'ready' &&
    presentation.mode !== 'binary' &&
    presentation.manualOverride;
  const checklistItems =
    achievement.tracking.mode === 'checklist'
      ? achievement.tracking.items
      : [];

  const displayLabel = isRevealed
    ? achievement.name
    : `Achievement ${sourceIndex + 1}`;

  const isControlsDisabled = isReadOnly || isPending;

  const executeAction = async (
    action: () => Promise<HuntMemoryActionResult>,
    onSuccess?: () => void,
  ) => {
    if (isPendingRef.current || isReadOnly) return;

    isPendingRef.current = true;
    setIsPending(true);
    setActionError(null);

    try {
      const result = await action();
      if (!isMountedRef.current) return;
      if (result.status === 'success' || result.status === 'no-op') {
        onSuccess?.();
        setActionError(null);
      } else {
        setActionError(result.message);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setActionError(
        err instanceof Error ? err.message : 'An unexpected error occurred.',
      );
    } finally {
      if (isMountedRef.current) {
        isPendingRef.current = false;
        setIsPending(false);
      }
    }
  };

  const handleCounterApply = async (
    achievementId: string,
    counter: CounterProgress,
  ): Promise<HuntMemoryActionResult> => {
    if (isPendingRef.current || isReadOnly) {
      return {
        status: 'busy',
        message: 'An operation is already in progress.',
        reason: 'OPERATION_IN_FLIGHT',
      };
    }

    isPendingRef.current = true;
    setIsPending(true);
    setActionError(null);

    try {
      const result = await onCounterProgressChange(achievementId, counter);
      return result;
    } catch (err) {
      return {
        status: 'failure',
        code: 'UNEXPECTED_ERROR',
        message:
          err instanceof Error ? err.message : 'An unexpected error occurred.',
      };
    } finally {
      if (isMountedRef.current) {
        isPendingRef.current = false;
        setIsPending(false);
      }
    }
  };

  const handleBinaryChange = (checked: boolean) => {
    void executeAction(() =>
      onBinaryCompletionChange(achievement.id, checked),
    );
  };

  const handleChecklistChange = (itemId: string, checked: boolean) => {
    void executeAction(() =>
      onChecklistItemCompletionChange(achievement.id, itemId, checked),
    );
  };

  const handleTogglePin = () => {
    void executeAction(() => onTogglePin(achievement.id, !isPinned));
  };

  const handleConfirmOverride = () => {
    void executeAction(
      () => onCompletionOverrideChange(achievement.id, true),
      () => setIsConfirmingOverride(false),
    );
  };

  const handleRemoveOverride = () => {
    void executeAction(() =>
      onCompletionOverrideChange(achievement.id, false),
    );
  };

  const handleCancelOverride = () => {
    if (isControlsDisabled) return;
    setIsConfirmingOverride(false);
  };

  const displayedNotes =
    notesDraft !== null ? notesDraft : (progress?.notes ?? '');

  const handleSaveNotes = () => {
    const valueToSave = displayedNotes;
    void executeAction(
      () => onNotesChange(achievement.id, valueToSave),
      () => setNotesDraft(null),
    );
  };

  const handleClearNotes = () => {
    void executeAction(
      () => onNotesChange(achievement.id, undefined),
      () => setNotesDraft(null),
    );
  };

  const canClearNotes =
    !isControlsDisabled &&
    (notesDraft !== null || progress?.notes !== undefined);

  return (
    <article
      aria-label={
        !isReady && achievement.tracking.mode !== 'counter'
          ? `Unavailable progress for ${displayLabel}`
          : undefined
      }
      aria-labelledby={isReady ? headingId : undefined}
      className={
        isReady
          ? 'space-y-3 rounded-lg border border-slate-800 bg-slate-900/90 p-4'
          : achievement.tracking.mode !== 'counter'
            ? 'rounded-lg border border-slate-800 bg-slate-900/90 p-4 text-xs text-slate-400'
            : undefined
      }
    >
      {isReady && (
        <div className="flex flex-col items-start justify-between gap-2 border-b border-slate-800/80 pb-2 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4
                id={headingId}
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
              disabled={isControlsDisabled}
              onClick={handleTogglePin}
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
      )}

      {isReady && isRevealed && (
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

      <div className={isReady ? 'space-y-3 pt-1' : undefined}>
        {achievement.tracking.mode === 'counter' && (
          <HuntMemoryCounterEditor
            achievement={achievement}
            progress={progress}
            displayLabel={displayLabel}
            gameId={gameId}
            setId={setId}
            runId={runId}
            isReadOnly={isControlsDisabled}
            getTimestamp={getTimestamp}
            onApply={handleCounterApply}
          />
        )}

        {binaryPresentation && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={binaryPresentation.completed}
              disabled={isControlsDisabled}
              onChange={(event) => handleBinaryChange(event.target.checked)}
            />
            <span>Mark {displayLabel} complete</span>
          </label>
        )}

        {checklistPresentation && (
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-400">
              Checklist for {displayLabel}
            </legend>
            <p className="text-xs font-medium text-slate-300">
              {checklistPresentation.summary}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {checklistItems.map((item, itemIndex) => {
                const itemLabel = isRevealed
                  ? item.name
                  : `Item ${itemIndex + 1}`;
                const itemPres = checklistPresentation.items.find(
                  (presItem) => presItem.id === item.id,
                );
                const isChecked = itemPres?.completed === true;
                return (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center gap-2 rounded border border-slate-800 bg-slate-950 p-1.5 text-xs text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isControlsDisabled}
                      onChange={(event) =>
                        handleChecklistChange(item.id, event.target.checked)
                      }
                    />
                    <span>
                      {itemLabel} for {displayLabel}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {isReady && achievement.tracking.mode !== 'binary' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 pt-2 text-xs">
            {isManualOverrideActive ? (
              <>
                <span className="font-medium text-emerald-400">
                  Manual completion override active
                </span>
                <button
                  type="button"
                  aria-label={`Return ${displayLabel} to tracker-derived completion`}
                  disabled={isControlsDisabled}
                  onClick={handleRemoveOverride}
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
                    disabled={isControlsDisabled}
                    onClick={handleConfirmOverride}
                    className="rounded bg-amber-900 px-2.5 py-1 text-xs font-semibold text-amber-100 disabled:opacity-50"
                  >
                    Confirm override
                  </button>
                  <button
                    type="button"
                    aria-label={`Cancel completion override for ${displayLabel}`}
                    disabled={isControlsDisabled}
                    onClick={handleCancelOverride}
                    className="px-2 py-1 text-xs text-slate-400 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                aria-label={`Override completion for ${displayLabel}`}
                disabled={isControlsDisabled}
                onClick={() => setIsConfirmingOverride(true)}
                className="rounded border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-400 disabled:opacity-50"
              >
                Override completion
              </button>
            )}
          </div>
        )}

        {isReady && (
          <div className="space-y-2 border-t border-slate-800/60 pt-2">
            <label htmlFor={notesId} className="text-xs text-slate-400">
              Manual notes for {displayLabel}
            </label>
            <textarea
              id={notesId}
              rows={2}
              value={displayedNotes}
              disabled={isControlsDisabled}
              onChange={(event) => setNotesDraft(event.target.value)}
              placeholder="Add manual notes..."
              className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-label={`Save notes for ${displayLabel}`}
                disabled={isControlsDisabled}
                onClick={handleSaveNotes}
                className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 disabled:opacity-50"
              >
                Save Notes
              </button>
              <button
                type="button"
                aria-label={`Clear notes for ${displayLabel}`}
                disabled={!canClearNotes}
                onClick={handleClearNotes}
                className="rounded px-2.5 py-1 text-xs text-slate-400 disabled:opacity-50"
              >
                Clear Notes
              </button>
            </div>
          </div>
        )}

        {actionError && (
          <p id={errorId} role="alert" className="text-xs text-amber-300">
            {actionError}
          </p>
        )}

        {isReady && progress && (
          <div className="grid gap-1 pt-1 font-mono text-[11px] text-slate-500 sm:grid-cols-3">
            <p>State: {progress.completed ? 'Complete' : 'Incomplete'}</p>
            <p>Provenance: {progress.provenance}</p>
            <p>Updated: {progress.lastUpdated}</p>
          </div>
        )}
      </div>

      {!isReady && achievement.tracking.mode !== 'counter' && (
        <p>
          Progress is unavailable for {displayLabel}. Saved data has not been changed.
        </p>
      )}
    </article>
  );
}

export function HuntMemoryTrackerCard(props: HuntMemoryTrackerCardProps) {
  const identityKey = JSON.stringify([
    props.gameId,
    props.setId,
    props.runId,
    props.achievement.id,
  ]);

  return <HuntMemoryTrackerCardInner key={identityKey} {...props} />;
}
