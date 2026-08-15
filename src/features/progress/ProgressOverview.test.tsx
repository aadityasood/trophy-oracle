import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultLocalProgressStore,
  ensureGameAndSetInitialized,
} from '../../domain/progress-engine';
import type { LocalProgressStore } from '../../domain/progress-schema';
import {
  mockGameStellarDrift,
  MOCK_TIMESTAMP,
} from '../../test/progress-fixtures';
import { ProgressOverview } from './ProgressOverview';

const psSet = mockGameStellarDrift.achievementSets[0];
const steamSet = mockGameStellarDrift.achievementSets[1];

function createStore(): LocalProgressStore {
  return ensureGameAndSetInitialized(
    createDefaultLocalProgressStore(),
    mockGameStellarDrift,
    psSet.id,
    MOCK_TIMESTAMP,
  );
}

function renderOverview(
  overrides: Partial<ComponentProps<typeof ProgressOverview>> = {},
) {
  const callbacks = {
    onBinaryCompletionChange: vi.fn(),
    onCounterValueChange: vi.fn(),
    onChecklistItemCompletionChange: vi.fn(),
    onTogglePin: vi.fn(),
    onSelectActiveStage: vi.fn(),
  };
  render(
    <ProgressOverview
      game={mockGameStellarDrift}
      set={psSet}
      store={createStore()}
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

describe('ProgressOverview', () => {
  it('renders one spoiler-safe unavailable article and no overview actions when active set progress is absent', () => {
    const store = createStore();
    delete store.gameProgress['stellar-drift'].sets['stellar-drift-ps'];

    renderOverview({ store });

    expect(
      screen.getByRole('article', { name: 'Progress overview unavailable' }),
    ).toHaveTextContent(
      'Progress for this platform is unavailable. Roadmap, Focus Board, and Oracle actions are hidden so your saved data stays unchanged.',
    );
    expect(
      screen.queryByRole('button', { name: /Select Story stage/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /focus board/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Reveal details/ }),
    ).not.toBeInTheDocument();
  });

  it('announces action errors in a polite overview-local status region', () => {
    renderOverview({
      actionStatus: 'Cannot pin more than 5 achievements per set',
    });

    const status = screen.getByText(
      'Cannot pin more than 5 achievements per set',
    );
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
  });

  describe('Roadmap stage summary & active stage', () => {
    it('renders platform roadmap label and stage counts in canonical order', () => {
      renderOverview();

      expect(screen.getByRole('heading', { name: 'Platinum Roadmap' })).toBeInTheDocument();
      expect(screen.getByText('PlayStation')).toBeInTheDocument();

      const storyStage = screen.getByRole('button', {
        name: /Select Story stage: 0 of 2 completed/,
      });
      expect(storyStage).toBeInTheDocument();
      expect(within(storyStage).getByText('Active')).toBeInTheDocument(); // visual fallback to story
      expect(within(storyStage).getByText(/0 \/ 2 completed/)).toBeInTheDocument();
      expect(within(storyStage).getByText(/\(2 remaining\)/)).toBeInTheDocument();

      const missablesStage = screen.getByRole('button', {
        name: /Select Missables stage: 0 of 1 completed/,
      });
      expect(missablesStage).toBeInTheDocument();
      expect(within(missablesStage).getByText(/0 \/ 1 completed/)).toBeInTheDocument();

      const cleanupStage = screen.getByRole('button', {
        name: /Select Grind\/Cleanup stage: 0 of 3 completed/,
      });
      expect(cleanupStage).toBeInTheDocument();
      expect(within(cleanupStage).getByText(/0 \/ 3 completed/)).toBeInTheDocument();
    });

    it('derives 100% Roadmap label for steam set', () => {
      const store = ensureGameAndSetInitialized(
        createDefaultLocalProgressStore(),
        mockGameStellarDrift,
        steamSet.id,
        MOCK_TIMESTAMP,
      );
      renderOverview({ set: steamSet, store });

      expect(screen.getByRole('heading', { name: '100% Roadmap' })).toBeInTheDocument();
      expect(screen.getByText('Steam')).toBeInTheDocument();
    });

    it('handles explicit stage selection and calls onSelectActiveStage', async () => {
      const user = userEvent.setup();
      const callbacks = renderOverview();

      const missablesStage = screen.getByRole('button', {
        name: /Select Missables stage/,
      });
      await user.click(missablesStage);

      expect(callbacks.onSelectActiveStage).toHaveBeenCalledWith('missables');
    });

    it('displays active stage indicator when activeStage is stored', () => {
      const store = createStore();
      store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].activeStage =
        'cleanup';

      renderOverview({ store });

      const cleanupStage = screen.getByRole('button', {
        name: /Select Grind\/Cleanup stage/,
      });
      expect(within(cleanupStage).getByText('Active')).toBeInTheDocument();
      expect(cleanupStage).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('Focus Board', () => {
    it('renders empty message when no achievements are pinned', () => {
      renderOverview();

      expect(
        screen.getByText(
          /No achievements pinned to the Focus Board\. Pin up to 5 achievements/i,
        ),
      ).toBeInTheDocument();
    });

    it('renders pinned achievements in stored order up to 5 pins and respects spoiler safe defaults', async () => {
      const store = createStore();
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].pinnedAchievementIds = ['sd-ps-004', 'sd-ps-001', 'sd-ps-002'];

      renderOverview({ store });

      expect(
        screen.getByRole('heading', { name: 'Focus Board (3 / 5 pinned)' }),
      ).toBeInTheDocument();

      // Focus cards in stored order: sd-ps-004 (index 2: Achievement 3), sd-ps-001 (index 0: Achievement 1), sd-ps-002 (index 1: Achievement 2)
      const focusCards = screen.getAllByRole('article', { name: /Focus item:/ });
      expect(focusCards).toHaveLength(3);

      // Spoiler safe: hidden names not in DOM
      expect(screen.queryByText('Signal Collector')).not.toBeInTheDocument();
      expect(screen.queryByText('First Burn')).not.toBeInTheDocument();
      expect(screen.queryByText('Orbit Breaker')).not.toBeInTheDocument();
      expect(screen.queryByText('Finish Ch 3 shortcut')).not.toBeInTheDocument();

      // Stable generic labels are present in stored Focus Board order.
      expect(within(focusCards[0]).getByText('Achievement 3')).toBeInTheDocument();
      expect(within(focusCards[1]).getByText('Achievement 1')).toBeInTheDocument();
      expect(within(focusCards[2]).getByText('Achievement 2')).toBeInTheDocument();

      // Reveals details on click for individual item
      const user = userEvent.setup();
      await user.click(
        within(focusCards[1]).getByRole('button', {
          name: 'Reveal details for Achievement 1',
        }),
      );

      expect(within(focusCards[1]).getByText('First Burn')).toBeInTheDocument();
      expect(within(focusCards[1]).getByText('Tutorial race')).toBeInTheDocument();
      expect(within(focusCards[1]).getByText('Mandatory')).toBeInTheDocument();
      expect(screen.queryByText('Orbit Breaker')).not.toBeInTheDocument();
    });

    it('renders a spoiler-safe unavailable article instead of silently dropping a pinned item with missing progress', () => {
      const store = createStore();
      const setProgress =
        store.gameProgress['stellar-drift'].sets['stellar-drift-ps'];
      setProgress.pinnedAchievementIds = ['sd-ps-001'];
      delete setProgress.progress['sd-ps-001'];

      renderOverview({ store });

      expect(
        screen.getByRole('article', {
          name: 'Unavailable progress for Achievement 1',
        }),
      ).toHaveTextContent(
        'Progress is unavailable for Achievement 1. Saved data has not been changed.',
      );
      expect(screen.queryByText('First Burn')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('checkbox', {
          name: 'Mark Achievement 1 complete',
        }),
      ).not.toBeInTheDocument();
    });

    it('provides quick binary completion and unpin controls', async () => {
      const user = userEvent.setup();
      const store = createStore();
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].pinnedAchievementIds = ['sd-ps-001'];

      const callbacks = renderOverview({ store });

      const checkbox = screen.getByRole('checkbox', {
        name: 'Mark Achievement 1 complete',
      });
      expect(checkbox).not.toBeChecked();

      await user.click(checkbox);
      expect(callbacks.onBinaryCompletionChange).toHaveBeenCalledWith(
        'sd-ps-001',
        true,
      );

      const unpinBtn = screen.getByRole('button', {
        name: 'Unpin Achievement 1 from focus board',
      });
      await user.click(unpinBtn);
      expect(callbacks.onTogglePin).toHaveBeenCalledWith('sd-ps-001', false);
    });

    it('provides bounded counter quick step controls, remaining count, and percentage', async () => {
      const user = userEvent.setup();
      const store = createStore();
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].pinnedAchievementIds = ['sd-ps-004'];
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].progress['sd-ps-004'].counterValue = 5;

      const callbacks = renderOverview({ store });

      // target is 48. value is 5. remaining 43, 10%
      expect(
        screen.getByText(/Progress: 5 \/ 48 \(43 remaining, 10%\)/),
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole('button', {
          name: 'Add 5 to counter for Achievement 3',
        }),
      );
      expect(callbacks.onCounterValueChange).toHaveBeenCalledWith(
        'sd-ps-004',
        10,
      );

      await user.click(
        screen.getByRole('button', {
          name: 'Decrease counter for Achievement 3',
        }),
      );
      expect(callbacks.onCounterValueChange).toHaveBeenCalledWith('sd-ps-004', 4);
    });

    it('preserves over-target counter values while flooring remaining and capping percentage', async () => {
      const user = userEvent.setup();
      const store = createStore();
      const setProgress =
        store.gameProgress['stellar-drift'].sets['stellar-drift-ps'];
      setProgress.pinnedAchievementIds = ['sd-ps-004'];
      setProgress.progress['sd-ps-004'].counterValue = 53;
      setProgress.progress['sd-ps-004'].completed = true;

      const callbacks = renderOverview({ store });

      expect(
        screen.getByText('Progress: 53 / 48 (0 remaining, 100%)'),
      ).toBeInTheDocument();
      expect(screen.getByText('counter')).toBeInTheDocument();

      await user.click(
        screen.getByRole('button', {
          name: 'Add 5 to counter for Achievement 3',
        }),
      );
      expect(callbacks.onCounterValueChange).toHaveBeenCalledWith(
        'sd-ps-004',
        58,
      );
    });

    it('handles open counters without inventing targets, percentages, or completion', async () => {
      const user = userEvent.setup();
      const store = createStore();
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].pinnedAchievementIds = ['sd-ps-006']; // open counter
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].progress['sd-ps-006'].counterValue = 3;

      const callbacks = renderOverview({ store });
      const focusCard = screen.getByRole('article', {
        name: 'Focus item: Achievement 5',
      });

      expect(
        within(focusCard).getByText(/Progress: 3 duels \(open counter\)/),
      ).toBeInTheDocument();
      expect(within(focusCard).queryByText(/remaining/i)).not.toBeInTheDocument();
      expect(within(focusCard).queryByText(/%/)).not.toBeInTheDocument();

      await user.click(
        screen.getByRole('button', {
          name: 'Add 1 to counter for Achievement 5',
        }),
      );
      expect(callbacks.onCounterValueChange).toHaveBeenCalledWith(
        'sd-ps-006',
        4,
      );
    });

    it('provides quick checklist item controls and percentage', async () => {
      const user = userEvent.setup();
      const store = createStore();
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].pinnedAchievementIds = ['sd-ps-005']; // checklist
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].progress['sd-ps-005'].checklistCompletion = {
        'task-a': true,
        'task-b': false,
        'task-c': false,
      };

      const callbacks = renderOverview({ store });

      expect(
        screen.getByText(/Progress: 1 \/ 3 items \(2 remaining, 33%\)/),
      ).toBeInTheDocument();

      // Spoiler safe item label
      const item2Checkbox = screen.getByRole('checkbox', {
        name: 'Item 2 for Achievement 4',
      });
      expect(item2Checkbox).not.toBeChecked();

      await user.click(item2Checkbox);
      expect(callbacks.onChecklistItemCompletionChange).toHaveBeenCalledWith(
        'sd-ps-005',
        'task-b',
        true,
      );
    });

    it('disables all Focus Board interactive controls when isReadOnly is true', () => {
      const store = createStore();
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].pinnedAchievementIds = ['sd-ps-001', 'sd-ps-004'];

      renderOverview({ store, isReadOnly: true });

      expect(
        screen.getByRole('button', {
          name: /Select Story stage/,
        }),
      ).toBeDisabled();

      expect(
        screen.getByRole('checkbox', {
          name: 'Mark Achievement 1 complete',
        }),
      ).toBeDisabled();

      expect(
        screen.getByRole('button', {
          name: 'Unpin Achievement 1 from focus board',
        }),
      ).toBeDisabled();

      expect(
        screen.getByRole('button', {
          name: 'Add 1 to counter for Achievement 3',
        }),
      ).toBeDisabled();
    });
  });

  describe('Oracle Focus recommendations', () => {
    it('renders recommendations with urgency, stage, and in-progress badges', () => {
      const store = createStore();
      // Initially sd-ps-001 is incomplete.
      // sd-ps-002 is blocked because sd-ps-001 is incomplete; the selector
      // still returns three eligible items under the full priority ordering.
      renderOverview({ store });

      expect(screen.getByRole('heading', { name: 'Oracle Focus' })).toBeInTheDocument();

      const recs = screen.getAllByRole('article', {
        name: /Oracle recommendation:/,
      });
      expect(recs.length).toBeLessThanOrEqual(3);
      expect(recs.length).toBe(3);

      expect(
        recs.some(
          (recommendation) =>
            within(recommendation).queryByText('Active Stage') !== null,
        ),
      ).toBe(true);
    });

    it('shows urgent/missable badge and prioritizes unlocked missable achievement', () => {
      const store = createStore();
      // Complete sd-ps-001 -> unlocks sd-ps-002 (missable with warning)
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].progress['sd-ps-001'].completed = true;

      renderOverview({ store });

      const recs = screen.getAllByRole('article', {
        name: /Oracle recommendation:/,
      });
      // sd-ps-002 is top recommendation
      expect(within(recs[0]).getByText('Urgent / Missable')).toBeInTheDocument();
      expect(within(recs[0]).getByText('Achievement 2')).toBeInTheDocument();
    });

    it('keeps exact Oracle recommendation fields absent before reveal', () => {
      const store = createStore();
      store.gameProgress['stellar-drift'].sets[
        'stellar-drift-ps'
      ].progress['sd-ps-001'].completed = true;

      renderOverview({ store });

      expect(screen.queryByText('Orbit Breaker')).not.toBeInTheDocument();
      expect(screen.queryByText('Finish Ch 3 shortcut')).not.toBeInTheDocument();
      expect(screen.queryByText('Chapter 3 only')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Take shortcut before Ch 4'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Task A')).not.toBeInTheDocument();
    });

    it('allows pinning an achievement directly from Oracle Focus recommendation card', async () => {
      const user = userEvent.setup();
      const callbacks = renderOverview();

      const pinBtn = screen.getByRole('button', {
        name: 'Pin Achievement 1 to focus board',
      });
      await user.click(pinBtn);

      expect(callbacks.onTogglePin).toHaveBeenCalledWith('sd-ps-001', true);
    });

    it('renders calm message when no recommendations qualify', () => {
      const store = createStore();
      const setProgress =
        store.gameProgress['stellar-drift'].sets['stellar-drift-ps'];
      // Mark all achievements completed
      for (const ach of psSet.achievements) {
        setProgress.progress[ach.id].completed = true;
      }

      renderOverview({ store });

      expect(
        screen.getByText(/No Oracle Focus recommendations available/i),
      ).toBeInTheDocument();
    });
  });
});
