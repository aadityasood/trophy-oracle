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

  it('starts from the domain default rather than a duplicated schema literal', () => {
    const { result } = renderHook(() =>
      useProgressStore({ storage: null, now: fixedNow }),
    );
    expect(result.current.store).toEqual(createDefaultLocalProgressStore());
  });
});
