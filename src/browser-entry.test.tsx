import { StrictMode, act } from 'react';
import type { Root, RootOptions } from 'react-dom/client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

let capturedMainRoot: Root | null = null;
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot: (container: Element | DocumentFragment, options?: RootOptions) => {
      const root = actual.createRoot(container, options);
      if ((container as HTMLElement).id === 'root') {
        capturedMainRoot = root;
      }
      return root;
    },
  };
});
import {
  browserHuntMemorySession,
} from './main';
import {
  createBrowserHuntMemorySession,
  defaultIsoUtcClock,
} from './browser-hunt-memory-session';
import {
  DEFAULT_HUNT_MEMORY_STORAGE_KEYS,
  DEFAULT_PROGRESS_V2_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_STORAGE_KEY,
  createDefaultHuntMemoryStore,
} from './data/hunt-memory-storage';
import type {
  WebLockCallback,
  WebLockManagerLike,
} from './data/hunt-memory-write-lock';
import type { DatasetLoadResult } from './domain/achievement-schema';
import {
  createDefaultGameProgressV3,
  createRun,
} from './domain/hunt-memory-lifecycle';
import type { LocalProgressStoreV3 } from './domain/hunt-memory-schema';
import { defaultRawDownload } from './features/progress/hunt-memory-export';
import { MemoryStorage } from './test/memory-storage';
import {
  MOCK_TIMESTAMP,
  mockGameStellarDrift,
} from './test/progress-fixtures';

class SimpleLockManager implements WebLockManagerLike {
  async request<T>(_name: string, optOrCb: unknown, maybeCb?: WebLockCallback<T>): Promise<T> {
    const cb = (typeof optOrCb === 'function' ? optOrCb : maybeCb!) as WebLockCallback<T>;
    return cb();
  }
}

const TEST_DATASET: DatasetLoadResult = {
  success: true,
  data: {
    schemaVersion: '1.0.0',
    notes: 'Test dataset',
    games: [mockGameStellarDrift],
  },
};

function createTestV3Store(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.lastGameId = mockGameStellarDrift.id;
  store.gameProgress[mockGameStellarDrift.id] = createDefaultGameProgressV3(
    mockGameStellarDrift,
    MOCK_TIMESTAMP,
  );
  return store;
}

describe('Browser entry and hunt memory session integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('safely guards ordinary acquisition, missing capabilities, and throwing getters with zero factory work', () => {
    const hadLocalStorage = Object.prototype.hasOwnProperty.call(window, 'localStorage');
    const originalLocalStorageDesc = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const hadNavigatorLocks = Object.prototype.hasOwnProperty.call(navigator, 'locks');
    const originalLocksDesc = Object.getOwnPropertyDescriptor(navigator, 'locks');
    const hadGlobalWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const originalGlobalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const hadGlobalNavigator = Object.prototype.hasOwnProperty.call(globalThis, 'navigator');
    const originalGlobalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    function restoreProp(obj: unknown, key: string, had: boolean, desc?: PropertyDescriptor): void {
      if (had && desc) {
        Object.defineProperty(obj, key, desc);
      } else {
        delete (obj as Record<string, unknown>)[key];
      }
    }

    const mockExposedLockManager: WebLockManagerLike = {
      request: vi.fn(),
    };
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: mockExposedLockManager,
    });

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
    const clearSpy = vi.spyOn(Storage.prototype, 'clear');

    try {
      const ordinarySession = createBrowserHuntMemorySession();
      expect(ordinarySession.storage).toBe(window.localStorage);
      expect(ordinarySession.lockManager).toBe(mockExposedLockManager);
      expect(mockExposedLockManager.request).not.toHaveBeenCalled();
      expect(ordinarySession.session).toMatch(/^hunt-session-/);
      expect(ordinarySession.clock).toBe(defaultIsoUtcClock);
      expect(ordinarySession.download).toBe(defaultRawDownload);

      expect(getItemSpy).not.toHaveBeenCalled();
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(removeItemSpy).not.toHaveBeenCalled();
      expect(clearSpy).not.toHaveBeenCalled();

      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: undefined,
      });
      const missingLocksSession = createBrowserHuntMemorySession();
      expect(missingLocksSession.lockManager).toBeNull();
      expect(missingLocksSession.storage).toBe(window.localStorage);

      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('Access denied', 'SecurityError'); },
      });

      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        get() { throw new Error('Lock manager denied'); },
      });

      const guardedSession = createBrowserHuntMemorySession();
      expect(guardedSession.storage).toBeNull();
      expect(guardedSession.lockManager).toBeNull();
      expect(guardedSession.session).toMatch(/^hunt-session-/);
      expect(typeof guardedSession.clock).toBe('function');
      expect(typeof guardedSession.download).toBe('function');

      Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
      expect(createBrowserHuntMemorySession().storage).toBeNull();

      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
      expect(createBrowserHuntMemorySession().lockManager).toBeNull();
    } finally {
      restoreProp(globalThis, 'window', hadGlobalWindow, originalGlobalWindowDesc);
      restoreProp(globalThis, 'navigator', hadGlobalNavigator, originalGlobalNavigatorDesc);
      restoreProp(window, 'localStorage', hadLocalStorage, originalLocalStorageDesc);
      restoreProp(navigator, 'locks', hadNavigatorLocks, originalLocksDesc);
    }

    const testStorage = new MemoryStorage();
    const testLock = new SimpleLockManager();
    const explicitGetSpy = vi.spyOn(testStorage, 'getItem');
    const explicitSetSpy = vi.spyOn(testStorage, 'setItem');
    const lockSpy = vi.spyOn(testLock, 'request');
    const clockSpy = vi.fn(() => MOCK_TIMESTAMP);
    const downloadSpy = vi.fn();

    const explicitSession = createBrowserHuntMemorySession({
      storage: testStorage,
      lockManager: testLock,
      clock: clockSpy,
      download: downloadSpy,
    });

    expect(explicitSession.storage).toBe(testStorage);
    expect(explicitSession.lockManager).toBe(testLock);
    expect(explicitGetSpy).not.toHaveBeenCalled();
    expect(explicitSetSpy).not.toHaveBeenCalled();
    expect(lockSpy).not.toHaveBeenCalled();
    expect(clockSpy).not.toHaveBeenCalled();
    expect(downloadSpy).not.toHaveBeenCalled();

    expect(explicitSession.keys).toEqual(DEFAULT_HUNT_MEMORY_STORAGE_KEYS);
    expect(explicitSession.keys).not.toBe(DEFAULT_HUNT_MEMORY_STORAGE_KEYS);
  });

  it('executes actual main bootstrap into an isolated root and supplies its session under StrictMode', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    try {
      vi.resetModules();
      await act(async () => {
        const specifier = './main?test=bootstrap';
        const mainModule = (await import(
          /* @vite-ignore */ specifier as string
        )) as typeof import('./main');
        expect(mainModule.browserHuntMemorySession).toBeDefined();
        expect(mainModule.browserHuntMemorySession.session).toMatch(/^hunt-session-/);
      });

      expect(
        within(root).getByRole('heading', {
          name: 'Hunt Memory Safety Status',
        }),
      ).toBeInTheDocument();
      expect(
        within(root).queryByRole('heading', {
          name: 'Platinum Roadmap',
        }),
      ).not.toBeInTheDocument();
    } finally {
      if (capturedMainRoot) {
        await act(async () => {
          capturedMainRoot?.unmount();
        });
        capturedMainRoot = null;
      }
      root.remove();
      vi.resetModules();
    }
  });

  it('binds browserHuntMemorySession from main and routes into App with stable dependencies', () => {
    expect(browserHuntMemorySession.session.trim().length).toBeGreaterThan(0);
    expect(browserHuntMemorySession.keys.v2Key).toBe(DEFAULT_PROGRESS_V2_STORAGE_KEY);
    expect(browserHuntMemorySession.keys.v3Key).toBe(DEFAULT_PROGRESS_V3_STORAGE_KEY);
    expect(browserHuntMemorySession.keys.cutoverKey).toBe(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
    );

    const { container: v3Container, rerender, unmount } = render(
      <StrictMode>
        <App
          datasetResult={TEST_DATASET}
          huntMemorySession={browserHuntMemorySession}
        />
      </StrictMode>,
    );

    expect(
      within(v3Container).getByRole('heading', {
        name: 'Hunt Memory Safety Status',
      }),
    ).toBeInTheDocument();

    rerender(
      <StrictMode>
        <App
          datasetResult={TEST_DATASET}
          huntMemorySession={browserHuntMemorySession}
        />
      </StrictMode>,
    );
    expect(
      within(v3Container).queryByText(/Session Configuration Conflict/i),
    ).not.toBeInTheDocument();
    unmount();

    const { container: legacyContainer } = render(
      <App datasetResult={TEST_DATASET} />,
    );
    expect(
      within(legacyContainer).queryByRole('heading', {
        name: 'Hunt Memory Safety Status',
      }),
    ).not.toBeInTheDocument();
    expect(
      within(legacyContainer).getByRole('searchbox', {
        name: 'Search games',
      }),
    ).toBeInTheDocument();
  });

  it('mounts fresh storage in StrictMode with zero writes and commits on first explicit action', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const lockManager = new SimpleLockManager();
    const session = createBrowserHuntMemorySession({
      storage,
      lockManager,
      clock: defaultIsoUtcClock,
    });

    render(
      <StrictMode>
        <App datasetResult={TEST_DATASET} huntMemorySession={session} />
      </StrictMode>,
    );

    expect(storage.writeCount).toBe(0);
    expect(storage.getItem(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBeNull();
    expect(screen.getByText(/Workspace not initialized/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Open workspace/i }));

    expect(storage.writeCount).toBeGreaterThan(0);
    expect(screen.queryByText(/Workspace not initialized/i)).not.toBeInTheDocument();
    const cutoverRaw = storage.getItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);
    expect(cutoverRaw).not.toBeNull();
    expect(JSON.parse(cutoverRaw!)).toMatchObject({
      recordVersion: 1,
      source: 'fresh',
    });
    expect(storage.getItem(DEFAULT_PROGRESS_V3_STORAGE_KEY)).not.toBeNull();
  });

  it('renders V2 preview with zero mount writes and upgrades deliberately preserving V2', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const lockManager = new SimpleLockManager();
    const rawV2 = JSON.stringify({ schemaVersion: '2.0', gameProgress: {} });
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const session = createBrowserHuntMemorySession({
      storage,
      lockManager,
      clock: defaultIsoUtcClock,
    });

    render(
      <StrictMode>
        <App datasetResult={TEST_DATASET} huntMemorySession={session} />
      </StrictMode>,
    );

    expect(storage.writeCount).toBe(0);
    expect(
      screen.getByText(/Earlier Version Progress Detected/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Upgrade progress/i }));

    const cutoverRaw = storage.getItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);
    expect(cutoverRaw).not.toBeNull();
    expect(JSON.parse(cutoverRaw!)).toMatchObject({
      recordVersion: 1,
      source: 'migrated-v2',
      rawV2,
    });
    expect(storage.getItem(DEFAULT_PROGRESS_V3_STORAGE_KEY)).not.toBeNull();
    expect(storage.getItem(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(rawV2);
  });

  it('reloads ready V3 store with zero mount writes and restores persisted run state', () => {
    const storage = new MemoryStorage();
    const lockManager = new SimpleLockManager();
    const v3Store = createTestV3Store();
    const customRunName = 'Orbital Velocity Speedrun';
    const runResult = createRun(
      v3Store,
      mockGameStellarDrift,
      'stellar-drift-ps',
      'stellar-speedrun-1',
      customRunName,
      MOCK_TIMESTAMP,
    );
    expect(runResult.success).toBe(true);
    const storeToSeed = runResult.success ? runResult.store : v3Store;

    storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, JSON.stringify(storeToSeed));
    storage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
    );

    const session = createBrowserHuntMemorySession({
      storage,
      lockManager,
      clock: defaultIsoUtcClock,
    });

    render(
      <StrictMode>
        <App datasetResult={TEST_DATASET} huntMemorySession={session} />
      </StrictMode>,
    );

    expect(storage.writeCount).toBe(0);
    expect(
      screen.getByRole('heading', { name: 'Stellar Drift' }),
    ).toBeInTheDocument();
    expect(screen.getByText(customRunName)).toBeInTheDocument();
  });

  it('fails closed to view-only without fallback writes when storage or lock manager is unavailable', () => {
    const sessionNoStorage = createBrowserHuntMemorySession({
      storage: null,
      lockManager: new SimpleLockManager(),
    });

    const { container: noStorageContainer, unmount } = render(
      <StrictMode>
        <App datasetResult={TEST_DATASET} huntMemorySession={sessionNoStorage} />
      </StrictMode>,
    );

    expect(
      within(noStorageContainer).getByText(
        'Browser storage is unavailable. Progress cannot be inspected or saved.',
      ),
    ).toBeInTheDocument();
    expect(
      within(noStorageContainer).getByRole('heading', {
        name: 'Hunt Memory Safety Status',
      }),
    ).toBeInTheDocument();
    expect(
      within(noStorageContainer).queryByRole('heading', {
        name: 'Platinum Roadmap',
      }),
    ).not.toBeInTheDocument();
    unmount();

    const freshStorage = new MemoryStorage();
    const sessionNoLock = createBrowserHuntMemorySession({
      storage: freshStorage,
      lockManager: null,
    });

    const { container: noLockContainer } = render(
      <StrictMode>
        <App datasetResult={TEST_DATASET} huntMemorySession={sessionNoLock} />
      </StrictMode>,
    );

    expect(
      within(noLockContainer).getByText(
        'Storage coordination is unavailable in this browser environment. Saving is disabled to prevent data corruption.',
      ),
    ).toBeInTheDocument();
    expect(freshStorage.writeCount).toBe(0);
    expect(
      within(noLockContainer).getByRole('heading', {
        name: 'Hunt Memory Safety Status',
      }),
    ).toBeInTheDocument();
    expect(
      within(noLockContainer).queryByRole('heading', {
        name: 'Platinum Roadmap',
      }),
    ).not.toBeInTheDocument();
  });

  it('delegates unchanged raw content to session download on explicit export click', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const lockManager = new SimpleLockManager();
    const v3Store = createTestV3Store();
    const rawV3 = JSON.stringify(v3Store);
    storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
    storage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
    );

    const downloadSpy = vi.fn();
    const session = createBrowserHuntMemorySession({
      storage,
      lockManager,
      download: downloadSpy,
      clock: defaultIsoUtcClock,
    });

    const defaultFactorySession = createBrowserHuntMemorySession();
    expect(defaultFactorySession.download).toBe(defaultRawDownload);

    render(
      <StrictMode>
        <App datasetResult={TEST_DATASET} huntMemorySession={session} />
      </StrictMode>,
    );

    expect(downloadSpy).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: /Export Raw V3 progress/i }),
    );
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).toHaveBeenCalledWith(
      'trophy-oracle-progress-v3.json',
      rawV3,
    );
  });
});
