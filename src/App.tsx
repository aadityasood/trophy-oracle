import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  getPlatformRoadmapLabel,
  type AchievementSet,
  type DatasetLoadResult,
  type GameRecord,
  type PlatformId,
} from './domain/achievement-schema';
import { loadDemoGamesDataset } from './data/demo-games';

interface AppProps {
  datasetResult?: DatasetLoadResult;
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

export default function App({ datasetResult = loadDemoGamesDataset() }: AppProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);

  const games = datasetResult.success ? datasetResult.data.games : EMPTY_GAMES;

  const filteredGames = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return games;
    }

    return games.filter(
      (game) =>
        game.title.toLowerCase().includes(normalizedQuery) ||
        game.aliases.some((alias) =>
          alias.toLowerCase().includes(normalizedQuery),
        ),
    );
  }, [games, searchQuery]);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId),
    [games, selectedGameId],
  );

  const selectedSet = useMemo(() => {
    if (!selectedGame) {
      return undefined;
    }

    return (
      selectedGame.achievementSets.find((set) => set.id === selectedSetId) ??
      selectedGame.achievementSets[0]
    );
  }, [selectedGame, selectedSetId]);

  if (!datasetResult.success) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100 flex items-center justify-center">
        <div
          role="alert"
          className="max-w-xl w-full rounded-lg border border-red-500/50 bg-slate-900 p-6 space-y-3"
          data-testid="dataset-error"
        >
          <h1 className="text-xl font-bold text-red-300">Demo data unavailable</h1>
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

  const handleSelectGame = (gameId: string) => {
    setSelectedGameId(gameId);
    const game = games.find((candidate) => candidate.id === gameId);
    setSelectedSetId(game?.achievementSets[0]?.id ?? null);
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
              : `${filteredGames.length} demo ${filteredGames.length === 1 ? 'game' : 'games'} available.`}
          </p>

          {filteredGames.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {filteredGames.map((game) => {
                const isSelected = game.id === selectedGame?.id;
                return (
                  <button
                    key={game.id}
                    onClick={() => handleSelectGame(game.id)}
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
                <span className="text-xs px-2 py-1 bg-slate-800 text-slate-300 rounded">
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
                            onChange={() => setSelectedSetId(set.id)}
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
              <div
                className="bg-slate-900 border border-slate-800 border-l-4 rounded-lg p-5 space-y-3"
                style={{ borderLeftColor: 'var(--theme-surface-glow)' }}
              >
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Platform roadmap
                </div>
                <h3 className="text-base font-bold text-slate-100">
                  {getPlatformRoadmapLabel(selectedSet.platform)}
                </h3>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-slate-400">Platform</dt>
                    <dd className="font-medium text-slate-200">
                      {platformLabels[selectedSet.platform]}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Edition</dt>
                    <dd className="font-medium text-slate-200">
                      {selectedSet.edition ?? 'Standard'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Achievements</dt>
                    <dd className="font-medium text-slate-200">
                      {selectedSet.achievements.length}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
