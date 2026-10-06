import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import appSource from '../../App.tsx?raw';
import overviewSource from './HuntMemoryProgressOverview.tsx?raw';
import { GameRecordSchema, type GameRecord } from '../../domain/achievement-schema';
import { LocalProgressStoreV3Schema, type LocalProgressStoreV3 } from '../../domain/hunt-memory-schema';
import { createDefaultGameProgressV3, createDefaultHuntMemoryStore, createDefaultRunProgress } from '../../domain/hunt-memory-lifecycle';
import { mockGameMythHarbor, mockGameStellarDrift, MOCK_TIMESTAMP, MOCK_TIMESTAMP_2 } from '../../test/progress-fixtures';
import { selectActiveWorkspaceV3 } from '../../domain/hunt-memory-view';
import { validateTrackerShape } from '../../domain/hunt-memory-tracker-shape';
import { HuntMemoryProgressOverview, type HuntMemoryProgressOverviewProps } from './HuntMemoryProgressOverview';
import type { HuntMemoryActionResult } from './use-hunt-memory-store';

const [psSet, steamSet] = mockGameStellarDrift.achievementSets;
const binaryStory = psSet.achievements[0];
const binaryMissable = psSet.achievements[1];
const counterAch = psSet.achievements[2];
const checklistAch = psSet.achievements[3];

const multiContextGame: GameRecord = GameRecordSchema.parse({
  ...mockGameStellarDrift,
  id: 'multi-context-game',
  achievementSets: [
    {
      ...psSet,
      id: 'set-alpha',
      achievements: [
        { ...binaryStory, id: 'shared-story', name: 'Shared Story' },
        { ...counterAch, id: 'shared-counter', name: 'Shared Counter', tracking: { mode: 'counter', unit: 'items', target: 50, quickSteps: [1, 5] } },
        { ...checklistAch, id: 'shared-checklist', name: 'Shared Checklist' },
        { ...binaryMissable, id: 'shared-missable', name: 'Shared Missable' },
      ],
    },
    {
      ...steamSet,
      id: 'set-beta',
      achievements: [
        { ...binaryStory, id: 'shared-story', name: 'Shared Story', reward: { type: 'achievement' } },
        { ...counterAch, id: 'shared-counter', name: 'Shared Counter', reward: { type: 'achievement' }, tracking: { mode: 'counter', unit: 'items', target: 50, quickSteps: [1, 5] } },
      ],
    },
  ],
});

function createBaseStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.gameProgress[mockGameStellarDrift.id] = createDefaultGameProgressV3(mockGameStellarDrift, MOCK_TIMESTAMP);
  return LocalProgressStoreV3Schema.parse(store);
}

function successResult(store: LocalProgressStoreV3): HuntMemoryActionResult {
  return { status: 'success', store };
}

function createProps(overrides: Partial<HuntMemoryProgressOverviewProps> = {}) {
  const store = overrides.store ?? createBaseStore();
  const callbacks = {
    onSelectActiveStage: vi.fn().mockResolvedValue(successResult(store)),
    onTogglePin: vi.fn().mockResolvedValue(successResult(store)),
    onBinaryCompletionChange: vi.fn().mockResolvedValue(successResult(store)),
    onCounterProgressChange: vi.fn().mockResolvedValue(successResult(store)),
    onChecklistItemCompletionChange: vi.fn().mockResolvedValue(successResult(store)),
    getTimestamp: vi.fn(() => MOCK_TIMESTAMP_2),
  };
  const props: HuntMemoryProgressOverviewProps = {
    game: mockGameStellarDrift,
    selectedSetId: psSet.id,
    store,
    ...callbacks,
    ...overrides,
  };
  return { props, callbacks };
}

describe('HuntMemoryProgressOverview', () => {
  describe('Matching ready selection and projected confirmed summaries', () => {
    it('binds exact context triple, selector ordinals, roadmap, and scoped Oracle recommendation summaries', async () => {
      const user = userEvent.setup();
      const store = createDefaultHuntMemoryStore();
      store.gameProgress[mockGameStellarDrift.id] = createDefaultGameProgressV3(mockGameStellarDrift, MOCK_TIMESTAMP);
      const set = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id];
      const run = set.runs['default-run'];

      run.progress[binaryStory.id] = { ...run.progress[binaryStory.id], completed: true };
      run.progress[binaryMissable.id] = { ...run.progress[binaryMissable.id], completed: true };
      run.progress[counterAch.id] = {
        ...run.progress[counterAch.id],
        completed: false,
        counter: { certainty: 'exact', value: 3 },
      };
      run.progress[checklistAch.id] = {
        ...run.progress[checklistAch.id],
        completed: false,
        checklistCompletion: { 'task-a': true, 'task-b': false, 'task-c': false },
      };
      run.pinnedAchievementIds = [counterAch.id, checklistAch.id];

      const { props, callbacks } = createProps({ store });
      render(<HuntMemoryProgressOverview {...props} />);

      expect(screen.getByText('Platform roadmap')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Platinum Roadmap' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Select Story stage: 1 of 2 completed/i })).toHaveAttribute('aria-pressed', 'true');

      const missablesBtn = screen.getByRole('button', { name: /Select Missables stage: 1 of 1 completed/i });
      expect(missablesBtn).toHaveAttribute('aria-pressed', 'false');

      expect(screen.getByRole('heading', { name: 'Focus Board (2 / 5 pinned)' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Oracle Focus' })).toBeInTheDocument();

      const pinnedArticles = screen.getAllByRole('article', { name: /Focus item: Achievement/i });
      expect(pinnedArticles).toHaveLength(2);
      expect(within(pinnedArticles[0]).getByRole('heading', { name: 'Achievement 3' })).toBeInTheDocument();
      expect(within(pinnedArticles[1]).getByRole('heading', { name: 'Achievement 4' })).toBeInTheDocument();

      const stageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      await user.click(stageBtn);
      expect(callbacks.onSelectActiveStage).toHaveBeenCalledWith(
        { gameId: mockGameStellarDrift.id, setId: psSet.id, runId: 'default-run' },
        'missables',
      );

      const unpinBtn = screen.getByRole('button', { name: /Unpin Achievement 3 from focus board/i });
      await user.click(unpinBtn);
      expect(callbacks.onTogglePin).toHaveBeenCalledWith(
        { gameId: mockGameStellarDrift.id, setId: psSet.id, runId: 'default-run' },
        counterAch.id,
        false,
      );

      const oracleCounterCard = screen.getByRole('article', { name: 'Oracle recommendation: Achievement 3' });
      expect(within(oracleCounterCard).getByText(/Progress: 3 \/ 48 \(45 remaining, 6%\)/i)).toBeInTheDocument();

      const oracleChecklistCard = screen.getByRole('article', { name: 'Oracle recommendation: Achievement 4' });
      expect(within(oracleChecklistCard).getByText(/Progress: 1 \/ 3 items \(2 remaining, 33%\)/i)).toBeInTheDocument();

      expect(callbacks.getTimestamp).not.toHaveBeenCalled();

      cleanup();
      const aboveStore = structuredClone(store);
      aboveStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].progress[counterAch.id] = {
        ...aboveStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].progress[counterAch.id],
        completed: false,
        counter: { certainty: 'estimated', estimate: 60 },
      };
      aboveStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].pinnedAchievementIds = [counterAch.id];

      const { props: aboveProps, callbacks: aboveCb } = createProps({ store: aboveStore });
      render(<HuntMemoryProgressOverview {...aboveProps} />);

      const aboveOracleCard = screen.getByRole('article', { name: 'Oracle recommendation: Achievement 3' });
      expect(within(aboveOracleCard).getByText(/Progress: ~60 \/ 48 \(~0 remaining, ~100%\)/i)).toBeInTheDocument();
      expect(within(aboveOracleCard).queryByText('Completed')).not.toBeInTheDocument();

      const aboveBoardCard = screen.getByRole('article', { name: 'Focus item: Achievement 3' });
      expect(within(aboveBoardCard).queryByText('Completed')).not.toBeInTheDocument();

      const certaintySelect = screen.getByRole('combobox', { name: /Certainty for Achievement 3/i });
      await user.selectOptions(certaintySelect, 'unknown');
      const applyBtn = screen.getByRole('button', { name: /Apply counter for Achievement 3/i });
      await user.click(applyBtn);

      expect(aboveCb.getTimestamp).toHaveBeenCalledTimes(1);
      expect(aboveCb.onCounterProgressChange).toHaveBeenCalledWith(
        { gameId: mockGameStellarDrift.id, setId: psSet.id, runId: 'default-run' },
        counterAch.id,
        { certainty: 'unknown', observedSinceStart: 0, trackingStartedAt: MOCK_TIMESTAMP_2 },
      );
    });
  });

  describe('Item unavailability, masking, and draft survival', () => {
    it('masks unavailable items in DOM/ARIA even after reveal, preserving consent and drafts on restore', async () => {
      const user = userEvent.setup();
      const store = createBaseStore();
      const run = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'];
      run.pinnedAchievementIds = [binaryStory.id, counterAch.id];

      const { props, callbacks } = createProps({ store });
      const { rerender } = render(<HuntMemoryProgressOverview {...props} />);

      const reveal1 = screen.getAllByRole('button', { name: /Reveal details for Achievement 1/i })[0];
      const reveal3 = screen.getAllByRole('button', { name: /Reveal details for Achievement 3/i })[0];
      await user.click(reveal1);
      await user.click(reveal3);

      expect(screen.getAllByText(binaryStory.name).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(counterAch.name).length).toBeGreaterThanOrEqual(1);

      const spin = screen.getByRole('spinbutton', { name: new RegExp(`Set counter for ${counterAch.name}`, 'i') });
      await user.clear(spin);
      await user.type(spin, '25');
      const certaintySelect = screen.getByRole('combobox', { name: new RegExp(`Certainty for ${counterAch.name}`, 'i') });
      await user.selectOptions(certaintySelect, 'estimated');

      const lostStore = structuredClone(store);
      delete lostStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].progress[binaryStory.id];
      lostStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].progress[counterAch.id] = {
        achievementId: counterAch.id,
        completed: false,
        manualOverride: false,
        provenance: 'manual',
        lastUpdated: MOCK_TIMESTAMP,
        checklistCompletion: {},
      };
      expect(validateTrackerShape(lostStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].progress[counterAch.id], counterAch.tracking)).toBe(false);
      expect(validateTrackerShape(store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].progress[counterAch.id], counterAch.tracking)).toBe(true);

      rerender(<HuntMemoryProgressOverview {...props} store={lostStore} />);

      expect(screen.queryByText(binaryStory.name)).not.toBeInTheDocument();
      expect(screen.queryByText(counterAch.name)).not.toBeInTheDocument();
      expect(screen.getByRole('article', { name: /Unavailable progress for Achievement 1/i })).toHaveTextContent(
        /Progress is unavailable for Achievement 1\. Saved data has not been changed\./,
      );
      expect(screen.getByRole('article', { name: /Unavailable progress for Achievement 3/i })).toHaveTextContent(
        /Progress is unavailable for Achievement 3\. Saved data has not been changed\./,
      );

      expect(screen.queryByRole('button', { name: /Unpin Achievement 1/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Reveal details for Achievement 1/i })).not.toBeInTheDocument();

      rerender(<HuntMemoryProgressOverview {...props} store={store} />);

      expect(screen.getAllByText(binaryStory.name).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(counterAch.name).length).toBeGreaterThanOrEqual(1);

      const restoredSpin = screen.getByRole('spinbutton', { name: new RegExp(`Set counter for ${counterAch.name}`, 'i') });
      expect(restoredSpin).toHaveValue(25);
      const restoredCertainty = screen.getByRole('combobox', { name: new RegExp(`Certainty for ${counterAch.name}`, 'i') });
      expect(restoredCertainty).toHaveValue('estimated');

      const applyBtn = screen.getByRole('button', { name: new RegExp(`Apply counter for ${counterAch.name}`, 'i') });
      await user.click(applyBtn);
      expect(callbacks.onCounterProgressChange).toHaveBeenCalledWith(
        { gameId: mockGameStellarDrift.id, setId: psSet.id, runId: 'default-run' },
        counterAch.id,
        { certainty: 'estimated', estimate: 25 },
      );
    });
  });

  describe('Workspace unavailability reasons and state reset', () => {
    it('handles all five workspace-unavailable reasons unframed and resets local state on whole-workspace restore', async () => {
      const user = userEvent.setup();
      const reasons: Array<{
        reasonName: string;
        setup: (s: LocalProgressStoreV3) => void;
        expectedMsg: RegExp;
      }> = [
        {
          reasonName: 'GAME_NOT_FOUND',
          setup: (s) => { delete s.gameProgress[mockGameStellarDrift.id]; },
          expectedMsg: /does not exist in store/i,
        },
        {
          reasonName: 'SET_NOT_FOUND',
          setup: (s) => { delete s.gameProgress[mockGameStellarDrift.id].sets[psSet.id]; },
          expectedMsg: /does not exist as an active set/i,
        },
        {
          reasonName: 'SET_RETIRED',
          setup: (s) => {
            const set = s.gameProgress[mockGameStellarDrift.id].sets[psSet.id];
            delete s.gameProgress[mockGameStellarDrift.id].sets[psSet.id];
            s.gameProgress[mockGameStellarDrift.id].retiredSets[psSet.id] = { ...set, retirementReason: 'removed_set' };
          },
          expectedMsg: /is retired in game/i,
        },
        {
          reasonName: 'SET_VERSION_MISMATCH',
          setup: (s) => { s.gameProgress[mockGameStellarDrift.id].sets[psSet.id].version = '9.9.9'; },
          expectedMsg: /version mismatch: stored '9\.9\.9', expected/i,
        },
        {
          reasonName: 'RUN_NOT_FOUND',
          setup: (s) => { s.gameProgress[mockGameStellarDrift.id].sets[psSet.id].activeRunId = 'nonexistent-run'; },
          expectedMsg: /active run 'nonexistent-run' does not exist in set/i,
        },
      ];

      for (const { reasonName, setup, expectedMsg } of reasons) {
        cleanup();
        const store = createBaseStore();
        setup(store);
        const workspaceResult = selectActiveWorkspaceV3(mockGameStellarDrift, psSet.id, store);
        expect(workspaceResult.status).toBe('unavailable');
        if (workspaceResult.status === 'unavailable') expect(workspaceResult.reason).toBe(reasonName);

        const { props, callbacks } = createProps({ store });
        render(<HuntMemoryProgressOverview {...props} />);

        const statusP = screen.getByRole('status');
        expect(statusP).toHaveTextContent(expectedMsg);
        expect(statusP.tagName).toBe('P');
        expect(screen.queryByText('Platform roadmap')).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(callbacks.onSelectActiveStage).not.toHaveBeenCalled();
        expect(callbacks.getTimestamp).not.toHaveBeenCalled();
      }

      cleanup();
      const store = createBaseStore();
      const run = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'];
      run.pinnedAchievementIds = [counterAch.id];

      const { props } = createProps({ store });
      const { rerender } = render(<HuntMemoryProgressOverview {...props} />);

      const revealBtn = screen.getAllByRole('button', { name: /Reveal details for Achievement 3/i })[0];
      await user.click(revealBtn);
      expect(screen.getAllByText(counterAch.name).length).toBeGreaterThanOrEqual(1);

      const spin = screen.getByRole('spinbutton', { name: new RegExp(`Set counter for ${counterAch.name}`, 'i') });
      await user.clear(spin);
      await user.type(spin, '33');
      expect(spin).toHaveValue(33);

      const lostStore = structuredClone(store);
      delete lostStore.gameProgress[mockGameStellarDrift.id];
      rerender(<HuntMemoryProgressOverview {...props} store={lostStore} />);
      expect(screen.getByRole('status')).toHaveTextContent(/does not exist in store/i);

      rerender(<HuntMemoryProgressOverview {...props} store={store} />);
      expect(screen.queryByText(counterAch.name)).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Reveal details for Achievement 3/i }).length).toBeGreaterThanOrEqual(1);
      const restoredSpin = screen.getByRole('spinbutton', { name: /Set counter for Achievement 3/i });
      expect(restoredSpin).toHaveValue(0);
    });
  });

  describe('Prototype-safe reveal intent and projected checklist', () => {
    it('supports prototype-named achievement IDs for Reveal/Hide and projected checklist items', async () => {
      const user = userEvent.setup();
      const protoGame: GameRecord = {
        ...mockGameStellarDrift,
        id: 'constructor',
        achievementSets: [
          {
            ...psSet,
            id: 'toString',
            achievements: [
              {
                ...checklistAch,
                id: 'toString',
                name: 'Prototype ToString Achievement',
                tracking: {
                  mode: 'checklist',
                  items: [
                    { id: 'constructor', name: 'Item Constructor' },
                    { id: 'valueOf', name: 'Item ValueOf' },
                  ],
                },
              },
            ],
          },
        ],
      };

      const store = createDefaultHuntMemoryStore();
      store.gameProgress['constructor'] = createDefaultGameProgressV3(protoGame, MOCK_TIMESTAMP);
      const targetSet = store.gameProgress['constructor'].sets['toString'];
      const targetRun = targetSet.runs['default-run'];
      targetRun.pinnedAchievementIds = ['toString'];
      targetRun.progress['toString'] = {
        ...targetRun.progress['toString'],
        completed: false,
        checklistCompletion: { constructor: true, valueOf: false },
      };

      const { props, callbacks } = createProps({ game: protoGame, selectedSetId: 'toString', store });
      render(<HuntMemoryProgressOverview {...props} />);

      expect(screen.queryByText('Prototype ToString Achievement')).not.toBeInTheDocument();

      const revealBtns = screen.getAllByRole('button', { name: /Reveal details for Achievement 1/i });
      await user.click(revealBtns[0]);
      expect(screen.getAllByText('Prototype ToString Achievement').length).toBeGreaterThanOrEqual(2);

      const hideBtns = screen.getAllByRole('button', { name: /Hide details for Prototype ToString Achievement/i });
      await user.click(hideBtns[0]);
      expect(screen.queryByText('Prototype ToString Achievement')).not.toBeInTheDocument();

      await user.click(screen.getAllByRole('button', { name: /Reveal details for Achievement 1/i })[0]);
      const checkItem0 = screen.getByRole('checkbox', { name: /Item Constructor for Prototype ToString Achievement/i });
      expect(checkItem0).toBeChecked();

      const checkItem1 = screen.getByRole('checkbox', { name: /Item ValueOf for Prototype ToString Achievement/i });
      expect(checkItem1).not.toBeChecked();

      await user.click(checkItem1);
      expect(callbacks.onChecklistItemCompletionChange).toHaveBeenCalledWith(
        { gameId: 'constructor', setId: 'toString', runId: 'default-run' },
        'toString',
        'valueOf',
        true,
      );
    });
  });

  describe('Truthful safe feedback and counter acknowledgement', () => {
    it('presents sanitized feedback without loss guarantees, retaining counter draft and following confirmed props', async () => {
      const user = userEvent.setup();
      const store = createBaseStore();
      const run = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'];
      run.pinnedAchievementIds = [counterAch.id];

      const { props, callbacks } = createProps({ store });

      const cases: Array<{ result: HuntMemoryActionResult | 'REJECT'; expectedFragment: RegExp }> = [
        { result: { status: 'busy', message: 'SECRET_BUSY', reason: 'OPERATION_IN_FLIGHT' }, expectedFragment: /is waiting: an operation is in progress/i },
        { result: { status: 'blocked', message: 'SECRET_BLOCKED', reason: 'RULE' }, expectedFragment: /was not applied\. Prerequisites or constraints/i },
        { result: { status: 'mutation-failed', message: 'SECRET_MUTATION', code: 'FAIL' }, expectedFragment: /was not applied\. Please verify the current state/i },
        { result: { status: 'retryable-failure', message: 'SECRET_RETRY', code: 'WRITE_FAILED_TOKEN_UNCHANGED' }, expectedFragment: /saved state is unconfirmed\. Check safety controls/i },
        { result: { status: 'recovery-required', message: 'SECRET_RECOVERY', reason: 'STORAGE' }, expectedFragment: /could not be confirmed\. Check safety controls before proceeding/i },
        { result: { status: 'failure', message: 'SECRET_FAILURE', code: 'ERR' }, expectedFragment: /could not be confirmed\. Check safety controls before proceeding/i },
        { result: 'REJECT', expectedFragment: /could not be confirmed\. Check safety controls before proceeding/i },
      ];

      for (const { result, expectedFragment } of cases) {
        cleanup();
        if (result === 'REJECT') {
          callbacks.onSelectActiveStage.mockRejectedValueOnce(new Error('SECRET_RAW_EXCEPTION'));
        } else {
          callbacks.onSelectActiveStage.mockResolvedValueOnce(result);
        }

        render(<HuntMemoryProgressOverview {...props} />);
        const stageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
        await user.click(stageBtn);

        const status = screen.getByText(expectedFragment);
        expect(status).toHaveAttribute('role', 'status');
        expect(screen.queryByText(/Saved data has not been lost/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/SECRET_/)).not.toBeInTheDocument();
      }

      cleanup();
      callbacks.onCounterProgressChange.mockResolvedValueOnce({
        status: 'failure',
        message: 'SECRET_COUNTER_FAILURE',
        code: 'INTERNAL_ERROR',
      });
      const { rerender } = render(<HuntMemoryProgressOverview {...props} />);

      const spin = screen.getByRole('spinbutton', { name: /Set counter for Achievement 3/i });
      await user.clear(spin);
      await user.type(spin, '19');

      const applyBtn = screen.getByRole('button', { name: /Apply counter for Achievement 3/i });
      await user.click(applyBtn);

      expect(screen.getAllByText(/Counter update could not be confirmed\. Check safety controls before proceeding/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(/SECRET_COUNTER_FAILURE/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Saved data has not been lost/i)).not.toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: /Set counter for Achievement 3/i })).toHaveValue(19);

      callbacks.onCounterProgressChange.mockResolvedValueOnce({
        status: 'success',
        store,
      });
      await user.click(applyBtn);
      expect(screen.queryByText(/Counter update could not be confirmed/i)).not.toBeInTheDocument();

      const confirmedUpdateStore = structuredClone(store);
      confirmedUpdateStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].progress[counterAch.id].counter = {
        certainty: 'exact',
        value: 8,
      };
      rerender(<HuntMemoryProgressOverview {...props} store={confirmedUpdateStore} />);
      expect(screen.getByRole('spinbutton', { name: /Set counter for Achievement 3/i })).toHaveValue(8);
    });
  });

  describe('Synchronous admission latching', () => {
    it('admits at most one action for synchronous concurrent events in one act and retains draft', async () => {
      const store = createBaseStore();
      const run = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'];
      run.pinnedAchievementIds = [binaryStory.id, counterAch.id];

      let resolveStage: (res: HuntMemoryActionResult) => void = () => {};
      const pendingStagePromise = new Promise<HuntMemoryActionResult>((resolve) => {
        resolveStage = resolve;
      });

      const { props, callbacks } = createProps({ store });
      callbacks.onSelectActiveStage.mockReturnValue(pendingStagePromise);

      render(<HuntMemoryProgressOverview {...props} />);

      const spin = screen.getByRole('spinbutton', { name: /Set counter for Achievement 3/i });
      fireEvent.change(spin, { target: { value: '42' } });

      const stageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      const applyBtn = screen.getByRole('button', { name: /Apply counter for Achievement 3/i });

      act(() => {
        fireEvent.click(stageBtn);
        fireEvent.click(applyBtn);
      });

      expect(callbacks.onSelectActiveStage).toHaveBeenCalledTimes(1);
      expect(callbacks.onCounterProgressChange).toHaveBeenCalledTimes(0);
      expect(screen.getByText(/Counter update is waiting: an operation is already in progress/i)).toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: /Set counter for Achievement 3/i })).toHaveValue(42);

      await act(async () => {
        resolveStage(successResult(store));
      });
    });
  });

  describe('Independent lifetime transitions and deferred settlements', () => {
    it('independently varies game, set, and run on one root, preserving same-game pending and isolating game A-B-A', async () => {
      const user = userEvent.setup();
      const store = createDefaultHuntMemoryStore();
      store.gameProgress[multiContextGame.id] = createDefaultGameProgressV3(multiContextGame, MOCK_TIMESTAMP);

      const setAlpha = store.gameProgress[multiContextGame.id].sets['set-alpha'];
      setAlpha.runs['run-alpha-1'] = createDefaultRunProgress(multiContextGame.achievementSets[0], 'run-alpha-1', 'Alpha One', MOCK_TIMESTAMP);
      setAlpha.runs['run-alpha-1'].pinnedAchievementIds = ['shared-counter'];
      setAlpha.runs['run-alpha-1'].progress['shared-counter'] = {
        achievementId: 'shared-counter', completed: false, manualOverride: false, provenance: 'manual', lastUpdated: MOCK_TIMESTAMP,
        counter: { certainty: 'exact', value: 10 },
      };

      setAlpha.runs['run-alpha-2'] = createDefaultRunProgress(multiContextGame.achievementSets[0], 'run-alpha-2', 'Alpha Two', MOCK_TIMESTAMP);
      setAlpha.runs['run-alpha-2'].pinnedAchievementIds = ['shared-counter'];
      setAlpha.runs['run-alpha-2'].progress['shared-counter'] = {
        achievementId: 'shared-counter', completed: false, manualOverride: false, provenance: 'manual', lastUpdated: MOCK_TIMESTAMP,
        counter: { certainty: 'exact', value: 20 },
      };
      setAlpha.activeRunId = 'run-alpha-1';

      const setBeta = store.gameProgress[multiContextGame.id].sets['set-beta'];
      setBeta.runs['run-beta-1'] = createDefaultRunProgress(multiContextGame.achievementSets[1], 'run-beta-1', 'Beta One', MOCK_TIMESTAMP);
      setBeta.runs['run-beta-1'].pinnedAchievementIds = ['shared-counter'];
      setBeta.runs['run-beta-1'].progress['shared-counter'] = {
        achievementId: 'shared-counter', completed: false, manualOverride: false, provenance: 'manual', lastUpdated: MOCK_TIMESTAMP,
        counter: { certainty: 'exact', value: 30 },
      };
      setBeta.activeRunId = 'run-beta-1';

      const { props, callbacks } = createProps({
        game: multiContextGame,
        selectedSetId: 'set-alpha',
        store,
      });

      const { rerender } = render(<HuntMemoryProgressOverview {...props} />);

      expect(screen.getByRole('spinbutton', { name: /Set counter for Achievement 2/i })).toHaveValue(10);
      const revealBtn = screen.getAllByRole('button', { name: /Reveal details for Achievement 2/i })[0];
      await user.click(revealBtn);
      expect(screen.getAllByText('Shared Counter').length).toBeGreaterThanOrEqual(1);

      const spin = screen.getByRole('spinbutton', { name: /Set counter for Shared Counter/i });
      await user.clear(spin);
      await user.type(spin, '45');
      expect(spin).toHaveValue(45);

      rerender(<HuntMemoryProgressOverview {...props} store={structuredClone(store)} />);
      expect(screen.getAllByText('Shared Counter').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('spinbutton', { name: /Set counter for Shared Counter/i })).toHaveValue(45);

      const runSwitchStore = structuredClone(store);
      runSwitchStore.gameProgress[multiContextGame.id].sets['set-alpha'].activeRunId = 'run-alpha-2';
      rerender(<HuntMemoryProgressOverview {...props} store={runSwitchStore} />);

      expect(screen.queryByText('Shared Counter')).not.toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: /Set counter for Achievement 2/i })).toHaveValue(20);
      const applyRunBtn = screen.getByRole('button', { name: /Apply counter for Achievement 2/i });
      await user.click(applyRunBtn);
      expect(callbacks.onCounterProgressChange).toHaveBeenCalledWith(
        { gameId: multiContextGame.id, setId: 'set-alpha', runId: 'run-alpha-2' },
        'shared-counter',
        { certainty: 'exact', value: 20 },
      );

      rerender(<HuntMemoryProgressOverview {...props} selectedSetId="set-beta" store={store} />);
      expect(screen.queryByText('Shared Counter')).not.toBeInTheDocument();
      expect(screen.getByRole('spinbutton', { name: /Set counter for Achievement 2/i })).toHaveValue(30);

      let resolveAlphaAction: (res: HuntMemoryActionResult) => void = () => {};
      const alphaPendingPromise = new Promise<HuntMemoryActionResult>((r) => { resolveAlphaAction = r; });
      callbacks.onSelectActiveStage.mockReturnValueOnce(alphaPendingPromise);

      rerender(<HuntMemoryProgressOverview {...props} selectedSetId="set-alpha" store={store} />);
      const alphaStageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      fireEvent.click(alphaStageBtn);
      expect(callbacks.onSelectActiveStage).toHaveBeenCalledTimes(1);

      rerender(<HuntMemoryProgressOverview {...props} selectedSetId="set-beta" store={store} />);
      const betaStageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      expect(betaStageBtn).toBeDisabled();
      fireEvent.click(betaStageBtn);
      expect(callbacks.onSelectActiveStage).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveAlphaAction({ status: 'failure', code: 'SET_FAIL', message: 'Secret failure in set alpha' });
      });

      expect(screen.queryByText(/could not be confirmed/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Secret failure/i)).not.toBeInTheDocument();

      let rejectGameA: (err: unknown) => void = () => {};
      const gameAPending = new Promise<HuntMemoryActionResult>((_, reject) => { rejectGameA = reject; });
      callbacks.onSelectActiveStage.mockReturnValueOnce(gameAPending);

      rerender(<HuntMemoryProgressOverview {...props} selectedSetId="set-alpha" store={store} />);
      const returningStageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      fireEvent.click(returningStageBtn);

      const mythStore = createDefaultHuntMemoryStore();
      mythStore.gameProgress[mockGameMythHarbor.id] = createDefaultGameProgressV3(mockGameMythHarbor, MOCK_TIMESTAMP);
      const { props: mythProps, callbacks: mythCb } = createProps({
        game: mockGameMythHarbor,
        selectedSetId: mockGameMythHarbor.achievementSets[0].id,
        store: mythStore,
      });

      rerender(<HuntMemoryProgressOverview {...mythProps} />);
      const mythStageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      expect(mythStageBtn).not.toBeDisabled();
      fireEvent.click(mythStageBtn);
      expect(mythCb.onSelectActiveStage).toHaveBeenCalledTimes(1);

      rerender(<HuntMemoryProgressOverview {...props} selectedSetId="set-alpha" store={store} />);
      const freshStageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      expect(freshStageBtn).not.toBeDisabled();

      const freshSpin = screen.getByRole('spinbutton', { name: /Set counter for Achievement 2/i });
      await user.clear(freshSpin);
      await user.type(freshSpin, '99');
      expect(freshSpin).toHaveValue(99);

      await act(async () => {
        rejectGameA(new Error('Stale Game A rejection'));
      });

      expect(freshSpin).toHaveValue(99);
      expect(freshStageBtn).not.toBeDisabled();
      expect(screen.queryByText(/could not be confirmed/i)).not.toBeInTheDocument();
    });
  });

  describe('Controlled parent publication', () => {
    it('leaves confirmed display unchanged until parent passes updated store', async () => {
      const user = userEvent.setup();
      const store = createBaseStore();
      const run = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'];
      run.pinnedAchievementIds = [binaryStory.id];

      const updatedStore = structuredClone(store);
      updatedStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'].progress[binaryStory.id].completed = true;

      const { props, callbacks } = createProps({ store });
      callbacks.onBinaryCompletionChange.mockResolvedValue({
        status: 'success',
        store: updatedStore,
      });

      const { rerender } = render(<HuntMemoryProgressOverview {...props} />);

      const check = screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i });
      expect(check).not.toBeChecked();

      await user.click(check);
      expect(callbacks.onBinaryCompletionChange).toHaveBeenCalled();
      expect(check).not.toBeChecked();

      rerender(<HuntMemoryProgressOverview {...props} store={updatedStore} />);
      const updatedCheck = screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i });
      expect(updatedCheck).toBeChecked();
    });
  });

  describe('Postures, instance isolation, and accessibility references', () => {
    it('distinguishes isReadOnly vs isBusy, isolates dual instances, and verifies resolving ID/ARIA references', async () => {
      const user = userEvent.setup();
      const store = createBaseStore();
      const run = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'];
      run.pinnedAchievementIds = [binaryStory.id, counterAch.id, checklistAch.id];

      const { props: roProps, callbacks: roCb } = createProps({ store, isReadOnly: true });
      const { rerender } = render(<HuntMemoryProgressOverview {...roProps} />);

      expect(screen.getByText(/Editing is disabled so saved progress stays unchanged/i)).toBeInTheDocument();
      const roStageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      expect(roStageBtn).toBeDisabled();
      fireEvent.click(roStageBtn);
      expect(roCb.onSelectActiveStage).not.toHaveBeenCalled();
      expect(roCb.getTimestamp).not.toHaveBeenCalled();

      const roUnpin = screen.getByRole('button', { name: /Unpin Achievement 3 from focus board/i });
      expect(roUnpin).toBeDisabled();
      fireEvent.click(roUnpin);
      expect(roCb.onTogglePin).not.toHaveBeenCalled();

      const roCheck = screen.getByRole('checkbox', { name: /Mark Achievement 1 complete/i });
      expect(roCheck).toBeDisabled();
      fireEvent.click(roCheck);
      expect(roCb.onBinaryCompletionChange).not.toHaveBeenCalled();

      const roReveal = screen.getAllByRole('button', { name: /Reveal details for Achievement 1/i })[0];
      expect(roReveal).not.toBeDisabled();
      await user.click(roReveal);
      expect(screen.getAllByText(binaryStory.name).length).toBeGreaterThanOrEqual(1);

      const { props: busyProps, callbacks: busyCb } = createProps({ store, isBusy: true });
      rerender(<HuntMemoryProgressOverview {...busyProps} />);
      const busyStageBtn = screen.getByRole('button', { name: /Select Missables stage/i });
      expect(busyStageBtn).toBeDisabled();
      fireEvent.click(busyStageBtn);
      expect(busyCb.onSelectActiveStage).not.toHaveBeenCalled();
      expect(busyCb.getTimestamp).not.toHaveBeenCalled();

      const busyReveal = screen.getAllByRole('button', { name: /Reveal details for Achievement 3/i })[0];
      expect(busyReveal).not.toBeDisabled();
      await user.click(busyReveal);
      expect(screen.getAllByText(counterAch.name).length).toBeGreaterThanOrEqual(1);

      cleanup();
      const initialStoreJson = JSON.stringify(store);
      let resolveInstA: (res: HuntMemoryActionResult) => void = () => {};
      const instAPending = new Promise<HuntMemoryActionResult>((r) => { resolveInstA = r; });
      const { props: instA, callbacks: cbA } = createProps({ store, game: mockGameStellarDrift });
      cbA.onSelectActiveStage.mockReturnValue(instAPending);

      const { props: instB, callbacks: cbB } = createProps({ store, game: mockGameStellarDrift });

      const { container } = render(
        <div>
          <div data-testid="inst-a"><HuntMemoryProgressOverview {...instA} /></div>
          <div data-testid="inst-b"><HuntMemoryProgressOverview {...instB} /></div>
        </div>,
      );

      const idElements = Array.from(container.querySelectorAll('[id]'));
      const idValues = idElements.map((el) => el.id);
      expect(new Set(idValues).size).toBe(idValues.length);

      const labelledElements = Array.from(container.querySelectorAll('[aria-labelledby]'));
      for (const el of labelledElements) {
        const refId = el.getAttribute('aria-labelledby');
        expect(refId).toBeTruthy();
        expect(container.querySelector(`#${refId}`)).not.toBeNull();
      }

      const labelElements = Array.from(container.querySelectorAll('label[for]'));
      for (const el of labelElements) {
        const refId = el.getAttribute('for');
        expect(refId).toBeTruthy();
        expect(container.querySelector(`#${refId}`)).not.toBeNull();
      }

      const instARoot = screen.getByTestId('inst-a');
      const instBRoot = screen.getByTestId('inst-b');

      const stageBtnA = within(instARoot).getByRole('button', { name: /Select Missables stage/i });
      fireEvent.click(stageBtnA);
      expect(cbA.onSelectActiveStage).toHaveBeenCalledTimes(1);

      const stageBtnB = within(instBRoot).getByRole('button', { name: /Select Missables stage/i });
      expect(stageBtnB).not.toBeDisabled();
      fireEvent.click(stageBtnB);
      expect(cbB.onSelectActiveStage).toHaveBeenCalledTimes(1);

      const revealBtnA = within(instARoot).getAllByRole('button', { name: /Reveal details for Achievement 1/i })[0];
      await user.click(revealBtnA);
      expect(within(instARoot).getAllByText(binaryStory.name).length).toBeGreaterThanOrEqual(1);
      expect(within(instBRoot).queryByText(binaryStory.name)).not.toBeInTheDocument();

      expect(JSON.stringify(store)).toBe(initialStoreJson);

      await act(async () => {
        resolveInstA(successResult(store));
      });
    });
  });

  describe('Oracle Focus stage-neutral copy', () => {
    it('uses run-scoped copy for out-of-stage and empty recommendations', () => {
      const store = createBaseStore();
      const run = store.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'];
      run.progress[binaryStory.id] = { ...run.progress[binaryStory.id], completed: true };
      run.progress[binaryMissable.id] = { ...run.progress[binaryMissable.id], completed: true };
      render(<HuntMemoryProgressOverview {...createProps({ store }).props} />);
      expect(screen.getByText('Recommended achievements for this run.')).toBeInTheDocument();
      expect(screen.getByRole('article', { name: 'Oracle recommendation: Achievement 3' })).toBeInTheDocument();
      cleanup();
      const emptyStore = createBaseStore();
      const emptyRun = emptyStore.gameProgress[mockGameStellarDrift.id].sets[psSet.id].runs['default-run'];
      for (const ach of psSet.achievements) emptyRun.progress[ach.id].completed = true;
      render(<HuntMemoryProgressOverview {...createProps({ store: emptyStore }).props} />);
      expect(screen.getByText('No recommendations available.')).toBeInTheDocument();
      expect(screen.queryByText(/for the active stage/i)).not.toBeInTheDocument();
    });
  });

  describe('Scope and unwiring', () => {
    it('confirms App does not import HuntMemoryProgressOverview and overview does not import V2 APIs', () => {
      expect(appSource).not.toContain('HuntMemoryProgressOverview');
      expect(overviewSource).not.toContain('useProgressStore');
      expect(overviewSource).not.toContain('use-progress-store');
      expect(overviewSource).not.toContain('LocalProgressStore"');
      expect(overviewSource).not.toContain('LocalProgressStore\'');
      expect(overviewSource).not.toContain('from \'./FocusBoard\'');
      expect(overviewSource).not.toContain('from \'./OracleFocus\'');
    });
  });
});
