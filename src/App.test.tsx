import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { loadDemoGamesDataset } from './data/demo-games';
import type {
  DatasetLoadResult,
  DemoGamesDataset,
} from './domain/achievement-schema';

function getSuccessfulDatasetResult(): Extract<
  DatasetLoadResult,
  { success: true }
> {
  const result = loadDemoGamesDataset();
  if (!result.success) {
    throw new Error(result.error);
  }
  return result;
}

describe('App foundation UI', () => {
  it('searches demo games and exposes a polite result status', async () => {
    const user = userEvent.setup();
    render(<App datasetResult={getSuccessfulDatasetResult()} />);

    expect(
      screen.getByRole('heading', { name: 'Trophy Oracle' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Stellar Drift/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Myth Harbor/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Ashen Circuit/ }),
    ).toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox', {
      name: 'Search games',
    });
    await user.type(searchInput, 'harbor');

    expect(
      screen.getByRole('button', { name: /Myth Harbor/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Stellar Drift/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 demo game available.',
    );

    await user.clear(searchInput);
    await user.type(searchInput, 'nonexistentgame');

    expect(screen.getByRole('status')).toHaveTextContent(
      'No games found matching "nonexistentgame".',
    );
  });

  it('selects a labelled platform and edition choice and updates roadmap labels both ways', async () => {
    const user = userEvent.setup();
    render(<App datasetResult={getSuccessfulDatasetResult()} />);

    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));

    expect(screen.getByText('Fictional demo data')).toBeInTheDocument();
    const setGroup = screen.getByRole('group', {
      name: 'Select platform and edition',
    });
    const playStationSet = within(setGroup).getByRole('radio', {
      name: 'PlayStation (Standard Edition)',
    });
    const steamSet = within(setGroup).getByRole('radio', {
      name: 'Steam (Standard Edition)',
    });

    expect(playStationSet).toBeChecked();
    expect(
      screen.getByRole('heading', { name: 'Platinum Roadmap' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('First Burn')).not.toBeInTheDocument();

    await user.click(steamSet);
    expect(steamSet).toBeChecked();
    expect(playStationSet).not.toBeChecked();
    expect(
      screen.getByRole('heading', { name: '100% Roadmap' }),
    ).toBeInTheDocument();

    await user.click(playStationSet);
    expect(playStationSet).toBeChecked();
    expect(
      screen.getByRole('heading', { name: 'Platinum Roadmap' }),
    ).toBeInTheDocument();
  });

  it('renders calm local-data failure copy without raw validation details', () => {
    const failedResult: DatasetLoadResult = {
      success: false,
      error: 'games.0.id: Duplicate game ID: stellar-drift',
    };

    render(<App datasetResult={failedResult} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Demo data unavailable' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/could not open its trusted local demo data/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('games.0.id: Duplicate game ID: stellar-drift'),
    ).not.toBeInTheDocument();
  });

  it('rerenders safely from success to failure and back to success', () => {
    const successfulResult = getSuccessfulDatasetResult();
    const failedResult: DatasetLoadResult = {
      success: false,
      error: 'Raw diagnostic reserved for code and tests',
    };
    const { rerender } = render(<App datasetResult={successfulResult} />);

    expect(
      screen.getByRole('button', { name: /Stellar Drift/ }),
    ).toBeInTheDocument();

    rerender(<App datasetResult={failedResult} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<App datasetResult={successfulResult} />);
    expect(
      screen.getByRole('button', { name: /Stellar Drift/ }),
    ).toBeInTheDocument();
  });

  it('shows a clear state when a selected game has no achievement sets', async () => {
    const user = userEvent.setup();
    const dataset = structuredClone(
      getSuccessfulDatasetResult().data,
    ) as DemoGamesDataset;
    dataset.games[0].achievementSets = [];

    render(<App datasetResult={{ success: true, data: dataset }} />);
    await user.click(screen.getByRole('button', { name: /Stellar Drift/ }));

    const emptyState = screen.getByText(
      'No achievement sets are available for this game.',
    );
    expect(emptyState).toHaveAttribute('role', 'status');
    expect(
      screen.queryByRole('heading', { name: /Roadmap/ }),
    ).not.toBeInTheDocument();
  });
});
