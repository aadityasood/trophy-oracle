import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { loadDemoGamesDataset } from './data/demo-games';
import { DEFAULT_STORAGE_KEY } from './data/progress-storage';
import type { DatasetLoadResult } from './domain/achievement-schema';
import {
  createDefaultLocalProgressStore,
  selectGame,
  selectPreferredSet,
} from './domain/progress-engine';
import { MemoryStorage } from './test/memory-storage';
import { MOCK_TIMESTAMP } from './test/progress-fixtures';

const fixedNow = () => MOCK_TIMESTAMP;

function getDataset(): Extract<DatasetLoadResult, { success: true }> {
  const result = loadDemoGamesDataset();
  if (!result.success) throw new Error(result.error);
  return result;
}

async function chooseGame(name: string): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: new RegExp(name) }));
}

describe('App foundation and tracker integration', () => {
  it('searches without writing and exposes polite result status', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    render(<App datasetResult={getDataset()} storage={storage} now={fixedNow} />);

    expect(screen.getByRole('heading', { name: 'Trophy Oracle' })).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: 'Search games' });
    await user.type(search, 'harbor');
    expect(screen.getByRole('button', { name: /Myth Harbor/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stellar Drift/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 demo game available.')).toBeInTheDocument();
    expect(storage.writeCount).toBe(0);

    await user.clear(search);
    await user.type(search, 'missing');
    expect(screen.getByText('No games found matching "missing".')).toBeInTheDocument();
    expect(storage.writeCount).toBe(0);
  });

  it('selects a game and first set with one write, applies its theme, and restores on remount', async () => {
    const storage = new MemoryStorage();
    const { container, unmount } = render(
      <App datasetResult={getDataset()} storage={storage} now={fixedNow} />,
    );
    await chooseGame('Myth Harbor');

    expect(storage.writeCount).toBe(1);
    expect(screen.getByRole('heading', { name: 'Myth Harbor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Platinum Roadmap' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Select platform and edition' })).getByRole(
        'radio',
        { name: 'PlayStation (Standard Edition)' },
      ),
    ).toBeChecked();
    expect(container.firstElementChild).toHaveStyle({
      '--theme-primary': '#34d399',
      '--theme-secondary': '#fbbf24',
      '--theme-surface-glow': '#10b981',
    });
    await userEvent.setup().click(
      screen.getByRole('checkbox', {
        name: 'Mark Achievement 1 complete',
      }),
    );
    unmount();

    render(<App datasetResult={getDataset()} storage={storage} now={fixedNow} />);
    expect(screen.getByRole('heading', { name: 'Myth Harbor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Platinum Roadmap' })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: 'Mark Achievement 1 complete',
      }),
    ).toBeChecked();
  });

  it('persists binary completion and one-step undo restores it', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    render(<App datasetResult={getDataset()} storage={storage} now={fixedNow} />);
    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));

    const checkbox = screen.getByRole('checkbox', {
      name: 'Mark Achievement 1 complete',
    });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(storage.writeCount).toBe(2);

    await user.click(
      screen.getByRole('button', {
        name: 'Undo last change in PlayStation (Standard Edition)',
      }),
    );
    expect(checkbox).not.toBeChecked();
    expect(storage.writeCount).toBe(3);
  });

  it('handles bounded counter steps, direct apply, remaining count, and derived completion', async () => {
    const user = userEvent.setup();
    render(<App datasetResult={getDataset()} storage={null} now={fixedNow} />);
    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));
    const card = screen.getByRole('article', { name: 'Achievement 4' });

    expect(within(card).getByText(/0 \/ 48 \(48 remaining\)/)).toBeInTheDocument();
    await user.click(
      within(card).getByRole('button', {
        name: 'Add 5 to counter for Achievement 4',
      }),
    );
    expect(within(card).getByText(/5 \/ 48 \(43 remaining\)/)).toBeInTheDocument();

    const input = within(card).getByRole('spinbutton', {
      name: 'Set counter for Achievement 4',
    });
    await user.clear(input);
    await user.type(input, '48');
    await user.click(
      within(card).getByRole('button', {
        name: 'Apply counter for Achievement 4',
      }),
    );
    expect(within(card).getByText('State: Complete')).toBeInTheDocument();

    await user.click(
      within(card).getByRole('button', {
        name: 'Decrease counter for Achievement 4',
      }),
    );
    expect(within(card).getByText(/47 \/ 48 \(1 remaining\)/)).toBeInTheDocument();
    expect(within(card).getByText('State: Incomplete')).toBeInTheDocument();
  });

  it.each(['', 'not-a-number', '-1', '1.5'])(
    'rejects direct counter draft %j without a storage write',
    async (draft) => {
      const user = userEvent.setup();
      const storage = new MemoryStorage();
      render(<App datasetResult={getDataset()} storage={storage} now={fixedNow} />);
      await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));
      const card = screen.getByRole('article', { name: 'Achievement 4' });
      const input = within(card).getByRole('spinbutton', {
        name: 'Set counter for Achievement 4',
      });
      const writesBefore = storage.writeCount;

      await user.clear(input);
      if (draft !== '') await user.type(input, draft);
      await user.click(
        within(card).getByRole('button', {
          name: 'Apply counter for Achievement 4',
        }),
      );

      expect(
        within(card).getByText('Enter a non-negative whole number.'),
      ).toBeInTheDocument();
      expect(storage.writeCount).toBe(writesBefore);
    },
  );

  it('keeps an open counter derived-incomplete through increments and supports confirmed override reset', async () => {
    const user = userEvent.setup();
    render(<App datasetResult={getDataset()} storage={null} now={fixedNow} />);
    await user.click(screen.getByRole('button', { name: /Ashen Circuit/ }));
    const card = screen.getByRole('article', { name: 'Achievement 5' });

    expect(within(card).getByText(/0 duels \(open counter\)/)).toBeInTheDocument();
    await user.click(
      within(card).getByRole('button', {
        name: 'Add 1 to counter for Achievement 5',
      }),
    );
    expect(within(card).getByText('State: Incomplete')).toBeInTheDocument();

    await user.click(
      within(card).getByRole('button', {
        name: 'Override completion for Achievement 5',
      }),
    );
    await user.click(
      within(card).getByRole('button', {
        name: 'Confirm completion override for Achievement 5',
      }),
    );
    expect(within(card).getByText('State: Complete')).toBeInTheDocument();

    await user.click(
      within(card).getByRole('button', {
        name: 'Return Achievement 5 to tracker-derived completion',
      }),
    );
    expect(within(card).getByText('State: Incomplete')).toBeInTheDocument();
  });

  it('types notes without writing, then saves, clears, and undoes explicit transactions', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    render(<App datasetResult={getDataset()} storage={storage} now={fixedNow} />);
    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));
    const notes = screen.getByRole('textbox', {
      name: 'Manual notes for Achievement 1',
    });
    const writesAfterSelection = storage.writeCount;

    await user.type(notes, '  saved note  ');
    expect(storage.writeCount).toBe(writesAfterSelection);
    await user.click(
      screen.getByRole('button', { name: 'Save notes for Achievement 1' }),
    );
    expect(storage.writeCount).toBe(writesAfterSelection + 1);
    await user.click(
      screen.getByRole('button', {
        name: 'Undo last change in PlayStation (Standard Edition)',
      }),
    );
    expect(notes).toHaveValue('');

    await user.type(notes, '  saved note  ');
    await user.click(
      screen.getByRole('button', { name: 'Save notes for Achievement 1' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Clear notes for Achievement 1' }),
    );
    expect(notes).toHaveValue('');

    await user.click(
      screen.getByRole('button', {
        name: 'Undo last change in PlayStation (Standard Edition)',
      }),
    );
    expect(notes).toHaveValue('  saved note  ');
  });

  it('keeps platform progress independent and undoes the recorded set while another set is viewed', async () => {
    const user = userEvent.setup();
    render(<App datasetResult={getDataset()} storage={null} now={fixedNow} />);
    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    );
    const setGroup = screen.getByRole('group', {
      name: 'Select platform and edition',
    });
    await user.click(
      within(setGroup).getByRole('radio', {
        name: 'Steam (Standard Edition)',
      }),
    );

    expect(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    ).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /Ashen Circuit/ }));
    expect(
      within(
        screen.getByRole('group', { name: 'Select platform and edition' }),
      ).getByRole('radio', { name: 'Xbox (Standard Edition)' }),
    ).toBeChecked();
    await user.click(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    ).toBeChecked();

    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));
    const restoredSetGroup = screen.getByRole('group', {
      name: 'Select platform and edition',
    });
    expect(
      within(restoredSetGroup).getByRole('radio', {
        name: 'Steam (Standard Edition)',
      }),
    ).toBeChecked();
    await user.click(
      screen.getByRole('button', {
        name: 'Undo last change in PlayStation (Standard Edition)',
      }),
    );
    await user.click(
      within(restoredSetGroup).getByRole('radio', {
        name: 'PlayStation (Standard Edition)',
      }),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    ).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /Ashen Circuit/ }));
    expect(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    ).toBeChecked();
  });

  it('preserves invalid saved bytes and keeps session mutations in memory without writes', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    const raw = '{ malformed progress';
    storage.seed(DEFAULT_STORAGE_KEY, raw);
    render(<App datasetResult={getDataset()} storage={storage} now={fixedNow} />);

    expect(screen.getByText(/will not overwrite it/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    ).toBeChecked();
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(raw);
    expect(storage.writeCount).toBe(0);
  });

  it('keeps failed saves in memory and clears not-saved status after recovery', async () => {
    const user = userEvent.setup();
    const storage = new MemoryStorage();
    storage.setWriteError(new Error('quota exceeded'));
    render(<App datasetResult={getDataset()} storage={storage} now={fixedNow} />);
    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));

    expect(screen.getByText(/Progress not saved:.*quota exceeded/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Stellar Drift' })).toBeInTheDocument();
    storage.setWriteError(null);
    await user.click(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    );
    expect(screen.queryByText(/Progress not saved/i)).not.toBeInTheDocument();
  });

  it('locks only a stored set with a mismatched definition version and performs no unsafe write', async () => {
    const user = userEvent.setup();
    const dataset = getDataset();
    const game = dataset.data.games.find((candidate) => candidate.id === 'stellar-drift');
    if (!game) throw new Error('Missing Stellar Drift fixture');
    let store = selectGame(createDefaultLocalProgressStore(), game, MOCK_TIMESTAMP);
    store = selectPreferredSet(store, game, 'stellar-drift-ps', MOCK_TIMESTAMP);
    store.gameProgress[game.id].sets['stellar-drift-ps'].version = 'older-version';
    const raw = JSON.stringify(store);
    const storage = new MemoryStorage();
    storage.seed(DEFAULT_STORAGE_KEY, raw);

    render(<App datasetResult={dataset} storage={storage} now={fixedNow} />);
    expect(screen.getByText(/different data version/i)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }),
    ).toBeDisabled();
    expect(storage.writeCount).toBe(0);
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBe(raw);

    await user.click(
      within(screen.getByRole('group', { name: 'Select platform and edition' })).getByRole(
        'radio',
        { name: 'Steam (Standard Edition)' },
      ),
    );
    const compatibleCheckbox = screen.getByRole('checkbox', {
      name: 'Mark Achievement 1 complete',
    });
    expect(compatibleCheckbox).toBeEnabled();
    await user.click(compatibleCheckbox);
    expect(compatibleCheckbox).toBeChecked();
  });

  it('remounts reveal state on combined game and set identity', async () => {
    const user = userEvent.setup();
    const dataset = structuredClone(getDataset());
    const game = dataset.data.games[0];
    const secondEdition = structuredClone(game.achievementSets[0]);
    secondEdition.id = 'stellar-drift-ps-second-edition';
    secondEdition.edition = 'Second Edition';
    game.achievementSets = [game.achievementSets[0], secondEdition];
    render(<App datasetResult={dataset} storage={null} now={fixedNow} />);
    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));
    await user.click(
      screen.getByRole('button', {
        name: 'Reveal details for Achievement 1',
      }),
    );
    expect(screen.getByText('First Burn')).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('group', { name: 'Select platform and edition' })).getByRole(
        'radio',
        { name: 'PlayStation (Second Edition)' },
      ),
    );
    expect(screen.queryByText('First Burn')).not.toBeInTheDocument();
    expect(screen.getByText('Achievement 1')).toBeInTheDocument();
  });

  it('keeps no-set and dataset-failure transitions safe without changing hook order', async () => {
    const dataset = structuredClone(getDataset());
    dataset.data.games[0].achievementSets = [];
    const failed: DatasetLoadResult = {
      success: false,
      error: 'private validation details',
    };
    const { rerender } = render(
      <App datasetResult={failed} storage={null} now={fixedNow} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Demo data unavailable');
    expect(screen.queryByText('private validation details')).not.toBeInTheDocument();

    rerender(<App datasetResult={dataset} storage={null} now={fixedNow} />);
    await chooseGame('Stellar Drift');
    expect(screen.getByText('No achievement sets are available for this game.')).toBeInTheDocument();
    expect(screen.getByText('Fictional demo data')).toHaveClass('self-start');
  });
});
