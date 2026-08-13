import { useCallback, useRef, useState } from 'react';
import type { GameRecord } from '../../domain/achievement-schema';
import {
  createDefaultLocalProgressStore,
  selectGame,
  selectPreferredSet,
  setBinaryCompletion,
  setChecklistItemCompletion,
  setCompletionOverride,
  setCounterValue,
  setNotes,
  undoLastMutation,
} from '../../domain/progress-engine';
import type { MutationResult } from '../../domain/progress-engine';
import type { LocalProgressStore } from '../../domain/progress-schema';
import {
  loadProgressFromStorage,
  saveProgressToStorage,
  type StorageLike,
} from '../../data/progress-storage';

export interface UseProgressStoreOptions {
  storage?: StorageLike | null;
  now?: () => string;
}

type InitialProgressState = {
  store: LocalProgressStore;
  canSave: boolean;
  persistenceStatus: string | null;
};

const defaultNow = (): string => new Date().toISOString();

function getLazyLocalStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage;
    }
  } catch {
    // Property access can fail in privacy-restricted browser contexts.
  }
  return null;
}

function loadInitialState(storage: StorageLike | null): InitialProgressState {
  if (!storage) {
    return {
      store: createDefaultLocalProgressStore(),
      canSave: false,
      persistenceStatus: 'Session-only mode: progress is available in memory but will not be saved.',
    };
  }

  const result = loadProgressFromStorage(storage);
  if (!result.success) {
    return {
      store: result.fallbackStore,
      canSave: false,
      persistenceStatus: `Saved progress could not be loaded (${result.code}). This session will not overwrite it.`,
    };
  }

  return {
    store: result.store,
    canSave: true,
    persistenceStatus: null,
  };
}

export function useProgressStore(options: UseProgressStoreOptions = {}) {
  const [dependencies] = useState(() => ({
    storage:
      options.storage !== undefined ? options.storage : getLazyLocalStorage(),
    now: options.now ?? defaultNow,
  }));
  const [initialState] = useState(() => loadInitialState(dependencies.storage));
  const [store, setStore] = useState(initialState.store);
  const latestStoreRef = useRef(initialState.store);
  const [persistenceStatus, setPersistenceStatus] = useState<string | null>(
    initialState.persistenceStatus,
  );
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const commitStore = useCallback(
    (nextStore: LocalProgressStore): boolean => {
      if (nextStore === latestStoreRef.current) return false;

      latestStoreRef.current = nextStore;
      setStore(nextStore);
      setActionStatus(null);

      if (initialState.canSave && dependencies.storage) {
        const saveResult = saveProgressToStorage(
          nextStore,
          dependencies.storage,
        );
        setPersistenceStatus(
          saveResult.success
            ? null
            : `Progress not saved: ${saveResult.message}`,
        );
      }

      return true;
    },
    [dependencies.storage, initialState.canSave],
  );

  const commitMutation = useCallback(
    (result: MutationResult): void => {
      if (!result.success) {
        setActionStatus(result.error);
        return;
      }
      if (result.changed) commitStore(result.store);
    },
    [commitStore],
  );

  const selectGameAction = useCallback(
    (game: GameRecord): void => {
      const currentStore = latestStoreRef.current;
      const timestamp = dependencies.now();
      let nextStore = selectGame(currentStore, game, timestamp);
      const existingPreference = nextStore.gameProgress[game.id]?.preferredSetId;
      const preferredSet = game.achievementSets.find(
        (achievementSet) => achievementSet.id === existingPreference,
      );
      const targetSet = preferredSet ?? game.achievementSets[0];
      if (targetSet) {
        nextStore = selectPreferredSet(
          nextStore,
          game,
          targetSet.id,
          timestamp,
        );
      }
      commitStore(nextStore);
    },
    [commitStore, dependencies],
  );

  const selectSetAction = useCallback(
    (game: GameRecord, setId: string): void => {
      if (!game.achievementSets.some((set) => set.id === setId)) {
        setActionStatus(
          `Achievement set '${setId}' is not available for '${game.title}'.`,
        );
        return;
      }

      const currentStore = latestStoreRef.current;
      const timestamp = dependencies.now();
      const selectedGameStore = selectGame(currentStore, game, timestamp);
      const nextStore = selectPreferredSet(
        selectedGameStore,
        game,
        setId,
        timestamp,
      );
      commitStore(nextStore);
    },
    [commitStore, dependencies],
  );

  const updateBinaryCompletion = useCallback(
    (game: GameRecord, setId: string, achievementId: string, completed: boolean) => {
      commitMutation(
        setBinaryCompletion(
          latestStoreRef.current,
          game,
          setId,
          achievementId,
          completed,
          dependencies.now(),
        ),
      );
    },
    [commitMutation, dependencies],
  );

  const updateCounterValue = useCallback(
    (game: GameRecord, setId: string, achievementId: string, value: number) => {
      commitMutation(
        setCounterValue(
          latestStoreRef.current,
          game,
          setId,
          achievementId,
          value,
          dependencies.now(),
        ),
      );
    },
    [commitMutation, dependencies],
  );

  const updateChecklistItemCompletion = useCallback(
    (
      game: GameRecord,
      setId: string,
      achievementId: string,
      itemId: string,
      completed: boolean,
    ) => {
      commitMutation(
        setChecklistItemCompletion(
          latestStoreRef.current,
          game,
          setId,
          achievementId,
          itemId,
          completed,
          dependencies.now(),
        ),
      );
    },
    [commitMutation, dependencies],
  );

  const updateNotes = useCallback(
    (
      game: GameRecord,
      setId: string,
      achievementId: string,
      notes: string | undefined,
    ) => {
      commitMutation(
        setNotes(
          latestStoreRef.current,
          game,
          setId,
          achievementId,
          notes,
          dependencies.now(),
        ),
      );
    },
    [commitMutation, dependencies],
  );

  const updateCompletionOverride = useCallback(
    (
      game: GameRecord,
      setId: string,
      achievementId: string,
      override: boolean,
    ) => {
      commitMutation(
        setCompletionOverride(
          latestStoreRef.current,
          game,
          setId,
          achievementId,
          override,
          dependencies.now(),
        ),
      );
    },
    [commitMutation, dependencies],
  );

  const undoAction = useCallback(
    (gameId: string): void => {
      const result = undoLastMutation(latestStoreRef.current, gameId);
      if (!result.success) {
        setActionStatus(result.error);
        return;
      }
      commitStore(result.store);
    },
    [commitStore],
  );

  return {
    store,
    canSave: initialState.canSave,
    persistenceStatus,
    actionStatus,
    selectGameAction,
    selectSetAction,
    updateBinaryCompletion,
    updateCounterValue,
    updateChecklistItemCompletion,
    updateNotes,
    updateCompletionOverride,
    undoAction,
  };
}
