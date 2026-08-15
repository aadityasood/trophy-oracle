import { render, screen } from '@testing-library/react';
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
import { AchievementTracker } from './AchievementTracker';

const setDefinition = mockGameStellarDrift.achievementSets[0];

function createStore(): LocalProgressStore {
  return ensureGameAndSetInitialized(
    createDefaultLocalProgressStore(),
    mockGameStellarDrift,
    setDefinition.id,
    MOCK_TIMESTAMP,
  );
}

function renderTracker(
  overrides: Partial<ComponentProps<typeof AchievementTracker>> = {},
) {
  const callbacks = {
    onBinaryCompletionChange: vi.fn(),
    onCounterValueChange: vi.fn(),
    onChecklistItemCompletionChange: vi.fn(),
    onNotesChange: vi.fn(),
    onCompletionOverrideChange: vi.fn(),
    onTogglePin: vi.fn(),
    onUndo: vi.fn(),
  };
  render(
    <AchievementTracker
      game={mockGameStellarDrift}
      set={setDefinition}
      store={createStore()}
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

describe('AchievementTracker', () => {
  it('keeps exact hidden fields out of the DOM until only that achievement is revealed', async () => {
    const user = userEvent.setup();
    renderTracker();

    expect(screen.queryByText('Orbit Breaker')).not.toBeInTheDocument();
    expect(screen.queryByText('Finish Ch 3 shortcut')).not.toBeInTheDocument();
    expect(screen.queryByText('Chapter 3 only')).not.toBeInTheDocument();
    expect(screen.queryByText('Take shortcut before Ch 4')).not.toBeInTheDocument();
    expect(screen.queryByText('Task A')).not.toBeInTheDocument();
    expect(screen.getByText(/Chapter 3 route choice/)).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: 'Reveal details for Achievement 2',
      }),
    );

    expect(screen.getByText('Orbit Breaker')).toBeInTheDocument();
    expect(screen.getByText('Finish Ch 3 shortcut')).toBeInTheDocument();
    expect(screen.getByText('Chapter 3 only')).toBeInTheDocument();
    expect(screen.getByText('Take shortcut before Ch 4')).toBeInTheDocument();
    expect(screen.queryByText('Checklist Mastery')).not.toBeInTheDocument();
    expect(screen.queryByText('Task A')).not.toBeInTheDocument();
  });

  it('gives repeated controls unique spoiler-safe accessible names', () => {
    renderTracker();

    expect(
      screen.getByRole('checkbox', {
        name: 'Mark Achievement 1 complete',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: 'Mark Achievement 2 complete',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Add 5 to counter for Achievement 3',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Override completion for Achievement 4',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', {
        name: 'Manual notes for Achievement 1',
      }),
    ).toBeInTheDocument();
  });

  it('renders a calm unavailable state when active set progress is missing', () => {
    const store = createStore();
    delete store.gameProgress['stellar-drift'].sets['stellar-drift-ps'];

    renderTracker({ store });

    expect(
      screen.getByText(
        'Progress for this platform is unavailable. Your saved data has not been changed.',
      ),
    ).toBeInTheDocument();
  });

  it('calls binary and checklist transactions only for their exact controls', async () => {
    const user = userEvent.setup();
    const callbacks = renderTracker();

    await user.click(
      screen.getByRole('checkbox', {
        name: 'Mark Achievement 1 complete',
      }),
    );
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Item 1 for Achievement 4',
      }),
    );

    expect(callbacks.onBinaryCompletionChange).toHaveBeenCalledWith(
      'sd-ps-001',
      true,
    );
    expect(callbacks.onChecklistItemCompletionChange).toHaveBeenCalledWith(
      'sd-ps-005',
      'task-a',
      true,
    );
  });

  it('supports bounded counter steps and explicit valid direct apply', async () => {
    const user = userEvent.setup();
    const callbacks = renderTracker();

    expect(screen.getByText(/0 \/ 48 \(48 remaining\)/)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Add 5 to counter for Achievement 3',
      }),
    );
    expect(callbacks.onCounterValueChange).toHaveBeenCalledWith('sd-ps-004', 5);

    const input = screen.getByRole('spinbutton', {
      name: 'Set counter for Achievement 3',
    });
    await user.clear(input);
    await user.type(input, '20');
    expect(callbacks.onCounterValueChange).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole('button', {
        name: 'Apply counter for Achievement 3',
      }),
    );
    expect(callbacks.onCounterValueChange).toHaveBeenLastCalledWith(
      'sd-ps-004',
      20,
    );
  });

  it.each(['', 'not-a-number', '-1', '1.5'])(
    'rejects the direct counter draft %j with feedback and no transaction',
    async (draft) => {
      const user = userEvent.setup();
      const callbacks = renderTracker();
      const input = screen.getByRole('spinbutton', {
        name: 'Set counter for Achievement 3',
      });
      await user.clear(input);
      if (draft !== '') await user.type(input, draft);
      await user.click(
        screen.getByRole('button', {
          name: 'Apply counter for Achievement 3',
        }),
      );

      expect(callbacks.onCounterValueChange).not.toHaveBeenCalled();
      expect(screen.getByText('Enter a non-negative whole number.')).toBeInTheDocument();
    },
  );

  it('uses explicit override confirmation and cancellation with unique controls', async () => {
    const user = userEvent.setup();
    const callbacks = renderTracker();
    const openButton = screen.getByRole('button', {
      name: 'Override completion for Achievement 3',
    });

    await user.click(openButton);
    await user.click(
      screen.getByRole('button', {
        name: 'Cancel completion override for Achievement 3',
      }),
    );
    expect(callbacks.onCompletionOverrideChange).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', {
        name: 'Override completion for Achievement 3',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Confirm completion override for Achievement 3',
      }),
    );
    expect(callbacks.onCompletionOverrideChange).toHaveBeenCalledWith(
      'sd-ps-004',
      true,
    );
  });

  it('does not save notes while typing and preserves whitespace and empty strings on explicit save', async () => {
    const user = userEvent.setup();
    const callbacks = renderTracker();
    const notes = screen.getByRole('textbox', {
      name: 'Manual notes for Achievement 1',
    });

    await user.type(notes, '  keep both sides  ');
    expect(callbacks.onNotesChange).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Save notes for Achievement 1' }),
    );
    expect(callbacks.onNotesChange).toHaveBeenLastCalledWith(
      'sd-ps-001',
      '  keep both sides  ',
    );

    await user.clear(notes);
    await user.click(
      screen.getByRole('button', { name: 'Save notes for Achievement 1' }),
    );
    expect(callbacks.onNotesChange).toHaveBeenLastCalledWith('sd-ps-001', '');
  });

  it('clears notes with undefined and formats the undo set for people', async () => {
    const user = userEvent.setup();
    const store = createStore();
    const setProgress = store.gameProgress['stellar-drift'].sets[
      'stellar-drift-ps'
    ];
    setProgress.progress['sd-ps-001'].notes = 'saved';
    store.undoState = {
      'stellar-drift': {
        setId: 'stellar-drift-ps',
        previous: structuredClone(setProgress),
      },
    };
    const onNotesChange = vi.fn();
    const onUndo = vi.fn();
    renderTracker({ store, onNotesChange, onUndo });

    await user.click(
      screen.getByRole('button', { name: 'Clear notes for Achievement 1' }),
    );
    expect(onNotesChange).toHaveBeenCalledWith('sd-ps-001', undefined);

    await user.click(
      screen.getByRole('button', {
        name: 'Undo last change in PlayStation (Standard Edition)',
      }),
    );
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('disables mutation and unsafe undo controls for incompatible progress', () => {
    renderTracker({
      isReadOnly: true,
      isUndoDisabled: true,
      undoDisabledReason: 'Undo is unavailable for this saved version.',
      store: {
        ...createStore(),
        undoState: {
          'stellar-drift': {
            setId: 'stellar-drift-ps',
            previous: createStore().gameProgress['stellar-drift'].sets[
              'stellar-drift-ps'
            ],
          },
        },
      },
    });

    expect(
      screen.getByRole('checkbox', {
        name: 'Mark Achievement 1 complete',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Undo last change in PlayStation (Standard Edition)',
      }),
    ).toBeDisabled();
  });

  it('renders pin controls with unique accessible names, aria-pressed, and calls onTogglePin', async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.gameProgress['stellar-drift'].sets[
      'stellar-drift-ps'
    ].pinnedAchievementIds = ['sd-ps-001'];
    const callbacks = renderTracker({ store });

    const pinnedButton = screen.getByRole('button', {
      name: 'Unpin Achievement 1',
    });
    expect(pinnedButton).toBeInTheDocument();
    expect(pinnedButton).toHaveAttribute('aria-pressed', 'true');
    expect(pinnedButton).toHaveTextContent('Pinned');

    const unpinnedButton = screen.getByRole('button', {
      name: 'Pin Achievement 2',
    });
    expect(unpinnedButton).toBeInTheDocument();
    expect(unpinnedButton).toHaveAttribute('aria-pressed', 'false');
    expect(unpinnedButton).toHaveTextContent('Pin');

    await user.click(pinnedButton);
    expect(callbacks.onTogglePin).toHaveBeenCalledWith('sd-ps-001', false);

    await user.click(unpinnedButton);
    expect(callbacks.onTogglePin).toHaveBeenCalledWith('sd-ps-002', true);
  });

  it('disables pin button when isReadOnly is true and displays domain error message from actionStatus', () => {
    renderTracker({
      isReadOnly: true,
      actionStatus: 'Cannot pin more than 5 achievements per set',
    });

    expect(
      screen.getByRole('button', {
        name: 'Pin Achievement 1',
      }),
    ).toBeDisabled();

    expect(
      screen.getByText('Cannot pin more than 5 achievements per set'),
    ).toBeInTheDocument();
  });
});
