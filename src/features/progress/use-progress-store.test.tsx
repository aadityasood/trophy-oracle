import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STORAGE_KEY } from '../../data/progress-storage';
import { createDefaultLocalProgressStore } from '../../domain/progress-engine';
import { CURRENT_STORE_SCHEMA_VERSION } from '../../domain/progress-schema';
import { MemoryStorage } from '../../test/memory-storage';
import {
  mockGameStellarDrift,
  MOCK_TIMESTAMP,
} from '../../test/progress-fixtures';
import { useProgressStore } from './use-progress-store';

const fixedNow = () => MOCK_TIMESTAMP;

function StrictWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

describe('useProgressStore', () => {
  it('performs zero writes while empty storage initializes in Strict Mode', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(
      () => useProgressStore({ storage, now: fixedNow }),
      { wrapper: StrictWrapper },
    );

    expect(result.current.canSave).toBe(true);
    expect(result.current.persistenceStatus).toBeNull();
    expect(storage.writeCount).toBe(0);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBeNull();
  });

  it('keeps session-only progress usable when storage is null', () => {
    const { result } = renderHook(() =>
      useProgressStore({ storage: null, now: fixedNow }),
    );

    act(() => {
      result.current.updateBinaryCompletion(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
      );
    });

    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toContain('Session-only mode');
    expect(
      result.current.store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].progress['sd-ps-001'].completed,
    ).toBe(true);
  });

  it('selects a game and valid first set atomically with one write and restores both', () => {
    const storage = new MemoryStorage();
    const { result, unmount } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => result.current.selectGameAction(mockGameStellarDrift));

    expect(storage.writeCount).toBe(1);
    expect(result.current.store.lastGameId).toBe('stellar-drift');
    expect(
      result.current.store.gameProgress['stellar-drift'].preferredSetId,
    ).toBe('stellar-drift-ps');
    unmount();

    const { result: restored } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );
    expect(restored.current.store.lastGameId).toBe('stellar-drift');
    expect(
      restored.current.store.gameProgress['stellar-drift'].preferredSetId,
    ).toBe('stellar-drift-ps');
  });

  it('uses the latest store for back-to-back actions and preserves selection undo across set changes', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => {
      result.current.selectGameAction(mockGameStellarDrift);
      result.current.updateBinaryCompletion(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
      );
    });
    const undoBefore = structuredClone(
      result.current.store.undoState?.['stellar-drift'],
    );
    const writesBeforeSetChange = storage.writeCount;

    act(() => {
      result.current.selectSetAction(
        mockGameStellarDrift,
        'stellar-drift-steam',
      );
    });

    expect(result.current.store.lastGameId).toBe('stellar-drift');
    expect(
      result.current.store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].progress['sd-ps-001'].completed,
    ).toBe(true);
    expect(
      result.current.store.gameProgress['stellar-drift'].sets[
        'stellar-drift-steam'
      ].progress['sd-steam-001'].completed,
    ).toBe(false);
    expect(result.current.store.undoState?.['stellar-drift']).toEqual(
      undoBefore,
    );
    expect(storage.writeCount).toBe(writesBeforeSetChange + 1);
  });

  it('does not write or announce a mutation for a true no-op', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );
    act(() => result.current.selectGameAction(mockGameStellarDrift));
    const writesBefore = storage.writeCount;

    act(() => {
      result.current.updateBinaryCompletion(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        false,
      );
    });

    expect(storage.writeCount).toBe(writesBefore);
    expect(result.current.actionStatus).toBeNull();
  });

  it('rejects a cross-set checklist item without changing or writing state', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );
    act(() => result.current.selectGameAction(mockGameStellarDrift));
    const before = structuredClone(result.current.store);
    const writesBefore = storage.writeCount;

    act(() => {
      result.current.updateChecklistItemCompletion(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-005',
        'not-in-this-set',
        true,
      );
    });

    expect(result.current.store).toEqual(before);
    expect(result.current.actionStatus).toContain('not found');
    expect(storage.writeCount).toBe(writesBefore);
  });

  it.each([
    ['malformed JSON', '{ invalid json'],
    [
      'invalid structure',
      JSON.stringify({
        schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
        gameProgress: 'invalid',
      }),
    ],
    [
      'unsupported version',
      JSON.stringify({ schemaVersion: '1.0', gameProgress: {} }),
    ],
  ])('preserves %s bytes and disables writes', (_label, rawValue) => {
    const storage = new MemoryStorage();
    storage.seed(DEFAULT_STORAGE_KEY, rawValue);
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => {
      result.current.updateBinaryCompletion(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
      );
    });

    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toContain('will not overwrite');
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(rawValue);
    expect(storage.writeCount).toBe(0);
  });

  it('handles a read exception without browser globals or later writes', () => {
    const storage = new MemoryStorage();
    storage.seed(DEFAULT_STORAGE_KEY, 'preserve me');
    storage.setReadError(new Error('access denied'));
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => result.current.selectGameAction(mockGameStellarDrift));
    storage.setReadError(null);

    expect(result.current.canSave).toBe(false);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe('preserve me');
    expect(storage.writeCount).toBe(0);
  });

  it('keeps a failed save in memory and clears the stale error after a later successful action', () => {
    const storage = new MemoryStorage();
    storage.setWriteError(new Error('quota exceeded'));
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => result.current.selectGameAction(mockGameStellarDrift));
    expect(result.current.store.lastGameId).toBe('stellar-drift');
    expect(result.current.persistenceStatus).toContain('Progress not saved');

    storage.setWriteError(null);
    act(() => {
      result.current.updateBinaryCompletion(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
      );
    });

    expect(result.current.persistenceStatus).toBeNull();
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).not.toBeNull();
  });

  it('pins and unpins achievements with single writes, stored order, latest-state chaining, and replaces undo snapshot', () => {
    const storage = new MemoryStorage();
    let clockCounter = 0;
    const customNow = () => `2026-07-22T00:00:0${clockCounter++}.000Z`;
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: customNow }),
    );

    act(() => result.current.selectGameAction(mockGameStellarDrift));
    const writesAfterSelect = storage.writeCount;

    act(() => {
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        true,
      );
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
      );
    });

    const setProgress =
      result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'];
    expect(setProgress.pinnedAchievementIds).toEqual(['sd-ps-004', 'sd-ps-001']);
    expect(storage.writeCount).toBe(writesAfterSelect + 2);
    expect(result.current.actionStatus).toBeNull();
    expect(
      result.current.store.undoState?.['stellar-drift']?.previous
        .pinnedAchievementIds,
    ).toEqual(['sd-ps-004']);

    // Unpin sd-ps-004
    act(() => {
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        false,
      );
    });

    expect(
      result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .pinnedAchievementIds,
    ).toEqual(['sd-ps-001']);
  });

  it('rejects pinning beyond the 5-pin limit with a domain error, no store change, and no storage write', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => {
      result.current.selectGameAction(mockGameStellarDrift);
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
      );
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-002',
        true,
      );
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        true,
      );
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-005',
        true,
      );
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-006',
        true,
      );
    });

    expect(
      result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .pinnedAchievementIds,
    ).toHaveLength(5);
    const writesAtLimit = storage.writeCount;

    // Attempt to pin a 6th achievement
    act(() => {
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-007',
        true,
      );
    });

    expect(result.current.actionStatus).toContain('Cannot pin more than 5');
    expect(storage.writeCount).toBe(writesAtLimit);
    expect(
      result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .pinnedAchievementIds,
    ).toHaveLength(5);
  });

  it('treats no-op pin toggles as no-ops without storage writes or status errors', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => {
      result.current.selectGameAction(mockGameStellarDrift);
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
      );
    });
    const writesBefore = storage.writeCount;

    // Pinning an already-pinned achievement
    act(() => {
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-001',
        true,
      );
    });
    expect(storage.writeCount).toBe(writesBefore);
    expect(result.current.actionStatus).toBeNull();

    // Unpinning an unpinned achievement
    act(() => {
      result.current.togglePinAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-002',
        false,
      );
    });
    expect(storage.writeCount).toBe(writesBefore);
    expect(result.current.actionStatus).toBeNull();
  });

  it('mutates activeStage with single writes, updates undo snapshot, and supports no-op checks', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => result.current.selectGameAction(mockGameStellarDrift));
    const writesBefore = storage.writeCount;

    act(() => {
      result.current.setActiveStageAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'missables',
      );
    });

    expect(
      result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .activeStage,
    ).toBe('missables');
    expect(storage.writeCount).toBe(writesBefore + 1);
    expect(
      result.current.store.undoState?.['stellar-drift']?.previous.activeStage,
    ).toBeUndefined();

    // No-op same stage
    act(() => {
      result.current.setActiveStageAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'missables',
      );
    });
    expect(storage.writeCount).toBe(writesBefore + 1);

    // A second active-stage mutation replaces the game-scoped snapshot.
    act(() => {
      result.current.setActiveStageAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'cleanup',
      );
    });
    expect(
      result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .activeStage,
    ).toBe('cleanup');
    expect(storage.writeCount).toBe(writesBefore + 2);
    expect(
      result.current.store.undoState?.['stellar-drift']?.previous.activeStage,
    ).toBe('missables');

    // Clear active stage.
    act(() => {
      result.current.setActiveStageAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        undefined,
      );
    });
    expect(
      result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .activeStage,
    ).toBeUndefined();
    expect(storage.writeCount).toBe(writesBefore + 3);
  });

  it('clears a stale action error after a later successful no-op without writing', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    act(() => {
      result.current.selectGameAction(mockGameStellarDrift);
      result.current.updateCounterValue(
        mockGameStellarDrift,
        'stellar-drift-ps',
        'sd-ps-004',
        -1,
      );
    });
    expect(result.current.actionStatus).toContain('non-negative integer');
    const writesBefore = storage.writeCount;

    act(() => {
      result.current.setActiveStageAction(
        mockGameStellarDrift,
        'stellar-drift-ps',
        undefined,
      );
    });

    expect(result.current.actionStatus).toBeNull();
    expect(storage.writeCount).toBe(writesBefore);
  });

  it('starts from the domain default rather than a duplicated schema literal', () => {
    const { result } = renderHook(() =>
      useProgressStore({ storage: null, now: fixedNow }),
    );
    expect(result.current.store).toEqual(createDefaultLocalProgressStore());
  });

  it('rejects stale action when two independently mounted hooks share storage', () => {
    const storage = new MemoryStorage();
    const { result: hook1 } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );
    const { result: hook2 } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );

    const hook2InitialStore = hook2.current.store;

    act(() => hook1.current.selectGameAction(mockGameStellarDrift));
    expect(storage.writeCount).toBe(1);
    expect(hook1.current.store.lastGameId).toBe('stellar-drift');
    expect(hook1.current.persistenceStatus).toBeNull();
    const storedAfterHook1 = storage.getRawValue(DEFAULT_STORAGE_KEY);
    expect(storedAfterHook1).not.toBeNull();

    act(() => hook2.current.selectGameAction(mockGameStellarDrift));

    expect(hook2.current.store).toBe(hook2InitialStore);
    expect(hook2.current.canSave).toBe(false);
    expect(hook2.current.persistenceStatus).toBe(
      'Saved progress changed in another session. Reload required to resume saving.',
    );
    expect(storage.writeCount).toBe(1);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(storedAfterHook1);
  });

  it('handles save-time read failure by rejecting store changes and showing reload-required state', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() =>
      useProgressStore({ storage, now: fixedNow }),
    );
    const initialStore = result.current.store;

    storage.setReadError(new Error('Save-time disk error'));
    act(() => result.current.selectGameAction(mockGameStellarDrift));

    expect(result.current.store).toBe(initialStore);
    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toBe(
      'Saved progress could not be checked. Reload required to resume saving.',
    );
    expect(result.current.persistenceStatus).not.toContain('another session');
    expect(storage.writeCount).toBe(0);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBeNull();
  });

  it('marks session stale on browser storage event, ignores identical values and other keys, and cleans up on unmount', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    window.localStorage.clear();

    const { result, unmount } = renderHook(() =>
      useProgressStore({ storage: window.localStorage, now: fixedNow }),
    );

    const storageListenerCall = addEventListenerSpy.mock.calls.find(
      ([type]) => type === 'storage',
    );
    expect(storageListenerCall).toBeDefined();
    const registeredListener = storageListenerCall?.[1];
    expect(typeof registeredListener).toBe('function');

    expect(result.current.canSave).toBe(true);
    expect(result.current.persistenceStatus).toBeNull();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'some.other.key',
          newValue: 'foo',
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.canSave).toBe(true);
    expect(result.current.persistenceStatus).toBeNull();

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEFAULT_STORAGE_KEY,
          newValue: null,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.canSave).toBe(true);
    expect(result.current.persistenceStatus).toBeNull();

    const foreignBytes = JSON.stringify({
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      lastGameId: 'other-game',
      gameProgress: {},
    });
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEFAULT_STORAGE_KEY,
          newValue: foreignBytes,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toBe(
      'Saved progress changed in another session. Reload required to resume saving.',
    );

    const storeBeforeAction = result.current.store;
    act(() => result.current.selectGameAction(mockGameStellarDrift));
    expect(result.current.store).toBe(storeBeforeAction);

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'storage',
      registeredListener,
    );

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
    window.localStorage.clear();
  });

  it('ignores a clear event with no saved token and latches stale after saved progress is cleared', () => {
    window.localStorage.clear();
    const { result, unmount } = renderHook(() =>
      useProgressStore({ storage: window.localStorage, now: fixedNow }),
    );
    const dispatchClearEvent = () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: null,
          newValue: null,
          storageArea: window.localStorage,
        }),
      );
    };

    act(dispatchClearEvent);
    expect(result.current.canSave).toBe(true);
    expect(result.current.persistenceStatus).toBeNull();
    expect(window.localStorage.length).toBe(0);

    act(() => result.current.selectGameAction(mockGameStellarDrift));
    const savedStore = result.current.store;
    expect(window.localStorage.getItem(DEFAULT_STORAGE_KEY)).not.toBeNull();

    act(() => {
      window.localStorage.clear();
      dispatchClearEvent();
    });
    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toBe(
      'Saved progress changed in another session. Reload required to resume saving.',
    );
    expect(result.current.store).toBe(savedStore);

    act(() => {
      result.current.selectSetAction(mockGameStellarDrift, 'stellar-drift-steam');
    });
    expect(result.current.store).toBe(savedStore);
    expect(window.localStorage.length).toBe(0);
    unmount();
  });

  it('marks session stale when existing key is deleted via browser storage event', () => {
    window.localStorage.clear();
    const initialRaw = JSON.stringify(createDefaultLocalProgressStore());
    window.localStorage.setItem(DEFAULT_STORAGE_KEY, initialRaw);

    const { result } = renderHook(() =>
      useProgressStore({ storage: window.localStorage, now: fixedNow }),
    );
    expect(result.current.canSave).toBe(true);

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEFAULT_STORAGE_KEY,
          newValue: null,
          storageArea: window.localStorage,
        }),
      );
    });

    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toBe(
      'Saved progress changed in another session. Reload required to resume saving.',
    );

    window.localStorage.clear();
  });

  it('returns true on counter and notes acceptance across successful write, no-op, session-only, fallback, and physical write failure', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() => useProgressStore({ storage, now: fixedNow }));
    act(() => result.current.selectGameAction(mockGameStellarDrift));
    const writesAfterSelect = storage.writeCount;

    act(() => {
      expect(result.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', 10)).toBe(true);
      expect(result.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', 'accepted note')).toBe(true);
    });
    expect(storage.writeCount).toBe(writesAfterSelect + 2);
    expect(result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-004'].counterValue).toBe(10);
    expect(result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-001'].notes).toBe('accepted note');
    expect(result.current.store.undoState?.['stellar-drift']).toBeDefined();
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toContain('"counterValue":10');
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toContain('accepted note');
    expect(result.current.canSave).toBe(true);
    expect(result.current.persistenceStatus).toBeNull();

    const writesBeforeNoOp = storage.writeCount;
    const storeBeforeNoOp = result.current.store;
    const undoBeforeNoOp = structuredClone(result.current.store.undoState?.['stellar-drift']);
    const rawBeforeNoOp = storage.getRawValue(DEFAULT_STORAGE_KEY);
    act(() => {
      expect(result.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', 10)).toBe(true);
      expect(result.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', 'accepted note')).toBe(true);
    });
    expect(storage.writeCount).toBe(writesBeforeNoOp);
    expect(result.current.store).toBe(storeBeforeNoOp);
    expect(result.current.store.undoState?.['stellar-drift']).toEqual(undoBeforeNoOp);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(rawBeforeNoOp);
    expect(result.current.canSave).toBe(true);
    expect(result.current.persistenceStatus).toBeNull();

    const { result: sessionResult } = renderHook(() => useProgressStore({ storage: null, now: fixedNow }));
    act(() => sessionResult.current.selectGameAction(mockGameStellarDrift));
    act(() => {
      expect(sessionResult.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', 5)).toBe(true);
      expect(sessionResult.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', 'session note')).toBe(true);
    });
    expect(sessionResult.current.canSave).toBe(false);
    expect(sessionResult.current.persistenceStatus).toContain('Session-only mode');
    expect(sessionResult.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-004'].counterValue).toBe(5);
    expect(sessionResult.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-001'].notes).toBe('session note');
    expect(sessionResult.current.store.undoState?.['stellar-drift']).toBeDefined();

    const malformedStorage = new MemoryStorage();
    const rawMalformed = '{ malformed';
    malformedStorage.seed(DEFAULT_STORAGE_KEY, rawMalformed);
    const { result: malformedResult } = renderHook(() => useProgressStore({ storage: malformedStorage, now: fixedNow }));
    act(() => malformedResult.current.selectGameAction(mockGameStellarDrift));
    act(() => {
      expect(malformedResult.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', 12)).toBe(true);
      expect(malformedResult.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', 'fallback note')).toBe(true);
    });
    expect(malformedStorage.writeCount).toBe(0);
    expect(malformedStorage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(rawMalformed);
    expect(malformedResult.current.canSave).toBe(false);
    expect(malformedResult.current.persistenceStatus).toContain('will not overwrite it');
    expect(malformedResult.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-004'].counterValue).toBe(12);
    expect(malformedResult.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-001'].notes).toBe('fallback note');
    expect(malformedResult.current.store.undoState?.['stellar-drift']).toBeDefined();

    const unreadableStorage = new MemoryStorage();
    const rawUnreadable = JSON.stringify({ schemaVersion: '2.0', lastGameId: 'stellar-drift' });
    unreadableStorage.seed(DEFAULT_STORAGE_KEY, rawUnreadable);
    unreadableStorage.setReadError(new Error('initial load failure'));
    const { result: unreadableResult } = renderHook(() => useProgressStore({ storage: unreadableStorage, now: fixedNow }));
    act(() => unreadableResult.current.selectGameAction(mockGameStellarDrift));
    act(() => {
      expect(unreadableResult.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', 14)).toBe(true);
      expect(unreadableResult.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', 'unreadable note')).toBe(true);
    });
    expect(unreadableStorage.writeCount).toBe(0);
    expect(unreadableStorage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(rawUnreadable);
    expect(unreadableResult.current.canSave).toBe(false);
    expect(unreadableResult.current.persistenceStatus).toContain('could not be loaded');
    expect(unreadableResult.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-004'].counterValue).toBe(14);
    expect(unreadableResult.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-001'].notes).toBe('unreadable note');
    expect(unreadableResult.current.store.undoState?.['stellar-drift']).toBeDefined();

    const throwingStorage = new MemoryStorage();
    throwingStorage.setWriteError(new Error('quota exceeded'));
    const { result: throwingResult } = renderHook(() => useProgressStore({ storage: throwingStorage, now: fixedNow }));
    act(() => throwingResult.current.selectGameAction(mockGameStellarDrift));
    const writesBeforeThrow = throwingStorage.writeCount;
    act(() => {
      expect(throwingResult.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', 15)).toBe(true);
      expect(throwingResult.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', 'failed write note')).toBe(true);
    });
    expect(throwingStorage.writeCount).toBe(writesBeforeThrow + 2);
    expect(throwingStorage.getRawValue(DEFAULT_STORAGE_KEY)).toBeNull();
    expect(throwingResult.current.canSave).toBe(true);
    expect(throwingResult.current.persistenceStatus).toContain('Progress not saved');
    expect(throwingResult.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-004'].counterValue).toBe(15);
    expect(throwingResult.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-001'].notes).toBe('failed write note');
    expect(throwingResult.current.store.undoState?.['stellar-drift']).toBeDefined();
  });

  it('returns false for domain errors, stale conflicts, and save-time read failures with unchanged store and undo', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() => useProgressStore({ storage, now: fixedNow }));
    act(() => {
      result.current.selectGameAction(mockGameStellarDrift);
      result.current.updateBinaryCompletion(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', true);
    });
    expect(result.current.store.undoState?.['stellar-drift']).toBeDefined();
    const storeBefore = result.current.store;
    const undoBefore = structuredClone(result.current.store.undoState?.['stellar-drift']);
    const rawBefore = storage.getRawValue(DEFAULT_STORAGE_KEY);
    const writesBefore = storage.writeCount;

    act(() => {
      expect(result.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', -5)).toBe(false);
    });
    expect(result.current.actionStatus).toContain('non-negative integer');
    expect(result.current.canSave).toBe(true);
    expect(result.current.persistenceStatus).toBeNull();
    expect(result.current.store).toBe(storeBefore);
    expect(result.current.store.undoState?.['stellar-drift']).toEqual(undoBefore);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(rawBefore);
    expect(storage.writeCount).toBe(writesBefore);

    const foreignBytes = JSON.stringify({ foreign: 'data' });
    storage.seed(DEFAULT_STORAGE_KEY, foreignBytes);
    act(() => {
      expect(result.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', 20)).toBe(false);
    });
    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toBe('Saved progress changed in another session. Reload required to resume saving.');
    expect(result.current.store).toBe(storeBefore);
    expect(result.current.store.undoState?.['stellar-drift']).toEqual(undoBefore);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(foreignBytes);
    expect(storage.writeCount).toBe(writesBefore);

    const storage2 = new MemoryStorage();
    const { result: hook2 } = renderHook(() => useProgressStore({ storage: storage2, now: fixedNow }));
    act(() => {
      hook2.current.selectGameAction(mockGameStellarDrift);
      hook2.current.updateBinaryCompletion(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', true);
    });
    expect(hook2.current.store.undoState?.['stellar-drift']).toBeDefined();
    const hook2StoreBefore = hook2.current.store;
    const hook2UndoBefore = structuredClone(hook2.current.store.undoState?.['stellar-drift']);
    const hook2RawBefore = storage2.getRawValue(DEFAULT_STORAGE_KEY);
    const hook2WritesBefore = storage2.writeCount;

    storage2.setReadError(new Error('save-time read failure'));
    act(() => {
      expect(hook2.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', 'should fail')).toBe(false);
    });
    expect(hook2.current.canSave).toBe(false);
    expect(hook2.current.persistenceStatus).toBe('Saved progress could not be checked. Reload required to resume saving.');
    expect(hook2.current.store).toBe(hook2StoreBefore);
    expect(hook2.current.store.undoState?.['stellar-drift']).toEqual(hook2UndoBefore);
    expect(storage2.getRawValue(DEFAULT_STORAGE_KEY)).toBe(hook2RawBefore);
    expect(storage2.writeCount).toBe(hook2WritesBefore);
  });

  it('preserves reload latch on no-op, returns true without clearing status, and rejects subsequent changed actions', () => {
    const storage = new MemoryStorage();
    const { result } = renderHook(() => useProgressStore({ storage, now: fixedNow }));
    act(() => {
      result.current.selectGameAction(mockGameStellarDrift);
      result.current.updateBinaryCompletion(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', true);
    });
    expect(result.current.store.undoState?.['stellar-drift']).toBeDefined();
    const confirmedCounter = result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-004']?.counterValue ?? 0;
    const confirmedNotes = result.current.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].progress['sd-ps-001']?.notes;

    const foreignBytes = JSON.stringify({ foreign: 'conflict' });
    storage.seed(DEFAULT_STORAGE_KEY, foreignBytes);
    act(() => {
      expect(result.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', confirmedCounter + 1)).toBe(false);
    });
    expect(result.current.canSave).toBe(false);
    const reloadWarning = result.current.persistenceStatus;
    expect(reloadWarning).toContain('Reload required');

    const storeBeforeNoOp = result.current.store;
    const undoBeforeNoOp = structuredClone(result.current.store.undoState?.['stellar-drift']);
    const writesBeforeNoOp = storage.writeCount;

    act(() => {
      expect(result.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', confirmedCounter)).toBe(true);
      expect(result.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', confirmedNotes)).toBe(true);
    });
    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toBe(reloadWarning);
    expect(result.current.store).toBe(storeBeforeNoOp);
    expect(result.current.store.undoState?.['stellar-drift']).toEqual(undoBeforeNoOp);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(foreignBytes);
    expect(storage.writeCount).toBe(writesBeforeNoOp);

    act(() => {
      expect(result.current.updateCounterValue(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-004', 99)).toBe(false);
      expect(result.current.updateNotes(mockGameStellarDrift, 'stellar-drift-ps', 'sd-ps-001', 'rejected')).toBe(false);
    });
    expect(result.current.canSave).toBe(false);
    expect(result.current.persistenceStatus).toBe(reloadWarning);
    expect(result.current.store).toBe(storeBeforeNoOp);
    expect(result.current.store.undoState?.['stellar-drift']).toEqual(undoBeforeNoOp);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(foreignBytes);
    expect(storage.writeCount).toBe(writesBeforeNoOp);
  });
});
