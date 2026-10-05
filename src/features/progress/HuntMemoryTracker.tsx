import { useEffect, useId, useRef, useState } from 'react';
import type {
  AchievementSet,
  GameRecord,
  PlatformId,
} from '../../domain/achievement-schema';
import type {
  CounterProgress,
  LocalProgressStoreV3,
  ProgressUndoSnapshotV3,
} from '../../domain/hunt-memory-schema';
import {
  selectActiveWorkspaceV3,
  type ActiveWorkspaceV3Result,
} from '../../domain/hunt-memory-view';
import { HuntMemoryTrackerCard } from './HuntMemoryTrackerCard';
import type { HuntMemoryActionResult } from './use-hunt-memory-store';

export interface HuntMemoryTrackerContext {
  gameId: string;
  setId: string;
  runId: string;
}

export interface HuntMemoryTrackerProps {
  game: GameRecord;
  selectedSetId: string;
  store: LocalProgressStoreV3;
  getTimestamp: () => string;
  onBinaryCompletionChange: (context: HuntMemoryTrackerContext, achievementId: string, completed: boolean) => Promise<HuntMemoryActionResult>;
  onCounterProgressChange: (context: HuntMemoryTrackerContext, achievementId: string, counter: CounterProgress) => Promise<HuntMemoryActionResult>;
  onChecklistItemCompletionChange: (context: HuntMemoryTrackerContext, achievementId: string, itemId: string, completed: boolean) => Promise<HuntMemoryActionResult>;
  onNotesChange: (context: HuntMemoryTrackerContext, achievementId: string, notes: string | undefined) => Promise<HuntMemoryActionResult>;
  onCompletionOverrideChange: (context: HuntMemoryTrackerContext, achievementId: string, override: boolean) => Promise<HuntMemoryActionResult>;
  onTogglePin: (context: HuntMemoryTrackerContext, achievementId: string, pin: boolean) => Promise<HuntMemoryActionResult>;
  onUndo: (gameId: string, expectedSnapshot: ProgressUndoSnapshotV3) => Promise<HuntMemoryActionResult>;
  isReadOnly?: boolean;
  isBusy?: boolean;
  isUndoDisabled?: boolean;
  undoDisabledReason?: string;
}

const platformLabels: Record<PlatformId, string> = {
  playstation: 'PlayStation',
  xbox: 'Xbox',
  steam: 'Steam',
  other: 'Other',
};

function formatSetLabel(set: AchievementSet): string {
  const edition = set.edition ? ` (${set.edition})` : '';
  const label = platformLabels[set.platform] ?? set.platform;
  return `${label}${edition}`;
}

function resolveUndoTarget(
  game: GameRecord,
  store: LocalProgressStoreV3,
  snapshot: ProgressUndoSnapshotV3,
  workspace: ActiveWorkspaceV3Result,
  isReadOnly: boolean,
  isBusy: boolean,
  isUndoDisabled: boolean,
  undoDisabledReason?: string,
) {
  const gameProgress = Object.hasOwn(store.gameProgress, game.id)
    ? store.gameProgress[game.id]
    : undefined;

  const targetSetDef = game.achievementSets.find((s) => s.id === snapshot.setId);
  const targetSetLabel = targetSetDef ? formatSetLabel(targetSetDef) : 'unavailable recorded set';

  const isTargetSetRetired = gameProgress ? Object.hasOwn(gameProgress.retiredSets, snapshot.setId) : false;
  const isTargetSetActive = gameProgress ? Object.hasOwn(gameProgress.sets, snapshot.setId) : false;
  const targetSetProgress = gameProgress && isTargetSetActive ? gameProgress.sets[snapshot.setId] : undefined;

  const targetRun = targetSetProgress && Object.hasOwn(targetSetProgress.runs, snapshot.runId)
    ? targetSetProgress.runs[snapshot.runId]
    : undefined;

  const targetRunLabel = targetRun ? targetRun.name : `${snapshot.previous.name} (unavailable)`;
  const undoButtonLabel = `Undo last change in ${targetSetLabel} (${targetRunLabel})`;

  let eligibilityReason: string | undefined;

  if (isReadOnly) {
    eligibilityReason = undoDisabledReason ?? 'Editing is disabled so saved progress stays unchanged.';
  } else if (isBusy) {
    eligibilityReason = undoDisabledReason ?? 'An operation is in progress.';
  } else if (isUndoDisabled) {
    eligibilityReason = undoDisabledReason ?? 'Undo is currently disabled.';
  } else if (workspace.status === 'unavailable') {
    eligibilityReason = 'Undo is disabled because the selected workspace is unavailable.';
  } else if (!gameProgress) {
    eligibilityReason = `Game '${game.id}' does not exist in store.`;
  } else if (!targetSetDef) {
    eligibilityReason = `Target set '${snapshot.setId}' does not exist in game definition.`;
  } else if (isTargetSetRetired) {
    eligibilityReason = `Target set '${snapshot.setId}' is retired.`;
  } else if (!isTargetSetActive || !targetSetProgress) {
    eligibilityReason = `Target set '${snapshot.setId}' does not exist in active sets.`;
  } else if (targetSetProgress.version !== targetSetDef.version) {
    eligibilityReason = `Target set '${snapshot.setId}' version mismatch: stored '${targetSetProgress.version}', expected '${targetSetDef.version}'.`;
  } else if (targetSetProgress.version !== snapshot.guardedSetVersion) {
    eligibilityReason = `Target set '${snapshot.setId}' version mismatch: current '${targetSetProgress.version}', guarded '${snapshot.guardedSetVersion}'.`;
  } else if (!targetRun) {
    eligibilityReason = `Target run '${snapshot.runId}' does not exist in set '${snapshot.setId}'.`;
  } else if (snapshot.previous.runId !== snapshot.runId) {
    eligibilityReason = 'Undo snapshot contains an invalid previous run identity.';
  }

  return { undoButtonLabel, isEligible: eligibilityReason === undefined, eligibilityReason };
}

function HuntMemoryTrackerInner({
  game,
  selectedSetId,
  store,
  getTimestamp,
  onBinaryCompletionChange,
  onCounterProgressChange,
  onChecklistItemCompletionChange,
  onNotesChange,
  onCompletionOverrideChange,
  onTogglePin,
  onUndo,
  isReadOnly = false,
  isBusy = false,
  isUndoDisabled = false,
  undoDisabledReason,
}: HuntMemoryTrackerProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const statusId = `${baseId}-status`;
  const undoReasonId = `${baseId}-undo-reason`;
  const undoFeedbackId = `${baseId}-undo-feedback`;

  const [localUndoPending, setLocalUndoPending] = useState(false);
  const [undoFeedback, setUndoFeedback] = useState<string | null>(null);

  const undoPendingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const workspace = selectActiveWorkspaceV3(game, selectedSetId, store);
  const undoSnapshot = store.undoState && Object.hasOwn(store.undoState, game.id)
    ? store.undoState[game.id]
    : undefined;

  const undoTarget = undoSnapshot
    ? resolveUndoTarget(
        game,
        store,
        undoSnapshot,
        workspace,
        isReadOnly,
        isBusy || localUndoPending,
        isUndoDisabled,
        undoDisabledReason,
      )
    : undefined;

  const handleUndo = async () => {
    if (
      undoPendingRef.current ||
      isReadOnly ||
      isBusy ||
      localUndoPending ||
      isUndoDisabled ||
      !undoSnapshot ||
      !undoTarget?.isEligible
    ) {
      return;
    }

    undoPendingRef.current = true;
    setLocalUndoPending(true);
    setUndoFeedback(null);

    const capturedGameId = game.id;
    const capturedSnapshot = undoSnapshot;

    try {
      const result = await onUndo(capturedGameId, capturedSnapshot);
      if (!isMountedRef.current) return;
      if (result.status === 'success' || result.status === 'no-op') {
        setUndoFeedback(null);
      } else {
        const detail = result.message ? `: ${result.message}` : '';
        setUndoFeedback(`Undo could not be confirmed${detail}`);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
      setUndoFeedback(`Undo could not be confirmed${detail}`);
    } finally {
      if (isMountedRef.current) {
        undoPendingRef.current = false;
        setLocalUndoPending(false);
      }
    }
  };

  const childIsReadOnly = isReadOnly || isBusy || localUndoPending;
  const isReady = workspace.status === 'ready';

  const hasReason =
    undoSnapshot &&
    undoTarget &&
    !undoTarget.isEligible &&
    (!isReadOnly || undoTarget.eligibilityReason !== 'Editing is disabled so saved progress stays unchanged.');
  const hasFeedback = Boolean(undoFeedback);
  const undoDescribedBy = [
    hasReason ? undoReasonId : null,
    hasFeedback ? undoFeedbackId : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 border-b border-slate-800 pb-3 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <h3 id={headingId} className="text-base font-bold text-slate-100">
            Achievement Trackers{isReady ? ` (${workspace.set.achievements.length})` : ''}
          </h3>
          {isReady && (
            <p className="text-xs text-slate-400">
              {formatSetLabel(workspace.set)} / Run: {workspace.activeRun.name}
            </p>
          )}
        </div>

        {undoSnapshot && undoTarget && (
          <button
            type="button"
            onClick={handleUndo}
            disabled={!undoTarget.isEligible}
            aria-describedby={undoDescribedBy}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            {undoTarget.undoButtonLabel}
          </button>
        )}
      </div>

      {isReadOnly && (
        <p role="status" className="rounded border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-300">
          Editing is disabled so saved progress stays unchanged.
        </p>
      )}

      {hasReason && (
        <p id={undoReasonId} role="status" className="rounded border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-300">
          {undoTarget.eligibilityReason}
        </p>
      )}

      {undoFeedback && (
        <p id={undoFeedbackId} role="alert" className="text-xs text-amber-300">
          {undoFeedback}
        </p>
      )}

      {!isReady ? (
        <p id={statusId} role="status" className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          {workspace.message}
        </p>
      ) : (
        <div className="space-y-4">
          {workspace.set.achievements.map((achievement, index) => {
            const progress = Object.hasOwn(workspace.activeRun.progress, achievement.id)
              ? workspace.activeRun.progress[achievement.id]
              : undefined;
            const isPinned = workspace.activeRun.pinnedAchievementIds.includes(achievement.id);
            const context: HuntMemoryTrackerContext = {
              gameId: game.id,
              setId: workspace.set.id,
              runId: workspace.activeRun.runId,
            };

            return (
              <HuntMemoryTrackerCard
                key={achievement.id}
                achievement={achievement}
                sourceIndex={index}
                progress={progress}
                isPinned={isPinned}
                gameId={game.id}
                setId={workspace.set.id}
                runId={workspace.activeRun.runId}
                isReadOnly={childIsReadOnly}
                getTimestamp={getTimestamp}
                onBinaryCompletionChange={(achId, completed) => onBinaryCompletionChange(context, achId, completed)}
                onCounterProgressChange={(achId, counter) => onCounterProgressChange(context, achId, counter)}
                onChecklistItemCompletionChange={(achId, itemId, completed) =>
                  onChecklistItemCompletionChange(context, achId, itemId, completed)
                }
                onNotesChange={(achId, notes) => onNotesChange(context, achId, notes)}
                onCompletionOverrideChange={(achId, override) => onCompletionOverrideChange(context, achId, override)}
                onTogglePin={(achId, pin) => onTogglePin(context, achId, pin)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

export function HuntMemoryTracker(props: HuntMemoryTrackerProps) {
  return <HuntMemoryTrackerInner key={props.game.id} {...props} />;
}
