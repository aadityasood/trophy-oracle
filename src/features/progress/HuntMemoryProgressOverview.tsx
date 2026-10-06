import { useId, useRef, useState } from 'react';
import type { AchievementRecord, GameRecord } from '../../domain/achievement-schema';
import type {
  AchievementProgressV3,
  CounterProgress,
  LocalProgressStoreV3,
} from '../../domain/hunt-memory-schema';
import {
  getRunOracleFocus,
  getTrackerPresentationV3,
  hasRunPartialProgress,
  selectActiveWorkspaceV3,
  type ActiveWorkspaceReadyResult,
  type StageId,
} from '../../domain/hunt-memory-view';
import { getRiskLabel } from '../../domain/progress-view';
import { HuntMemoryCounterEditor } from './HuntMemoryCounterEditor';
import type { HuntMemoryTrackerContext } from './HuntMemoryTracker';
import { RoadmapProgress } from './RoadmapProgress';
import type { HuntMemoryActionResult } from './use-hunt-memory-store';

export type { HuntMemoryTrackerContext as HuntMemoryOverviewContext };

export interface HuntMemoryProgressOverviewProps {
  game: GameRecord;
  selectedSetId: string;
  store: LocalProgressStoreV3;
  getTimestamp: () => string;
  onSelectActiveStage: (context: HuntMemoryTrackerContext, stage: StageId) => Promise<HuntMemoryActionResult>;
  onTogglePin: (context: HuntMemoryTrackerContext, achievementId: string, pin: boolean) => Promise<HuntMemoryActionResult>;
  onBinaryCompletionChange: (context: HuntMemoryTrackerContext, achievementId: string, completed: boolean) => Promise<HuntMemoryActionResult>;
  onCounterProgressChange: (context: HuntMemoryTrackerContext, achievementId: string, counter: CounterProgress) => Promise<HuntMemoryActionResult>;
  onChecklistItemCompletionChange: (context: HuntMemoryTrackerContext, achievementId: string, itemId: string, completed: boolean) => Promise<HuntMemoryActionResult>;
  isReadOnly?: boolean;
  isBusy?: boolean;
}

function formatSafeActionFeedback(actionName: string, result: HuntMemoryActionResult | unknown): string {
  if (typeof result === 'object' && result !== null && 'status' in result) {
    const actionResult = result as HuntMemoryActionResult;
    switch (actionResult.status) {
      case 'busy':
        return `${actionName} is waiting: an operation is in progress. Please wait before trying again.`;
      case 'blocked':
        return `${actionName} was not applied. Prerequisites or constraints were not met.`;
      case 'mutation-failed':
        return `${actionName} was not applied. Please verify the current state and try again.`;
      case 'retryable-failure':
        return `${actionName} saved state is unconfirmed. Check safety controls before retrying.`;
      case 'recovery-required':
      case 'failure':
        return `${actionName} could not be confirmed. Check safety controls before proceeding.`;
      case 'success':
      case 'no-op':
        return '';
    }
  }
  return `${actionName} could not be confirmed. Check safety controls before proceeding.`;
}

function createSafeTimestampGetter(getTimestamp: () => string): () => string {
  return () => {
    try {
      return getTimestamp();
    } catch {
      throw new Error('Clock validation failed. Please check device time settings.');
    }
  };
}

interface FocusBoardItemProps {
  achievement: AchievementRecord;
  ordinal: number;
  progress?: AchievementProgressV3;
  isItemRevealed: boolean;
  context: HuntMemoryTrackerContext;
  childIsReadOnly: boolean;
  safeGetTimestamp: () => string;
  onToggleReveal: () => void;
  onTogglePin: () => void;
  onBinaryCompletionChange: (completed: boolean) => void;
  onChecklistItemCompletionChange: (itemId: string, completed: boolean) => void;
  onCounterProgressChange: (counter: CounterProgress) => Promise<HuntMemoryActionResult>;
}

function FocusBoardItem({
  achievement,
  ordinal,
  progress,
  isItemRevealed,
  context,
  childIsReadOnly,
  safeGetTimestamp,
  onToggleReveal,
  onTogglePin,
  onBinaryCompletionChange,
  onChecklistItemCompletionChange,
  onCounterProgressChange,
}: FocusBoardItemProps) {
  const presentation = getTrackerPresentationV3(achievement, progress);
  const isReady = presentation.status === 'ready';
  const isCounter = achievement.tracking.mode === 'counter';
  const displayLabel = isReady && isItemRevealed ? achievement.name : `Achievement ${ordinal}`;

  return (
    <article
      aria-label={
        !isReady && !isCounter
          ? `Unavailable progress for ${displayLabel}`
          : isReady
            ? `Focus item: ${displayLabel}`
            : undefined
      }
      className={
        isReady
          ? 'space-y-3 rounded-lg border border-slate-800 bg-slate-950 p-4'
          : !isCounter
            ? 'rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400'
            : undefined
      }
    >
      {!isReady && !isCounter && `Progress is unavailable for ${displayLabel}. Saved data has not been changed.`}

      {isReady && (
        <div className="flex flex-col items-start justify-between gap-2 border-b border-slate-800/80 pb-2 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-100">{displayLabel}</h4>
              <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                {achievement.expectedStage}
              </span>
              <span className="rounded border border-slate-800 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] capitalize text-slate-400">
                {achievement.tracking.mode}
              </span>
              {presentation.completed && (
                <span className="rounded border border-emerald-800 bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                  Completed
                </span>
              )}
              {presentation.mode !== 'binary' && presentation.manualOverride && (
                <span className="rounded border border-amber-800 bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                  Manual Override
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300">
              {isItemRevealed ? (
                achievement.description
              ) : (
                <span className="italic text-slate-400">
                  Spoiler protected{achievement.spoilerSafeHint ? ` - Hint: ${achievement.spoilerSafeHint}` : ''}
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label={`Unpin ${displayLabel} from focus board`}
              disabled={childIsReadOnly}
              onClick={onTogglePin}
              className="rounded border border-amber-800/60 bg-amber-950/40 px-2.5 py-1 text-xs text-amber-200 transition-colors hover:bg-amber-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Unpin
            </button>
            <button
              type="button"
              aria-label={`${isItemRevealed ? 'Hide' : 'Reveal'} details for ${displayLabel}`}
              onClick={onToggleReveal}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              {isItemRevealed ? 'Hide' : 'Reveal'}
            </button>
          </div>
        </div>
      )}

      {isReady && isItemRevealed && (
        <div className="space-y-1 rounded border border-slate-800/60 bg-slate-900/60 p-2.5 text-xs text-slate-300">
          <p>
            <span className="font-semibold text-slate-400">Evidence: </span>
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

      <div className={isReady ? 'space-y-2 pt-1' : undefined}>
        {isReady && presentation.mode === 'binary' && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={presentation.completed}
              disabled={childIsReadOnly}
              onChange={(e) => onBinaryCompletionChange(e.target.checked)}
              className="focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
            <span>Mark {displayLabel} complete</span>
          </label>
        )}

        {isCounter && (
          <HuntMemoryCounterEditor
            achievement={achievement}
            progress={progress}
            displayLabel={displayLabel}
            gameId={context.gameId}
            setId={context.setId}
            runId={context.runId}
            isReadOnly={childIsReadOnly}
            getTimestamp={safeGetTimestamp}
            onApply={(_achId, counter) => onCounterProgressChange(counter)}
          />
        )}

        {isReady && presentation.mode === 'checklist' && achievement.tracking.mode === 'checklist' && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-300">{presentation.summary}</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {presentation.items.map((itemPres, idx) => {
                const checklistItems = (achievement.tracking as Extract<AchievementRecord['tracking'], { mode: 'checklist' }>).items;
                const defItem = checklistItems[idx];
                const itemLabel = isItemRevealed ? defItem?.name ?? `Item ${idx + 1}` : `Item ${idx + 1}`;
                return (
                  <label
                    key={itemPres.id}
                    className="flex cursor-pointer items-center gap-2 rounded border border-slate-800/80 bg-slate-900/60 p-1.5 text-xs text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={itemPres.completed}
                      disabled={childIsReadOnly}
                      onChange={(e) => onChecklistItemCompletionChange(itemPres.id, e.target.checked)}
                      className="focus-visible:ring-2 focus-visible:ring-indigo-500"
                    />
                    <span>{itemLabel} for {displayLabel}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

interface ReadyProps extends HuntMemoryProgressOverviewProps {
  workspace: ActiveWorkspaceReadyResult;
  isPending: boolean;
  isPendingRef: React.MutableRefObject<boolean>;
  setLocalPending: (pending: boolean) => void;
  baseId: string;
}

function HuntMemoryProgressOverviewReady({
  game,
  workspace,
  getTimestamp,
  onSelectActiveStage,
  onTogglePin,
  onBinaryCompletionChange,
  onCounterProgressChange,
  onChecklistItemCompletionChange,
  isReadOnly = false,
  isBusy = false,
  isPending,
  isPendingRef,
  setLocalPending,
  baseId,
}: ReadyProps) {
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const focusBoardHeadingId = `${baseId}-focus-board-heading`;
  const oracleFocusHeadingId = `${baseId}-oracle-focus-heading`;
  const feedbackId = `${baseId}-feedback`;

  const childIsReadOnly = isReadOnly || isBusy || isPending;
  const safeGetTimestamp = createSafeTimestampGetter(getTimestamp);

  const context: HuntMemoryTrackerContext = {
    gameId: game.id,
    setId: workspace.set.id,
    runId: workspace.activeRun.runId,
  };

  const dispatchContextAction = async (
    actionName: string,
    execute: () => Promise<HuntMemoryActionResult>,
  ): Promise<HuntMemoryActionResult> => {
    if (isReadOnly) {
      const safeMsg = `${actionName} was not applied: editing is disabled. Saved progress is unchanged.`;
      setActionFeedback(safeMsg);
      return { status: 'blocked', reason: 'READ_ONLY', message: safeMsg };
    }

    if (isBusy || isPending || isPendingRef.current) {
      const safeMsg = `${actionName} is waiting: an operation is already in progress. Please wait.`;
      setActionFeedback(safeMsg);
      return { status: 'busy', reason: 'OPERATION_IN_FLIGHT', message: safeMsg };
    }

    isPendingRef.current = true;
    setLocalPending(true);
    setActionFeedback(null);

    try {
      const result = await execute();
      if (result.status === 'success' || result.status === 'no-op') {
        setActionFeedback(null);
        return result;
      }
      const safeMsg = formatSafeActionFeedback(actionName, result);
      setActionFeedback(safeMsg);
      return { ...result, message: safeMsg };
    } catch {
      const safeMsg = `${actionName} could not be confirmed. Check safety controls before proceeding.`;
      setActionFeedback(safeMsg);
      return { status: 'failure', code: 'UNCONFIRMED', message: safeMsg };
    } finally {
      isPendingRef.current = false;
      setLocalPending(false);
    }
  };

  const handleToggleReveal = (achievementId: string) => {
    setRevealedIds((current) => {
      const next = new Set(current);
      if (next.has(achievementId)) {
        next.delete(achievementId);
      } else {
        next.add(achievementId);
      }
      return next;
    });
  };

  const getOrdinal = (achievementId: string): number => {
    const index = workspace.set.achievements.findIndex((a) => a.id === achievementId);
    return index >= 0 ? index + 1 : 1;
  };

  const handleTogglePin = (achievementId: string, pin: boolean) =>
    dispatchContextAction('Pin update', () => onTogglePin(context, achievementId, pin));
  const handleBinaryChange = (achievementId: string, completed: boolean) =>
    dispatchContextAction('Achievement update', () => onBinaryCompletionChange(context, achievementId, completed));
  const handleChecklistChange = (achievementId: string, itemId: string, completed: boolean) =>
    dispatchContextAction('Checklist update', () => onChecklistItemCompletionChange(context, achievementId, itemId, completed));
  const handleCounterChange = (achievementId: string, counter: CounterProgress) =>
    dispatchContextAction('Counter update', () => onCounterProgressChange(context, achievementId, counter));

  const recommendations = getRunOracleFocus(workspace.set, workspace.activeRun);

  return (
    <div className="space-y-6">
      {actionFeedback && (
        <p id={feedbackId} role="status" aria-live="polite" aria-atomic="true" className="rounded border border-amber-800 bg-amber-950 p-3 text-xs text-amber-200">
          {actionFeedback}
        </p>
      )}

      {isReadOnly && (
        <p role="status" className="rounded border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">
          Editing is disabled so saved progress stays unchanged.
        </p>
      )}

      <RoadmapProgress
        platform={workspace.set.platform}
        edition={workspace.set.edition}
        achievementCount={workspace.set.achievements.length}
        activeStage={workspace.activeStage}
        stageSummaries={workspace.stageSummaries}
        onSelectActiveStage={(stage) => {
          void dispatchContextAction('Stage update', () => onSelectActiveStage(context, stage));
        }}
        isReadOnly={childIsReadOnly}
      />

      <section aria-labelledby={focusBoardHeadingId} className="space-y-4">
        <h3 id={focusBoardHeadingId} className="text-base font-bold text-slate-100">
          Focus Board ({workspace.pinnedAchievements.length} / 5 pinned)
        </h3>

        {workspace.pinnedAchievements.length === 0 ? (
          <p role="status" className="rounded border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
            No achievements pinned to the Focus Board.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {workspace.pinnedAchievements.map((achievement) => {
              const progress = Object.hasOwn(workspace.activeRun.progress, achievement.id)
                ? workspace.activeRun.progress[achievement.id]
                : undefined;
              return (
                <FocusBoardItem
                  key={achievement.id}
                  achievement={achievement}
                  ordinal={getOrdinal(achievement.id)}
                  progress={progress}
                  isItemRevealed={revealedIds.has(achievement.id)}
                  context={context}
                  childIsReadOnly={childIsReadOnly}
                  safeGetTimestamp={safeGetTimestamp}
                  onToggleReveal={() => handleToggleReveal(achievement.id)}
                  onTogglePin={() => { void handleTogglePin(achievement.id, false); }}
                  onBinaryCompletionChange={(completed) => { void handleBinaryChange(achievement.id, completed); }}
                  onChecklistItemCompletionChange={(itemId, completed) => { void handleChecklistChange(achievement.id, itemId, completed); }}
                  onCounterProgressChange={(counter) => handleCounterChange(achievement.id, counter)}
                />
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby={oracleFocusHeadingId} className="space-y-4">
        <div>
          <h3 id={oracleFocusHeadingId} className="text-base font-bold text-slate-100">Oracle Focus</h3>
          <p className="text-xs text-slate-400">Recommended achievements for this run.</p>
        </div>

        {recommendations.length === 0 ? (
          <p role="status" className="rounded border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
            No recommendations available.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {recommendations.map((achievement) => {
              const isItemRevealed = revealedIds.has(achievement.id);
              const ordinal = getOrdinal(achievement.id);
              const displayLabel = isItemRevealed ? achievement.name : `Achievement ${ordinal}`;
              const progress = Object.hasOwn(workspace.activeRun.progress, achievement.id)
                ? workspace.activeRun.progress[achievement.id]
                : undefined;
              const presentation = getTrackerPresentationV3(achievement, progress);
              const isPinned = workspace.activeRun.pinnedAchievementIds.includes(achievement.id);
              const riskLabel = getRiskLabel(achievement);
              const isStageMatch = achievement.expectedStage === workspace.activeStage;
              const partial = hasRunPartialProgress(achievement, progress);

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

                    <h4 className="text-sm font-semibold text-slate-100">{displayLabel}</h4>

                    <p className="text-xs text-slate-300">
                      {isItemRevealed ? (
                        achievement.description
                      ) : (
                        <span className="italic text-slate-400">
                          Spoiler protected{achievement.spoilerSafeHint ? ` - Hint: ${achievement.spoilerSafeHint}` : ''}
                        </span>
                      )}
                    </p>

                    {presentation.status === 'ready' && presentation.summary && (
                      <p className="text-xs font-medium text-slate-400">{presentation.summary}</p>
                    )}

                    {isItemRevealed && achievement.warning && (
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
                      disabled={childIsReadOnly}
                      onClick={() => { void handleTogglePin(achievement.id, !isPinned); }}
                      className={`rounded border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                        isPinned
                          ? 'border-amber-700 bg-amber-950/60 text-amber-200 hover:bg-amber-900/60'
                          : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {isPinned ? 'Pinned' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      aria-label={`${isItemRevealed ? 'Hide' : 'Reveal'} details for ${displayLabel}`}
                      onClick={() => handleToggleReveal(achievement.id)}
                      className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    >
                      {isItemRevealed ? 'Hide' : 'Reveal'}
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

function HuntMemoryProgressOverviewGame(props: HuntMemoryProgressOverviewProps) {
  const { game, selectedSetId, store, isReadOnly = false, isBusy = false } = props;
  const baseId = useId();
  const unavailableHeadingId = `${baseId}-unavailable-heading`;
  const isPendingRef = useRef(false);
  const [localPending, setLocalPending] = useState(false);

  const workspace = selectActiveWorkspaceV3(game, selectedSetId, store);

  if (workspace.status === 'unavailable') {
    return (
      <section aria-labelledby={unavailableHeadingId} className="space-y-3">
        <h3 id={unavailableHeadingId} className="text-base font-bold text-slate-100">
          Progress overview unavailable
        </h3>
        <p role="status" className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
          {workspace.message}
        </p>
      </section>
    );
  }

  const tupleKey = JSON.stringify([selectedSetId, workspace.activeRun.runId]);

  return (
    <HuntMemoryProgressOverviewReady
      key={tupleKey}
      {...props}
      workspace={workspace}
      isReadOnly={isReadOnly}
      isBusy={isBusy}
      isPending={localPending}
      isPendingRef={isPendingRef}
      setLocalPending={setLocalPending}
      baseId={baseId}
    />
  );
}

export function HuntMemoryProgressOverview(props: HuntMemoryProgressOverviewProps) {
  return <HuntMemoryProgressOverviewGame key={props.game.id} {...props} />;
}
