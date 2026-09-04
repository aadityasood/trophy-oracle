import type {
  AchievementRecord,
  AchievementSet,
  GameRecord,
} from './achievement-schema';

export const TS1 = '2026-07-22T00:00:00.000Z';
export const TS2 = '2026-07-23T00:00:00.000Z';

export function createBinaryAchievement(
  id: string,
  overrides?: Partial<AchievementRecord>,
): AchievementRecord {
  return {
    id,
    name: `Achievement ${id}`,
    description: `Description ${id}`,
    evidence: 'Mandatory',
    reward: { type: 'achievement' },
    tracking: { mode: 'binary' },
    labels: ['story'],
    expectedStage: 'story',
    confidence: 1,
    prerequisites: [],
    ...overrides,
  };
}

export function createCounterAchievement(
  id: string,
  target?: number,
  overrides?: Partial<AchievementRecord>,
): AchievementRecord {
  return {
    id,
    name: `Achievement ${id}`,
    description: `Description ${id}`,
    evidence: 'Mandatory',
    reward: { type: 'achievement' },
    tracking:
      target !== undefined
        ? { mode: 'counter', unit: 'items', target }
        : { mode: 'counter', unit: 'items' },
    labels: ['completion'],
    expectedStage: 'cleanup',
    confidence: 1,
    prerequisites: [],
    ...overrides,
  };
}

export function createChecklistAchievement(
  id: string,
  itemIds: string[],
  overrides?: Partial<AchievementRecord>,
): AchievementRecord {
  return {
    id,
    name: `Achievement ${id}`,
    description: `Description ${id}`,
    evidence: 'Mandatory',
    reward: { type: 'achievement' },
    tracking: {
      mode: 'checklist',
      items: itemIds.map((itemId) => ({ id: itemId, name: `Item ${itemId}` })),
    },
    labels: ['missable'],
    expectedStage: 'missables',
    confidence: 1,
    prerequisites: [],
    spoilerSafeHint: 'Check required locations.',
    ...overrides,
  };
}

export function createTestSet(
  id: string,
  version: string,
  achievements: AchievementRecord[],
): AchievementSet {
  return {
    id,
    platform: 'steam',
    version,
    achievements,
  };
}

export function createTestGame(
  id: string,
  version: string,
  achievementSets: AchievementSet[],
): GameRecord {
  return {
    id,
    title: `Game ${id}`,
    aliases: [],
    sourceType: 'fictional_demo',
    version,
    theme: {
      primary: '#ffffff',
      secondary: '#000000',
      surfaceGlow: '#888888',
      mood: 'test',
    },
    summary: 'A test game record',
    achievementSets,
  };
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}
