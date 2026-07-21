import { describe, expect, it } from 'vitest';
import rawDemoGames from '../../data/source-of-truth/demo-games.json';
import { validateDemoGamesDataset } from './achievement-schema';
import type { DemoGamesDataset } from './achievement-schema';

function getValidDataset(): DemoGamesDataset {
  const result = validateDemoGamesDataset(rawDemoGames);
  if (!result.success) {
    throw new Error(result.error);
  }
  return structuredClone(result.data);
}

function expectInvalid(
  dataset: DemoGamesDataset,
  expectedMessage?: string,
): void {
  const result = validateDemoGamesDataset(dataset);
  expect(result.success).toBe(false);
  if (!result.success && expectedMessage) {
    expect(result.error).toContain(expectedMessage);
  }
}

describe('Achievement schema and trusted dataset validation', () => {
  it('parses the real demo dataset with 3 games, 4 sets, and 21 achievements', () => {
    const result = validateDemoGamesDataset(rawDemoGames);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.games).toHaveLength(3);
    expect(
      result.data.games.reduce(
        (total, game) => total + game.achievementSets.length,
        0,
      ),
    ).toBe(4);
    expect(
      result.data.games.reduce(
        (gameTotal, game) =>
          gameTotal +
          game.achievementSets.reduce(
            (setTotal, set) => setTotal + set.achievements.length,
            0,
          ),
        0,
      ),
    ).toBe(21);
  });

  it('rejects a duplicate game ID', () => {
    const invalid = getValidDataset();
    invalid.games.push(structuredClone(invalid.games[0]));

    expectInvalid(invalid, 'Duplicate game ID');
  });

  it('rejects a duplicate achievement-set ID', () => {
    const invalid = getValidDataset();
    invalid.games[1].achievementSets.push(
      structuredClone(invalid.games[0].achievementSets[0]),
    );

    expectInvalid(invalid, 'Duplicate achievement set ID');
  });

  it('rejects a duplicate achievement ID within one set', () => {
    const invalid = getValidDataset();
    const set = invalid.games[0].achievementSets[0];
    set.achievements.push(structuredClone(set.achievements[0]));

    expectInvalid(invalid, 'Duplicate achievement ID');
  });

  it('rejects a duplicate platform and edition pair within one game', () => {
    const invalid = getValidDataset();
    const duplicatePair = structuredClone(
      invalid.games[0].achievementSets[0],
    );
    duplicatePair.id = 'stellar-drift-ps-duplicate-pair';
    invalid.games[0].achievementSets.push(duplicatePair);

    expectInvalid(invalid, 'Duplicate platform/edition pair');
  });

  it('rejects a PlayStation reward mismatch', () => {
    const invalid = getValidDataset();
    invalid.games[0].achievementSets[0].achievements[0].reward = {
      type: 'gamerscore',
      points: 100,
    };

    expectInvalid(
      invalid,
      "Platform 'playstation' requires 'trophy' reward",
    );
  });

  it('requires generic achievement rewards for other-platform records', () => {
    const invalid = getValidDataset();
    const set = invalid.games[0].achievementSets[1];
    set.platform = 'other';
    set.achievements[0].reward = { type: 'trophy', grade: 'bronze' };

    expectInvalid(invalid, "Platform 'other' requires 'achievement' reward");
  });

  it('rejects a cross-set prerequisite', () => {
    const invalid = getValidDataset();
    invalid.games[0].achievementSets[0].achievements[0].prerequisites = [
      'sd-steam-001',
    ];

    expectInvalid(invalid, 'does not exist in set');
  });

  it('rejects a self-prerequisite', () => {
    const invalid = getValidDataset();
    invalid.games[0].achievementSets[0].achievements[0].prerequisites = [
      'sd-ps-001',
    ];

    expectInvalid(invalid, 'cannot list itself as a prerequisite');
  });

  it('rejects a counter with a whitespace-only unit', () => {
    const invalid = getValidDataset();
    invalid.games[0].achievementSets[0].achievements[3].tracking = {
      mode: 'counter',
      unit: '   ',
    };

    expectInvalid(invalid, 'non-whitespace');
  });

  it('rejects an empty checklist', () => {
    const invalid = getValidDataset();
    invalid.games[1].achievementSets[0].achievements[2].tracking = {
      mode: 'checklist',
      items: [],
    };

    expectInvalid(invalid);
  });

  it('rejects duplicate checklist item IDs', () => {
    const invalid = getValidDataset();
    const tracking = invalid.games[1].achievementSets[0].achievements[2]
      .tracking;
    if (tracking.mode !== 'checklist') {
      throw new Error('Expected checklist fixture');
    }
    tracking.items[1].id = tracking.items[0].id;

    expectInvalid(invalid, 'Checklist item IDs must be unique');
  });

  it('rejects duplicate counter quick steps', () => {
    const invalid = getValidDataset();
    invalid.games[0].achievementSets[0].achievements[3].tracking = {
      mode: 'counter',
      unit: 'beacons',
      target: 48,
      quickSteps: [1, 1],
    };

    expectInvalid(invalid, 'quickSteps must contain distinct');
  });

  it.each([-0.01, 1.01])(
    'rejects confidence outside the inclusive range: %s',
    (confidence) => {
      const invalid = getValidDataset();
      invalid.games[0].achievementSets[0].achievements[0].confidence =
        confidence;

      expectInvalid(invalid);
    },
  );

  it('rejects a warning without its required spoiler-safe hint', () => {
    const invalid = getValidDataset();
    delete invalid.games[0].achievementSets[0].achievements[1]
      .spoilerSafeHint;

    expectInvalid(invalid, 'requires a non-empty spoilerSafeHint');
  });

  it('rejects checklist tracking without its required spoiler-safe hint', () => {
    const invalid = getValidDataset();
    delete invalid.games[1].achievementSets[0].achievements[2]
      .spoilerSafeHint;

    expectInvalid(invalid, 'requires a non-empty spoilerSafeHint');
  });

  it('rejects forbidden extra state on a binary tracker', () => {
    const invalid = getValidDataset();
    const binaryTracking = invalid.games[0].achievementSets[0].achievements[0]
      .tracking as { mode: 'binary'; target?: number };
    binaryTracking.target = 1;

    expectInvalid(invalid, 'target');
  });

  it('rejects whitespace-only stable IDs without rewriting them', () => {
    const invalid = getValidDataset();
    invalid.games[0].id = '   ';

    expectInvalid(invalid, 'non-whitespace');
  });

  it('rejects whitespace-only required evidence', () => {
    const invalid = getValidDataset();
    invalid.games[0].achievementSets[0].achievements[0].evidence = '   ';

    expectInvalid(invalid, 'non-whitespace');
  });
});
