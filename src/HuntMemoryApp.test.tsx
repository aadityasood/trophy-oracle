import { StrictMode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import HuntMemoryApp, { type HuntMemorySessionConfig } from './HuntMemoryApp';
import {
  DEFAULT_PROGRESS_V2_STORAGE_KEY, DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_STORAGE_KEY, createDefaultHuntMemoryStore,
  type HuntMemoryStorageKeys,
} from './data/hunt-memory-storage';
import type { WebLockCallback, WebLockManagerLike } from './data/hunt-memory-write-lock';
import type { DatasetLoadResult } from './domain/achievement-schema';
import { createDefaultGameProgressV3, createDefaultRunProgress, createRun } from './domain/hunt-memory-lifecycle';
import { setRunBinaryCompletion } from './domain/hunt-memory-progress';
import { LocalProgressStoreV3Schema, RunProgressSchema, type LocalProgressStoreV3 } from './domain/hunt-memory-schema';
import { MemoryStorage } from './test/memory-storage';
import { MOCK_TIMESTAMP, MOCK_TIMESTAMP_2, mockGameMythHarbor, mockGameStellarDrift } from './test/progress-fixtures';

class TestLockManager implements WebLockManagerLike {
  shouldDefer = false;
  deferredResolver: (() => Promise<void>) | null = null;

  async request<T>(_name: string, optOrCb: unknown, maybeCb?: WebLockCallback<T>): Promise<T> {
    const cb = (typeof optOrCb === 'function' ? optOrCb : maybeCb!) as WebLockCallback<T>;
    if (!this.shouldDefer) return cb();
    return new Promise<T>((resolve, reject) => {
      this.deferredResolver = async () => {
        try { resolve(await cb()); } catch (err) { reject(err); }
      };
    });
  }
}

const TEST_KEYS: HuntMemoryStorageKeys = {
  v2Key: DEFAULT_PROGRESS_V2_STORAGE_KEY,
  v3Key: DEFAULT_PROGRESS_V3_STORAGE_KEY,
  cutoverKey: DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
};

const TEST_DATASET: DatasetLoadResult = {
  success: true,
  data: {
    schemaVersion: '1.0.0',
    notes: 'Test dataset',
    games: [mockGameStellarDrift, mockGameMythHarbor],
  },
};

function createBaseStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.lastGameId = mockGameStellarDrift.id;
  store.gameProgress[mockGameStellarDrift.id] = createDefaultGameProgressV3(mockGameStellarDrift, MOCK_TIMESTAMP);
  return store;
}

function seedReadyStorage(storage: MemoryStorage, keys = TEST_KEYS, store = createBaseStore()): LocalProgressStoreV3 {
  storage.seed(keys.v3Key, JSON.stringify(store));
  storage.seed(keys.cutoverKey, JSON.stringify({ recordVersion: 1, source: 'fresh' }));
  return store;
}

function getStoredRun(storage: MemoryStorage, gameId = mockGameStellarDrift.id, setId = 'stellar-drift-ps', runId = 'default-run') {
  const raw = storage.getItem(TEST_KEYS.v3Key);
  if (!raw) return null;
  const store = JSON.parse(raw) as LocalProgressStoreV3;
  return store.gameProgress[gameId]?.sets[setId]?.runs[runId] ?? null;
}

function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const val = obj[key];
    if (val && typeof val === 'object' && !Object.isFrozen(val)) deepFreeze(val as object);
  }
  return obj;
}

function createSession(overrides: Partial<HuntMemorySessionConfig> = {}): HuntMemorySessionConfig {
  return {
    session: 'test-session-1', storage: new MemoryStorage(), lockManager: new TestLockManager(),
    keys: TEST_KEYS, clock: vi.fn(() => MOCK_TIMESTAMP), download: vi.fn(), ...overrides,
  };
}

describe('HuntMemoryApp Integration and Lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes default to V2 with zero V3 work and opt-in to HuntMemoryApp', () => {
    const storage = new MemoryStorage();
    const spy = vi.spyOn(storage, 'getItem');
    render(<App storage={storage} now={() => MOCK_TIMESTAMP} />);
    expect(screen.getByRole('heading', { name: 'Trophy Oracle' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith(TEST_KEYS.v3Key);
    expect(storage.getItem(TEST_KEYS.v3Key)).toBeNull();
    expect(storage.getItem(TEST_KEYS.cutoverKey)).toBeNull();

    render(<App datasetResult={TEST_DATASET} huntMemorySession={createSession({ storage })} />);
    expect(screen.getByRole('heading', { name: 'Hunt Memory Safety Status' })).toBeInTheDocument();
  });

  it('mounts opt-in in StrictMode with zero writes and no passive mutation clock calls', async () => {
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    const clock = vi.fn(() => MOCK_TIMESTAMP);
    const session = createSession({ storage, clock });

    render(<StrictMode><HuntMemoryApp datasetResult={TEST_DATASET} session={session} /></StrictMode>);
    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();
    expect(storage.writeCount).toBe(0);
    const baselineClockCalls = clock.mock.calls.length;

    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search games' }), 'Drift');
    expect(storage.writeCount).toBe(0);
    expect(clock.mock.calls.length).toBe(baselineClockCalls);
  });

  it('fails closed when session configuration is missing or invalid', () => {
    const invalidSession = {
      session: '', storage: null, lockManager: null, keys: { v2Key: 'k', v3Key: 'k', cutoverKey: 'k' },
      clock: () => MOCK_TIMESTAMP, download: () => {},
    } as unknown as HuntMemorySessionConfig;
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={invalidSession} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Hunt Memory Unavailable/i);
  });

  it('fails closed on dependency or in-place key modification on same session identity', () => {
    const storage = new MemoryStorage();
    const keysObj = { ...TEST_KEYS };
    const session = createSession({ storage, keys: keysObj });
    const { rerender } = render(<HuntMemoryApp datasetResult={TEST_DATASET} session={session} />);
    expect(screen.queryByText(/Session Configuration Conflict/i)).toBeNull();

    keysObj.v2Key = 'tampered-v2-key';
    rerender(<HuntMemoryApp datasetResult={TEST_DATASET} session={session} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Session Configuration Conflict/i);
  });

  it('preserves lifetime across equivalent session wrapper and key clones', () => {
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    const session1 = createSession({ storage });
    const { rerender } = render(<HuntMemoryApp datasetResult={TEST_DATASET} session={session1} />);
    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();

    rerender(<HuntMemoryApp datasetResult={TEST_DATASET} session={{ ...session1, keys: { ...session1.keys } }} />);
    expect(screen.queryByText(/Session Configuration Conflict/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();
  });

  it('renders safe alert and performs no hook work when dataset is invalid', () => {
    const storage = new MemoryStorage();
    render(<HuntMemoryApp datasetResult={{ success: false, error: 'Corrupt dataset' }} session={createSession({ storage })} />);
    expect(screen.getByTestId('dataset-error')).toBeInTheDocument();
    expect(storage.readCount).toBe(0);
    expect(storage.writeCount).toBe(0);
  });

  it('displays uninitialized state for fresh game and initializes explicitly via Open workspace', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    expect(screen.getByText(/Workspace not initialized/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Open workspace/i }));
    expect(storage.writeCount).toBeGreaterThan(0);
    expect(screen.queryByText(/Workspace not initialized/i)).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Achievement 1' }).length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getAllByRole('button', { name: /Reveal details for Achievement 1/i })[0]);
    expect(screen.getAllByRole('heading', { name: 'First Burn' }).length).toBeGreaterThanOrEqual(1);
  });

  it('browses games and sets locally without storage writes when saving is unavailable', async () => {
    const user = userEvent.setup();
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage: null, lockManager: null })} />);
    await user.click(screen.getByRole('button', { name: /Myth Harbor/i }));
    expect(screen.getByRole('heading', { name: 'Myth Harbor' })).toBeInTheDocument();
  });

  it('switches to uninitialized game when saving is active, displaying uninitialized workspace and allowing explicit open', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Myth Harbor/i }));
    expect(screen.getByRole('heading', { name: 'Myth Harbor' })).toBeInTheDocument();
    expect(screen.getByText(/Workspace not initialized/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Open workspace/i }));
    expect(screen.queryByText(/Workspace not initialized/i)).toBeNull();
    const updatedStore = JSON.parse(storage.getItem(TEST_KEYS.v3Key)!) as LocalProgressStoreV3;
    expect(updatedStore.lastGameId).toBe('myth-harbor');
    expect(updatedStore.gameProgress['myth-harbor']).toBeDefined();
  });

  it('displays safe actionable alert on set version mismatch without auto-repair', () => {
    const storage = new MemoryStorage();
    const store = createBaseStore();
    store.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].version = 'outdated-version-999';
    seedReadyStorage(storage, TEST_KEYS, store);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Achievement data for this version is out of date/i);
    expect(storage.writeCount).toBe(0);
  });

  it('adapts binary checkbox toggle on selected run, records target run undo, and isolates other run', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const base = createBaseStore();
    base.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].runs['default-run'].pinnedAchievementIds = ['sd-ps-002'];
    const created = createRun(base, mockGameStellarDrift, 'stellar-drift-ps', 'speedrun', 'Speedrun Mode', MOCK_TIMESTAMP);
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.message);
    const store = created.store;
    store.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].activeRunId = 'default-run';
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
    seedReadyStorage(storage, TEST_KEYS, store);
    const getStore = () => JSON.parse(storage.getItem(TEST_KEYS.v3Key)!) as LocalProgressStoreV3;
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    const runSelect = screen.getByRole('combobox', { name: /Active run/i });
    expect(runSelect).toHaveValue('default-run');
    await user.selectOptions(runSelect, 'speedrun');
    expect(runSelect).toHaveValue('speedrun');
    expect(getStore().gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].activeRunId).toBe('speedrun');
    const speedrunBefore = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'speedrun')!;
    const defaultBefore = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'default-run')!;
    expect(speedrunBefore.progress['sd-ps-001'].completed).toBeFalsy();
    expect(defaultBefore.pinnedAchievementIds).toEqual(['sd-ps-002']);
    const checkbox = screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    const speedrunAfter = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'speedrun')!;
    expect(speedrunAfter.progress['sd-ps-001'].completed).toBe(true);
    expect(speedrunAfter.progress['sd-ps-001'].lastUpdated).toBe(MOCK_TIMESTAMP);
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'default-run')).toEqual(defaultBefore);
    const snapshot = getStore().undoState?.[mockGameStellarDrift.id];
    expect(snapshot?.runId).toBe('speedrun');
    expect(snapshot?.setId).toBe('stellar-drift-ps');
    expect(snapshot?.guardedSetVersion).toBe('2026.07.13');
    expect(snapshot?.previous).toEqual(speedrunBefore);

    await user.selectOptions(runSelect, 'default-run');
    expect(runSelect).toHaveValue('default-run');
    expect(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i })).not.toBeChecked();
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'default-run')).toEqual(defaultBefore);
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'speedrun')).toEqual(speedrunAfter);
    expect(getStore().undoState?.[mockGameStellarDrift.id]).toEqual(snapshot);
    await user.click(screen.getByRole('button', { name: /Undo last change in PlayStation \(Standard Edition\) \(Speedrun Mode\)/i }));
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'speedrun')).toEqual(speedrunBefore);
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'default-run')).toEqual(defaultBefore);
    expect(getStore().undoState?.[mockGameStellarDrift.id]).toBeUndefined();
    expect(runSelect).toHaveValue('default-run');
    expect(getStore().gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].activeRunId).toBe('default-run');
  });

  it('adapts counter and checklist updates into raw V3 storage with timestamps', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    await user.click(screen.getByRole('button', { name: /Add 5 to counter for Achievement 3/i }));
    await user.click(screen.getByRole('checkbox', { name: /Item 1 for Achievement 4/i }));

    const run = getStoredRun(storage)!;
    expect(run.progress['sd-ps-004'].counter).toEqual({ certainty: 'exact', value: 5 });
    expect(run.progress['sd-ps-004'].lastUpdated).toBe(MOCK_TIMESTAMP);
    expect(run.progress['sd-ps-005'].checklistCompletion?.['task-a']).toBe(true);
    expect(run.progress['sd-ps-005'].lastUpdated).toBe(MOCK_TIMESTAMP);
  });

  it('adapts pins, stage, notes, and override into raw V3 storage with timestamps', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    await user.click(screen.getByRole('button', { name: /^Pin Achievement 1$/i }));
    await user.click(screen.getByRole('button', { name: /Select Missables stage/i }));

    const notesInput = screen.getByLabelText(/Manual notes for Achievement 1/i);
    await user.type(notesInput, 'Crucial note');
    await user.click(screen.getByRole('button', { name: /Save notes for Achievement 1/i }));

    await user.click(screen.getByRole('button', { name: /Override completion for Achievement 3/i }));
    await user.click(screen.getByRole('button', { name: /Confirm completion override for Achievement 3/i }));

    const run = getStoredRun(storage)!;
    expect(run.pinnedAchievementIds).toContain('sd-ps-001');
    expect(run.activeStage).toBe('missables');
    expect(run.progress['sd-ps-001'].notes).toBe('Crucial note');
    expect(run.progress['sd-ps-001'].lastUpdated).toBe(MOCK_TIMESTAMP);
    expect(run.progress['sd-ps-004'].manualOverride).toBe(true);
    expect(run.progress['sd-ps-004'].lastUpdated).toBe(MOCK_TIMESTAMP);
  });

  it('undo restores recorded run mutation across set navigation without losing state', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    const checkbox = screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByRole('radio', { name: /Steam/i }));
    const undoBtn = screen.getByRole('button', {
      name: /Undo last change in PlayStation \(Standard Edition\) \(Main Run\)/i,
    });
    await user.click(undoBtn);
    await user.click(screen.getByRole('radio', { name: /PlayStation/i }));
    expect(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i })).not.toBeChecked();
  });

  it('handles contention across two surfaces, asserts one admission and one losing acknowledgement, then settles', async () => {
    const storage = new MemoryStorage();
    const lockManager = new TestLockManager();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, lockManager })} />);

    lockManager.shouldDefer = true;
    act(() => {
      screen.getByRole('button', { name: /^Pin Achievement 1$/i }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      screen.getByRole('button', { name: /Select Missables stage/i }).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(await screen.findByText(/Stage update is waiting: an operation is in progress/i)).toBeInTheDocument();
    await act(async () => {
      if (lockManager.deferredResolver) await lockManager.deferredResolver();
    });

    const run = getStoredRun(storage)!;
    expect(run.pinnedAchievementIds).toContain('sd-ps-001');
    expect(run.activeStage).not.toBe('missables');
  });

  it('isolates unresolved action across session A to B to A and unmount remount settlement', async () => {
    const user = userEvent.setup();
    const lockA = new TestLockManager();
    const storageA = new MemoryStorage();
    const storageB = new MemoryStorage();
    seedReadyStorage(storageA);
    seedReadyStorage(storageB);
    const sessionA = createSession({ session: 'session-A', storage: storageA, lockManager: lockA });
    const sessionB = createSession({ session: 'session-B', storage: storageB });

    const { rerender, unmount } = render(<HuntMemoryApp datasetResult={TEST_DATASET} session={sessionA} />);
    lockA.shouldDefer = true;
    await user.click(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i }));
    expect(lockA.deferredResolver).toBeTypeOf('function');

    rerender(<HuntMemoryApp datasetResult={TEST_DATASET} session={sessionB} />);
    expect(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i })).not.toBeChecked();

    await act(async () => { await lockA.deferredResolver!(); });
    expect(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i })).not.toBeChecked();
    expect(getStoredRun(storageA)?.progress['sd-ps-001']?.completed).toBe(true);
    expect(storageB.writeCount).toBe(0);

    rerender(<HuntMemoryApp datasetResult={TEST_DATASET} session={sessionA} />);
    expect(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i })).toBeChecked();

    lockA.shouldDefer = true;
    await user.click(screen.getByRole('button', { name: /^Pin Achievement 1$/i }));
    expect(lockA.deferredResolver).toBeTypeOf('function');
    const deferredPin = lockA.deferredResolver!;
    unmount();

    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={sessionB} />);
    const notesInput = screen.getByLabelText(/Manual notes for Achievement 1/i);
    await user.type(notesInput, 'Draft before old settlement');
    expect(notesInput).toHaveValue('Draft before old settlement');

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const sessionBRunName = screen.getByLabelText(/Run name/i);
    await user.type(sessionBRunName, 'Draft in Session B');
    expect(sessionBRunName).toHaveValue('Draft in Session B');

    await act(async () => { await deferredPin(); });
    expect(notesInput).toHaveValue('Draft before old settlement');
    expect(sessionBRunName).toHaveValue('Draft in Session B');
    expect(screen.getByRole('button', { name: /^Pin Achievement 1$/i })).toBeInTheDocument();
    expect(storageB.writeCount).toBe(0);
    expect(getStoredRun(storageA)?.pinnedAchievementIds).toContain('sd-ps-001');
  });

  it('starts in upgrade-required state when V2 exists and commits on explicit upgrade', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    storage.seed(TEST_KEYS.v2Key, JSON.stringify({ schemaVersion: '2.0', gameProgress: {} }));
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    expect(screen.getByText(/Earlier Version Progress Detected/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Upgrade progress/i }));
    expect(storage.getItem(TEST_KEYS.cutoverKey)).not.toBeNull();
  });

  it('reloads inspection on explicit Reload button after storage is seeded and asserts updated inspection', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const store = seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);

    const mutationRes = setRunBinaryCompletion(store, mockGameStellarDrift, 'stellar-drift-ps', 'default-run', 'sd-ps-001', true, MOCK_TIMESTAMP_2);
    expect(mutationRes.success).toBe(true);
    if (mutationRes.success) storage.seed(TEST_KEYS.v3Key, JSON.stringify(mutationRes.store));

    await user.click(screen.getByRole('button', { name: /^Pin Achievement 1$/i }));
    const reloadBtn = await screen.findByRole('button', { name: /Reload Application/i });
    await user.click(reloadBtn);
    expect(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i })).toBeChecked();
  });

  it('exports raw retained bytes via callback on explicit download click with zero automatic calls', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    const download = vi.fn();
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, download })} />);
    expect(download).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Export Raw V3 progress/i }));
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith('trophy-oracle-progress-v3.json', storage.getItem(TEST_KEYS.v3Key));
  });

  it('preserves neutral labels for spoiler-masked achievements until revealed', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    expect(screen.getByRole('heading', { name: 'Achievement 2' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reveal details for Achievement 2/i }));
    expect(screen.getByRole('heading', { name: 'Orbit Breaker' })).toBeInTheDocument();
  });

  it('manages delayed navigation intent across mixed initialized and uninitialized games during Open workspace', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const lockManager = new TestLockManager();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, lockManager })} />);
    await user.click(screen.getByRole('button', { name: /Myth Harbor/i }));
    expect(screen.getByText(/Progress for Myth Harbor is not loaded in this view/i)).toBeInTheDocument();

    lockManager.shouldDefer = true;
    await user.click(screen.getByRole('button', { name: /Open workspace/i }));
    await user.click(screen.getByRole('button', { name: /Stellar Drift/i }));
    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();

    await act(async () => {
      if (lockManager.deferredResolver) await lockManager.deferredResolver();
    });

    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();
    const updated = JSON.parse(storage.getItem(TEST_KEYS.v3Key)!) as LocalProgressStoreV3;
    expect(updated.gameProgress['myth-harbor']).toBeDefined();
  });

  it('disables undo button when recorded snapshot version mismatches dataset', () => {
    const storage = new MemoryStorage();
    const store = createBaseStore();
    const baseRun = store.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].runs['default-run'];
    store.undoState = {
      [mockGameStellarDrift.id]: {
        setId: 'stellar-drift-ps', runId: 'default-run',
        guardedSetVersion: 'mismatched-version-99', previous: baseRun,
      },
    };
    seedReadyStorage(storage, TEST_KEYS, store);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    const undoBtn = screen.getByRole('button', { name: /Undo last change in PlayStation/i });
    expect(undoBtn).toBeDisabled();
    expect(screen.getByText(/version mismatch/i)).toBeInTheDocument();
  });

  it('wires pending Retry and Discard in safety panel when storage write fails', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    storage.setWriteError(new Error('Simulated write failure'));

    await user.click(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i }));
    expect(await screen.findByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeInTheDocument();

    storage.setWriteError(null);
    await user.click(screen.getByRole('button', { name: /Retry save/i }));
    expect(screen.queryByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeNull();
    expect(getStoredRun(storage)?.progress['sd-ps-001'].completed).toBe(true);
    expect(storage.writeCount).toBeGreaterThan(0);
    const confirmedRaw = storage.getRawValue(TEST_KEYS.v3Key);

    storage.setWriteError(new Error('Second write failure'));
    await user.click(screen.getByRole('button', { name: /^Pin Achievement 1$/i }));
    expect(await screen.findByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeInTheDocument();
    const writeCountBeforeDiscard = storage.writeCount;

    await user.click(screen.getByRole('button', { name: /Discard unsaved change/i }));
    expect(screen.queryByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeNull();
    expect(storage.getRawValue(TEST_KEYS.v3Key)).toBe(confirmedRaw);
    expect(storage.writeCount).toBe(writeCountBeforeDiscard);
    expect(getStoredRun(storage)?.pinnedAchievementIds).not.toContain('sd-ps-001');

    storage.setWriteError(null);
    await user.click(screen.getByRole('button', { name: /^Pin Achievement 1$/i }));
    expect(storage.writeCount).toBe(writeCountBeforeDiscard + 1);
    expect(getStoredRun(storage)?.pinnedAchievementIds).toContain('sd-ps-001');
  });

  it('retains draft in memory and protects foreign storage bytes on token conflict', async () => {
    const user = userEvent.setup();
    const competingStore = createBaseStore();
    competingStore.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-002'] = {
      achievementId: 'sd-ps-002', completed: true, manualOverride: false, provenance: 'manual', lastUpdated: MOCK_TIMESTAMP_2,
    };
    const foreignPayload = JSON.stringify(competingStore);

    for (const { label, draft, btnName, expected } of [
      { label: /Manual notes for Achievement 1/i, draft: 'Uncommitted conflict note', btnName: /Save notes for Achievement 1/i, expected: 'Uncommitted conflict note' },
      { label: /Set counter for Achievement 3/i, draft: '42', btnName: /Apply counter for Achievement 3/i, expected: 42 },
    ]) {
      const storage = new MemoryStorage();
      seedReadyStorage(storage);
      const { unmount } = render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
      const input = screen.getByLabelText(label);
      await user.clear(input);
      await user.type(input, draft);

      storage.seed(TEST_KEYS.v3Key, foreignPayload);
      const btn = screen.getByRole('button', { name: btnName });
      expect(btn).toBeEnabled();
      await user.click(btn);

      expect(await screen.findByText(/Saving is blocked until reloaded/i)).toBeInTheDocument();
      expect(input).toHaveValue(expected);
      expect(storage.getRawValue(TEST_KEYS.v3Key)).toBe(foreignPayload);
      unmount();
    }
  });

  it('displays and navigates multiple runs locally with distinguishing progress when saving is unavailable', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const store = createBaseStore();
    const psSet = store.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'];
    psSet.runs['speedrun'] = {
      ...psSet.runs['default-run'], runId: 'speedrun', name: 'Speedrun Mode',
      progress: {
        'sd-ps-001': {
          achievementId: 'sd-ps-001', completed: true,
          manualOverride: false, provenance: 'manual', lastUpdated: MOCK_TIMESTAMP,
        },
      },
    };
    seedReadyStorage(storage, TEST_KEYS, store);

    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, lockManager: null })} />);
    expect(screen.getByText(/View-Only Mode: Saving Disabled/i)).toBeInTheDocument();

    const runSelect = screen.getByRole('combobox', { name: /Active run/i });
    expect(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i })).not.toBeChecked();

    await user.selectOptions(runSelect, 'speedrun');
    expect(screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i })).toBeChecked();
    expect(storage.writeCount).toBe(0);
  });

  it('maintains scoped IDs and ARIA labels across independent instances without mutating inputs', async () => {
    const user = userEvent.setup();
    const clonedDataset = deepFreeze(JSON.parse(JSON.stringify(TEST_DATASET)) as DatasetLoadResult);
    const keysA = deepFreeze({ ...TEST_KEYS });
    const storageA = new MemoryStorage();
    const storageB = new MemoryStorage();
    seedReadyStorage(storageA);
    seedReadyStorage(storageB);
    const sessionA = createSession({ session: 'session-inst-a', keys: keysA, storage: storageA });
    const sessionB = createSession({ session: 'session-inst-b', keys: deepFreeze({ ...TEST_KEYS }), storage: storageB });

    const { container: containerA } = render(<HuntMemoryApp datasetResult={clonedDataset} session={sessionA} />);
    const { container: containerB } = render(<HuntMemoryApp datasetResult={clonedDataset} session={sessionB} />);

    await user.click(within(containerA).getByRole('button', { name: /^New run$/i }));
    await user.click(within(containerB).getByRole('button', { name: /^New run$/i }));
    const nameInputA = within(containerA).getByLabelText(/Run name/i);
    const nameInputB = within(containerB).getByLabelText(/Run name/i);
    expect(nameInputA).toBeInTheDocument();
    expect(nameInputB).toBeInTheDocument();
    expect(nameInputA.id).not.toBe(nameInputB.id);

    const rawIdsA = Array.from(containerA.querySelectorAll('[id]'), (el) => el.id);
    const rawIdsB = Array.from(containerB.querySelectorAll('[id]'), (el) => el.id);
    expect(new Set(rawIdsA).size).toBe(rawIdsA.length);
    expect(new Set(rawIdsB).size).toBe(rawIdsB.length);
    expect(rawIdsA.length).toBeGreaterThan(0);
    expect(rawIdsA.some((id) => new Set(rawIdsB).has(id))).toBe(false);

    for (const root of [containerA, containerB]) {
      for (const el of root.querySelectorAll('[aria-labelledby]')) {
        for (const id of el.getAttribute('aria-labelledby')!.trim().split(/\s+/)) {
          expect(root.querySelector('#' + CSS.escape(id))).not.toBeNull();
        }
      }
      for (const label of root.querySelectorAll('label[for]')) {
        expect(root.querySelector('#' + CSS.escape(label.getAttribute('for')!))).not.toBeNull();
      }
    }

    await user.click(within(containerA).getByRole('button', { name: /Myth Harbor/i }));
    expect(within(containerA).getByRole('heading', { name: 'Myth Harbor' })).toBeInTheDocument();
    expect(within(containerB).getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();

    const notesB = within(containerB).getByLabelText(/Manual notes for Achievement 1/i);
    await user.type(notesB, 'Draft in B');
    expect(notesB).toHaveValue('Draft in B');
    await user.click(within(containerB).getByRole('checkbox', { name: /Mark Achievement 1 complete/i }));

    expect(storageB.writeCount).toBe(1);
    expect(storageA.writeCount).toBe(0);
    expect(getStoredRun(storageB)?.progress['sd-ps-001'].completed).toBe(true);
    expect(getStoredRun(storageA)?.progress['sd-ps-001'].completed).toBe(false);

    expect(clonedDataset.success).toBe(true);
    expect(keysA.v3Key).toBe(DEFAULT_PROGRESS_V3_STORAGE_KEY);
  });

  it('validates whitespace input and cancellation without writes, creates run with exact padded name skipping occupied run id, allows duplicate display names with compact ordinals, and retains selection on reload', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const clock = vi.fn(() => MOCK_TIMESTAMP);
    const baseStore = createBaseStore();
    const psSet = baseStore.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'];
    psSet.runs['run-1'] = { ...psSet.runs['default-run'], runId: 'run-1', name: 'Occupied Run 1' };
    expect(LocalProgressStoreV3Schema.safeParse(baseStore).success).toBe(true);
    seedReadyStorage(storage, TEST_KEYS, baseStore);
    const { unmount } = render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, clock })} />);
    const baselineClockCalls = clock.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /^New run$/i }));

    const runNameInput = screen.getByLabelText(/Run name/i);
    const createRunSubmit = within(runNameInput.closest('form')!).getByRole('button', { name: /^Create run$/i });

    expect(createRunSubmit).toBeDisabled();
    await user.type(runNameInput, ' ');
    expect(createRunSubmit).toBeDisabled();
    expect(storage.writeCount).toBe(0);
    expect(clock.mock.calls.length).toBe(baselineClockCalls);

    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText(/Run name/i)).toBeNull();
    expect(storage.writeCount).toBe(0);
    expect(clock.mock.calls.length).toBe(baselineClockCalls);

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const reopenedInput = screen.getByLabelText(/Run name/i);
    const reopenedSubmit = within(reopenedInput.closest('form')!).getByRole('button', { name: /^Create run$/i });
    await user.type(reopenedInput, ' P ');
    expect(reopenedSubmit).toBeEnabled();
    await user.click(reopenedSubmit);
    expect(screen.queryByLabelText(/Run name/i)).toBeNull();

    const runSelect = screen.getByRole('combobox', { name: /Active run/i });
    expect(runSelect).toHaveValue('run-2');

    const storedRun2 = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-2')!;
    expect(storedRun2).toBeDefined();
    expect(storedRun2.runId).toBe('run-2');
    expect(storedRun2.name).toBe(' P ');
    expect(RunProgressSchema.safeParse(storedRun2).success).toBe(true);

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const proto1 = screen.getByLabelText(/Run name/i);
    await user.type(proto1, 'toString');
    await user.click(within(proto1.closest('form')!).getByRole('button', { name: /^Create run$/i }));
    expect(runSelect).toHaveValue('run-3');

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const proto2 = screen.getByLabelText(/Run name/i);
    await user.type(proto2, 'toString');
    await user.click(within(proto2.closest('form')!).getByRole('button', { name: /^Create run$/i }));

    expect(runSelect).toHaveValue('run-4');
    const options = Array.from(runSelect.querySelectorAll('option'), (o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining([' P ', 'toString (1)', 'toString (2)']));

    const storedProtoRun = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-4')!;
    expect(storedProtoRun.name).toBe('toString');
    expect(RunProgressSchema.safeParse(storedProtoRun).success).toBe(true);

    const seeded = JSON.parse(storage.getItem(TEST_KEYS.v3Key)!) as LocalProgressStoreV3;
    const runs = seeded.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].runs;
    ['Run', 'Run', ' Run (1) ', 'Run '].forEach((name, i) => {
      runs[`c-${i + 1}`] = { ...runs['default-run'], runId: `c-${i + 1}`, name };
    });
    storage.setItem(TEST_KEYS.v3Key, JSON.stringify(seeded));
    unmount();
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);
    const reloadedSelect = screen.getByRole('combobox', { name: /Active run/i });
    expect(reloadedSelect).toHaveValue('run-4');
    expect(screen.getByRole('option', { name: 'Run (1)' })).toHaveValue('c-3');
    expect(reloadedSelect.querySelector('option[value="c-1"]')).toHaveTextContent('Run (2)');
    expect(reloadedSelect.querySelector('option[value="c-2"]')).toHaveTextContent('Run (3)');
    expect(reloadedSelect.querySelector('option[value="c-4"]')).toHaveTextContent('Run (4)');
    expect(reloadedSelect.querySelector('option[value="run-2"]')?.textContent).toBe(' P ');
  });

  it('creates run from distinguishing prior progress and undo snapshot, asserting fresh defaults, untouched prior state and recorded target undo', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const baseStore = createBaseStore();
    const defaultRun = baseStore.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].runs['default-run'];
    defaultRun.pinnedAchievementIds = ['sd-ps-001'];
    defaultRun.activeStage = 'missables';

    const mutationRes = setRunBinaryCompletion(baseStore, mockGameStellarDrift, 'stellar-drift-ps', 'default-run', 'sd-ps-001', true, MOCK_TIMESTAMP);
    expect(mutationRes.success).toBe(true);
    if (!mutationRes.success) throw new Error('Setup failed');
    const seededStore = mutationRes.store;
    seededStore.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].notes = 'prior note';
    const beforeCreationStore = structuredClone(seededStore);
    seedReadyStorage(storage, TEST_KEYS, seededStore);

    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage })} />);

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    await user.type(screen.getByLabelText(/Run name/i), 'Fresh Run');
    await user.click(within(screen.getByLabelText(/Run name/i).closest('form')!).getByRole('button', { name: /^Create run$/i }));

    const runSelect = screen.getByRole('combobox', { name: /Active run/i });
    expect(runSelect).toHaveValue('run-1');

    const freshRun = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-1')!;
    const expectedFreshRun = createDefaultRunProgress(mockGameStellarDrift.achievementSets[0], 'run-1', 'Fresh Run', MOCK_TIMESTAMP);
    expect(freshRun).toEqual(expectedFreshRun);
    expect(freshRun.progress['sd-ps-001'].notes).toBeUndefined();

    const storedPriorRun = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'default-run')!;
    expect(storedPriorRun).toEqual(beforeCreationStore.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].runs['default-run']);
    expect(storedPriorRun.progress['sd-ps-001'].notes).toBe('prior note');

    const currentStore = JSON.parse(storage.getItem(TEST_KEYS.v3Key)!) as LocalProgressStoreV3;
    const expectedCreatedStore = structuredClone(beforeCreationStore);
    expectedCreatedStore.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].activeRunId = 'run-1';
    expectedCreatedStore.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].runs['run-1'] = freshRun;
    expect(currentStore).toEqual(expectedCreatedStore);

    const checkbox = screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-1')?.progress['sd-ps-001'].completed).toBe(true);

    await user.selectOptions(runSelect, 'default-run');
    expect(runSelect).toHaveValue('default-run');

    const undoBtn = screen.getByRole('button', {
      name: /Undo last change in PlayStation \(Standard Edition\) \(Fresh Run\)/i,
    });
    await user.click(undoBtn);

    expect(runSelect).toHaveValue('default-run');
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'default-run')).toEqual(storedPriorRun);
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-1')).toEqual(freshRun);
    const storeAfterUndo = JSON.parse(storage.getItem(TEST_KEYS.v3Key)!) as LocalProgressStoreV3;
    expect(storeAfterUndo.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'].activeRunId).toBe('default-run');
    expect(storeAfterUndo.undoState?.[mockGameStellarDrift.id]).toBeUndefined();
  });

  it('exercises retryable creation failure, candidate publication via Retry versus Discard, and stale conflict protection', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const lockManager = new TestLockManager();
    seedReadyStorage(storage);
    render(<HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, lockManager })} />);

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const nameInput = screen.getByLabelText(/Run name/i);
    const form = nameInput.closest('form')!;
    await user.type(nameInput, 'Fail Run');

    storage.setWriteError(new Error('Simulated write failure on run create'));
    await user.click(within(form).getByRole('button', { name: /^Create run$/i }));

    expect(await screen.findByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeInTheDocument();
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-1')).toBeNull();
    expect(form).toBeInTheDocument();
    expect(within(form).getByLabelText(/Run name/i)).toHaveValue('Fail Run');
    expect(screen.getByText(/Run creation could not be saved to storage/i)).toBeInTheDocument();

    storage.setWriteError(null);
    lockManager.shouldDefer = true;
    await user.click(screen.getByRole('button', { name: /Retry save/i }));

    await user.click(within(form).getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByLabelText(/Run name/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const sameNameInput = screen.getByLabelText(/Run name/i);
    const newForm = sameNameInput.closest('form')!;
    await user.type(sameNameInput, 'Fail Run');

    expect(lockManager.deferredResolver).toBeTypeOf('function');
    const retryResolver = lockManager.deferredResolver!;
    lockManager.shouldDefer = false;
    await act(async () => {
      await retryResolver();
    });

    expect(screen.queryByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeNull();
    const publishedRun = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-1')!;
    expect(publishedRun.name).toBe('Fail Run');
    expect(RunProgressSchema.safeParse(publishedRun).success).toBe(true);

    expect(newForm).toBeInTheDocument();
    expect(within(newForm).getByLabelText(/Run name/i)).toHaveValue('Fail Run');

    storage.setWriteError(new Error('Second simulated failure'));
    await user.click(within(newForm).getByRole('button', { name: /^Create run$/i }));
    expect(await screen.findByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Discard unsaved change/i }));
    expect(screen.queryByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeNull();
    expect(newForm).toBeInTheDocument();
    expect(within(newForm).getByLabelText(/Run name/i)).toHaveValue('Fail Run');
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-2')).toBeNull();

    storage.setWriteError(null);
    const foreignMutation = setRunBinaryCompletion(createBaseStore(), mockGameStellarDrift, 'stellar-drift-ps', 'default-run', 'sd-ps-001', true, MOCK_TIMESTAMP_2);
    if (!foreignMutation.success) throw new Error('Setup failed');
    const foreignPayload = JSON.stringify(foreignMutation.store);
    storage.seed(TEST_KEYS.v3Key, foreignPayload);

    await user.click(within(newForm).getByRole('button', { name: /^Create run$/i }));
    expect(await screen.findByText(/Saving is blocked until reloaded/i)).toBeInTheDocument();
    expect(newForm).toBeInTheDocument();
    expect(within(newForm).getByLabelText(/Run name/i)).toHaveValue('Fail Run');
    expect(storage.getRawValue(TEST_KEYS.v3Key)).toBe(foreignPayload);
  });

  it('batches duplicate native submit clicks before rerender with deferred locks and maps clock error to safe feedback', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const lockManager = new TestLockManager();
    seedReadyStorage(storage);
    const { unmount } = render(
      <HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, lockManager })} />,
    );

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const runNameInput = screen.getByLabelText(/Run name/i);
    await user.type(runNameInput, 'Fast');
    lockManager.shouldDefer = true;
    const createBtn = within(runNameInput.closest('form')!).getByRole('button', { name: /^Create run$/i });
    const cancelBtn = within(runNameInput.closest('form')!).getByRole('button', { name: /^Cancel$/i });

    act(() => {
      createBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      createBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});

    expect(lockManager.deferredResolver).toBeTypeOf('function');
    expect(createBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    expect(screen.queryByText(/already in progress|encounter|fail/i)).toBeNull();
    await user.type(runNameInput, ' Newer');

    await act(async () => {
      await lockManager.deferredResolver!();
    });

    expect(screen.getByLabelText(/Run name/i)).toHaveValue('Fast Newer');

    const stellarStore = JSON.parse(storage.getItem(TEST_KEYS.v3Key)!) as LocalProgressStoreV3;
    const stellarRuns = stellarStore.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs;
    expect(Object.keys(stellarRuns).sort()).toEqual(['default-run', 'run-1']);
    expect(stellarRuns['run-1'].name).toBe('Fast');
    unmount();

    let clockThrows = false;
    const badClockMarker = '__RAW_TIMESTAMP_ERROR_MARKER__';
    const clockStorage = new MemoryStorage();
    seedReadyStorage(clockStorage);
    render(
      <HuntMemoryApp
        datasetResult={TEST_DATASET}
        session={createSession({
          storage: clockStorage,
          clock: () => {
            if (clockThrows) throw new Error('__RAW_CLOCK_EXCEPTION__');
            return badClockMarker;
          },
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const clockInput = screen.getByLabelText(/Run name/i);
    await user.type(clockInput, 'Bad');
    const clockSubmit = within(clockInput.closest('form')!).getByRole('button', { name: /^Create run$/i });
    await user.click(clockSubmit);

    expect(await screen.findByText(/System clock error\. Please try again\./i)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(badClockMarker))).toBeNull();
    expect(clockInput).toHaveValue('Bad');
    expect(clockInput).toHaveAttribute('aria-describedby');
    expect(document.getElementById(clockInput.getAttribute('aria-describedby')!)).toHaveTextContent(/System clock error/i);

    clockThrows = true;
    await user.click(clockSubmit);
    expect(await screen.findByText(/Run creation encountered an unexpected error\./i)).toBeInTheDocument();
    expect(screen.queryByText(/__RAW_CLOCK_EXCEPTION__/)).toBeNull();
    expect(clockInput).toHaveValue('Bad');
    expect(clockSubmit).toBeEnabled();
    expect(within(clockInput.closest('form')!).getByRole('button', { name: /^Cancel$/i })).toBeEnabled();
    expect(clockStorage.writeCount).toBe(0);
  });

  it('isolates multi-game lifetime across waits, preserving newer drafts on A->B->A, same-set browsing, and disabling submit in view-only', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const lockManager = new TestLockManager();

    const multiStore = createBaseStore();
    const psSet = multiStore.gameProgress[mockGameStellarDrift.id].sets['stellar-drift-ps'];
    psSet.runs['speedrun'] = {
      ...psSet.runs['default-run'],
      runId: 'speedrun',
      name: 'Speedrun Mode',
    };
    multiStore.gameProgress[mockGameMythHarbor.id] = createDefaultGameProgressV3(mockGameMythHarbor, MOCK_TIMESTAMP);
    seedReadyStorage(storage, TEST_KEYS, multiStore);

    const { unmount } = render(
      <HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, lockManager })} />,
    );

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const browsingInput = screen.getByLabelText(/Run name/i);
    await user.type(browsingInput, 'D');
    const runSelect = screen.getByRole('combobox', { name: /Active run/i });
    expect(runSelect).toHaveValue('default-run');

    await user.selectOptions(runSelect, 'speedrun');
    expect(runSelect).toHaveValue('speedrun');
    expect(browsingInput).toHaveValue('D');
    await user.selectOptions(runSelect, 'default-run');
    expect(runSelect).toHaveValue('default-run');
    expect(browsingInput).toHaveValue('D');

    lockManager.shouldDefer = true;
    const createBtn = within(browsingInput.closest('form')!).getByRole('button', { name: /^Create run$/i });
    await user.click(createBtn);
    expect(lockManager.deferredResolver).toBeTypeOf('function');
    const oldDeferred = lockManager.deferredResolver!;

    await user.click(screen.getByRole('button', { name: new RegExp(mockGameMythHarbor.title, 'i') }));
    expect(screen.getByRole('heading', { name: 'Myth Harbor' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: new RegExp(mockGameStellarDrift.title, 'i') }));
    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const freshInput = screen.getByLabelText(/Run name/i);
    await user.type(freshInput, 'D');

    await act(async () => {
      await oldDeferred();
    });

    expect(freshInput).toBeInTheDocument();
    expect(freshInput).toHaveValue('D');
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-1')?.name).toBe('D');

    await user.click(within(freshInput.closest('form')!).getByRole('button', { name: /^Create run$/i }));
    const failDeferred = lockManager.deferredResolver!;

    await user.click(screen.getByRole('button', { name: new RegExp(mockGameMythHarbor.title, 'i') }));
    await user.click(screen.getByRole('button', { name: new RegExp(mockGameStellarDrift.title, 'i') }));
    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const failInput = screen.getByLabelText(/Run name/i);
    await user.type(failInput, 'F');

    storage.setWriteError(new Error('Deferred write failure'));
    await act(async () => {
      await failDeferred();
    });

    expect(screen.getByLabelText(/Run name/i)).toHaveValue('F');
    expect(screen.queryByText(/Run creation could not be saved to storage/i)).toBeNull();
    expect(failInput).not.toHaveAttribute('aria-describedby');
    expect(await screen.findByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();
    expect(getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-2')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Discard unsaved change/i }));
    expect(screen.queryByRole('heading', { name: /Unsaved Progress Candidate/i })).toBeNull();
    expect(screen.getByLabelText(/Run name/i)).toHaveValue('F');

    storage.setWriteError(null);
    lockManager.shouldDefer = false;
    await user.click(within(failInput.closest('form')!).getByRole('button', { name: /^Create run$/i }));
    expect(screen.queryByLabelText(/Run name/i)).toBeNull();

    const createdFreshRun = getStoredRun(storage, mockGameStellarDrift.id, 'stellar-drift-ps', 'run-2')!;
    expect(createdFreshRun.name).toBe('F');
    expect(RunProgressSchema.safeParse(createdFreshRun).success).toBe(true);
    unmount();

    const initialWrites = storage.writeCount;
    const { unmount: unmountViewOnly } = render(
      <HuntMemoryApp datasetResult={TEST_DATASET} session={createSession({ storage, lockManager: null })} />,
    );
    expect(screen.getByText(/View-Only Mode: Saving Disabled/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^New run$/i }));
    const viewOnlyInput = screen.getByLabelText(/Run name/i);
    await user.type(viewOnlyInput, 'D');
    const viewOnlySubmit = within(viewOnlyInput.closest('form')!).getByRole('button', { name: /^Create run$/i });
    expect(viewOnlySubmit).toBeDisabled();
    expect(storage.writeCount).toBe(initialWrites);
    expect(viewOnlyInput).not.toHaveAttribute('aria-describedby');
    expect(viewOnlyInput.id).toBeTruthy();
    expect(screen.getByLabelText(/Run name/i)).toHaveAttribute('id', viewOnlyInput.id);
    unmountViewOnly();
  });
});
