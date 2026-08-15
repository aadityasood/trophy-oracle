import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  type AchievementSet,
  type DatasetLoadResult,
  type GameRecord,
  type PlatformId,
} from './domain/achievement-schema';
import { loadDemoGamesDataset } from './data/demo-games';
import type { StorageLike } from './data/progress-storage';
import { useProgressStore } from './features/progress/use-progress-store';
import { AchievementTracker } from './features/progress/AchievementTracker';
import { ProgressOverview } from './features/progress/ProgressOverview';

export interface AppProps {
  datasetResult?: DatasetLoadResult;
  storage?: StorageLike | null;
  now?: () => string;
}

const EMPTY_GAMES: GameRecord[] = [];

const platformLabels: Record<PlatformId, string> = {
  playstation: 'PlayStation',
  xbox: 'Xbox',
  steam: 'Steam',
  other: 'Other',
};

const sourceTypeLabels: Record<GameRecord['sourceType'], string> = {
  fictional_demo: 'Fictional demo data',
  imported: 'Imported local data',
  scraped: 'Scraped data',
  manual: 'Manually entered data',
};

function getSetLabel(set: AchievementSet): string {
  const edition = set.edition ? ` (${set.edition})` : '';
  return `${platformLabels[set.platform]}${edition}`;
}

export default function App({
  datasetResult = loadDemoGamesDataset(),
  storage,
  now,
}: AppProps) {
  const games = datasetResult.success ? datasetResult.data.games : EMPTY_GAMES;

  const {
    store,
    persistenceStatus,
    actionStatus,
    selectGameAction,
    selectSetAction,
    updateBinaryCompletion,
    updateCounterValue,
    updateChecklistItemCompletion,
    updateNotes,
    updateCompletionOverride,
    togglePinAction,
    setActiveStageAction,
    undoAction,
  } = useProgressStore({ storage, now });

  const [searchQuery, setSearchQuery] = useState('');

  const filteredGames = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return games;
    }

    return games.filter(
      (game) =>
        game.title.toLowerCase().includes(normalizedQuery) ||
        game.aliases.some((alias) =>
          alias.toLowerCase().includes(normalizedQuery)
        )
    );
  }, [games, searchQuery]);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === store.lastGameId),
    [games, store.lastGameId]
  );

  const selectedSet = useMemo(() => {
    if (!selectedGame) {
      return undefined;
    }

    const preferredId = store.gameProgress[selectedGame.id]?.preferredSetId;
    return (
      selectedGame.achievementSets.find((set) => set.id === preferredId) ??
      selectedGame.achievementSets[0]
    );
  }, [selectedGame, store.gameProgress]);

  const selectedSetProgress =
    selectedGame && selectedSet
      ? store.gameProgress[selectedGame.id]?.sets[selectedSet.id]
      : undefined;
  const isSetVersionMismatch =
    selectedSet !== undefined &&
    selectedSetProgress !== undefined &&
    selectedSetProgress.version !== selectedSet.version;

  const undoSnapshot = selectedGame
    ? store.undoState?.[selectedGame.id]
    : undefined;
  const undoSetDefinition = undoSnapshot
    ? selectedGame?.achievementSets.find(
        (set) => set.id === undoSnapshot.setId,
      )
    : undefined;
  const undoActiveSet =
    selectedGame && undoSnapshot
      ? store.gameProgress[selectedGame.id]?.sets[undoSnapshot.setId]
      : undefined;
  const isUndoDisabled =
    undoSnapshot !== undefined &&
    (undoSetDefinition === undefined ||
      undoActiveSet === undefined ||
      undoActiveSet.version !== undoSetDefinition.version ||
      undoSnapshot.previous.version !== undoSetDefinition.version);

  if (!datasetResult.success) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100 flex items-center justify-center">
        <div
          role="alert"
          className="max-w-xl w-full rounded-lg border border-red-500/50 bg-slate-900 p-6 space-y-3"
          data-testid="dataset-error"
        >
          <h1 className="text-xl font-bold text-red-300">
            Demo data unavailable
          </h1>
          <p className="text-sm text-slate-300">
            Trophy Oracle could not open its trusted local demo data. Please try
            again after the data has been checked.
          </p>
        </div>
      </div>
    );
  }

  const themeStyles: CSSProperties = selectedGame
    ? ({
        '--theme-primary': selectedGame.theme.primary,
        '--theme-secondary': selectedGame.theme.secondary,
        '--theme-surface-glow': selectedGame.theme.surfaceGlow,
      } as CSSProperties)
    : {};

  const handleSelectGame = (game: GameRecord) => {
    selectGameAction(game);
  };

  const handleSelectSet = (set: AchievementSet) => {
    if (selectedGame) {
      selectSetAction(selectedGame, set.id);
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans"
      style={themeStyles}
    >
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h1 className="text-xl font-bold tracking-tight text-slate-50">
            Trophy Oracle
          </h1>
          <div className="w-full sm:w-80">
            <label htmlFor="game-search" className="sr-only">
              Search games
            </label>
            <input
              id="game-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search games or aliases..."
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus-visible:outline-none focus-visible:border-[var(--theme-primary)] focus-visible:ring-1 focus-visible:ring-[var(--theme-secondary)]"
            />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        {persistenceStatus && (
          <p
            role="status"
            aria-live="polite"
            className="rounded border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300"
          >
            {persistenceStatus}
          </p>
        )}

        <section aria-labelledby="games-heading" className="space-y-3">
          <h2
            id="games-heading"
            className="text-xs font-semibold uppercase tracking-wider text-slate-400"
          >
            Demo games ({filteredGames.length})
          </h2>

          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={
              filteredGames.length === 0
                ? 'p-6 text-center bg-slate-900/50 rounded-lg border border-slate-800 text-slate-400 text-sm'
                : 'sr-only'
            }
          >
            {filteredGames.length === 0
              ? `No games found matching "${searchQuery}".`
              : `${filteredGames.length} demo ${
                  filteredGames.length === 1 ? 'game' : 'games'
                } available.`}
          </p>

          {filteredGames.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {filteredGames.map((game) => {
                const isSelected = game.id === selectedGame?.id;
                return (
                  <button
                    key={game.id}
                    onClick={() => handleSelectGame(game)}
                    type="button"
                    aria-pressed={isSelected}
                    className={`text-left p-4 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-secondary)] ${
                      isSelected
                        ? 'bg-slate-900'
                        : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                    }`}
                    style={
                      isSelected
                        ? {
                            borderColor: 'var(--theme-primary)',
                            boxShadow:
                              'inset 0 0 0 1px var(--theme-secondary)',
                          }
                        : undefined
                    }
                  >
                    <span className="font-semibold text-slate-200">
                      {game.title}
                    </span>
                    <span className="text-xs text-slate-400 mt-1 line-clamp-2 block">
                      {game.summary}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {selectedGame && (
          <section aria-labelledby="game-details-heading" className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h2
                    id="game-details-heading"
                    className="text-lg font-bold text-slate-100"
                  >
                    {selectedGame.title}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {selectedGame.summary}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 bg-slate-800 text-slate-300 rounded self-start sm:self-auto">
                  {sourceTypeLabels[selectedGame.sourceType]}
                </span>
              </div>

              {selectedGame.achievementSets.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold text-slate-400">
                    Select platform and edition
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {selectedGame.achievementSets.map((set) => {
                      const isSetSelected = set.id === selectedSet?.id;
                      return (
                        <label
                          key={set.id}
                          className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                            isSetSelected
                              ? 'bg-slate-800 text-slate-100'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                          style={
                            isSetSelected
                              ? {
                                  borderColor: 'var(--theme-primary)',
                                  boxShadow:
                                    'inset 0 0 0 1px var(--theme-secondary)',
                                }
                              : undefined
                          }
                        >
                          <input
                            type="radio"
                            name={`achievement-set-${selectedGame.id}`}
                            value={set.id}
                            checked={isSetSelected}
                            onChange={() => handleSelectSet(set)}
                            style={{ accentColor: 'var(--theme-primary)' }}
                          />
                          <span>{getSetLabel(set)}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : (
                <p
                  role="status"
                  aria-live="polite"
                  className="rounded border border-slate-800 bg-slate-950 p-4 text-sm text-slate-300"
                >
                  No achievement sets are available for this game.
                </p>
              )}
            </div>

            {selectedSet && (
              <div className="space-y-6">
                {/* Progress Overview (Roadmap + Focus Board + Oracle Focus) */}
                <ProgressOverview
                  key={`overview-${selectedGame.id}:${selectedSet.id}`}
                  game={selectedGame}
                  set={selectedSet}
                  store={store}
                  onBinaryCompletionChange={(achId, completed) =>
                    updateBinaryCompletion(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      completed,
                    )
                  }
                  onCounterValueChange={(achId, val) =>
                    updateCounterValue(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      val,
                    )
                  }
                  onChecklistItemCompletionChange={(achId, itemId, completed) =>
                    updateChecklistItemCompletion(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      itemId,
                      completed,
                    )
                  }
                  onTogglePin={(achId, pin) =>
                    togglePinAction(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      pin,
                    )
                  }
                  onSelectActiveStage={(stage) =>
                    setActiveStageAction(
                      selectedGame,
                      selectedSet.id,
                      stage,
                    )
                  }
                  actionStatus={actionStatus}
                  isReadOnly={isSetVersionMismatch}
                />

                {/* Tracker Workbench */}
                <AchievementTracker
                  key={`${selectedGame.id}:${selectedSet.id}`}
                  game={selectedGame}
                  set={selectedSet}
                  store={store}
                  onBinaryCompletionChange={(achId, completed) =>
                    updateBinaryCompletion(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      completed,
                    )
                  }
                  onCounterValueChange={(achId, val) =>
                    updateCounterValue(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      val,
                    )
                  }
                  onChecklistItemCompletionChange={(achId, itemId, completed) =>
                    updateChecklistItemCompletion(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      itemId,
                      completed,
                    )
                  }
                  onNotesChange={(achId, notes) =>
                    updateNotes(selectedGame, selectedSet.id, achId, notes)
                  }
                  onCompletionOverrideChange={(achId, override) =>
                    updateCompletionOverride(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      override,
                    )
                  }
                  onTogglePin={(achId, pin) =>
                    togglePinAction(
                      selectedGame,
                      selectedSet.id,
                      achId,
                      pin,
                    )
                  }
                  onUndo={() => undoAction(selectedGame.id)}
                  isReadOnly={isSetVersionMismatch}
                  isUndoDisabled={isUndoDisabled}
                  undoDisabledReason={
                    isUndoDisabled
                      ? 'Undo is unavailable because its recorded set does not match the current trusted data version.'
                      : undefined
                  }
                />
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
