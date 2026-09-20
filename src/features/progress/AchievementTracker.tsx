import type {
  AchievementSet,
  GameRecord,
  PlatformId,
} from '../../domain/achievement-schema';
import type { LocalProgressStore } from '../../domain/progress-schema';
import { AchievementTrackerCard } from './AchievementTrackerCard';

export interface AchievementTrackerProps {
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
  onNotesChange: (achievementId: string, notes: string | undefined) => void;
  onCompletionOverrideChange: (
    achievementId: string,
    override: boolean,
  ) => void;
  onTogglePin: (achievementId: string, pin: boolean) => void;
  onUndo: () => void;
  isReadOnly?: boolean;
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
  return `${platformLabels[set.platform]}${edition}`;
}

export function AchievementTracker({
  game,
  set,
  store,
  onBinaryCompletionChange,
  onCounterValueChange,
  onChecklistItemCompletionChange,
  onNotesChange,
  onCompletionOverrideChange,
  onTogglePin,
  onUndo,
  isReadOnly = false,
  isUndoDisabled = false,
  undoDisabledReason,
}: AchievementTrackerProps) {
  const gameProgress = store.gameProgress[game.id];
  const activeSetProgress = gameProgress?.sets[set.id];
  const undoSnapshot = store.undoState?.[game.id];
  const recordedSet = undoSnapshot
    ? game.achievementSets.find((candidate) => candidate.id === undoSnapshot.setId)
    : undefined;
  const undoSetLabel = undoSnapshot
    ? recordedSet
      ? formatSetLabel(recordedSet)
      : 'unavailable recorded set'
    : null;

  return (
    <section aria-labelledby="tracker-heading" className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 border-b border-slate-800 pb-3 sm:flex-row sm:items-center">
        <h3 id="tracker-heading" className="text-base font-bold text-slate-100">
          Achievement Trackers ({set.achievements.length})
        </h3>

        {undoSnapshot && undoSetLabel && (
          <button
            type="button"
            onClick={onUndo}
            disabled={isUndoDisabled}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-secondary)]"
          >
            Undo last change in {undoSetLabel}
          </button>
        )}
      </div>

      {isReadOnly && (
        <p
          role="status"
          className="rounded border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-300"
        >
          This saved set uses a different data version. Editing is disabled so
          its progress stays unchanged.
        </p>
      )}
      {isUndoDisabled && undoDisabledReason && (
        <p
          role="status"
          className="rounded border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-300"
        >
          {undoDisabledReason}
        </p>
      )}

      {!activeSetProgress ? (
        <p
          role="status"
          className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300"
        >
          Progress for this platform is unavailable. Your saved data has not
          been changed.
        </p>
      ) : (
        <div className="space-y-4">
          {set.achievements.map((achievement, index) => (
            <AchievementTrackerCard
              key={achievement.id}
              achievement={achievement}
              sourceIndex={index}
              progress={activeSetProgress.progress[achievement.id]}
              isPinned={activeSetProgress.pinnedAchievementIds.includes(
                achievement.id,
              )}
              gameId={game.id}
              setId={set.id}
              onBinaryCompletionChange={onBinaryCompletionChange}
              onCounterValueChange={onCounterValueChange}
              onChecklistItemCompletionChange={onChecklistItemCompletionChange}
              onNotesChange={onNotesChange}
              onCompletionOverrideChange={onCompletionOverrideChange}
              onTogglePin={onTogglePin}
              isReadOnly={isReadOnly}
            />
          ))}
        </div>
      )}
    </section>
  );
}
