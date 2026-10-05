import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import appSource from '../../App.tsx?raw';
import { GameRecordSchema, type GameRecord } from '../../domain/achievement-schema';
import {
  LocalProgressStoreV3Schema, ProgressUndoSnapshotV3Schema,
  type LocalProgressStoreV3, type ProgressUndoSnapshotV3,
} from '../../domain/hunt-memory-schema';
import {
  DEFAULT_HUNT_MEMORY_RUN_ID, createDefaultAchievementProgressV3,
  createDefaultGameProgressV3, createDefaultHuntMemoryStore, createDefaultRunProgress,
} from '../../domain/hunt-memory-lifecycle';
import { selectActiveWorkspaceV3 } from '../../domain/hunt-memory-view';
import { validateTrackerShape } from '../../domain/hunt-memory-tracker-shape';
import {
  MOCK_TIMESTAMP, MOCK_TIMESTAMP_2,
  mockGameMythHarbor, mockGameStellarDrift,
} from '../../test/progress-fixtures';
import { HuntMemoryTracker, type HuntMemoryTrackerProps } from './HuntMemoryTracker';
import type { HuntMemoryActionResult } from './use-hunt-memory-store';

const [psSet, steamSet] = mockGameStellarDrift.achievementSets;
const binaryStory = psSet.achievements[0];
const binaryMissable = psSet.achievements[1];
const counterAch = psSet.achievements[2];
const checklistAch = psSet.achievements[3];

const multiContextGame: GameRecord = {
  ...mockGameStellarDrift,
  achievementSets: [
    {
      ...psSet,
      id: 'set-alpha',
      achievements: [
        { ...binaryStory, id: 'shared-ach', name: 'Shared Achievement Alpha' },
        { ...counterAch, id: 'shared-counter', name: 'Counter Achievement Alpha' },
        { ...checklistAch, id: 'shared-checklist', name: 'Checklist Achievement' },
      ],
    },
    {
      ...steamSet,
      id: 'set-beta',
      achievements: [
        { ...binaryStory, id: 'shared-ach', name: 'Shared Achievement Beta', reward: { type: 'achievement' } },
        { ...counterAch, id: 'shared-counter', name: 'Counter Achievement Beta', reward: { type: 'achievement' } },
      ],
    },
  ],
};

const [mhSet] = mockGameMythHarbor.achievementSets;
const multiContextGameB: GameRecord = {
  ...mockGameMythHarbor,
  achievementSets: [{
    ...mhSet,
    id: 'set-beta',
    achievements: [
      { ...binaryStory, id: 'shared-ach', name: 'Shared Achievement Gamma' },
      { ...counterAch, id: 'shared-counter', name: 'Counter Achievement Gamma' },
    ],
  }],
};

function createBaseStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.gameProgress[mockGameStellarDrift.id] = createDefaultGameProgressV3(mockGameStellarDrift, MOCK_TIMESTAMP);
  return store;
}

function createSuccessResult(store: LocalProgressStoreV3): HuntMemoryActionResult {
  return { status: 'success', store };
}

function createDefaultProps(overrides: Partial<HuntMemoryTrackerProps> = {}): HuntMemoryTrackerProps {
  const store = overrides.store ?? createBaseStore();
  return {
    game: mockGameStellarDrift,
    selectedSetId: psSet.id,
    store,
    getTimestamp: vi.fn(() => MOCK_TIMESTAMP_2),
    onBinaryCompletionChange: vi.fn().mockResolvedValue(createSuccessResult(store)),
    onCounterProgressChange: vi.fn().mockResolvedValue(createSuccessResult(store)),
    onChecklistItemCompletionChange: vi.fn().mockResolvedValue(createSuccessResult(store)),
    onNotesChange: vi.fn().mockResolvedValue(createSuccessResult(store)),
    onCompletionOverrideChange: vi.fn().mockResolvedValue(createSuccessResult(store)),
    onTogglePin: vi.fn().mockResolvedValue(createSuccessResult(store)),
    onUndo: vi.fn().mockResolvedValue(createSuccessResult(store)),
    ...overrides,
  };
}

describe('HuntMemoryTracker', () => {
  it('renders matching active run context, source order, duplicate run names and forwards exact context', async () => {
    const user = userEvent.setup();
    const store = createDefaultHuntMemoryStore();
    store.gameProgress[multiContextGame.id] = createDefaultGameProgressV3(multiContextGame, MOCK_TIMESTAMP);
    const setAlpha = store.gameProgress[multiContextGame.id].sets['set-alpha'];
    setAlpha.runs['run-a'] = createDefaultRunProgress(multiContextGame.achievementSets[0], 'run-a', 'Main Run', MOCK_TIMESTAMP);
    setAlpha.runs['run-b'] = createDefaultRunProgress(multiContextGame.achievementSets[0], 'run-b', 'Main Run', MOCK_TIMESTAMP);
    setAlpha.activeRunId = 'run-a';

    setAlpha.runs['run-a'].pinnedAchievementIds = ['shared-ach'];
    setAlpha.runs['run-a'].progress['shared-ach'].completed = true;
    setAlpha.runs['run-a'].progress['shared-counter'].counter = { certainty: 'exact', value: 12 };
    setAlpha.runs['run-a'].progress['shared-checklist'].checklistCompletion = { 'task-a': true, 'task-b': false, 'task-c': false };

    expect(GameRecordSchema.safeParse(multiContextGame).success).toBe(true);
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);

    const snapshotGame = structuredClone(multiContextGame);
    const snapshotStore = structuredClone(store);
    const props = createDefaultProps({ game: multiContextGame, selectedSetId: 'set-alpha', store });
    const { rerender } = render(<HuntMemoryTracker {...props} />);

    expect(screen.getByRole('heading', { name: 'Achievement Trackers (3)' })).toBeInTheDocument();
    expect(screen.getByText(/PlayStation \(Standard Edition\) \/ Run: Main Run/)).toBeInTheDocument();

    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(['Achievement 1', 'Achievement 2', 'Achievement 3']);

    expect(screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' })).toBeChecked();
    expect(screen.getByText(/Progress: 12 \/ 48/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 3' }));
    expect(screen.getByRole('checkbox', { name: 'Task A for Checklist Achievement' })).toBeChecked();

    const pinBtn = screen.getByRole('button', { name: 'Unpin Achievement 1' });
    await user.click(pinBtn);
    expect(props.onTogglePin).toHaveBeenCalledWith(
      { gameId: multiContextGame.id, setId: 'set-alpha', runId: 'run-a' },
      'shared-ach',
      false,
    );

    const runBStore = structuredClone(store);
    runBStore.gameProgress[multiContextGame.id].sets['set-alpha'].activeRunId = 'run-b';
    rerender(<HuntMemoryTracker {...props} store={runBStore} />);
    expect(screen.getByText(/PlayStation \(Standard Edition\) \/ Run: Main Run/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin Achievement 1' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' })).not.toBeChecked();

    rerender(<HuntMemoryTracker {...props} selectedSetId="set-beta" store={store} />);
    expect(screen.getByRole('heading', { name: 'Achievement Trackers (2)' })).toBeInTheDocument();
    expect(screen.getByText(/Steam \(Standard Edition\) \/ Run: Main Run/)).toBeInTheDocument();
    const betaCompleteBox = screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' });
    expect(betaCompleteBox).not.toBeChecked();
    await user.click(betaCompleteBox);
    expect(props.onBinaryCompletionChange).toHaveBeenCalledWith(
      { gameId: multiContextGame.id, setId: 'set-beta', runId: DEFAULT_HUNT_MEMORY_RUN_ID },
      'shared-ach',
      true,
    );

    expect(multiContextGame).toEqual(snapshotGame);
    expect(store).toEqual(snapshotStore);
  });

  it('fails closed on all five workspace unavailable reasons and per-achievement missing or incompatible progress', () => {
    const reasons: Array<[string, (store: LocalProgressStoreV3) => void, boolean]> = [
      ['GAME_NOT_FOUND', (s) => delete s.gameProgress[mockGameStellarDrift.id], true],
      ['SET_NOT_FOUND', (s) => delete s.gameProgress[mockGameStellarDrift.id].sets[psSet.id], true],
      ['SET_RETIRED', (s) => {
        const sets = s.gameProgress[mockGameStellarDrift.id].sets;
        s.gameProgress[mockGameStellarDrift.id].retiredSets[psSet.id] = { ...sets[psSet.id], retirementReason: 'removed_set' };
        delete sets[psSet.id];
      }, true],
      ['SET_VERSION_MISMATCH', (s) => {
        s.gameProgress[mockGameStellarDrift.id].sets[psSet.id].version = '9999.01';
      }, true],
      ['RUN_NOT_FOUND', (s) => {
        s.gameProgress[mockGameStellarDrift.id].sets[psSet.id].activeRunId = 'missing-run';
      }, false],
    ];

    for (const [, mutate, schemaValid] of reasons) {
      cleanup();
      const store = createBaseStore();
      mutate(store);
      expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(schemaValid);
      const ws = selectActiveWorkspaceV3(mockGameStellarDrift, psSet.id, store);
      if (ws.status !== 'unavailable') throw new Error('Expected unavailable workspace');
      const props = createDefaultProps({ store });
      render(<HuntMemoryTracker {...props} />);
      expect(screen.getByRole('status')).toHaveTextContent(ws.message);
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('spinbutton')).toBeNull();
      expect(screen.queryByRole('button', { name: /(Pin|Apply|Save|Override)/ })).toBeNull();
    }

    cleanup();
    const missingProgStore = createBaseStore();
    delete missingProgStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs[DEFAULT_HUNT_MEMORY_RUN_ID].progress[binaryStory.id];
    render(<HuntMemoryTracker {...createDefaultProps({ store: missingProgStore })} />);
    expect(screen.getByText('Progress is unavailable for Achievement 1. Saved data has not been changed.')).toBeInTheDocument();

    cleanup();
    const incompatibleProgStore = createBaseStore();
    const activeRun = incompatibleProgStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs[DEFAULT_HUNT_MEMORY_RUN_ID];
    activeRun.progress[binaryStory.id] = { ...activeRun.progress[binaryStory.id], counter: { certainty: 'exact', value: 1 } };
    expect(LocalProgressStoreV3Schema.safeParse(incompatibleProgStore).success).toBe(true);
    expect(validateTrackerShape(activeRun.progress[binaryStory.id], binaryStory.tracking)).toBe(false);
    render(<HuntMemoryTracker {...createDefaultProps({ store: incompatibleProgStore })} />);
    expect(screen.getByText('Progress is unavailable for Achievement 1. Saved data has not been changed.')).toBeInTheDocument();
  });

  it('rejects inherited progress and checklist items while keeping own prototype-named IDs functional', async () => {
    const user = userEvent.setup();
    const store = createBaseStore();
    const activeRun = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs[DEFAULT_HUNT_MEMORY_RUN_ID];

    const inheritedRecord = createDefaultAchievementProgressV3(binaryStory, MOCK_TIMESTAMP);
    const progressProto = { [binaryStory.id]: inheritedRecord };
    const progressWithInheritance = Object.create(progressProto);
    for (const ach of psSet.achievements) {
      if (ach.id !== binaryStory.id) progressWithInheritance[ach.id] = activeRun.progress[ach.id];
    }
    activeRun.progress = progressWithInheritance;

    const malformedChecklistProto = { 'task-b': true, 'stale-id': true };
    const malformedChecklist = Object.create(malformedChecklistProto);
    malformedChecklist['task-a'] = true;
    malformedChecklist['task-c'] = false;
    activeRun.progress[checklistAch.id].checklistCompletion = malformedChecklist;

    expect(validateTrackerShape(activeRun.progress[checklistAch.id], checklistAch.tracking)).toBe(false);
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);

    const customGame: GameRecord = {
      ...mockGameStellarDrift,
      achievementSets: [{
        ...psSet,
        achievements: [...psSet.achievements, { ...binaryStory, id: 'toString', name: 'Valid Prototype Named ID' }],
      }],
    };
    expect(GameRecordSchema.safeParse(customGame).success).toBe(true);

    activeRun.progress['toString'] = {
      ...createDefaultAchievementProgressV3(binaryStory, MOCK_TIMESTAMP),
      achievementId: 'toString',
      completed: true,
    };

    const props = createDefaultProps({ game: customGame, store });
    render(<HuntMemoryTracker {...props} />);

    expect(screen.getByText('Progress is unavailable for Achievement 1. Saved data has not been changed.')).toBeInTheDocument();
    expect(screen.getByText('Progress is unavailable for Achievement 4. Saved data has not been changed.')).toBeInTheDocument();

    const protoCheckbox = screen.getByRole('checkbox', { name: 'Mark Achievement 7 complete' });
    expect(protoCheckbox).toBeChecked();
    await user.click(protoCheckbox);
    expect(props.onBinaryCompletionChange).toHaveBeenCalledWith(
      { gameId: mockGameStellarDrift.id, setId: psSet.id, runId: DEFAULT_HUNT_MEMORY_RUN_ID },
      'toString',
      false,
    );
  });

  it('forwards all six callback payloads exactly and preserves controlled parent acknowledgement', async () => {
    const user = userEvent.setup();
    const initialStore = createBaseStore();
    const frozenInitialStore = structuredClone(initialStore);

    function ControlledHarness(testProps: Partial<HuntMemoryTrackerProps>) {
      const [currentStore, setCurrentStore] = useState(initialStore);
      return (
        <HuntMemoryTracker
          {...createDefaultProps({
            ...testProps,
            store: currentStore,
            onBinaryCompletionChange: async (ctx, achId, comp) => {
              const res = await testProps.onBinaryCompletionChange!(ctx, achId, comp);
              if (res.status === 'success') {
                const next = structuredClone(currentStore);
                next.gameProgress[ctx.gameId].sets[ctx.setId].runs[ctx.runId].progress[achId].completed = comp;
                setCurrentStore(next);
              }
              return res;
            },
          })}
        />
      );
    }

    let resolveBinary!: (res: HuntMemoryActionResult) => void;
    const binaryPromise = new Promise<HuntMemoryActionResult>((res) => { resolveBinary = res; });
    const onBinaryCompletionChange = vi.fn().mockImplementation(() => binaryPromise);
    const onNotesChange = vi.fn().mockResolvedValue({ status: 'failure', code: 'REJECT', message: 'Notes rejected' });
    const onTogglePin = vi.fn().mockResolvedValue({ status: 'no-op', store: initialStore });

    const props = createDefaultProps({ onBinaryCompletionChange, onNotesChange, onTogglePin });
    render(<ControlledHarness {...props} />);

    const defaultCtx = { gameId: mockGameStellarDrift.id, setId: psSet.id, runId: DEFAULT_HUNT_MEMORY_RUN_ID };

    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 1' }));
    const binaryBox = screen.getByRole('checkbox', { name: `Mark ${binaryStory.name} complete` });
    await user.click(binaryBox);
    expect(onBinaryCompletionChange).toHaveBeenCalledWith(defaultCtx, binaryStory.id, true);
    expect(binaryBox).not.toBeChecked();

    await act(async () => { resolveBinary(createSuccessResult(initialStore)); });
    expect(binaryBox).toBeChecked();
    expect(initialStore).toEqual(frozenInitialStore);

    const pinBtn = screen.getByRole('button', { name: `Pin ${binaryStory.name}` });
    await user.click(pinBtn);
    expect(onTogglePin).toHaveBeenCalledWith(defaultCtx, binaryStory.id, true);
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: `Reveal details for Achievement 3` }));
    await user.selectOptions(screen.getByRole('combobox', { name: `Certainty for ${counterAch.name}` }), 'exact');
    const counterInput = screen.getByRole('spinbutton', { name: `Set counter for ${counterAch.name}` });
    await user.clear(counterInput);
    await user.type(counterInput, '25');
    await user.click(screen.getByRole('button', { name: `Apply counter for ${counterAch.name}` }));
    expect(props.onCounterProgressChange).toHaveBeenCalledWith(defaultCtx, counterAch.id, { certainty: 'exact', value: 25 });

    await user.selectOptions(screen.getByRole('combobox', { name: `Certainty for ${counterAch.name}` }), 'unknown');
    await user.click(screen.getByRole('button', { name: `Apply counter for ${counterAch.name}` }));
    expect(props.onCounterProgressChange).toHaveBeenCalledWith(defaultCtx, counterAch.id, { certainty: 'unknown', observedSinceStart: 0, trackingStartedAt: MOCK_TIMESTAMP_2 });

    await user.click(screen.getByRole('button', { name: `Reveal details for Achievement 4` }));
    await user.click(screen.getByRole('checkbox', { name: `Task A for ${checklistAch.name}` }));
    expect(props.onChecklistItemCompletionChange).toHaveBeenCalledWith(defaultCtx, checklistAch.id, 'task-a', true);

    const notesInput = screen.getByRole('textbox', { name: `Manual notes for ${binaryStory.name}` });
    await user.type(notesInput, '  padded text  ');
    await user.click(screen.getByRole('button', { name: `Save notes for ${binaryStory.name}` }));
    expect(onNotesChange).toHaveBeenCalledWith(defaultCtx, binaryStory.id, '  padded text  ');
    expect(notesInput).toHaveValue('  padded text  ');
    expect(screen.getByRole('alert')).toHaveTextContent('Notes rejected');

    await user.click(screen.getByRole('button', { name: `Clear notes for ${binaryStory.name}` }));
    expect(onNotesChange).toHaveBeenCalledWith(defaultCtx, binaryStory.id, undefined);

    await user.click(screen.getByRole('button', { name: `Override completion for ${counterAch.name}` }));
    await user.click(screen.getByRole('button', { name: `Confirm completion override for ${counterAch.name}` }));
    expect(props.onCompletionOverrideChange).toHaveBeenCalledWith(defaultCtx, counterAch.id, true);
  });

  it('resets drafts across identity changes, preserves same-context drafts, and isolates awaited results', async () => {
    const user = userEvent.setup();
    const store = createDefaultHuntMemoryStore();
    store.gameProgress[multiContextGame.id] = createDefaultGameProgressV3(multiContextGame, MOCK_TIMESTAMP);
    const setAlpha = store.gameProgress[multiContextGame.id].sets['set-alpha'];
    const setBeta = store.gameProgress[multiContextGame.id].sets['set-beta'];
    setAlpha.runs['run-a'] = createDefaultRunProgress(multiContextGame.achievementSets[0], 'run-a', 'First Run', MOCK_TIMESTAMP);
    setAlpha.runs['run-b'] = createDefaultRunProgress(multiContextGame.achievementSets[0], 'run-b', 'Second Run', MOCK_TIMESTAMP);
    setBeta.runs['run-b'] = createDefaultRunProgress(multiContextGame.achievementSets[1], 'run-b', 'Beta Run', MOCK_TIMESTAMP);
    setAlpha.activeRunId = 'run-a';
    setBeta.activeRunId = 'run-b';
    setAlpha.runs['run-a'].progress['shared-counter'].counter = { certainty: 'exact', value: 10 };
    setAlpha.runs['run-b'].progress['shared-counter'].counter = { certainty: 'exact', value: 20 };
    setBeta.runs['run-b'].progress['shared-counter'].counter = { certainty: 'exact', value: 5 };

    const gameBStore = createDefaultHuntMemoryStore();
    gameBStore.gameProgress[multiContextGameB.id] = createDefaultGameProgressV3(multiContextGameB, MOCK_TIMESTAMP);
    const gameBSetBeta = gameBStore.gameProgress[multiContextGameB.id].sets['set-beta'];
    gameBSetBeta.runs['run-b'] = createDefaultRunProgress(multiContextGameB.achievementSets[0], 'run-b', 'Gamma Run', MOCK_TIMESTAMP);
    gameBSetBeta.runs['run-b'].progress['shared-counter'].counter = { certainty: 'exact', value: 30 };
    gameBSetBeta.activeRunId = 'run-b';

    expect(GameRecordSchema.safeParse(multiContextGame).success).toBe(true);
    expect(GameRecordSchema.safeParse(multiContextGameB).success).toBe(true);
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
    expect(LocalProgressStoreV3Schema.safeParse(gameBStore).success).toBe(true);

    let resolveAction!: (res: HuntMemoryActionResult) => void;
    const deferredPromise = new Promise<HuntMemoryActionResult>((res) => { resolveAction = res; });
    const onNotesChange = vi.fn().mockImplementation(() => deferredPromise);
    const props = createDefaultProps({ game: multiContextGame, selectedSetId: 'set-alpha', store, onNotesChange });
    const { rerender } = render(<HuntMemoryTracker {...props} />);

    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 2' }));
    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 1' }));
    expect(screen.getByRole('heading', { level: 4, name: 'Counter Achievement Alpha' })).toBeInTheDocument();

    const notesInput = screen.getByRole('textbox', { name: 'Manual notes for Shared Achievement Alpha' });
    const counterInput = screen.getByRole('spinbutton', { name: 'Set counter for Counter Achievement Alpha' });
    await user.type(notesInput, 'Draft note text');
    await user.clear(counterInput);
    await user.type(counterInput, '42');

    rerender(<HuntMemoryTracker {...props} store={structuredClone(store)} />);
    expect(screen.getByRole('textbox', { name: 'Manual notes for Shared Achievement Alpha' })).toHaveValue('Draft note text');
    expect(screen.getByRole('spinbutton', { name: 'Set counter for Counter Achievement Alpha' })).toHaveValue(42);

    const storeWithMissingAch = structuredClone(store);
    delete storeWithMissingAch.gameProgress[multiContextGame.id].sets['set-alpha'].runs['run-a'].progress['shared-ach'];
    rerender(<HuntMemoryTracker {...props} store={storeWithMissingAch} />);
    expect(screen.getByText('Progress is unavailable for Shared Achievement Alpha. Saved data has not been changed.')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Set counter for Counter Achievement Alpha' })).toHaveValue(42);

    rerender(<HuntMemoryTracker {...props} store={structuredClone(store)} />);
    expect(screen.getByRole('textbox', { name: 'Manual notes for Shared Achievement Alpha' })).toHaveValue('Draft note text');
    expect(screen.getByRole('spinbutton', { name: 'Set counter for Counter Achievement Alpha' })).toHaveValue(42);

    await user.click(screen.getByRole('button', { name: 'Save notes for Shared Achievement Alpha' }));
    expect(onNotesChange).toHaveBeenCalledWith(
      { gameId: multiContextGame.id, setId: 'set-alpha', runId: 'run-a' },
      'shared-ach',
      'Draft note text',
    );

    // 1. RUN ONLY: hold gameId & setId fixed; change runId from run-a to run-b
    const runBStore = structuredClone(store);
    runBStore.gameProgress[multiContextGame.id].sets['set-alpha'].activeRunId = 'run-b';
    rerender(<HuntMemoryTracker {...props} store={runBStore} />);
    expect(screen.getByRole('button', { name: 'Reveal details for Achievement 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hide details/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 1' }));
    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 2' }));
    const runBNotesInput = screen.getByRole('textbox', { name: 'Manual notes for Shared Achievement Alpha' });
    const runBCounterInput = screen.getByRole('spinbutton', { name: 'Set counter for Counter Achievement Alpha' });
    expect(runBNotesInput).toHaveValue('');
    expect(runBCounterInput).toHaveValue(20);

    await user.type(runBNotesInput, 'Run B distinct draft');
    await user.clear(runBCounterInput);
    await user.type(runBCounterInput, '55');

    await act(async () => { resolveAction({ status: 'no-op', store }); });
    expect(runBNotesInput).toHaveValue('Run B distinct draft');
    expect(runBCounterInput).toHaveValue(55);

    // 2. SET ONLY: hold gameId & runId fixed; change setId from set-alpha to set-beta
    rerender(<HuntMemoryTracker {...props} selectedSetId="set-beta" store={runBStore} />);
    expect(screen.getByRole('button', { name: 'Reveal details for Achievement 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hide details/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 1' }));
    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 2' }));
    const setBetaNotesInput = screen.getByRole('textbox', { name: 'Manual notes for Shared Achievement Beta' });
    const setBetaCounterInput = screen.getByRole('spinbutton', { name: 'Set counter for Counter Achievement Beta' });
    expect(setBetaNotesInput).toHaveValue('');
    expect(setBetaCounterInput).toHaveValue(5);

    await user.type(setBetaNotesInput, 'Set Beta distinct draft');
    await user.clear(setBetaCounterInput);
    await user.type(setBetaCounterInput, '66');

    // 3. GAME ONLY: hold setId & runId fixed; change gameId to multiContextGameB
    rerender(<HuntMemoryTracker {...props} game={multiContextGameB} selectedSetId="set-beta" store={gameBStore} />);
    expect(screen.getByRole('button', { name: 'Reveal details for Achievement 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hide details/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 1' }));
    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 2' }));
    const gameBNotesInput = screen.getByRole('textbox', { name: 'Manual notes for Shared Achievement Gamma' });
    const gameBCounterInput = screen.getByRole('spinbutton', { name: 'Set counter for Counter Achievement Gamma' });
    expect(gameBNotesInput).toHaveValue('');
    expect(gameBCounterInput).toHaveValue(30);
  });

  it('handles game-scoped Undo routing, eligibility checks, latching, lifetime A-B-A isolation and feedback', async () => {
    const store = createBaseStore();
    const steamSnapshot: ProgressUndoSnapshotV3 = {
      setId: steamSet.id,
      runId: DEFAULT_HUNT_MEMORY_RUN_ID,
      guardedSetVersion: steamSet.version,
      previous: createDefaultRunProgress(steamSet, DEFAULT_HUNT_MEMORY_RUN_ID, 'Main Run', MOCK_TIMESTAMP),
    };
    store.undoState = { [mockGameStellarDrift.id]: steamSnapshot };
    expect(ProgressUndoSnapshotV3Schema.safeParse(steamSnapshot).success).toBe(true);

    let resolveUndoA1!: (res: HuntMemoryActionResult) => void, resolveUndoA2!: (res: HuntMemoryActionResult) => void;
    const undoPromiseA1 = new Promise<HuntMemoryActionResult>((res) => { resolveUndoA1 = res; });
    const undoPromiseA2 = new Promise<HuntMemoryActionResult>((res) => { resolveUndoA2 = res; });
    const onUndo = vi.fn().mockImplementationOnce(() => undoPromiseA1).mockImplementationOnce(() => undoPromiseA2);

    const props = createDefaultProps({ store, onUndo });
    const { rerender } = render(<HuntMemoryTracker {...props} />);

    const undoBtn = screen.getByRole('button', {
      name: 'Undo last change in Steam (Standard Edition) (Main Run)',
    });
    expect(undoBtn).toBeInTheDocument();

    act(() => { undoBtn.click(); undoBtn.click(); });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith(mockGameStellarDrift.id, steamSnapshot);

    const storeWithRunTwo = structuredClone(store);
    storeWithRunTwo.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['run-two'] = createDefaultRunProgress(psSet, 'run-two', 'Run Two', MOCK_TIMESTAMP);
    storeWithRunTwo.gameProgress[mockGameStellarDrift.id].sets[psSet.id].activeRunId = 'run-two';
    rerender(<HuntMemoryTracker {...props} store={storeWithRunTwo} />);
    expect(screen.getByRole('button', { name: /Undo last change/ })).toBeDisabled();

    rerender(<HuntMemoryTracker {...props} selectedSetId={steamSet.id} store={storeWithRunTwo} />);
    expect(screen.getByRole('button', { name: /Undo last change/ })).toBeDisabled();

    const gameBStore = createDefaultHuntMemoryStore();
    gameBStore.gameProgress[mockGameMythHarbor.id] = createDefaultGameProgressV3(mockGameMythHarbor, MOCK_TIMESTAMP);
    expect(selectActiveWorkspaceV3(mockGameMythHarbor, mockGameMythHarbor.achievementSets[0].id, gameBStore).status).toBe('ready');
    rerender(<HuntMemoryTracker {...props} game={mockGameMythHarbor} selectedSetId={mockGameMythHarbor.achievementSets[0].id} store={gameBStore} />);
    expect(screen.queryByRole('button', { name: /Undo last change/ })).toBeNull();

    rerender(<HuntMemoryTracker {...props} game={mockGameStellarDrift} selectedSetId={psSet.id} store={store} />);
    const returnUndoBtn = screen.getByRole('button', { name: /Undo last change/ });
    expect(returnUndoBtn).not.toBeDisabled();

    act(() => { returnUndoBtn.click(); });
    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(returnUndoBtn).toBeDisabled();

    await act(async () => { resolveUndoA1({ status: 'failure', code: 'OLD', message: 'Old failure message' }); });
    expect(returnUndoBtn).toBeDisabled();
    expect(screen.queryByText(/Old failure message/)).toBeNull();

    await act(async () => { resolveUndoA2({ status: 'recovery-required', reason: 'DESYNC', message: 'State desynchronized' }); });
    expect(returnUndoBtn).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Undo could not be confirmed: State desynchronized');

    for (const [res, expectAlert] of [
      [Promise.reject(new Error('Network offline')), 'Undo could not be confirmed: Network offline'],
      [Promise.resolve({ status: 'no-op', store }), null],
      [Promise.resolve(createSuccessResult(store)), null],
    ] as const) {
      onUndo.mockImplementationOnce(() => res);
      await act(async () => { returnUndoBtn.click(); });
      if (expectAlert) {
        expect(screen.getByRole('alert')).toHaveTextContent(expectAlert);
      } else {
        expect(screen.queryByRole('alert')).toBeNull();
      }
    }

    const ineligibleCases: Array<{
      mutate: (s: LocalProgressStoreV3, snap: ProgressUndoSnapshotV3) => void;
      reason: string;
      override?: Partial<HuntMemoryTrackerProps>;
      invalidSchema?: boolean;
    }> = [
      { mutate: (_s, sn) => { sn.setId = 'missing-set-id'; }, reason: "Target set 'missing-set-id' does not exist in game definition." },
      { mutate: (s, sn) => {
        const sets = s.gameProgress[mockGameStellarDrift.id].sets;
        s.gameProgress[mockGameStellarDrift.id].retiredSets[sn.setId] = { ...sets[sn.setId], retirementReason: 'removed_set' };
        delete sets[sn.setId];
      }, reason: `Target set '${steamSet.id}' is retired.` },
      { mutate: (s, sn) => { delete s.gameProgress[mockGameStellarDrift.id].sets[sn.setId]; }, reason: `Target set '${steamSet.id}' does not exist in active sets.` },
      { mutate: (s, sn) => {
        const psProg = s.gameProgress[mockGameStellarDrift.id].sets[psSet.id];
        const steamProg = s.gameProgress[mockGameStellarDrift.id].sets[sn.setId];
        s.gameProgress[mockGameStellarDrift.id].sets = Object.assign(Object.create({ [sn.setId]: steamProg }), { [psSet.id]: psProg });
      }, reason: `Target set '${steamSet.id}' does not exist in active sets.` },
      { mutate: (s, sn) => { s.gameProgress[mockGameStellarDrift.id].sets[sn.setId].version = '9999.01'; }, reason: `Target set '${steamSet.id}' version mismatch: stored '9999.01', expected '${steamSet.version}'.` },
      { mutate: (_s, sn) => { sn.guardedSetVersion = '8888.01'; }, reason: `Target set '${steamSet.id}' version mismatch: current '${steamSet.version}', guarded '8888.01'.` },
      { mutate: (s, sn) => { delete s.gameProgress[mockGameStellarDrift.id].sets[sn.setId].runs[sn.runId]; }, reason: `Target run '${DEFAULT_HUNT_MEMORY_RUN_ID}' does not exist in set '${steamSet.id}'.` },
      { mutate: (_s, sn) => { sn.previous = { ...sn.previous, runId: 'mismatched-run-id' }; }, reason: 'Undo snapshot contains an invalid previous run identity.', invalidSchema: true },
      { mutate: (s) => { delete s.gameProgress[mockGameStellarDrift.id].sets[psSet.id]; }, reason: 'Undo is disabled because the selected workspace is unavailable.' },
      { mutate: () => {}, override: { isUndoDisabled: true, undoDisabledReason: 'Undo explicitly disabled.' }, reason: 'Undo explicitly disabled.' },
    ];

    onUndo.mockClear();
    for (const testCase of ineligibleCases) {
      const caseStore = createBaseStore();
      const caseSnapshot = structuredClone(steamSnapshot);
      caseStore.undoState = { [mockGameStellarDrift.id]: caseSnapshot };
      testCase.mutate(caseStore, caseSnapshot);

      if (testCase.invalidSchema) {
        expect(ProgressUndoSnapshotV3Schema.safeParse(caseSnapshot).success).toBe(false);
      }

      rerender(<HuntMemoryTracker {...props} store={caseStore} {...testCase.override} />);
      const btn = screen.getByRole('button', { name: /Undo last change/ });
      expect(btn).toBeDisabled();
      btn.click();
      expect(onUndo).toHaveBeenCalledTimes(0);
      const reasonEl = screen.getByText(testCase.reason);
      expect(btn).toHaveAttribute('aria-describedby', expect.stringContaining(reasonEl.id));
    }

    rerender(<HuntMemoryTracker {...props} store={createBaseStore()} isUndoDisabled={false} />);
    expect(screen.queryByRole('button', { name: /Undo last change/ })).toBeNull();
  });

  it('enforces read-only and busy posture separately, keeps reveal usable, and isolates instances', async () => {
    const user = userEvent.setup();
    const store = createBaseStore();
    const steamSnapshot: ProgressUndoSnapshotV3 = {
      setId: steamSet.id,
      runId: DEFAULT_HUNT_MEMORY_RUN_ID,
      guardedSetVersion: steamSet.version,
      previous: createDefaultRunProgress(steamSet, DEFAULT_HUNT_MEMORY_RUN_ID, 'Main Run', MOCK_TIMESTAMP),
    };
    store.undoState = { [mockGameStellarDrift.id]: steamSnapshot };

    const readOnlyProps = createDefaultProps({ store, isReadOnly: true, isBusy: false });
    const { rerender } = render(<HuntMemoryTracker {...readOnlyProps} />);

    expect(screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Undo last change/ })).toBeDisabled();
    expect(screen.getByText('Editing is disabled so saved progress stays unchanged.')).toBeInTheDocument();

    const revealBtn = screen.getByRole('button', { name: 'Reveal details for Achievement 2' });
    expect(revealBtn).not.toBeDisabled();
    await user.click(revealBtn);
    expect(screen.getByText(binaryMissable.name)).toBeInTheDocument();

    screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }).click();
    screen.getByRole('button', { name: /Undo last change/ }).click();
    expect(readOnlyProps.onBinaryCompletionChange).toHaveBeenCalledTimes(0);
    expect(readOnlyProps.onUndo).toHaveBeenCalledTimes(0);
    expect(readOnlyProps.getTimestamp).toHaveBeenCalledTimes(0);

    const busyProps = createDefaultProps({ store, isReadOnly: false, isBusy: true });
    rerender(<HuntMemoryTracker {...busyProps} />);
    expect(screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Undo last change/ })).toBeDisabled();
    expect(screen.getByText('An operation is in progress.')).toBeInTheDocument();

    screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }).click();
    screen.getByRole('button', { name: /Undo last change/ }).click();
    expect(busyProps.onBinaryCompletionChange).toHaveBeenCalledTimes(0);
    expect(busyProps.onUndo).toHaveBeenCalledTimes(0);

    cleanup();
    const inst1Store = { ...createBaseStore(), undoState: { [mockGameStellarDrift.id]: steamSnapshot } };
    const inst2Store = { ...createBaseStore(), undoState: { [mockGameStellarDrift.id]: steamSnapshot } };

    const inst1OnUndo = vi.fn().mockResolvedValue({ status: 'failure', code: 'TEST_FAILURE', message: 'Instance 1 failed' });
    const inst2OnUndo = vi.fn().mockResolvedValue(createSuccessResult(inst2Store));

    const { container } = render(
      <div>
        <HuntMemoryTracker {...createDefaultProps({ store: inst1Store, onUndo: inst1OnUndo })} />
        <HuntMemoryTracker {...createDefaultProps({ store: inst2Store, onUndo: inst2OnUndo })} />
      </div>,
    );

    const allIds = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(allIds).size).toBe(allIds.length);

    const headings = screen.getAllByRole('heading', {
      name: `Achievement Trackers (${psSet.achievements.length})`,
    });
    expect(headings[0].id).not.toBe(headings[1].id);

    const revealButtons = screen.getAllByRole('button', {
      name: 'Reveal details for Achievement 2',
    });
    await user.click(revealButtons[0]);

    const articles = container.querySelectorAll('article');
    expect(articles[1].innerHTML).toContain(binaryMissable.name);
    expect(articles[1 + psSet.achievements.length].innerHTML).not.toContain(binaryMissable.name);

    const notesInputs = screen.getAllByRole('textbox', { name: 'Manual notes for Achievement 1' });
    await user.type(notesInputs[0], 'Instance 1 unique note');
    expect(notesInputs[0]).toHaveValue('Instance 1 unique note');
    expect(notesInputs[1]).toHaveValue('');

    const undoButtons = screen.getAllByRole('button', { name: /Undo last change/ });
    await act(async () => { undoButtons[0].click(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Undo could not be confirmed: Instance 1 failed');
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    expect(appSource).not.toContain('HuntMemoryTracker');
  });
});
