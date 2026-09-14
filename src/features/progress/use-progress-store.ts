import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameRecord } from '../../domain/achievement-schema';
import {
  createDefaultLocalProgressStore,
  selectGame,
  selectPreferredSet,
  setActiveStage,
  setBinaryCompletion,
  setChecklistItemCompletion,
  setCompletionOverride,
  setCounterValue,
  setNotes,
  togglePin,
  undoLastMutation,
} from '../../domain/progress-engine';
import type { MutationResult } from '../../domain/progress-engine';
import type { LocalProgressStore } from '../../domain/progress-schema';
import {
  DEFAULT_STORAGE_KEY,
  loadProgressFromStorage,
  saveProgressToStorage,
  type RevisionToken,
  type StorageLike,
} from '../../data/progress-storage';

export interface UseProgressStoreOptions {
  storage?: StorageLike | null;
  now?: () => string;
}

const STALE_RELOAD_STATUS =
  'Saved progress changed in another session. Reload required to resume saving.';

const READ_ERROR_RELOAD_STATUS =
  'Saved progress could not be checked. Reload required to resume saving.';

type InitialProgressState = {
  store: LocalProgressStore;
  canSave: boolean;
  token: RevisionToken;
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
      token: null,
      persistenceStatus: 'Session-only mode: progress is available in memory but will not be saved.',
    };
  }

  const result = loadProgressFromStorage(storage);
  if (!result.success) {
    return {
      store: result.fallbackStore,
      canSave: false,
      token: null,
      persistenceStatus: `Saved progress could not be loaded (${result.code}). This session will not overwrite it.`,
    };
  }

  return {
    store: result.store,
    canSave: true,
    token: result.token,
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
  const currentTokenRef = useRef<RevisionToken>(initialState.token);
  const canSaveRef = useRef(initialState.canSave);
  const isStaleRef = useRef(false);
  const [canSave, setCanSave] = useState(initialState.canSave);
  const [persistenceStatus, setPersistenceStatus] = useState<string | null>(
    initialState.persistenceStatus,
  );
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (
        typeof window === 'undefined' ||
        !dependencies.storage ||
        dependencies.storage !== window.localStorage
      ) {
        return;
      }
    } catch {
      return;
    }

    const isTargetStorageArea = (event: StorageEvent): boolean => {
      try {
        return !event.storageArea || event.storageArea === window.localStorage;
      } catch {
        return false;
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (!isTargetStorageArea(event)) {
        return;
      }
      if (event.key === null) {
        if (currentTokenRef.current === null) return;
      } else if (
        event.key !== DEFAULT_STORAGE_KEY ||
        event.newValue === currentTokenRef.current
      ) {
        return;
      }

      // Storage event is an early warning: mark stale and disable future saves.
      isStaleRef.current = true;
      canSaveRef.current = false;
      setCanSave(false);
      setPersistenceStatus(STALE_RELOAD_STATUS);
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [dependencies.storage]);

  const commitStore = useCallback(
    (nextStore: LocalProgressStore): boolean => {
      if (nextStore === latestStoreRef.current) return false;

      if (isStaleRef.current) {
        return false;
      }

      if (!canSaveRef.current || !dependencies.storage) {
        latestStoreRef.current = nextStore;
        setStore(nextStore);
        setActionStatus(null);
        return true;
      }

      const saveResult = saveProgressToStorage(
        nextStore,
        dependencies.storage,
        currentTokenRef.current,
      );

      if (saveResult.success) {
        currentTokenRef.current = saveResult.token;
        latestStoreRef.current = nextStore;
        setStore(nextStore);
        setActionStatus(null);
        setPersistenceStatus(null);
        return true;
      }

      if (saveResult.code === 'STALE_WRITE_CONFLICT') {
        // Fail closed: reject candidate, keep current in-memory store, and disable future saves.
        isStaleRef.current = true;
        canSaveRef.current = false;
        setCanSave(false);
        setPersistenceStatus(STALE_RELOAD_STATUS);
        return false;
      }

      if (saveResult.code === 'STORAGE_ACCESS_ERROR') {
        // Fail closed: reject candidate, keep current in-memory store, and disable future saves.
        isStaleRef.current = true;
        canSaveRef.current = false;
        setCanSave(false);
        setPersistenceStatus(READ_ERROR_RELOAD_STATUS);
        return false;
      }

      // A physical write failure preserves the in-memory change and expected token for retry.
      latestStoreRef.current = nextStore;
      setStore(nextStore);
      setActionStatus(null);
      setPersistenceStatus(`Progress not saved: ${saveResult.message}`);
      return true;
    },
    [dependencies.storage],
  );

  const commitMutation = useCallback(
    (result: MutationResult): void => {
      if (!result.success) {
        setActionStatus(result.error);
        return;
      }
      if (result.changed) {
        commitStore(result.store);
      } else {
        setActionStatus(null);
      }
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

  const togglePinAction = useCallback(
    (game: GameRecord, setId: string, achievementId: string, pin: boolean) => {
      commitMutation(
        togglePin(
          latestStoreRef.current,
          game,
          setId,
          achievementId,
          pin,
          dependencies.now(),
        ),
      );
    },
    [commitMutation, dependencies],
  );

  const setActiveStageAction = useCallback(
    (
      game: GameRecord,
      setId: string,
      stage: 'story' | 'missables' | 'cleanup' | undefined,
    ) => {
      commitMutation(
        setActiveStage(
          latestStoreRef.current,
          game,
          setId,
          stage,
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
    canSave,
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
  };
}
