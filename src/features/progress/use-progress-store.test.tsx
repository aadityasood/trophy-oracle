import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
