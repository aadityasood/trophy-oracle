import {
  useCallback, useId, useMemo, useRef, useState,
  type CSSProperties, type ReactElement,
} from 'react';
import type {
  AchievementSet, DatasetLoadResult, DemoGamesDataset, GameRecord, PlatformId,
} from './domain/achievement-schema';
import { loadDemoGamesDataset } from './data/demo-games';
import type { StorageLike } from './data/progress-storage';
import type { HuntMemoryStorageKeys } from './data/hunt-memory-storage';
import type { WebLockManagerLike } from './data/hunt-memory-write-lock';
import {
  createDefaultGameProgressV3, DEFAULT_HUNT_MEMORY_RUN_ID, selectRun,
} from './domain/hunt-memory-lifecycle';
import {
  setRunActiveStage, setRunBinaryCompletion, setRunChecklistItemCompletion,
  setRunCompletionOverride, setRunCounterProgress, setRunNotes, setRunPinned,
  undoLastRunMutation,
} from './domain/hunt-memory-progress';
import type {
  CounterProgress, LocalProgressStoreV3, ProgressUndoSnapshotV3,
} from './domain/hunt-memory-schema';
import { selectActiveWorkspaceV3, type StageId } from './domain/hunt-memory-view';
import { useHuntMemoryStore, type DomainMutationResult } from './features/progress/use-hunt-memory-store';
import { HuntMemorySafetyPanel } from './features/progress/HuntMemorySafetyPanel';
import { HuntMemoryProgressOverview } from './features/progress/HuntMemoryProgressOverview';
import { HuntMemoryTracker, type HuntMemoryTrackerContext } from './features/progress/HuntMemoryTracker';

export interface HuntMemorySessionConfig {
  session: string;
  storage: StorageLike | null;
  lockManager: WebLockManagerLike | null;
  keys: HuntMemoryStorageKeys;
  clock: () => string;
  download: (filename: string, content: string) => void;
}

export interface HuntMemoryAppProps {
  datasetResult?: DatasetLoadResult;
  session: HuntMemorySessionConfig;
}

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

function isValidSessionConfig(c: unknown): c is HuntMemorySessionConfig {
  if (!c || typeof c !== 'object') return false;
  const cfg = c as Record<string, unknown>;
  const validStorage =
    cfg.storage === null ||
    (typeof cfg.storage === 'object' &&
      cfg.storage !== null &&
      typeof (cfg.storage as StorageLike).getItem === 'function' &&
      typeof (cfg.storage as StorageLike).setItem === 'function');
  const validLock =
    cfg.lockManager === null ||
    (typeof cfg.lockManager === 'object' &&
      cfg.lockManager !== null &&
      typeof (cfg.lockManager as WebLockManagerLike).request === 'function');
  const k = cfg.keys as Record<string, unknown> | undefined;
  const validKeys = Boolean(
    k &&
      typeof k.v2Key === 'string' && k.v2Key.trim() &&
      typeof k.v3Key === 'string' && k.v3Key.trim() &&
      typeof k.cutoverKey === 'string' && k.cutoverKey.trim() &&
      k.v2Key !== k.v3Key && k.v2Key !== k.cutoverKey && k.v3Key !== k.cutoverKey,
  );
  return (
    typeof cfg.session === 'string' &&
    Boolean(cfg.session.trim()) &&
    Boolean(validStorage) &&
    Boolean(validLock) &&
    validKeys &&
    typeof cfg.clock === 'function' &&
    typeof cfg.download === 'function'
  );
}

function createSessionSnapshot(config: HuntMemorySessionConfig): HuntMemorySessionConfig {
  return {
    session: config.session,
    storage: config.storage,
    lockManager: config.lockManager,
    keys: {
      v2Key: config.keys.v2Key,
      v3Key: config.keys.v3Key,
      cutoverKey: config.keys.cutoverKey,
    },
    clock: config.clock,
    download: config.download,
  };
}

function formatSafeWorkspaceError(reason: string, message: string): string {
  switch (reason) {
    case 'GAME_NOT_FOUND':
      return 'Progress for this game is not loaded in this view.';
    case 'SET_VERSION_MISMATCH':
      return 'Achievement data for this version is out of date and cannot be tracked safely.';
    case 'SET_RETIRED':
      return 'This achievement set has been retired and is no longer active for tracking.';
    case 'SET_NOT_FOUND':
      return 'The selected achievement set could not be found for this game.';
    case 'RUN_NOT_FOUND':
      return 'The selected run is unavailable.';
    default:
      return message;
  }
}

interface HuntMemoryAppInnerProps {
  dataset: DemoGamesDataset;
  session: HuntMemorySessionConfig;
  onReload: () => void;
}

function HuntMemoryAppInner({
  dataset,
  session,
  onReload,
}: HuntMemoryAppInnerProps): ReactElement {
  const store = useHuntMemoryStore({
    storage: session.storage,
    lockManager: session.lockManager,
    keys: session.keys,
    now: session.clock,
  });

  const baseId = useId();
  const navIntentRef = useRef({ game: 0, set: 0, run: 0 });

  const [searchQuery, setSearchQuery] = useState('');
  const [previewGameId, setPreviewGameId] = useState<string | undefined>();
  const [previewSetId, setPreviewSetId] = useState<string | undefined>();
  const [previewRunId, setPreviewRunId] = useState<string | undefined>();

  const games = dataset.games;

  const filteredGames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return games;
    return games.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [games, searchQuery]);

  const activeGameId =
    previewGameId ?? store.store?.lastGameId ?? games[0]?.id;
  const selectedGame = useMemo(
    () => games.find((g) => g.id === activeGameId),
    [games, activeGameId],
  );

  const gameProgress =
    selectedGame &&
    store.store &&
    Object.hasOwn(store.store.gameProgress, selectedGame.id)
      ? store.store.gameProgress[selectedGame.id]
      : undefined;

  const activeSetId =
    previewSetId ??
    gameProgress?.preferredSetId ??
    selectedGame?.achievementSets[0]?.id;
  const selectedSet = useMemo(
    () => selectedGame?.achievementSets.find((s) => s.id === activeSetId),
    [selectedGame, activeSetId],
  );

  const setProgress =
    gameProgress &&
    selectedSet &&
    Object.hasOwn(gameProgress.sets, selectedSet.id)
      ? gameProgress.sets[selectedSet.id]
      : undefined;

  const storedActiveRunId = setProgress?.activeRunId ?? DEFAULT_HUNT_MEMORY_RUN_ID;
  const activeRunId =
    previewRunId && setProgress && Object.hasOwn(setProgress.runs, previewRunId)
      ? previewRunId
      : storedActiveRunId;

  // Separate immutable display projection for child presentation
  const displayStore = useMemo(() => {
    if (!store.store || !selectedGame || !selectedSet || !setProgress) {
      return store.store;
    }
    if (
      !activeRunId ||
      setProgress.activeRunId === activeRunId ||
      !Object.hasOwn(setProgress.runs, activeRunId)
    ) {
      return store.store;
    }
    return {
      ...store.store,
      gameProgress: {
        ...store.store.gameProgress,
        [selectedGame.id]: {
          ...gameProgress!,
          sets: {
            ...gameProgress!.sets,
            [selectedSet.id]: {
              ...setProgress,
              activeRunId,
            },
          },
        },
      },
    };
  }, [store.store, selectedGame, selectedSet, setProgress, gameProgress, activeRunId]);

  const handleSelectGame = (game: GameRecord) => {
    const intentId = ++navIntentRef.current.game;
    navIntentRef.current.set++;
    navIntentRef.current.run++;
    setPreviewGameId(game.id);
    setPreviewSetId(undefined);
    setPreviewRunId(undefined);
    if (!store.store || !Object.hasOwn(store.store.gameProgress, game.id)) {
      return;
    }
    if (store.canSave) {
      void store.mutate((s) => {
        if (!Object.hasOwn(s.gameProgress, game.id)) {
          return { success: false, code: 'GAME_NOT_FOUND', message: `Game '${game.id}' not found` };
        }
        if (s.lastGameId === game.id) return { success: true, store: s, changed: false };
        const next = structuredClone(s);
        next.lastGameId = game.id;
        return { success: true, store: next, changed: true };
      }).then((res) => {
        if (navIntentRef.current.game === intentId && (res.status === 'success' || res.status === 'no-op')) {
          setPreviewGameId((current) => (current === game.id ? undefined : current));
        }
      });
    }
  };

  const handleSelectSet = (set: AchievementSet) => {
    if (!selectedGame) return;
    const gameId = selectedGame.id;
    const intentId = ++navIntentRef.current.set;
    navIntentRef.current.run++;
    setPreviewSetId(set.id);
    setPreviewRunId(undefined);
    if (!gameProgress || !Object.hasOwn(gameProgress.sets, set.id)) {
      return;
    }
    if (store.canSave && store.store) {
      void store.mutate((s) => {
        const gp = s.gameProgress[gameId];
        if (!gp || !Object.hasOwn(gp.sets, set.id) || Object.hasOwn(gp.retiredSets, set.id)) {
          return { success: false, code: 'SET_NOT_FOUND', message: `Set '${set.id}' unavailable` };
        }
        if (gp.sets[set.id].version !== set.version) {
          return { success: false, code: 'SET_VERSION_MISMATCH', message: `Set '${set.id}' version mismatch` };
        }
        if (gp.preferredSetId === set.id) return { success: true, store: s, changed: false };
        const next = structuredClone(s);
        next.gameProgress[gameId].preferredSetId = set.id;
        return { success: true, store: next, changed: true };
      }).then((res) => {
        if (navIntentRef.current.set === intentId && (res.status === 'success' || res.status === 'no-op')) {
          setPreviewSetId((current) => (current === set.id ? undefined : current));
        }
      });
    }
  };

  const handleSelectRun = (runId: string) => {
    if (!selectedGame || !selectedSet) return;
    const gameId = selectedGame.id;
    const setId = selectedSet.id;
    const intentId = ++navIntentRef.current.run;
    setPreviewRunId(runId);
    if (!setProgress || !Object.hasOwn(setProgress.runs, runId)) {
      return;
    }
    if (store.canSave && store.store) {
      void store.mutate((s) => {
        const gp = s.gameProgress[gameId];
        if (!gp || !Object.hasOwn(gp.sets, setId) || Object.hasOwn(gp.retiredSets, setId)) {
          return { success: false, code: 'SET_NOT_FOUND', message: `Set '${setId}' unavailable` };
        }
        if (gp.sets[setId].version !== selectedSet.version) {
          return { success: false, code: 'SET_VERSION_MISMATCH', message: `Set '${setId}' version mismatch` };
        }
        const res = selectRun(s, gameId, setId, runId);
        if (!res.success) return { success: false, code: res.code, message: res.message };
        return { success: true, store: res.store, changed: res.store !== s };
      }).then((res) => {
        if (navIntentRef.current.run === intentId && (res.status === 'success' || res.status === 'no-op')) {
          setPreviewRunId((current) => (current === runId ? undefined : current));
        }
      });
    }
  };

  const handleOpenWorkspace = () => {
    if (!store.canSave || !selectedGame) return;
    const gameToInit = selectedGame;
    const intentId = ++navIntentRef.current.game;
    void store.mutate((currentStore, timestamp) => {
      if (Object.hasOwn(currentStore.gameProgress, gameToInit.id)) {
        return { success: true, store: currentStore, changed: false };
      }
      const next = structuredClone(currentStore);
      next.lastGameId = gameToInit.id;
      next.gameProgress[gameToInit.id] = createDefaultGameProgressV3(gameToInit, timestamp);
      return { success: true, store: next, changed: true };
    }).then((res) => {
      if (navIntentRef.current.game === intentId && (res.status === 'success' || res.status === 'no-op')) {
        setPreviewGameId((current) => (current === gameToInit.id ? undefined : current));
      }
    });
  };

  const adaptAction = useCallback(
    (
      context: HuntMemoryTrackerContext,
      fn: (s: LocalProgressStoreV3, g: GameRecord, ts: string) => DomainMutationResult,
    ) => {
      return store.mutate((currentStore, timestamp) => {
        const game = games.find((g) => g.id === context.gameId);
        if (!game) {
          return { success: false, code: 'GAME_NOT_FOUND', message: `Game '${context.gameId}' not found` };
        }
        return fn(currentStore, game, timestamp);
      });
    },
    [games, store],
  );

  const handleBinary = useCallback(
    (ctx: HuntMemoryTrackerContext, id: string, val: boolean) =>
      adaptAction(ctx, (s, g, ts) => setRunBinaryCompletion(s, g, ctx.setId, ctx.runId, id, val, ts)),
    [adaptAction]);

  const handleCounter = useCallback(
    (ctx: HuntMemoryTrackerContext, id: string, counter: CounterProgress) =>
      adaptAction(ctx, (s, g, ts) => setRunCounterProgress(s, g, ctx.setId, ctx.runId, id, counter, ts)),
    [adaptAction]);

  const handleChecklist = useCallback(
    (ctx: HuntMemoryTrackerContext, id: string, itemId: string, val: boolean) =>
      adaptAction(ctx, (s, g, ts) => setRunChecklistItemCompletion(s, g, ctx.setId, ctx.runId, id, itemId, val, ts)),
    [adaptAction]);

  const handleNotes = useCallback(
    (ctx: HuntMemoryTrackerContext, id: string, notes?: string) =>
      adaptAction(ctx, (s, g, ts) => setRunNotes(s, g, ctx.setId, ctx.runId, id, notes, ts)),
    [adaptAction]);

  const handleOverride = useCallback(
    (ctx: HuntMemoryTrackerContext, id: string, override: boolean) =>
      adaptAction(ctx, (s, g, ts) => setRunCompletionOverride(s, g, ctx.setId, ctx.runId, id, override, ts)),
    [adaptAction]);

  const handleTogglePin = useCallback(
    (ctx: HuntMemoryTrackerContext, id: string, pin: boolean) =>
      adaptAction(ctx, (s, g, ts) => setRunPinned(s, g, ctx.setId, ctx.runId, id, pin, ts)),
    [adaptAction]);

  const handleActiveStage = useCallback(
    (ctx: HuntMemoryTrackerContext, stage: StageId) =>
      adaptAction(ctx, (s, g, ts) => setRunActiveStage(s, g, ctx.setId, ctx.runId, stage, ts)),
    [adaptAction]);

  const handleUndo = useCallback(
    async (gameId: string, expectedSnapshot: ProgressUndoSnapshotV3) => {
      return store.mutate((currentStore) => {
        if (!currentStore.undoState || !Object.hasOwn(currentStore.undoState, gameId)) {
          return { success: false, code: 'UNDO_SNAPSHOT_DEPARTED', message: 'No undo snapshot available for game' };
        }
        const actualSnapshot = currentStore.undoState[gameId];
        if (actualSnapshot !== expectedSnapshot) {
          return { success: false, code: 'UNDO_SNAPSHOT_DEPARTED', message: 'Undo snapshot has departed or changed' };
        }
        const g = games.find((item) => item.id === gameId);
        const setDef = g?.achievementSets.find((item) => item.id === expectedSnapshot.setId);
        if (!g || !setDef || setDef.version !== expectedSnapshot.guardedSetVersion) {
          return { success: false, code: 'SET_VERSION_MISMATCH', message: 'Target set version mismatch' };
        }
        return undoLastRunMutation(currentStore, gameId);
      });
    },
    [games, store],
  );

  const themeStyles: CSSProperties = selectedGame
    ? ({
        '--theme-primary': selectedGame.theme.primary,
        '--theme-secondary': selectedGame.theme.secondary,
        '--theme-surface-glow': selectedGame.theme.surfaceGlow,
      } as CSSProperties)
    : {};

  const workspace =
    selectedGame && selectedSet && displayStore
      ? selectActiveWorkspaceV3(selectedGame, selectedSet.id, displayStore)
      : undefined;

  const searchInputId = `${baseId}-search`;
  const gamesHeadingId = `${baseId}-games`;
  const gameDetailsHeadingId = `${baseId}-details`;
  const activeRunSelectId = `${baseId}-run`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans" style={themeStyles}>
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h1 className="text-xl font-bold tracking-tight text-slate-50">Trophy Oracle</h1>
          <div className="w-full sm:w-80">
            <label htmlFor={searchInputId} className="sr-only">Search games</label>
            <input
              id={searchInputId}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search games or aliases..."
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        <HuntMemorySafetyPanel
          state={store}
          onUpgrade={() => store.upgrade()}
          onRetry={() => store.retry()}
          onDiscard={() => store.discard()}
          onReload={onReload}
          onDownload={session.download}
        />

        <section aria-labelledby={gamesHeadingId} className="space-y-3">
          <h2 id={gamesHeadingId} className="text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                    onClick={() => handleSelectGame(game)}
                    type="button"
                    aria-pressed={isSelected}
                    className={`text-left p-4 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isSelected ? 'bg-slate-900 border-indigo-500' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-semibold text-slate-200">{game.title}</span>
                    <span className="text-xs text-slate-400 mt-1 line-clamp-2 block">{game.summary}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {selectedGame && (
          <section aria-labelledby={gameDetailsHeadingId} className="space-y-6">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h2 id={gameDetailsHeadingId} className="text-lg font-bold text-slate-100">{selectedGame.title}</h2>
                  <p className="text-xs text-slate-400">{selectedGame.summary}</p>
                </div>
                <span className="text-xs px-2 py-1 bg-slate-800 text-slate-300 rounded self-start sm:self-auto">
                  {sourceTypeLabels[selectedGame.sourceType]}
                </span>
              </div>

              {selectedGame.achievementSets.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold text-slate-400">Select platform and edition</legend>
                  <div className="flex flex-wrap gap-2">
                    {selectedGame.achievementSets.map((set) => {
                      const isSetSelected = set.id === selectedSet?.id;
                      return (
                        <label
                          key={set.id}
                          className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                            isSetSelected ? 'bg-slate-800 text-slate-100 border-indigo-500' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`${baseId}-set-${selectedGame.id}`}
                            value={set.id}
                            checked={isSetSelected}
                            onChange={() => handleSelectSet(set)}
                            className="accent-indigo-500"
                          />
                          <span>{getSetLabel(set)}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : (
                <p role="status" aria-live="polite" className="rounded border border-slate-800 bg-slate-950 p-4 text-sm text-slate-300">
                  No achievement sets are available for this game.
                </p>
              )}

              {setProgress && Object.keys(setProgress.runs).length > 0 && (
                <div className="flex items-center gap-2 pt-2 border-t border-slate-800/60">
                  <label htmlFor={activeRunSelectId} className="text-xs font-semibold text-slate-400">Active run:</label>
                  <select
                    id={activeRunSelectId}
                    value={activeRunId}
                    onChange={(e) => handleSelectRun(e.target.value)}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {Object.values(setProgress.runs).map((run) => (
                      <option key={run.runId} value={run.runId}>{run.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {selectedGame && !gameProgress && (
              <div className="space-y-3 py-2">
                <h3 className="text-base font-semibold text-slate-200">Workspace not initialized</h3>
                <p className="text-sm text-slate-400">
                  {store.canSave
                    ? `Progress for ${selectedGame.title} is not loaded in this view. Open workspace to begin tracking with Hunt Memory.`
                    : `Progress for ${selectedGame.title} is not loaded in this view. Persistent tracking is disabled for this session.`}
                </p>
                <button
                  type="button"
                  disabled={!store.canSave}
                  onClick={handleOpenWorkspace}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Open workspace
                </button>
              </div>
            )}

            {gameProgress && workspace?.status === 'unavailable' && (
              <div role="alert" aria-live="polite" className="rounded-lg border border-amber-800/80 bg-slate-900 p-4 text-xs text-amber-300">
                {formatSafeWorkspaceError(workspace.reason, workspace.message)}
              </div>
            )}

            {workspace?.status === 'ready' && selectedSet && displayStore && (
              <div className="space-y-6">
                <HuntMemoryProgressOverview
                  key={`overview-${selectedGame.id}`}
                  game={selectedGame}
                  selectedSetId={selectedSet.id}
                  store={displayStore}
                  getTimestamp={session.clock}
                  onSelectActiveStage={handleActiveStage}
                  onTogglePin={handleTogglePin}
                  onBinaryCompletionChange={handleBinary}
                  onCounterProgressChange={handleCounter}
                  onChecklistItemCompletionChange={handleChecklist}
                  isReadOnly={!store.canSave}
                  isBusy={store.isBusy}
                />

                <HuntMemoryTracker
                  key={`tracker-${selectedGame.id}`}
                  game={selectedGame}
                  selectedSetId={selectedSet.id}
                  store={displayStore}
                  getTimestamp={session.clock}
                  onBinaryCompletionChange={handleBinary}
                  onCounterProgressChange={handleCounter}
                  onChecklistItemCompletionChange={handleChecklist}
                  onNotesChange={handleNotes}
                  onCompletionOverrideChange={handleOverride}
                  onTogglePin={handleTogglePin}
                  onUndo={handleUndo}
                  isReadOnly={!store.canSave}
                  isBusy={store.isBusy}
                />
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default function HuntMemoryApp({
  datasetResult = loadDemoGamesDataset(),
  session,
}: HuntMemoryAppProps): ReactElement {
  const [reloadKey, setReloadKey] = useState(0);
  const [capturedSnapshot, setCapturedSnapshot] = useState<HuntMemorySessionConfig | null>(() =>
    isValidSessionConfig(session) ? createSessionSnapshot(session) : null,
  );

  if (!isValidSessionConfig(session)) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100 flex items-center justify-center">
        <div role="alert" className="max-w-xl w-full rounded-lg border border-amber-500/50 bg-slate-900 p-6 space-y-3">
          <h1 className="text-xl font-bold text-amber-300">Hunt Memory Unavailable</h1>
          <p className="text-sm text-slate-300">
            Explicit session dependencies are incomplete or invalid. Saving and inspection are disabled.
          </p>
        </div>
      </div>
    );
  }

  const activeSnapshot =
    capturedSnapshot === null || session.session !== capturedSnapshot.session
      ? createSessionSnapshot(session)
      : capturedSnapshot;

  if (activeSnapshot !== capturedSnapshot) {
    setCapturedSnapshot(activeSnapshot);
  }

  const keysMatch =
    activeSnapshot.keys.v2Key === session.keys.v2Key &&
    activeSnapshot.keys.v3Key === session.keys.v3Key &&
    activeSnapshot.keys.cutoverKey === session.keys.cutoverKey;
  const depsMatch =
    activeSnapshot.storage === session.storage &&
    activeSnapshot.lockManager === session.lockManager &&
    keysMatch &&
    activeSnapshot.clock === session.clock &&
    activeSnapshot.download === session.download;

  if (!depsMatch) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100 flex items-center justify-center">
        <div role="alert" className="max-w-xl w-full rounded-lg border border-red-500/50 bg-slate-900 p-6 space-y-3">
          <h1 className="text-xl font-bold text-red-300">Session Configuration Conflict</h1>
          <p className="text-sm text-slate-300">
            Injected dependencies changed without a new session identity. Operations failed closed.
          </p>
        </div>
      </div>
    );
  }

  if (!datasetResult.success) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100 flex items-center justify-center">
        <div role="alert" className="max-w-xl w-full rounded-lg border border-red-500/50 bg-slate-900 p-6 space-y-3" data-testid="dataset-error">
          <h1 className="text-xl font-bold text-red-300">Demo data unavailable</h1>
          <p className="text-sm text-slate-300">
            Trophy Oracle could not open its trusted local demo data. Please try again after the data has been checked.
          </p>
        </div>
      </div>
    );
  }

  return (
    <HuntMemoryAppInner
      key={`${activeSnapshot.session}-${reloadKey}`}
      dataset={datasetResult.data}
      session={activeSnapshot}
      onReload={() => setReloadKey((prev) => prev + 1)}
    />
  );
}
