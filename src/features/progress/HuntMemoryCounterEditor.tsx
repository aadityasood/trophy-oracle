import { useEffect, useId, useRef, useState } from 'react';
import type { AchievementRecord } from '../../domain/achievement-schema';
import {
  CounterProgressSchema,
  type AchievementProgressV3,
  type CounterProgress,
} from '../../domain/hunt-memory-schema';
import { getTrackerPresentationV3 } from '../../domain/hunt-memory-view';
import type { HuntMemoryActionResult } from './use-hunt-memory-store';

export interface HuntMemoryCounterEditorProps {
  achievement: AchievementRecord;
  progress?: AchievementProgressV3;
  displayLabel: string;
  gameId: string;
  setId: string;
  runId: string;
  isReadOnly?: boolean;
  getTimestamp: () => string;
  onApply: (
    achievementId: string,
    counter: CounterProgress,
  ) => Promise<HuntMemoryActionResult>;
}

type CertaintyVariant = CounterProgress['certainty'];

function getConfirmedValue(counter: CounterProgress): number {
  if (counter.certainty === 'exact') return counter.value;
  if (counter.certainty === 'at_least') return counter.minimum;
  if (counter.certainty === 'estimated') return counter.estimate;
  return counter.observedSinceStart;
}

function HuntMemoryCounterEditorInner({
  achievement,
  progress,
  displayLabel,
  isReadOnly = false,
  getTimestamp,
  onApply,
}: HuntMemoryCounterEditorProps) {
  const baseId = useId();
  const certaintyId = `${baseId}-certainty`;
  const numericId = `${baseId}-numeric`;
  const errorId = `${baseId}-error`;

  const [certaintyDraft, setCertaintyDraft] = useState<CertaintyVariant | null>(null);
  const [numericDraft, setNumericDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  if (presentation.status !== 'ready' || presentation.mode !== 'counter') {
    return (
      <article
        aria-label={`Unavailable progress for ${displayLabel}`}
        className="rounded-lg border border-slate-800 bg-slate-900/90 p-4 text-xs text-slate-400"
      >
        Progress is unavailable for {displayLabel}. Saved data has not been changed.
      </article>
    );
  }

  const confirmedCounter = progress!.counter!;
  const confirmedValue = getConfirmedValue(confirmedCounter);

  const effectiveCertainty: CertaintyVariant =
    certaintyDraft ?? confirmedCounter.certainty;
  const effectiveNumeric: string =
    numericDraft ?? String(confirmedValue);

  const handleCertaintyChange = (newCertainty: CertaintyVariant) => {
    if (newCertainty === effectiveCertainty) return;
    setError(null);
    if (newCertainty === 'unknown') {
      const isConfirmedUnknown = confirmedCounter.certainty === 'unknown';
      setNumericDraft(
        isConfirmedUnknown ? String(confirmedCounter.observedSinceStart) : '0',
      );
    } else if (effectiveCertainty === 'unknown') {
      setNumericDraft('');
    } else {
      setNumericDraft(effectiveNumeric);
    }
    setCertaintyDraft(newCertainty);
  };

  const dispatchCounter = async (counterPayload: CounterProgress) => {
    if (isPendingRef.current || isReadOnly) return;

    const validation = CounterProgressSchema.safeParse(counterPayload);
    if (!validation.success) {
      setError(
        validation.error.issues[0]?.message ?? 'Invalid counter progress.',
      );
      return;
    }

    isPendingRef.current = true;
    setIsPending(true);

    try {
      const result = await onApply(achievement.id, validation.data);
      if (!isMountedRef.current) return;
      if (result.status === 'success' || result.status === 'no-op') {
        setCertaintyDraft(null);
        setNumericDraft(null);
        setError(null);
      } else {
        setError(result.message);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(
        err instanceof Error ? err.message : 'An unexpected error occurred.',
      );
    } finally {
      if (isMountedRef.current) {
        isPendingRef.current = false;
        setIsPending(false);
      }
    }
  };

  const handleApply = () => {
    if (isPendingRef.current || isReadOnly) return;

    const trimmed = effectiveNumeric.trim();
    if (trimmed === '') {
      setError('Enter a non-negative whole number.');
      return;
    }

    const value = Number(trimmed);
    if (
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0 ||
      !/^\d+$/.test(trimmed)
    ) {
      setError('Enter a non-negative whole number.');
      return;
    }

    let payload: CounterProgress;
    if (effectiveCertainty === 'exact') {
      payload = { certainty: 'exact', value };
    } else if (effectiveCertainty === 'at_least') {
      payload = { certainty: 'at_least', minimum: value };
    } else if (effectiveCertainty === 'estimated') {
      payload = { certainty: 'estimated', estimate: value };
    } else {
      let trackingStartedAt: string;
      if (confirmedCounter.certainty === 'unknown') {
        trackingStartedAt = confirmedCounter.trackingStartedAt;
      } else {
        try {
          trackingStartedAt = getTimestamp();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : 'Invalid timestamp.',
          );
          return;
        }
      }
      payload = {
        certainty: 'unknown',
        observedSinceStart: value,
        trackingStartedAt,
      };
    }

    void dispatchCounter(payload);
  };

  const handleQuickAdjustment = (step: number) => {
    if (isPendingRef.current || isReadOnly) return;

    const nextCounter: CounterProgress =
      confirmedCounter.certainty === 'exact'
        ? { certainty: 'exact', value: Math.max(0, confirmedCounter.value + step) }
        : confirmedCounter.certainty === 'at_least'
          ? { certainty: 'at_least', minimum: Math.max(0, confirmedCounter.minimum + step) }
          : confirmedCounter.certainty === 'estimated'
            ? { certainty: 'estimated', estimate: Math.max(0, confirmedCounter.estimate + step) }
            : {
                certainty: 'unknown',
                observedSinceStart: Math.max(0, confirmedCounter.observedSinceStart + step),
                trackingStartedAt: confirmedCounter.trackingStartedAt,
              };

    void dispatchCounter(nextCounter);
  };

  const tracking = achievement.tracking as Extract<
    AchievementRecord['tracking'],
    { mode: 'counter' }
  >;
  const quickSteps = tracking.quickSteps ?? [1];
  const isControlsDisabled = isReadOnly || isPending;
  const isDecrementDisabled = isControlsDisabled || confirmedValue === 0;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-300">
        {presentation.summary}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          aria-label={`Decrease counter for ${displayLabel}`}
          disabled={isDecrementDisabled}
          onClick={() => handleQuickAdjustment(-1)}
          className="min-w-10 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 disabled:opacity-50"
        >
          -1
        </button>
        {quickSteps.map((step) => (
          <button
            key={step}
            type="button"
            aria-label={`Add ${step} to counter for ${displayLabel}`}
            disabled={isControlsDisabled}
            onClick={() => handleQuickAdjustment(step)}
            className="min-w-10 rounded border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 disabled:opacity-50"
          >
            +{step}
          </button>
        ))}
        <label
          htmlFor={certaintyId}
          className="flex flex-col gap-1 text-[11px] text-slate-400"
        >
          Certainty for {displayLabel}
          <select
            id={certaintyId}
            value={effectiveCertainty}
            disabled={isControlsDisabled}
            onChange={(event) =>
              handleCertaintyChange(
                event.target.value as CertaintyVariant,
              )
            }
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 disabled:opacity-50"
          >
            <option value="exact">Exact</option>
            <option value="at_least">At least</option>
            <option value="estimated">Estimated</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label
          htmlFor={numericId}
          className="flex flex-col gap-1 text-[11px] text-slate-400"
        >
          Set counter for {displayLabel}
          <input
            id={numericId}
            type="number"
            min="0"
            step="1"
            value={effectiveNumeric}
            disabled={isControlsDisabled}
            onChange={(event) => {
              setError(null);
              setNumericDraft(event.target.value);
            }}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          aria-label={`Apply counter for ${displayLabel}`}
          disabled={isControlsDisabled}
          onClick={handleApply}
          className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200 disabled:opacity-50"
        >
          Apply
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}

export function HuntMemoryCounterEditor(props: HuntMemoryCounterEditorProps) {
  const identityKey = JSON.stringify([
    props.gameId,
    props.setId,
    props.runId,
    props.achievement.id,
  ]);

  return <HuntMemoryCounterEditorInner key={identityKey} {...props} />;
}
