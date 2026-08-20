import { describe, expect, it } from 'vitest';
import {
  AchievementProgressV3Schema,
  CounterProgressSchema,
  HUNT_MEMORY_STORE_SCHEMA_VERSION,
  LocalProgressStoreV3Schema,
  OrphanedAchievementProgressV3Schema,
  RunProgressSchema,
} from './hunt-memory-schema';
import type { LocalProgressStoreV3, RunProgress } from './hunt-memory-schema';

const TS = '2026-07-22T00:00:00.000Z';

function createValidRun(): RunProgress {
  return {
    runId: 'legacy-v2',
    name: 'Existing Progress',
    createdAt: TS,
    activeStage: 'story',
    pinnedAchievementIds: ['ach-binary'],
    progress: {
      'ach-binary': {
        achievementId: 'ach-binary',
        completed: true,
        manualOverride: false,
        lastUpdated: TS,
        provenance: 'manual',
      },
      'ach-counter': {
        achievementId: 'ach-counter',
        completed: false,
        manualOverride: false,
        counter: { certainty: 'exact', value: 3 },
        lastUpdated: TS,
        provenance: 'manual',
      },
    },
    orphanedProgress: {
      'ach-orphan': [
        {
          achievementId: 'ach-orphan',
          completed: false,
          manualOverride: false,
          counter: { certainty: 'at_least', minimum: 2 },
          lastUpdated: TS,
          provenance: 'manual',
          trackingModeAtRemoval: 'counter',
        },
      ],
    },
  };
}

function createValidV3Store(): LocalProgressStoreV3 {
  return {
    schemaVersion: HUNT_MEMORY_STORE_SCHEMA_VERSION,
    lastGameId: 'game-a',
    gameProgress: {
      'game-a': {
        gameId: 'game-a',
        preferredSetId: 'set-a',
        sets: {
          'set-a': {
            setId: 'set-a',
            version: '1.0',
            activeRunId: 'legacy-v2',
            runs: { 'legacy-v2': createValidRun() },
          },
        },
        retiredSets: {
          'retired-removed': {
            setId: 'retired-removed',
            activeRunId: 'legacy-v2',
            runs: { 'legacy-v2': createValidRun() },
            retirementReason: 'removed_set',
            version: '2.0',
          },
          'retired-absent': {
            setId: 'retired-absent',
            activeRunId: 'legacy-v2',
            runs: { 'legacy-v2': createValidRun() },
            retirementReason: 'schema_2_absent_orphans',
          },
        },
      },
    },
    undoState: {
      'game-a': {
        setId: 'set-a',
        runId: 'legacy-v2',
        guardedSetVersion: '1.0',
        previous: createValidRun(),
      },
    },
  };
}

describe('hunt memory Schema 3.0 validation', () => {
  it('accepts a complete valid V3 store', () => {
    expect(LocalProgressStoreV3Schema.safeParse(createValidV3Store()).success).toBe(
      true,
    );
  });

  it('rejects unsupported schema literals and strict extra keys', () => {
    expect(
      LocalProgressStoreV3Schema.safeParse({
        ...createValidV3Store(),
        schemaVersion: '2.0',
      }).success,
    ).toBe(false);

    expect(
      LocalProgressStoreV3Schema.safeParse({
        ...createValidV3Store(),
        unexpected: true,
      }).success,
    ).toBe(false);

    const extraNested = structuredClone(createValidV3Store());
    (extraNested.gameProgress['game-a'].sets['set-a'] as unknown as Record<
      string,
      unknown
    >).extra = true;
    expect(LocalProgressStoreV3Schema.safeParse(extraNested).success).toBe(false);
  });

  it('accepts the four valid counter certainty variants', () => {
    expect(
      CounterProgressSchema.safeParse({ certainty: 'exact', value: 0 }).success,
    ).toBe(true);
    expect(
      CounterProgressSchema.safeParse({ certainty: 'at_least', minimum: 0 })
        .success,
    ).toBe(true);
    expect(
      CounterProgressSchema.safeParse({ certainty: 'estimated', estimate: 0 })
        .success,
    ).toBe(true);
    expect(
      CounterProgressSchema.safeParse({
        certainty: 'unknown',
        observedSinceStart: 0,
        trackingStartedAt: TS,
      }).success,
    ).toBe(true);
  });

  it('rejects negative, fractional, invalid-timestamp, and cross-variant counters', () => {
    expect(
      CounterProgressSchema.safeParse({ certainty: 'exact', value: -1 }).success,
    ).toBe(false);
    expect(
      CounterProgressSchema.safeParse({ certainty: 'exact', value: 1.5 }).success,
    ).toBe(false);
    expect(
      CounterProgressSchema.safeParse({ certainty: 'at_least', minimum: -1 })
        .success,
    ).toBe(false);
    expect(
      CounterProgressSchema.safeParse({ certainty: 'estimated', estimate: 0.5 })
        .success,
    ).toBe(false);
    expect(
      CounterProgressSchema.safeParse({
        certainty: 'unknown',
        observedSinceStart: 1,
        trackingStartedAt: 'invalid',
      }).success,
    ).toBe(false);
    expect(
      CounterProgressSchema.safeParse({
        certainty: 'unknown',
        observedSinceStart: 1,
      }).success,
    ).toBe(false);
    expect(
      CounterProgressSchema.safeParse({
        certainty: 'exact',
        value: 1,
        minimum: 2,
      }).success,
    ).toBe(false);
    expect(
      CounterProgressSchema.safeParse({ certainty: 'at_least', value: 1 })
        .success,
    ).toBe(false);
  });

  it('rejects counter/checklist coexistence and binary overrides', () => {
    const base = {
      achievementId: 'a',
      completed: false,
      manualOverride: false,
      lastUpdated: TS,
      provenance: 'manual',
    };

    expect(
      AchievementProgressV3Schema.safeParse({
        ...base,
        counter: { certainty: 'exact', value: 1 },
        checklistCompletion: { item: true },
      }).success,
    ).toBe(false);

    expect(
      AchievementProgressV3Schema.safeParse({
        ...base,
        manualOverride: true,
      }).success,
    ).toBe(false);

    expect(
      AchievementProgressV3Schema.safeParse({
        ...base,
        completed: false,
        manualOverride: true,
        counter: { certainty: 'exact', value: 1 },
      }).success,
    ).toBe(false);

    expect(
      AchievementProgressV3Schema.safeParse({
        ...base,
        completed: true,
        manualOverride: true,
        counter: { certainty: 'exact', value: 1 },
      }).success,
    ).toBe(true);
  });

  it('enforces orphan removal mode against tracker shape', () => {
    const base = {
      achievementId: 'orphan',
      completed: false,
      manualOverride: false,
      lastUpdated: TS,
      provenance: 'manual' as const,
    };
    const shapes = {
      none: {},
      counter: { counter: { certainty: 'exact' as const, value: 1 } },
      checklist: { checklistCompletion: { item: true } },
      both: {
        counter: { certainty: 'exact' as const, value: 1 },
        checklistCompletion: { item: true },
      },
    };
    const cases = [
      { mode: 'binary' as const, shape: 'none' as const, valid: true },
      { mode: 'binary' as const, shape: 'counter' as const, valid: false },
      { mode: 'binary' as const, shape: 'checklist' as const, valid: false },
      { mode: 'binary' as const, shape: 'both' as const, valid: false },
      { mode: 'counter' as const, shape: 'none' as const, valid: false },
      { mode: 'counter' as const, shape: 'counter' as const, valid: true },
      { mode: 'counter' as const, shape: 'checklist' as const, valid: false },
      { mode: 'counter' as const, shape: 'both' as const, valid: false },
      { mode: 'checklist' as const, shape: 'none' as const, valid: false },
      { mode: 'checklist' as const, shape: 'counter' as const, valid: false },
      { mode: 'checklist' as const, shape: 'checklist' as const, valid: true },
      { mode: 'checklist' as const, shape: 'both' as const, valid: false },
    ];

    cases.forEach(({ mode, shape, valid }) => {
      expect(
        OrphanedAchievementProgressV3Schema.safeParse({
          ...base,
          ...shapes[shape],
          trackingModeAtRemoval: mode,
        }).success,
        `${mode} orphan with ${shape} tracker shape`,
      ).toBe(valid);
    });
  });

  it('rejects game, set, run, progress, and orphan-history identity mismatches', () => {
    const gameMismatch = structuredClone(createValidV3Store());
    gameMismatch.gameProgress['game-a'].gameId = 'other';
    expect(LocalProgressStoreV3Schema.safeParse(gameMismatch).success).toBe(false);

    const setMismatch = structuredClone(createValidV3Store());
    setMismatch.gameProgress['game-a'].sets['set-a'].setId = 'other';
    expect(LocalProgressStoreV3Schema.safeParse(setMismatch).success).toBe(false);

    const runMismatch = structuredClone(createValidV3Store());
    runMismatch.gameProgress['game-a'].sets['set-a'].runs['legacy-v2'].runId =
      'other';
    expect(LocalProgressStoreV3Schema.safeParse(runMismatch).success).toBe(false);

    const progressMismatch = structuredClone(createValidV3Store());
    progressMismatch.gameProgress['game-a'].sets['set-a'].runs[
      'legacy-v2'
    ].progress['ach-binary'].achievementId = 'other';
    expect(LocalProgressStoreV3Schema.safeParse(progressMismatch).success).toBe(
      false,
    );

    const orphanMismatch = structuredClone(createValidV3Store());
    orphanMismatch.gameProgress['game-a'].sets['set-a'].runs[
      'legacy-v2'
    ].orphanedProgress['ach-orphan'][0].achievementId = 'other';
    expect(LocalProgressStoreV3Schema.safeParse(orphanMismatch).success).toBe(
      false,
    );
  });

  it('rejects blank run IDs, names, and achievement identities', () => {
    const blankName = structuredClone(createValidV3Store());
    blankName.gameProgress['game-a'].sets['set-a'].runs['legacy-v2'].name =
      '   ';
    expect(LocalProgressStoreV3Schema.safeParse(blankName).success).toBe(false);

    const blankRunId = structuredClone(createValidV3Store());
    blankRunId.gameProgress['game-a'].sets['set-a'].runs['legacy-v2'].runId =
      '   ';
    expect(LocalProgressStoreV3Schema.safeParse(blankRunId).success).toBe(false);

    const blankAchievement = structuredClone(createValidV3Store());
    blankAchievement.gameProgress['game-a'].sets['set-a'].runs[
      'legacy-v2'
    ].progress['ach-binary'].achievementId = ' ';
    expect(LocalProgressStoreV3Schema.safeParse(blankAchievement).success).toBe(
      false,
    );
  });

  it('enforces distinct pins, the five-pin limit, and active-progress membership', () => {
    const duplicate = structuredClone(createValidV3Store());
    duplicate.gameProgress['game-a'].sets['set-a'].runs[
      'legacy-v2'
    ].pinnedAchievementIds = ['ach-binary', 'ach-binary'];
    expect(LocalProgressStoreV3Schema.safeParse(duplicate).success).toBe(false);

    const absent = structuredClone(createValidV3Store());
    absent.gameProgress['game-a'].sets['set-a'].runs[
      'legacy-v2'
    ].pinnedAchievementIds = ['missing-achievement'];
    expect(LocalProgressStoreV3Schema.safeParse(absent).success).toBe(false);

    const progress: Record<string, unknown> = {};
    const pins: string[] = [];
    for (let i = 1; i <= 6; i += 1) {
      const id = `a${i}`;
      pins.push(id);
      progress[id] = {
        achievementId: id,
        completed: false,
        manualOverride: false,
        lastUpdated: TS,
        provenance: 'manual',
      };
    }
    const sixPins = {
      runId: 'legacy-v2',
      name: 'Existing Progress',
      createdAt: TS,
      pinnedAchievementIds: pins,
      progress,
      orphanedProgress: {},
    };
    expect(RunProgressSchema.safeParse(sixPins).success).toBe(false);
  });

  it('rejects empty orphan histories', () => {
    const emptyHistory = structuredClone(createValidV3Store());
    emptyHistory.gameProgress['game-a'].sets['set-a'].runs[
      'legacy-v2'
    ].orphanedProgress['ach-orphan'] = [];
    expect(LocalProgressStoreV3Schema.safeParse(emptyHistory).success).toBe(
      false,
    );
  });

  it('rejects missing or invalid active run references', () => {
    const missingRun = structuredClone(createValidV3Store());
    missingRun.gameProgress['game-a'].sets['set-a'].activeRunId = 'missing';
    expect(LocalProgressStoreV3Schema.safeParse(missingRun).success).toBe(false);

    const removedRun = structuredClone(createValidV3Store());
    delete removedRun.gameProgress['game-a'].sets['set-a'].runs['legacy-v2'];
    expect(LocalProgressStoreV3Schema.safeParse(removedRun).success).toBe(false);
  });

  it('applies run-ledger refinements to both retired variants', () => {
    const absentRunMismatch = structuredClone(createValidV3Store());
    absentRunMismatch.gameProgress['game-a'].retiredSets[
      'retired-absent'
    ].runs['legacy-v2'].runId = 'other-run';
    expect(
      LocalProgressStoreV3Schema.safeParse(absentRunMismatch).success,
    ).toBe(false);

    const removedActiveRunMissing = structuredClone(createValidV3Store());
    removedActiveRunMissing.gameProgress['game-a'].retiredSets[
      'retired-removed'
    ].activeRunId = 'missing-run';
    expect(
      LocalProgressStoreV3Schema.safeParse(removedActiveRunMissing).success,
    ).toBe(false);
  });

  it('rejects overlap between active and retired set IDs', () => {
    const overlap = structuredClone(createValidV3Store());
    overlap.gameProgress['game-a'].retiredSets['set-a'] = structuredClone(
      overlap.gameProgress['game-a'].retiredSets['retired-removed'],
    );
    overlap.gameProgress['game-a'].retiredSets['set-a'].setId = 'set-a';
    expect(LocalProgressStoreV3Schema.safeParse(overlap).success).toBe(false);
  });

  it('rejects a preferred set that points to a retired ledger', () => {
    const store = structuredClone(createValidV3Store());
    store.gameProgress['game-a'].preferredSetId = 'retired-removed';
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(false);
  });

  it('requires a version on removed_set and forbids one on schema_2_absent_orphans', () => {
    const missingVersion = structuredClone(createValidV3Store());
    const removed = missingVersion.gameProgress['game-a'].retiredSets[
      'retired-removed'
    ] as { version?: string };
    delete removed.version;
    expect(LocalProgressStoreV3Schema.safeParse(missingVersion).success).toBe(
      false,
    );

    const forbiddenVersion = structuredClone(createValidV3Store());
    const absent = forbiddenVersion.gameProgress['game-a'].retiredSets[
      'retired-absent'
    ] as unknown as { version: string };
    absent.version = '1.0';
    expect(LocalProgressStoreV3Schema.safeParse(forbiddenVersion).success).toBe(
      false,
    );
  });

  it('rejects undo run identity mismatches and missing undo game keys', () => {
    const runMismatch = structuredClone(createValidV3Store());
    runMismatch.undoState!['game-a'].previous.runId = 'other-run';
    expect(LocalProgressStoreV3Schema.safeParse(runMismatch).success).toBe(false);

    const missingGame = structuredClone(createValidV3Store());
    missingGame.undoState!['missing-game'] = structuredClone(
      missingGame.undoState!['game-a'],
    );
    expect(LocalProgressStoreV3Schema.safeParse(missingGame).success).toBe(false);
  });

  it('keeps a stale undo set and run target structurally parseable', () => {
    const store = structuredClone(createValidV3Store());
    const snapshot = store.undoState!['game-a'];
    snapshot.setId = 'missing-set';
    snapshot.runId = 'missing-run';
    snapshot.previous.runId = 'missing-run';
    snapshot.guardedSetVersion = '1.0';
    expect(LocalProgressStoreV3Schema.safeParse(store).success).toBe(true);
  });
});
