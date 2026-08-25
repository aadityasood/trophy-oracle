import { describe, expect, it } from 'vitest';
import {
  AchievementProgressV3Schema,
  GameProgressV3Schema,
  CounterProgressSchema,
  HUNT_MEMORY_STORE_SCHEMA_VERSION,
  LocalProgressStoreV3Schema,
  OrphanedAchievementProgressV3Schema,
  ProgressUndoSnapshotV3Schema,
  RunLedgerSetV3Schema,
  RunProgressSchema,
} from './hunt-memory-schema';
import { RESERVED_RECORD_KEY_MESSAGE } from './progress-schema-common';
import type {
  AchievementSetProgressV3,
  LocalProgressStoreV3,
  RetiredAchievementSetProgressV3,
  RunProgress,
} from './hunt-memory-schema';

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

function createValidRunWithRunId(runId: string): RunProgress {
  const run = structuredClone(createValidRun());
  run.runId = runId;
  return run;
}

function createValidSetWithSetId(
  setId: string,
  runId: string,
): AchievementSetProgressV3 {
  return {
    setId,
    version: '1.0',
    activeRunId: runId,
    runs: { [runId]: createValidRunWithRunId(runId) },
  };
}

function createValidRetiredSetWithSetId(
  setId: string,
  runId: string,
): RetiredAchievementSetProgressV3 {
  return {
    setId,
    activeRunId: runId,
    runs: { [runId]: createValidRunWithRunId(runId) },
    retirementReason: 'removed_set',
    version: '2.0',
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

  it('uses own-property semantics for pinned achievement membership', () => {
    for (const achievementId of ['constructor', 'toString'] as const) {
      const missing = structuredClone(createValidRun());
      missing.pinnedAchievementIds = [achievementId];
      expect(
        RunProgressSchema.safeParse(missing).success,
        `missing inherited pinned achievement '${achievementId}' should be rejected`,
      ).toBe(false);

      const present = structuredClone(createValidRun());
      present.progress = {
        ...present.progress,
        [achievementId]: {
          achievementId,
          completed: false,
          manualOverride: false,
          lastUpdated: TS,
          provenance: 'manual',
        },
      };
      present.pinnedAchievementIds = [achievementId];
      expect(
        RunProgressSchema.safeParse(present).success,
        `own pinned achievement '${achievementId}' should be accepted`,
      ).toBe(true);
      expect(Object.hasOwn(present.progress, achievementId)).toBe(true);
      expect(Object.getPrototypeOf(present.progress)).toBe(Object.prototype);
    }

    const reservedKey = '__proto__';
    const reservedPinned = structuredClone(createValidRun());
    reservedPinned.progress = {
      ...reservedPinned.progress,
      [reservedKey]: {
        achievementId: reservedKey,
        completed: false,
        manualOverride: false,
        lastUpdated: TS,
        provenance: 'manual',
      },
    };
    reservedPinned.pinnedAchievementIds = [reservedKey];
    const reservedResult = RunProgressSchema.safeParse(reservedPinned);
    expect(
      reservedResult.success,
      `own reserved pinned achievement '${reservedKey}' should be rejected`,
    ).toBe(false);
    if (!reservedResult.success) {
      expect(reservedResult.error.issues[0]?.message).toBe(
        RESERVED_RECORD_KEY_MESSAGE,
      );
    }
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

  it('uses own-property semantics for active run membership', () => {
    for (const runId of ['constructor', 'toString'] as const) {
      const missing = structuredClone(createValidV3Store());
      missing.gameProgress['game-a'].sets['set-a'].activeRunId = runId;
      expect(
        LocalProgressStoreV3Schema.safeParse(missing).success,
        `missing inherited run reference '${runId}' should be rejected`,
      ).toBe(false);

      const present = structuredClone(createValidV3Store());
      present.gameProgress['game-a'].sets['set-a'].runs = {
        [runId]: createValidRunWithRunId(runId),
      };
      present.gameProgress['game-a'].sets['set-a'].activeRunId = runId;
      expect(
        LocalProgressStoreV3Schema.safeParse(present).success,
        `own run key '${runId}' should be accepted`,
      ).toBe(true);
      expect(
        Object.hasOwn(
          present.gameProgress['game-a'].sets['set-a'].runs,
          runId,
        ),
      ).toBe(true);
      expect(
        Object.getPrototypeOf(
          present.gameProgress['game-a'].sets['set-a'].runs,
        ),
      ).toBe(Object.prototype);
    }

    const reservedRunId = '__proto__';
    const reservedRun = structuredClone(createValidV3Store());
    reservedRun.gameProgress['game-a'].sets['set-a'].runs = {
      [reservedRunId]: createValidRunWithRunId(reservedRunId),
    };
    reservedRun.gameProgress['game-a'].sets['set-a'].activeRunId = reservedRunId;
    const reservedResult = LocalProgressStoreV3Schema.safeParse(reservedRun);
    expect(
      reservedResult.success,
      `own reserved run key '${reservedRunId}' should be rejected`,
    ).toBe(false);
    if (!reservedResult.success) {
      expect(
        reservedResult.error.issues.some(
          (issue) => issue.message === RESERVED_RECORD_KEY_MESSAGE,
        ),
      ).toBe(true);
    }
  });

  it('uses own-property semantics for preferred set membership and active/retired overlap', () => {
    for (const setId of ['constructor', 'toString'] as const) {
      const missingPreferred = structuredClone(createValidV3Store());
      missingPreferred.gameProgress['game-a'].preferredSetId = setId;
      expect(
        LocalProgressStoreV3Schema.safeParse(missingPreferred).success,
        `missing inherited preferred set '${setId}' should be rejected`,
      ).toBe(false);

      const ownActiveNoOverlap = structuredClone(createValidV3Store());
      ownActiveNoOverlap.gameProgress['game-a'].sets = {
        [setId]: createValidSetWithSetId(setId, 'legacy-v2'),
      };
      ownActiveNoOverlap.gameProgress['game-a'].retiredSets = {};
      ownActiveNoOverlap.gameProgress['game-a'].preferredSetId = setId;
      ownActiveNoOverlap.undoState = {
        'game-a': {
          setId,
          runId: 'legacy-v2',
          guardedSetVersion: '1.0',
          previous: createValidRunWithRunId('legacy-v2'),
        },
      };
      expect(
        LocalProgressStoreV3Schema.safeParse(ownActiveNoOverlap).success,
        `own active set '${setId}' should not falsely overlap retiredSets`,
      ).toBe(true);
      expect(
        Object.hasOwn(ownActiveNoOverlap.gameProgress['game-a'].sets, setId),
      ).toBe(true);
      expect(
        Object.hasOwn(
          ownActiveNoOverlap.gameProgress['game-a'].retiredSets,
          setId,
        ),
      ).toBe(false);

      const realOverlap = structuredClone(createValidV3Store());
      realOverlap.gameProgress['game-a'].sets = {
        [setId]: createValidSetWithSetId(setId, 'legacy-v2'),
      };
      realOverlap.gameProgress['game-a'].retiredSets = {
        [setId]: createValidRetiredSetWithSetId(setId, 'legacy-v2'),
      };
      realOverlap.gameProgress['game-a'].preferredSetId = setId;
      realOverlap.undoState!['game-a'].setId = setId;
      expect(
        LocalProgressStoreV3Schema.safeParse(realOverlap).success,
        `real own-key active/retired overlap for '${setId}' should be rejected`,
      ).toBe(false);
      expect(
        Object.hasOwn(realOverlap.gameProgress['game-a'].sets, setId),
      ).toBe(true);
      expect(
        Object.hasOwn(realOverlap.gameProgress['game-a'].retiredSets, setId),
      ).toBe(true);
      expect(
        Object.getPrototypeOf(realOverlap.gameProgress['game-a'].sets),
      ).toBe(Object.prototype);
      expect(
        Object.getPrototypeOf(realOverlap.gameProgress['game-a'].retiredSets),
      ).toBe(Object.prototype);
    }

    const reservedSetId = '__proto__';
    const reservedPreferred = structuredClone(createValidV3Store());
    reservedPreferred.gameProgress['game-a'].preferredSetId = reservedSetId;
    expect(
      LocalProgressStoreV3Schema.safeParse(reservedPreferred).success,
      `missing inherited preferred set '${reservedSetId}' should be rejected`,
    ).toBe(false);

    const reservedActiveNoOverlap = structuredClone(createValidV3Store());
    reservedActiveNoOverlap.gameProgress['game-a'].sets = {
      [reservedSetId]: createValidSetWithSetId(reservedSetId, 'legacy-v2'),
    };
    reservedActiveNoOverlap.gameProgress['game-a'].retiredSets = {};
    reservedActiveNoOverlap.gameProgress['game-a'].preferredSetId = reservedSetId;
    const reservedActiveResult = LocalProgressStoreV3Schema.safeParse(
      reservedActiveNoOverlap,
    );
    expect(
      reservedActiveResult.success,
      `own reserved active set '${reservedSetId}' should be rejected`,
    ).toBe(false);
    if (!reservedActiveResult.success) {
      expect(
        reservedActiveResult.error.issues.some(
          (issue) => issue.message === RESERVED_RECORD_KEY_MESSAGE,
        ),
      ).toBe(true);
    }

    const reservedOverlap = structuredClone(createValidV3Store());
    reservedOverlap.gameProgress['game-a'].sets = {
      [reservedSetId]: createValidSetWithSetId(reservedSetId, 'legacy-v2'),
    };
    reservedOverlap.gameProgress['game-a'].retiredSets = {
      [reservedSetId]: createValidRetiredSetWithSetId(reservedSetId, 'legacy-v2'),
    };
    expect(
      LocalProgressStoreV3Schema.safeParse(reservedOverlap).success,
      `reserved active/retired overlap should be rejected`,
    ).toBe(false);
  });

  it('uses own-property semantics for lastGameId and undoState membership', () => {
    for (const gameId of ['constructor', 'toString'] as const) {
      const missingLastGame = structuredClone(createValidV3Store());
      missingLastGame.lastGameId = gameId;
      expect(
        LocalProgressStoreV3Schema.safeParse(missingLastGame).success,
        `missing inherited lastGameId '${gameId}' should be rejected`,
      ).toBe(false);

      const missingUndoGame = structuredClone(createValidV3Store());
      missingUndoGame.undoState = {
        [gameId]: structuredClone(missingUndoGame.undoState!['game-a']),
      };
      expect(
        LocalProgressStoreV3Schema.safeParse(missingUndoGame).success,
        `inherited undo key '${gameId}' without matching own game should be rejected`,
      ).toBe(false);

      const validGameAndUndo = structuredClone(createValidV3Store());
      const ownGame = structuredClone(
        validGameAndUndo.gameProgress['game-a'],
      );
      ownGame.gameId = gameId;
      validGameAndUndo.gameProgress = {
        ...validGameAndUndo.gameProgress,
        [gameId]: ownGame,
      };
      validGameAndUndo.undoState = {
        [gameId]: structuredClone(validGameAndUndo.undoState!['game-a']),
      };
      validGameAndUndo.lastGameId = gameId;
      expect(
        LocalProgressStoreV3Schema.safeParse(validGameAndUndo).success,
        `own game key '${gameId}' with matching undo should be accepted`,
      ).toBe(true);
      expect(
        Object.hasOwn(validGameAndUndo.gameProgress, gameId),
      ).toBe(true);
      expect(Object.hasOwn(validGameAndUndo.undoState!, gameId)).toBe(true);
      expect(
        Object.getPrototypeOf(validGameAndUndo.gameProgress),
      ).toBe(Object.prototype);
    }

    const reservedGameId = '__proto__';
    const reservedLastGame = structuredClone(createValidV3Store());
    reservedLastGame.lastGameId = reservedGameId;
    expect(
      LocalProgressStoreV3Schema.safeParse(reservedLastGame).success,
      `missing inherited lastGameId '${reservedGameId}' should be rejected`,
    ).toBe(false);

    const reservedUndoGame = structuredClone(createValidV3Store());
    reservedUndoGame.undoState = {
      [reservedGameId]: structuredClone(reservedUndoGame.undoState!['game-a']),
    };
    const reservedUndoResult = LocalProgressStoreV3Schema.safeParse(
      reservedUndoGame,
    );
    expect(
      reservedUndoResult.success,
      `reserved undo key '${reservedGameId}' should be rejected`,
    ).toBe(false);
    if (!reservedUndoResult.success) {
      expect(
        reservedUndoResult.error.issues.some(
          (issue) => issue.message === RESERVED_RECORD_KEY_MESSAGE,
        ),
      ).toBe(true);
    }

    const reservedGameAndUndo = structuredClone(createValidV3Store());
    const reservedOwnGame = structuredClone(
      reservedGameAndUndo.gameProgress['game-a'],
    );
    reservedOwnGame.gameId = reservedGameId;
    reservedGameAndUndo.gameProgress = {
      ...reservedGameAndUndo.gameProgress,
      [reservedGameId]: reservedOwnGame,
    };
    reservedGameAndUndo.undoState = {
      [reservedGameId]: structuredClone(
        reservedGameAndUndo.undoState!['game-a'],
      ),
    };
    reservedGameAndUndo.lastGameId = reservedGameId;
    const reservedGameResult = LocalProgressStoreV3Schema.safeParse(
      reservedGameAndUndo,
    );
    expect(
      reservedGameResult.success,
      `own reserved game key '${reservedGameId}' should be rejected`,
    ).toBe(false);
    if (!reservedGameResult.success) {
      expect(
        reservedGameResult.error.issues.some(
          (issue) => issue.message === RESERVED_RECORD_KEY_MESSAGE,
        ),
      ).toBe(true);
    }
  });

  it('rejects reserved embedded identities through exported Schema 3.0 schemas', () => {
    const reservedRun = { ...createValidRun(), runId: '__proto__' };
    const cases = [
      {
        name: 'achievement progress',
        result: AchievementProgressV3Schema.safeParse({
          achievementId: '__proto__',
          completed: false,
          manualOverride: false,
          lastUpdated: TS,
          provenance: 'manual',
        }),
        expectedPath: ['achievementId'],
      },
      {
        name: 'run progress',
        result: RunProgressSchema.safeParse(reservedRun),
        expectedPath: ['runId'],
      },
      {
        name: 'run ledger set',
        result: RunLedgerSetV3Schema.safeParse({
          setId: '__proto__',
          activeRunId: 'legacy-v2',
          runs: { 'legacy-v2': createValidRun() },
        }),
        expectedPath: ['setId'],
      },
      {
        name: 'game progress',
        result: GameProgressV3Schema.safeParse({
          gameId: '__proto__',
          sets: {},
          retiredSets: {},
        }),
        expectedPath: ['gameId'],
      },
      {
        name: 'undo snapshot set',
        result: ProgressUndoSnapshotV3Schema.safeParse({
          setId: '__proto__',
          runId: 'legacy-v2',
          guardedSetVersion: '1',
          previous: createValidRun(),
        }),
        expectedPath: ['setId'],
      },
      {
        name: 'undo snapshot run',
        result: ProgressUndoSnapshotV3Schema.safeParse({
          setId: 'set-a',
          runId: '__proto__',
          guardedSetVersion: '1',
          previous: reservedRun,
        }),
        expectedPath: ['runId'],
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

  it('rejects an own reserved key at every Schema 3.0 persisted record level with nested paths', () => {
    const validAchievementProgress = (achievementId: string) => ({
      achievementId,
      completed: false,
      manualOverride: false,
      lastUpdated: TS,
      provenance: 'manual' as const,
    });

    const cases: {
      name: string;
      mutate: (store: LocalProgressStoreV3) => void;
      expectedPath: Array<string | number>;
    }[] = [
      {
        name: 'checklistCompletion',
        mutate: (store) => {
          store.gameProgress['game-a'].sets['set-a'].runs[
            'legacy-v2'
          ].progress['ach-binary'].checklistCompletion = JSON.parse(
            '{"__proto__": true}',
          );
        },
        expectedPath: [
          'gameProgress',
          'game-a',
          'sets',
          'set-a',
          'runs',
          'legacy-v2',
          'progress',
          'ach-binary',
          'checklistCompletion',
          '__proto__',
        ],
      },
      {
        name: 'progress',
        mutate: (store) => {
          store.gameProgress['game-a'].sets['set-a'].runs[
            'legacy-v2'
          ].progress = JSON.parse(
            '{"__proto__": ' +
              JSON.stringify(validAchievementProgress('__proto__')) +
              '}',
          );
        },
        expectedPath: [
          'gameProgress',
          'game-a',
          'sets',
          'set-a',
          'runs',
          'legacy-v2',
          'progress',
          '__proto__',
        ],
      },
      {
        name: 'orphanedProgress',
        mutate: (store) => {
          store.gameProgress['game-a'].sets['set-a'].runs[
            'legacy-v2'
          ].orphanedProgress = JSON.parse(
            '{"__proto__": [' +
              JSON.stringify({
                ...validAchievementProgress('__proto__'),
                trackingModeAtRemoval: 'binary',
              }) +
              ']}',
          );
        },
        expectedPath: [
          'gameProgress',
          'game-a',
          'sets',
          'set-a',
          'runs',
          'legacy-v2',
          'orphanedProgress',
          '__proto__',
        ],
      },
      {
        name: 'runs',
        mutate: (store) => {
          store.gameProgress['game-a'].sets['set-a'].runs = JSON.parse(
            '{"__proto__": ' + JSON.stringify(createValidRun()) + '}',
          );
        },
        expectedPath: [
          'gameProgress',
          'game-a',
          'sets',
          'set-a',
          'runs',
          '__proto__',
        ],
      },
      {
        name: 'sets',
        mutate: (store) => {
          const set = store.gameProgress['game-a'].sets['set-a'];
          store.gameProgress['game-a'].sets = JSON.parse(
            '{"__proto__": ' + JSON.stringify(set) + '}',
          );
        },
        expectedPath: [
          'gameProgress',
          'game-a',
          'sets',
          '__proto__',
        ],
      },
      {
        name: 'retiredSets',
        mutate: (store) => {
          const retired = store.gameProgress['game-a'].retiredSets[
            'retired-removed'
          ];
          store.gameProgress['game-a'].retiredSets = JSON.parse(
            '{"__proto__": ' + JSON.stringify(retired) + '}',
          );
        },
        expectedPath: [
          'gameProgress',
          'game-a',
          'retiredSets',
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
                setId: 'set-a',
                runId: 'legacy-v2',
                guardedSetVersion: '1.0',
                previous: createValidRun(),
              }) +
              '}',
          );
        },
        expectedPath: ['undoState', '__proto__'],
      },
    ];

    for (const testCase of cases) {
      const store = structuredClone(createValidV3Store());
      testCase.mutate(store);
      const result = LocalProgressStoreV3Schema.safeParse(store);
      expect(result.success, testCase.name).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => i.message === RESERVED_RECORD_KEY_MESSAGE,
        );
        expect(issue, testCase.name).toBeDefined();
        expect(issue?.path, testCase.name).toEqual(testCase.expectedPath);
      }
    }
  });
});
