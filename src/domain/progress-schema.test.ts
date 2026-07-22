import { describe, expect, it } from 'vitest';
import {
  CURRENT_STORE_SCHEMA_VERSION,
  LocalProgressStoreSchema,
  ReconciliationDeltaReportSchema,
  isIsoUtcString,
} from './progress-schema';
import type { LocalProgressStore } from './progress-schema';

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
  it('accepts real UTC timestamps and rejects offsets and impossible calendar values', () => {
    expect(isIsoUtcString('2026-07-22T12:00:00Z')).toBe(true);
    expect(isIsoUtcString('2026-07-22T12:00:00.123456Z')).toBe(true);
    expect(isIsoUtcString('2024-02-29T23:59:59+00:00')).toBe(true);

    expect(isIsoUtcString('2026-02-29T12:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-04-31T12:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-07-22T24:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:60:00Z')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:00:60Z')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:00:00-00:00')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:00:00+05:30')).toBe(false);
    expect(isIsoUtcString('2026-07-22')).toBe(false);
  });

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
