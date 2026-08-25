import { describe, expect, it } from 'vitest';
import { RESERVED_RECORD_KEY_MESSAGE } from './progress-schema-common';
import { transformProgressStoreV2ToV3 } from './progress-migration';
import { LocalProgressStoreSchema } from './progress-schema';
import type { AchievementProgress } from './progress-schema';

const MIGRATION_TS = '2026-07-23T00:00:00.000Z';

function createV2Store(): unknown {
  return {
    schemaVersion: '2.0',
    lastGameId: 'game-b',
    gameProgress: {
      'game-b': {
        gameId: 'game-b',
        preferredSetId: 'set-b',
        sets: {
          'set-b': {
            setId: 'set-b',
            version: '1.0',
            activeStage: 'missables',
            pinnedAchievementIds: ['ach-counter', 'ach-binary'],
            progress: {
              'ach-counter': {
                achievementId: 'ach-counter',
                completed: false,
                manualOverride: false,
                counterValue: 7,
                lastUpdated: '2026-07-22T00:00:00.000Z',
                provenance: 'manual',
              },
              'ach-binary': {
                achievementId: 'ach-binary',
                completed: true,
                manualOverride: false,
                notes: 'keep me',
                lastUpdated: '2026-07-22T01:00:00.000Z',
                provenance: 'imported',
              },
              'ach-checklist': {
                achievementId: 'ach-checklist',
                completed: false,
                manualOverride: false,
                checklistCompletion: { 'task-a': true, 'task-b': false },
                lastUpdated: '2026-07-22T02:00:00.000Z',
                provenance: 'platform',
              },
            },
          },
        },
        orphanedProgress: {
          'set-b': {
            'ach-orphan': {
              achievementId: 'ach-orphan',
              completed: false,
              manualOverride: false,
              counterValue: 2,
              lastUpdated: '2026-07-22T03:00:00.000Z',
              provenance: 'manual',
              trackingModeAtRemoval: 'counter',
            },
          },
          'absent-set-a': {
            'orphan-a': {
              achievementId: 'orphan-a',
              completed: false,
              manualOverride: false,
              counterValue: 5,
              lastUpdated: '2026-07-22T04:00:00.000Z',
              provenance: 'manual',
              trackingModeAtRemoval: 'counter',
            },
          },
          'absent-set-empty': {},
        },
      },
      'game-a': {
        gameId: 'game-a',
        sets: {},
        orphanedProgress: {},
      },
    },
    undoState: {
      'game-b': {
        setId: 'set-b',
        previous: {
          setId: 'set-b',
          version: '1.0',
          activeStage: 'story',
          pinnedAchievementIds: ['ach-counter'],
          progress: {
            'ach-counter': {
              achievementId: 'ach-counter',
              completed: false,
              manualOverride: false,
              counterValue: 3,
              lastUpdated: '2026-07-22T05:00:00.000Z',
              provenance: 'manual',
            },
          },
        },
      },
    },
  };
}

describe('pure Schema 2.0 to 3.0 migration', () => {
  it('migrates an empty valid V2 store', () => {
    const result = transformProgressStoreV2ToV3(
      { schemaVersion: '2.0', gameProgress: {} },
      MIGRATION_TS,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.store).toEqual({ schemaVersion: '3.0', gameProgress: {} });
    expect(result.report).toEqual({
      sourceSchemaVersion: '2.0',
      targetSchemaVersion: '3.0',
      migratedAt: MIGRATION_TS,
      migratedGameIds: [],
      migratedSets: [],
      createdRuns: [],
      counterAssumptions: [],
      preservedUndoTargets: [],
      warnings: [],
    });
  });

  it('preserves selections, versions, stage, pins, completion, tracker state, notes, provenance, and timestamps', () => {
    const result = transformProgressStoreV2ToV3(createV2Store(), MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.store.schemaVersion).toBe('3.0');
    expect(result.store.lastGameId).toBe('game-b');

    const game = result.store.gameProgress['game-b'];
    expect(game.preferredSetId).toBe('set-b');

    const set = game.sets['set-b'];
    expect(set.version).toBe('1.0');
    expect(set.activeRunId).toBe('legacy-v2');

    const run = set.runs['legacy-v2'];
    expect(run.name).toBe('Existing Progress');
    expect(run.createdAt).toBe(MIGRATION_TS);
    expect(run.activeStage).toBe('missables');
    expect(run.pinnedAchievementIds).toEqual(['ach-counter', 'ach-binary']);

    expect(run.progress['ach-binary']).toEqual({
      achievementId: 'ach-binary',
      completed: true,
      manualOverride: false,
      notes: 'keep me',
      lastUpdated: '2026-07-22T01:00:00.000Z',
      provenance: 'imported',
    });

    expect(run.progress['ach-counter']).toEqual({
      achievementId: 'ach-counter',
      completed: false,
      manualOverride: false,
      counter: { certainty: 'exact', value: 7 },
      lastUpdated: '2026-07-22T00:00:00.000Z',
      provenance: 'manual',
    });

    expect(run.progress['ach-checklist']).toEqual({
      achievementId: 'ach-checklist',
      completed: false,
      manualOverride: false,
      checklistCompletion: { 'task-a': true, 'task-b': false },
      lastUpdated: '2026-07-22T02:00:00.000Z',
      provenance: 'platform',
    });
  });

  it('migrates active-set orphans and creates versionless retired ledgers for absent-set orphan maps', () => {
    const result = transformProgressStoreV2ToV3(createV2Store(), MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const game = result.store.gameProgress['game-b'];
    const activeRun = game.sets['set-b'].runs['legacy-v2'];
    expect(activeRun.orphanedProgress['ach-orphan']).toEqual([
      {
        achievementId: 'ach-orphan',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 2 },
        lastUpdated: '2026-07-22T03:00:00.000Z',
        provenance: 'manual',
        trackingModeAtRemoval: 'counter',
      },
    ]);

    const absent = game.retiredSets['absent-set-a'];
    expect(absent.retirementReason).toBe('schema_2_absent_orphans');
    expect(Object.hasOwn(absent, 'version')).toBe(false);
    expect(absent.activeRunId).toBe('legacy-v2');
    expect(absent.runs['legacy-v2'].progress).toEqual({});
    expect(absent.runs['legacy-v2'].orphanedProgress['orphan-a']).toEqual([
      {
        achievementId: 'orphan-a',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 5 },
        lastUpdated: '2026-07-22T04:00:00.000Z',
        provenance: 'manual',
        trackingModeAtRemoval: 'counter',
      },
    ]);

    const empty = game.retiredSets['absent-set-empty'];
    expect(empty.retirementReason).toBe('schema_2_absent_orphans');
    expect(Object.hasOwn(empty, 'version')).toBe(false);
    expect(empty.runs['legacy-v2'].progress).toEqual({});
    expect(empty.runs['legacy-v2'].orphanedProgress).toEqual({});
  });

  it('converts counters to exact certainty and reports unique active, orphan, and undo entries', () => {
    const result = transformProgressStoreV2ToV3(createV2Store(), MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.report.counterAssumptions).toEqual([
      {
        gameId: 'game-b',
        setId: 'absent-set-a',
        achievementId: 'orphan-a',
        location: 'orphan',
        assumedCertainty: 'exact',
        value: 5,
      },
      {
        gameId: 'game-b',
        setId: 'set-b',
        achievementId: 'ach-counter',
        location: 'active',
        assumedCertainty: 'exact',
        value: 7,
      },
      {
        gameId: 'game-b',
        setId: 'set-b',
        achievementId: 'ach-counter',
        location: 'undo',
        assumedCertainty: 'exact',
        value: 3,
      },
      {
        gameId: 'game-b',
        setId: 'set-b',
        achievementId: 'ach-orphan',
        location: 'orphan',
        assumedCertainty: 'exact',
        value: 2,
      },
    ]);
  });

  it('produces deterministic report ordering from unsorted source maps', () => {
    const result = transformProgressStoreV2ToV3(createV2Store(), MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.report.migratedGameIds).toEqual(['game-a', 'game-b']);
    expect(result.report.migratedSets).toEqual([
      { gameId: 'game-b', setId: 'absent-set-a', destination: 'retired' },
      { gameId: 'game-b', setId: 'absent-set-empty', destination: 'retired' },
      { gameId: 'game-b', setId: 'set-b', destination: 'active' },
    ]);
    expect(result.report.createdRuns).toEqual([
      {
        gameId: 'game-b',
        setId: 'absent-set-a',
        destination: 'retired',
        runId: 'legacy-v2',
      },
      {
        gameId: 'game-b',
        setId: 'absent-set-empty',
        destination: 'retired',
        runId: 'legacy-v2',
      },
      {
        gameId: 'game-b',
        setId: 'set-b',
        destination: 'active',
        runId: 'legacy-v2',
      },
    ]);
    expect(result.report.preservedUndoTargets).toEqual([
      {
        gameId: 'game-b',
        setId: 'set-b',
        runId: 'legacy-v2',
        guardedSetVersion: '1.0',
      },
    ]);
  });

  it('migrates a valid undo snapshot with a complete previous run and deep-copied current orphans', () => {
    const result = transformProgressStoreV2ToV3(createV2Store(), MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.store.undoState?.['game-b']).toEqual({
      setId: 'set-b',
      runId: 'legacy-v2',
      guardedSetVersion: '1.0',
      previous: {
        runId: 'legacy-v2',
        name: 'Existing Progress',
        createdAt: MIGRATION_TS,
        activeStage: 'story',
        pinnedAchievementIds: ['ach-counter'],
        progress: {
          'ach-counter': {
            achievementId: 'ach-counter',
            completed: false,
            manualOverride: false,
            counter: { certainty: 'exact', value: 3 },
            lastUpdated: '2026-07-22T05:00:00.000Z',
            provenance: 'manual',
          },
        },
        orphanedProgress: {
          'ach-orphan': [
            {
              achievementId: 'ach-orphan',
              completed: false,
              manualOverride: false,
              counter: { certainty: 'exact', value: 2 },
              lastUpdated: '2026-07-22T03:00:00.000Z',
              provenance: 'manual',
              trackingModeAtRemoval: 'counter',
            },
          ],
        },
      },
    });
  });

  it('fails the whole transformation when the undo target is missing or the version mismatches', () => {
    const missingTarget = createV2Store() as {
      undoState: { 'game-b': { setId: string; previous: { setId: string } } };
    };
    missingTarget.undoState['game-b'].setId = 'missing-set';
    missingTarget.undoState['game-b'].previous.setId = 'missing-set';
    const missingResult = transformProgressStoreV2ToV3(
      missingTarget,
      MIGRATION_TS,
    );
    expect(missingResult.success).toBe(false);
    if (missingResult.success) return;
    expect(missingResult.code).toBe('TRANSFORMATION_ERROR');

    const versionMismatch = createV2Store() as {
      undoState: { 'game-b': { previous: { version: string } } };
    };
    versionMismatch.undoState['game-b'].previous.version = '9.9';
    const mismatchResult = transformProgressStoreV2ToV3(
      versionMismatch,
      MIGRATION_TS,
    );
    expect(mismatchResult.success).toBe(false);
    if (mismatchResult.success) return;
    expect(mismatchResult.code).toBe('TRANSFORMATION_ERROR');
  });

  it('returns typed failures for invalid source, unsupported version, invalid timestamp, and unrepresentable target', () => {
    const invalidSource = transformProgressStoreV2ToV3(
      { schemaVersion: '2.0', gameProgress: 'not-an-object' },
      MIGRATION_TS,
    );
    expect(invalidSource.success).toBe(false);
    if (invalidSource.success) return;
    expect(invalidSource.code).toBe('INVALID_SOURCE_STORE');

    const unsupported = transformProgressStoreV2ToV3(
      { schemaVersion: '1.0', gameProgress: {} },
      MIGRATION_TS,
    );
    expect(unsupported.success).toBe(false);
    if (unsupported.success) return;
    expect(unsupported.code).toBe('INVALID_SOURCE_STORE');

    const badTimestamp = transformProgressStoreV2ToV3(createV2Store(), 'invalid');
    expect(badTimestamp.success).toBe(false);
    if (badTimestamp.success) return;
    expect(badTimestamp.code).toBe('TRANSFORMATION_ERROR');

    const unrepresentable = transformProgressStoreV2ToV3(
      {
        schemaVersion: '2.0',
        gameProgress: {
          game: {
            gameId: 'game',
            sets: {
              set: {
                setId: 'set',
                version: '1',
                pinnedAchievementIds: [],
                progress: {
                  ach: {
                    achievementId: 'ach',
                    completed: true,
                    manualOverride: true,
                    lastUpdated: MIGRATION_TS,
                    provenance: 'manual',
                  },
                },
              },
            },
            orphanedProgress: {},
          },
        },
      },
      MIGRATION_TS,
    );
    expect(unrepresentable.success).toBe(false);
    if (unrepresentable.success) return;
    expect(unrepresentable.code).toBe('INVALID_TARGET_STORE');
  });

  it('returns a complete typed failure for an incomplete V2 manual override without exposing a partial store', () => {
    const source = {
      schemaVersion: '2.0',
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
                  manualOverride: true,
                  counterValue: 1,
                  lastUpdated: MIGRATION_TS,
                  provenance: 'manual',
                },
              },
            },
          },
          orphanedProgress: {},
        },
      },
    };

    const result = transformProgressStoreV2ToV3(source, MIGRATION_TS);

    expect(result).toEqual({
      success: false,
      code: 'INVALID_TARGET_STORE',
      message: 'Transformed store failed Schema 3.0 validation',
      conflicts: [
        expect.stringContaining(
          'A completion override requires completed to be true',
        ),
      ],
    });
    expect('store' in result).toBe(false);
  });

  it('rejects a V2 achievement carrying both counterValue and checklistCompletion as an invalid V3 target', () => {
    const source = {
      schemaVersion: '2.0',
      gameProgress: {
        game: {
          gameId: 'game',
          sets: {
            set: {
              setId: 'set',
              version: '1',
              pinnedAchievementIds: [],
              progress: {
                ach: {
                  achievementId: 'ach',
                  completed: false,
                  manualOverride: false,
                  counterValue: 2,
                  checklistCompletion: { item: true },
                  lastUpdated: MIGRATION_TS,
                  provenance: 'manual',
                },
              },
            },
          },
          orphanedProgress: {},
        },
      },
    };

    expect(LocalProgressStoreSchema.safeParse(source).success).toBe(true);

    const result = transformProgressStoreV2ToV3(source, MIGRATION_TS);

    expect(result).toEqual({
      success: false,
      code: 'INVALID_TARGET_STORE',
      message: 'Transformed store failed Schema 3.0 validation',
      conflicts: [
        expect.stringContaining(
          'Achievement progress cannot contain both counter and checklist state',
        ),
      ],
    });
    expect('store' in result).toBe(false);
  });

  it('rejects a Schema 2.0 binary orphan with manualOverride at the source boundary', () => {
    const source = {
      schemaVersion: '2.0',
      gameProgress: {
        game: {
          gameId: 'game',
          sets: {},
          orphanedProgress: {
            old: {
              ach: {
                achievementId: 'ach',
                completed: true,
                manualOverride: true,
                lastUpdated: MIGRATION_TS,
                provenance: 'manual',
                trackingModeAtRemoval: 'binary',
              },
            },
          },
        },
      },
    };

    expect(LocalProgressStoreSchema.safeParse(source).success).toBe(false);

    const result = transformProgressStoreV2ToV3(source, MIGRATION_TS);

    expect(result).toEqual({
      success: false,
      code: 'INVALID_SOURCE_STORE',
      message: 'Source store is not a valid Schema 2.0 store',
      conflicts: [
        expect.stringContaining('Binary progress cannot use manualOverride'),
      ],
    });
    expect('store' in result).toBe(false);
  });

  it('preserves the same achievement ID in active progress and orphan history', () => {
    const source = createV2Store() as {
      gameProgress: {
        'game-b': {
          orphanedProgress: {
            'set-b': Record<string, unknown>;
          };
        };
      };
    };
    source.gameProgress['game-b'].orphanedProgress['set-b']['ach-counter'] = {
      achievementId: 'ach-counter',
      completed: false,
      manualOverride: false,
      counterValue: 4,
      lastUpdated: '2026-07-22T03:30:00.000Z',
      provenance: 'manual',
      trackingModeAtRemoval: 'counter',
    };

    const result = transformProgressStoreV2ToV3(source, MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const run =
      result.store.gameProgress['game-b'].sets['set-b'].runs['legacy-v2'];
    expect(run.progress['ach-counter'].counter).toEqual({
      certainty: 'exact',
      value: 7,
    });
    expect(run.orphanedProgress['ach-counter']).toEqual([
      {
        achievementId: 'ach-counter',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 4 },
        lastUpdated: '2026-07-22T03:30:00.000Z',
        provenance: 'manual',
        trackingModeAtRemoval: 'counter',
      },
    ]);
    expect(
      result.report.counterAssumptions.filter(
        (entry) =>
          entry.gameId === 'game-b' &&
          entry.setId === 'set-b' &&
          entry.achievementId === 'ach-counter',
      ),
    ).toEqual([
      {
        gameId: 'game-b',
        setId: 'set-b',
        achievementId: 'ach-counter',
        location: 'active',
        assumedCertainty: 'exact',
        value: 7,
      },
      {
        gameId: 'game-b',
        setId: 'set-b',
        achievementId: 'ach-counter',
        location: 'orphan',
        assumedCertainty: 'exact',
        value: 4,
      },
      {
        gameId: 'game-b',
        setId: 'set-b',
        achievementId: 'ach-counter',
        location: 'undo',
        assumedCertainty: 'exact',
        value: 3,
      },
    ]);
  });

  it('does not mutate the source or its nested records after success or failure', () => {
    const source = createV2Store();
    const before = structuredClone(source);
    const success = transformProgressStoreV2ToV3(source, MIGRATION_TS);
    expect(success.success).toBe(true);
    expect(source).toEqual(before);

    const failingSource = createV2Store() as {
      undoState: { 'game-b': { setId: string; previous: { setId: string } } };
    };
    failingSource.undoState['game-b'].setId = 'missing-set';
    failingSource.undoState['game-b'].previous.setId = 'missing-set';
    const failingBefore = structuredClone(failingSource);
    const failure = transformProgressStoreV2ToV3(failingSource, MIGRATION_TS);
    expect(failure.success).toBe(false);
    expect(failingSource).toEqual(failingBefore);
  });

  it('does not alias source or internal orphan and checklist objects', () => {
    const source = createV2Store() as {
      gameProgress: {
        'game-b': {
          sets: {
            'set-b': {
              progress: {
                'ach-checklist': { checklistCompletion: Record<string, boolean> };
              };
            };
          };
          orphanedProgress: { 'set-b': Record<string, unknown> };
        };
      };
    };

    const result = transformProgressStoreV2ToV3(source, MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const outputRun =
      result.store.gameProgress['game-b'].sets['set-b'].runs['legacy-v2'];
    const sourceChecklist =
      source.gameProgress['game-b'].sets['set-b'].progress[
        'ach-checklist'
      ].checklistCompletion;
    const outputChecklist =
      outputRun.progress['ach-checklist'].checklistCompletion;
    expect(outputChecklist).not.toBe(sourceChecklist);

    const sourceOrphan = source.gameProgress['game-b'].orphanedProgress['set-b'];
    const outputOrphanHistory = outputRun.orphanedProgress['ach-orphan'];
    expect(outputOrphanHistory[0]).not.toBe(sourceOrphan['ach-orphan']);

    const undo = result.store.undoState!['game-b'].previous;
    expect(undo.orphanedProgress).not.toBe(outputRun.orphanedProgress);
    expect(undo.orphanedProgress['ach-orphan']).not.toBe(
      outputRun.orphanedProgress['ach-orphan'],
    );
  });

  it('returns deeply equal results for repeated calls with the same source and timestamp', () => {
    const source = createV2Store();
    const first = transformProgressStoreV2ToV3(source, MIGRATION_TS);
    const second = transformProgressStoreV2ToV3(source, MIGRATION_TS);
    expect(second).toEqual(first);
  });

  it('rejects an own reserved key at every persisted V2 map level as INVALID_SOURCE_STORE without a partial store', () => {
    const validAchievementProgress = (
      achievementId: string,
    ): AchievementProgress => ({
      achievementId,
      completed: false,
      manualOverride: false,
      lastUpdated: '2026-07-22T00:00:00.000Z',
      provenance: 'manual',
    });

    const cases: {
      name: string;
      mutate: (source: unknown) => void;
      expectedPath: string;
    }[] = [
      {
        name: 'gameProgress',
        mutate: (source) => {
          (source as { gameProgress: unknown }).gameProgress = JSON.parse(
            '{"__proto__": {}}',
          );
        },
        expectedPath: 'gameProgress.__proto__',
      },
      {
        name: 'sets',
        mutate: (source) => {
          (
            source as {
              gameProgress: {
                'game-b': { sets: unknown };
              };
            }
          ).gameProgress['game-b'].sets = JSON.parse('{"__proto__": {}}');
        },
        expectedPath: 'gameProgress.game-b.sets.__proto__',
      },
      {
        name: 'progress',
        mutate: (source) => {
          (
            source as {
              gameProgress: {
                'game-b': {
                  sets: {
                    'set-b': { progress: unknown };
                  };
                };
              };
            }
          ).gameProgress['game-b'].sets['set-b'].progress = JSON.parse(
            '{"__proto__": ' +
              JSON.stringify(validAchievementProgress('__proto__')) +
              '}',
          );
        },
        expectedPath: 'gameProgress.game-b.sets.set-b.progress.__proto__',
      },
      {
        name: 'checklistCompletion',
        mutate: (source) => {
          (
            source as {
              gameProgress: {
                'game-b': {
                  sets: {
                    'set-b': {
                      progress: {
                        'ach-checklist': { checklistCompletion: unknown };
                      };
                    };
                  };
                };
              };
            }
          ).gameProgress['game-b'].sets['set-b'].progress[
            'ach-checklist'
          ].checklistCompletion = JSON.parse('{"__proto__": true}');
        },
        expectedPath:
          'gameProgress.game-b.sets.set-b.progress.ach-checklist.checklistCompletion.__proto__',
      },
      {
        name: 'orphanedProgress outer',
        mutate: (source) => {
          (
            source as {
              gameProgress: {
                'game-b': { orphanedProgress: unknown };
              };
            }
          ).gameProgress['game-b'].orphanedProgress = JSON.parse(
            '{"__proto__": {}}',
          );
        },
        expectedPath: 'gameProgress.game-b.orphanedProgress.__proto__',
      },
      {
        name: 'orphanedProgress inner',
        mutate: (source) => {
          (
            source as {
              gameProgress: {
                'game-b': { orphanedProgress: Record<string, unknown> };
              };
            }
          ).gameProgress['game-b'].orphanedProgress = {
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
        expectedPath:
          'gameProgress.game-b.orphanedProgress.set-old.__proto__',
      },
      {
        name: 'undoState',
        mutate: (source) => {
          (source as { undoState: unknown }).undoState = JSON.parse(
            '{"__proto__": {}}',
          );
        },
        expectedPath: 'undoState.__proto__',
      },
    ];

    for (const testCase of cases) {
      const source = structuredClone(createV2Store());
      testCase.mutate(source);
      const before = structuredClone(source);

      const result = transformProgressStoreV2ToV3(source, MIGRATION_TS);
      expect(result.success, testCase.name).toBe(false);
      if (!result.success) {
        expect(result.code, testCase.name).toBe('INVALID_SOURCE_STORE');
        expect('store' in result, testCase.name).toBe(false);
        expect(
          result.conflicts.some((conflict) =>
            conflict.includes(RESERVED_RECORD_KEY_MESSAGE),
          ),
          testCase.name,
        ).toBe(true);
        expect(
          result.conflicts.some((conflict) =>
            conflict.startsWith(testCase.expectedPath),
          ),
          testCase.name,
        ).toBe(true);
      }
      expect(source, testCase.name).toEqual(before);
    }
  });

  it('migrates valid constructor and toString IDs without changing report shape', () => {
    const source = createV2Store() as {
      gameProgress: Record<
        string,
        {
          gameId: string;
          preferredSetId?: string;
          sets: Record<
            string,
            {
              setId: string;
              version: string;
              pinnedAchievementIds: string[];
              progress: Record<string, unknown>;
            }
          >;
          orphanedProgress: Record<string, Record<string, unknown>>;
        }
      >;
    };
    source.gameProgress['constructor'] = {
      gameId: 'constructor',
      sets: {
        toString: {
          setId: 'toString',
          version: '1.0',
          pinnedAchievementIds: [],
          progress: {},
        },
      },
      orphanedProgress: {},
    };
    source.gameProgress['game-a'].orphanedProgress['toString'] = {
      constructor: {
        achievementId: 'constructor',
        completed: false,
        manualOverride: false,
        lastUpdated: '2026-07-22T06:00:00.000Z',
        provenance: 'manual',
        trackingModeAtRemoval: 'binary',
      },
    };

    const result = transformProgressStoreV2ToV3(source, MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.store.gameProgress['constructor']).toBeDefined();
    expect(
      result.store.gameProgress['constructor'].sets['toString'],
    ).toBeDefined();
    expect(
      result.store.gameProgress['constructor'].sets['toString'].runs[
        'legacy-v2'
      ],
    ).toBeDefined();
    expect(
      result.store.gameProgress['game-a'].retiredSets['toString'],
    ).toBeDefined();
    expect(result.report.migratedGameIds).toContain('constructor');
    expect(result.report.migratedSets).toContainEqual({
      gameId: 'constructor',
      setId: 'toString',
      destination: 'active',
    });
    expect(result.report.migratedSets).toContainEqual({
      gameId: 'game-a',
      setId: 'toString',
      destination: 'retired',
    });
  });
});
