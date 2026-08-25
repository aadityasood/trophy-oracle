import { describe, expect, it } from 'vitest';
import {
  CURRENT_STORE_SCHEMA_VERSION,
  AchievementProgressSchema,
  AchievementSetProgressSchema,
  GameProgressSchema,
  LocalProgressStoreSchema,
  ProgressUndoSnapshotSchema,
  ReconciliationDeltaReportSchema,
} from './progress-schema';
import type {
  AchievementProgress,
  LocalProgressStore,
} from './progress-schema';
import { RESERVED_RECORD_KEY_MESSAGE } from './progress-schema-common';

const TIMESTAMP = '2026-07-22T00:00:00.000Z';

function createValidStore(): LocalProgressStore {
  return {
    schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
    lastGameId: 'game-1',
    gameProgress: {
      'game-1': {
        gameId: 'game-1',
        preferredSetId: 'set-1',
        sets: {
          'set-1': {
            setId: 'set-1',
            version: '1.0',
            activeStage: 'story',
            pinnedAchievementIds: ['achievement-1'],
            progress: {
              'achievement-1': {
                achievementId: 'achievement-1',
                completed: true,
                manualOverride: false,
                notes: 'preserved',
                lastUpdated: TIMESTAMP,
                provenance: 'manual',
              },
            },
          },
        },
        orphanedProgress: {},
      },
    },
  };
}

describe('progress schema', () => {
  it('accepts a complete current-version store', () => {
    expect(LocalProgressStoreSchema.safeParse(createValidStore()).success).toBe(
      true,
    );
  });

  it('rejects unsupported versions and strict extra keys', () => {
    const unsupported = { ...createValidStore(), schemaVersion: '1.0' };
    expect(LocalProgressStoreSchema.safeParse(unsupported).success).toBe(false);

    const withExtraKey = { ...createValidStore(), unexpected: true };
    expect(LocalProgressStoreSchema.safeParse(withExtraKey).success).toBe(false);
  });

  it('rejects whitespace-only identities, references, and map keys without rewriting them', () => {
    const blankGameId = createValidStore();
    blankGameId.gameProgress['game-1'].gameId = '   ';
    expect(LocalProgressStoreSchema.safeParse(blankGameId).success).toBe(false);

    const blankGameKey: unknown = {
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        ' ': { gameId: ' ', sets: {}, orphanedProgress: {} },
      },
    };
    expect(LocalProgressStoreSchema.safeParse(blankGameKey).success).toBe(false);

    const blankPreferredSet = createValidStore();
    blankPreferredSet.gameProgress['game-1'].preferredSetId = ' ';
    expect(LocalProgressStoreSchema.safeParse(blankPreferredSet).success).toBe(
      false,
    );

    const blankProgressKey: unknown = {
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        game: {
          gameId: 'game',
          sets: {
            set: {
              setId: 'set',
              version: '1',
              pinnedAchievementIds: [],
              progress: {
                ' ': {
                  achievementId: ' ',
                  completed: false,
                  manualOverride: false,
                  lastUpdated: TIMESTAMP,
                  provenance: 'manual',
                },
              },
            },
          },
          orphanedProgress: {},
        },
      },
    };
    expect(LocalProgressStoreSchema.safeParse(blankProgressKey).success).toBe(
      false,
    );

    const blankSetKey: unknown = {
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        game: {
          gameId: 'game',
          sets: {
            ' ': {
              setId: ' ',
              version: '1',
              pinnedAchievementIds: [],
              progress: {},
            },
          },
          orphanedProgress: {},
        },
      },
    };
    expect(LocalProgressStoreSchema.safeParse(blankSetKey).success).toBe(false);
  });

  it('rejects game, set, progress, and orphan map-key identity mismatches', () => {
    const gameMismatch = createValidStore();
    gameMismatch.gameProgress['game-1'].gameId = 'different-game';
    expect(LocalProgressStoreSchema.safeParse(gameMismatch).success).toBe(false);

    const setMismatch = createValidStore();
    setMismatch.gameProgress['game-1'].sets['set-1'].setId = 'different-set';
    expect(LocalProgressStoreSchema.safeParse(setMismatch).success).toBe(false);

    const progressMismatch = createValidStore();
    progressMismatch.gameProgress['game-1'].sets['set-1'].progress[
      'achievement-1'
    ].achievementId = 'different-achievement';
    expect(LocalProgressStoreSchema.safeParse(progressMismatch).success).toBe(
      false,
    );

    const orphanMismatch: unknown = {
      ...createValidStore(),
      gameProgress: {
        'game-1': {
          ...createValidStore().gameProgress['game-1'],
          orphanedProgress: {
            'set-old': {
              'achievement-old': {
                achievementId: 'different-achievement',
                completed: false,
                manualOverride: false,
                lastUpdated: TIMESTAMP,
                provenance: 'manual',
                trackingModeAtRemoval: 'binary',
              },
            },
          },
        },
      },
    };
    expect(LocalProgressStoreSchema.safeParse(orphanMismatch).success).toBe(
      false,
    );
  });

  it('enforces pin uniqueness, the five-pin limit, and active-progress membership', () => {
    const duplicatePins = createValidStore();
    duplicatePins.gameProgress['game-1'].sets[
      'set-1'
    ].pinnedAchievementIds = ['achievement-1', 'achievement-1'];
    expect(LocalProgressStoreSchema.safeParse(duplicatePins).success).toBe(false);

    const sixPins: unknown = {
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        game: {
          gameId: 'game',
          sets: {
            set: {
              setId: 'set',
              version: '1',
              pinnedAchievementIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
              progress: {},
            },
          },
          orphanedProgress: {},
        },
      },
    };
    expect(LocalProgressStoreSchema.safeParse(sixPins).success).toBe(false);

    const absentPin = createValidStore();
    absentPin.gameProgress['game-1'].sets['set-1'].pinnedAchievementIds = [
      'missing-achievement',
    ];
    expect(LocalProgressStoreSchema.safeParse(absentPin).success).toBe(false);
  });

  it('rejects invalid counter, checklist, provenance, and timestamp values', () => {
    const negativeCounter = {
      achievementId: 'achievement',
      completed: false,
      manualOverride: false,
      counterValue: -1,
      lastUpdated: TIMESTAMP,
      provenance: 'manual',
    };
    const fractionalCounter = { ...negativeCounter, counterValue: 1.5 };
    const invalidChecklist = {
      ...negativeCounter,
      counterValue: undefined,
      checklistCompletion: { item: 'yes' },
    };
    const invalidProvenance = { ...negativeCounter, provenance: 'ai' };
    const invalidTimestamp = { ...negativeCounter, lastUpdated: '2026-02-30T00:00:00Z' };

    const wrapProgress = (progress: unknown): unknown => ({
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        game: {
          gameId: 'game',
          sets: {
            set: {
              setId: 'set',
              version: '1',
              pinnedAchievementIds: [],
              progress: { achievement: progress },
            },
          },
          orphanedProgress: {},
        },
      },
    });

    expect(LocalProgressStoreSchema.safeParse(wrapProgress(negativeCounter)).success).toBe(false);
    expect(LocalProgressStoreSchema.safeParse(wrapProgress(fractionalCounter)).success).toBe(false);
    expect(LocalProgressStoreSchema.safeParse(wrapProgress(invalidChecklist)).success).toBe(false);
    expect(LocalProgressStoreSchema.safeParse(wrapProgress(invalidProvenance)).success).toBe(false);
    expect(LocalProgressStoreSchema.safeParse(wrapProgress(invalidTimestamp)).success).toBe(false);
  });

  it('accepts valid counter, checklist, and supported provenance values', () => {
    const store: unknown = {
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        game: {
          gameId: 'game',
          sets: {
            set: {
              setId: 'set',
              version: '1',
              pinnedAchievementIds: [],
              progress: {
                counter: {
                  achievementId: 'counter',
                  completed: false,
                  manualOverride: false,
                  counterValue: 2,
                  lastUpdated: TIMESTAMP,
                  provenance: 'imported',
                },
                checklist: {
                  achievementId: 'checklist',
                  completed: false,
                  manualOverride: false,
                  checklistCompletion: { item: true },
                  lastUpdated: TIMESTAMP,
                  provenance: 'platform',
                },
              },
            },
          },
          orphanedProgress: {},
        },
      },
    };
    expect(LocalProgressStoreSchema.safeParse(store).success).toBe(true);
  });

  it('enforces mode-faithful orphan tracker shapes and valid overrides', () => {
    const baseOrphan = {
      achievementId: 'orphan',
      completed: false,
      manualOverride: false,
      lastUpdated: TIMESTAMP,
      provenance: 'manual',
    };
    const storeWithOrphan = (orphan: unknown): unknown => ({
      ...createValidStore(),
      gameProgress: {
        'game-1': {
          ...createValidStore().gameProgress['game-1'],
          orphanedProgress: { old: { orphan } },
        },
      },
    });

    expect(
      LocalProgressStoreSchema.safeParse(
        storeWithOrphan({ ...baseOrphan, trackingModeAtRemoval: 'binary' }),
      ).success,
    ).toBe(true);
    expect(
      LocalProgressStoreSchema.safeParse(
        storeWithOrphan({
          ...baseOrphan,
          trackingModeAtRemoval: 'binary',
          counterValue: 0,
        }),
      ).success,
    ).toBe(false);
    expect(
      LocalProgressStoreSchema.safeParse(
        storeWithOrphan({ ...baseOrphan, trackingModeAtRemoval: 'counter' }),
      ).success,
    ).toBe(false);
    expect(
      LocalProgressStoreSchema.safeParse(
        storeWithOrphan({
          ...baseOrphan,
          trackingModeAtRemoval: 'checklist',
          checklistCompletion: { item: false },
        }),
      ).success,
    ).toBe(true);
    expect(
      LocalProgressStoreSchema.safeParse(
        storeWithOrphan({
          ...baseOrphan,
          completed: false,
          manualOverride: true,
          counterValue: 1,
          trackingModeAtRemoval: 'counter',
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects inconsistent selection and undo references', () => {
    const badLastGame = createValidStore();
    badLastGame.lastGameId = 'missing-game';
    expect(LocalProgressStoreSchema.safeParse(badLastGame).success).toBe(false);

    const badPreferredSet = createValidStore();
    badPreferredSet.gameProgress['game-1'].preferredSetId = 'missing-set';
    expect(LocalProgressStoreSchema.safeParse(badPreferredSet).success).toBe(
      false,
    );

    const mismatchedUndo = createValidStore();
    mismatchedUndo.undoState = {
      'game-1': {
        setId: 'set-1',
        previous: {
          ...structuredClone(
            mismatchedUndo.gameProgress['game-1'].sets['set-1'],
          ),
          setId: 'different-set',
        },
      },
    };
    expect(LocalProgressStoreSchema.safeParse(mismatchedUndo).success).toBe(
      false,
    );

    const staleButInternallyConsistentUndo = createValidStore();
    staleButInternallyConsistentUndo.undoState = {
      'game-1': {
        setId: 'missing-set',
        previous: {
          ...structuredClone(
            staleButInternallyConsistentUndo.gameProgress['game-1'].sets[
              'set-1'
            ],
          ),
          setId: 'missing-set',
        },
      },
    };
    expect(
      LocalProgressStoreSchema.safeParse(staleButInternallyConsistentUndo)
        .success,
    ).toBe(true);

    const missingUndoGame = createValidStore();
    missingUndoGame.undoState = {
      missing: {
        setId: 'set-1',
        previous: structuredClone(
          missingUndoGame.gameProgress['game-1'].sets['set-1'],
        ),
      },
    };
    expect(LocalProgressStoreSchema.safeParse(missingUndoGame).success).toBe(
      false,
    );
  });

  function findReservedIssue(
    result: {
      success: false;
      error: { issues: Array<{ message: string; path: PropertyKey[] }> };
    },
  ): { message: string; path: PropertyKey[] } | undefined {
    return result.error.issues.find(
      (issue) => issue.message === RESERVED_RECORD_KEY_MESSAGE,
    );
  }

  it('rejects an own reserved key at every Schema 2.0 persisted record level with nested paths', () => {
    const validAchievementProgress = (
      achievementId: string,
    ): AchievementProgress => ({
      achievementId,
      completed: false,
      manualOverride: false,
      lastUpdated: TIMESTAMP,
      provenance: 'manual',
    });

    const cases: { name: string; mutate: (store: LocalProgressStore) => void; expectedPath: (string | number)[] }[] = [
      {
        name: 'checklistCompletion',
        mutate: (store) => {
          store.gameProgress['game-1'].sets['set-1'].progress[
            'achievement-1'
          ].checklistCompletion = JSON.parse('{"__proto__": true}');
        },
        expectedPath: [
          'gameProgress',
          'game-1',
          'sets',
          'set-1',
          'progress',
          'achievement-1',
          'checklistCompletion',
          '__proto__',
        ],
      },
      {
        name: 'progress',
        mutate: (store) => {
          store.gameProgress['game-1'].sets['set-1'].progress = JSON.parse(
            '{"__proto__": ' +
              JSON.stringify(validAchievementProgress('__proto__')) +
              '}',
          );
        },
        expectedPath: [
          'gameProgress',
          'game-1',
          'sets',
          'set-1',
          'progress',
          '__proto__',
        ],
      },
      {
        name: 'sets',
        mutate: (store) => {
          const setProgress = store.gameProgress['game-1'].sets['set-1'];
          store.gameProgress['game-1'].sets = JSON.parse(
            '{"__proto__": ' + JSON.stringify(setProgress) + '}',
          );
        },
        expectedPath: ['gameProgress', 'game-1', 'sets', '__proto__'],
      },
      {
        name: 'orphanedProgress outer map',
        mutate: (store) => {
          store.gameProgress['game-1'].orphanedProgress = JSON.parse(
            '{"__proto__": {}}',
          );
        },
        expectedPath: [
          'gameProgress',
          'game-1',
          'orphanedProgress',
          '__proto__',
        ],
      },
      {
        name: 'orphanedProgress inner map',
        mutate: (store) => {
          store.gameProgress['game-1'].orphanedProgress = {
            'set-old': JSON.parse(
              '{"__proto__": ' +
                JSON.stringify({
                  ...validAchievementProgress('__proto__'),
                  trackingModeAtRemoval: 'binary',
                }) +
                '}',
            ),
          };
        },
        expectedPath: [
          'gameProgress',
          'game-1',
          'orphanedProgress',
          'set-old',
          '__proto__',
        ],
      },
      {
        name: 'gameProgress',
        mutate: (store) => {
          store.gameProgress = JSON.parse('{"__proto__": {}}');
        },
        expectedPath: ['gameProgress', '__proto__'],
      },
      {
        name: 'undoState',
        mutate: (store) => {
          store.undoState = JSON.parse(
            '{"__proto__": ' +
              JSON.stringify({
                setId: 'set-1',
                previous: structuredClone(
                  store.gameProgress['game-1'].sets['set-1'],
                ),
              }) +
              '}',
          );
        },
        expectedPath: ['undoState', '__proto__'],
      },
    ];

    for (const testCase of cases) {
      const store = structuredClone(createValidStore());
      testCase.mutate(store);
      const result = LocalProgressStoreSchema.safeParse(store);
      expect(result.success, testCase.name).toBe(false);
      if (!result.success) {
        const issue = findReservedIssue(result);
        expect(issue, testCase.name).toBeDefined();
        expect(issue?.path, testCase.name).toEqual(testCase.expectedPath);
      }
    }
  });

  it('uses own-property semantics for constructor and toString references', () => {
    const withOwnAchievement = createValidStore();
    withOwnAchievement.gameProgress['game-1'].sets['set-1'].progress = {
      constructor: {
        achievementId: 'constructor',
        completed: false,
        manualOverride: false,
        lastUpdated: TIMESTAMP,
        provenance: 'manual' as const,
      },
    };
    withOwnAchievement.gameProgress['game-1'].sets[
      'set-1'
    ].pinnedAchievementIds = ['constructor'];
    expect(LocalProgressStoreSchema.safeParse(withOwnAchievement).success).toBe(
      true,
    );

    const missingAchievementPin = createValidStore();
    missingAchievementPin.gameProgress['game-1'].sets[
      'set-1'
    ].pinnedAchievementIds = ['constructor'];
    expect(
      LocalProgressStoreSchema.safeParse(missingAchievementPin).success,
    ).toBe(false);

    const ownSetPreferred = createValidStore();
    ownSetPreferred.gameProgress['game-1'].sets = {
      constructor: ownSetPreferred.gameProgress['game-1'].sets['set-1'],
    };
    ownSetPreferred.gameProgress['game-1'].sets['constructor'].setId =
      'constructor';
    ownSetPreferred.gameProgress['game-1'].preferredSetId = 'constructor';
    expect(LocalProgressStoreSchema.safeParse(ownSetPreferred).success).toBe(
      true,
    );

    const missingPreferredSet = createValidStore();
    missingPreferredSet.gameProgress['game-1'].preferredSetId = 'constructor';
    expect(
      LocalProgressStoreSchema.safeParse(missingPreferredSet).success,
    ).toBe(false);

    const ownGameLast = createValidStore();
    ownGameLast.gameProgress = {
      toString: { ...ownGameLast.gameProgress['game-1'], gameId: 'toString' },
    };
    ownGameLast.lastGameId = 'toString';
    expect(LocalProgressStoreSchema.safeParse(ownGameLast).success).toBe(true);

    const missingLastGame = createValidStore();
    missingLastGame.lastGameId = 'toString';
    expect(LocalProgressStoreSchema.safeParse(missingLastGame).success).toBe(
      false,
    );

    const ownGameUndo = createValidStore();
    ownGameUndo.gameProgress = {
      constructor: { ...ownGameUndo.gameProgress['game-1'], gameId: 'constructor' },
    };
    ownGameUndo.lastGameId = 'constructor';
    ownGameUndo.undoState = {
      constructor: {
        setId: 'set-1',
        previous: structuredClone(ownGameUndo.gameProgress['constructor'].sets['set-1']),
      },
    };
    expect(LocalProgressStoreSchema.safeParse(ownGameUndo).success).toBe(true);

    const missingUndoGame = createValidStore();
    missingUndoGame.undoState = {
      constructor: {
        setId: 'set-1',
        previous: structuredClone(
          missingUndoGame.gameProgress['game-1'].sets['set-1'],
        ),
      },
    };
    expect(LocalProgressStoreSchema.safeParse(missingUndoGame).success).toBe(
      false,
    );
  });

  it('rejects reserved embedded identities through exported Schema 2.0 schemas', () => {
    const cases = [
      {
        name: 'achievement progress',
        result: AchievementProgressSchema.safeParse({
          achievementId: '__proto__',
          completed: false,
          manualOverride: false,
          lastUpdated: TIMESTAMP,
          provenance: 'manual',
        }),
        expectedPath: ['achievementId'],
      },
      {
        name: 'set progress',
        result: AchievementSetProgressSchema.safeParse({
          setId: '__proto__',
          version: '1',
          pinnedAchievementIds: [],
          progress: {},
        }),
        expectedPath: ['setId'],
      },
      {
        name: 'game progress',
        result: GameProgressSchema.safeParse({
          gameId: '__proto__',
          sets: {},
          orphanedProgress: {},
        }),
        expectedPath: ['gameId'],
      },
      {
        name: 'undo snapshot',
        result: ProgressUndoSnapshotSchema.safeParse({
          setId: '__proto__',
          previous: {
            setId: '__proto__',
            version: '1',
            pinnedAchievementIds: [],
            progress: {},
          },
        }),
        expectedPath: ['setId'],
      },
    ];

    for (const testCase of cases) {
      expect(testCase.result.success, testCase.name).toBe(false);
      if (!testCase.result.success) {
        expect(
          testCase.result.error.issues.some(
            (issue) =>
              issue.message === RESERVED_RECORD_KEY_MESSAGE &&
              issue.path.join('.') === testCase.expectedPath.join('.'),
          ),
          testCase.name,
        ).toBe(true);
      }
    }
  });

  it('validates complete reconciliation reports with empty delta arrays', () => {
    const report = {
      gameId: 'game-1',
      fromGameVersion: '1',
      toGameVersion: '2',
      setDeltas: [
        {
          setId: 'set-1',
          fromVersion: '1',
          toVersion: '2',
          addedAchievementIds: [],
          quarantinedAchievementIds: [],
          restoredOrphanedAchievementIds: [],
          addedChecklistItems: [],
          removedChecklistItems: [],
          removedPinnedAchievementIds: [],
        },
      ],
      schemaConflicts: [],
    };
    expect(ReconciliationDeltaReportSchema.safeParse(report).success).toBe(true);
  });
});
