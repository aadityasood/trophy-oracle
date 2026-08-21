import { z, type RefinementCtx } from 'zod';
import {
  NonBlankStringSchema,
  ProgressProvenanceSchema,
  distinctNonBlankIds,
  isIsoUtcString,
} from './progress-schema-common';

export const HUNT_MEMORY_STORE_SCHEMA_VERSION = '3.0';

type IssueSink = RefinementCtx;

const IsoUtcTimestampSchema = z.string().refine(isIsoUtcString, {
  message: 'Must be a valid ISO-8601 UTC timestamp',
});

const TrackingModeSchema = z.enum(['binary', 'counter', 'checklist']);

export const CounterProgressSchema = z.discriminatedUnion('certainty', [
  z.strictObject({
    certainty: z.literal('exact'),
    value: z.number().int().nonnegative(),
  }),
  z.strictObject({
    certainty: z.literal('at_least'),
    minimum: z.number().int().nonnegative(),
  }),
  z.strictObject({
    certainty: z.literal('estimated'),
    estimate: z.number().int().nonnegative(),
  }),
  z.strictObject({
    certainty: z.literal('unknown'),
    observedSinceStart: z.number().int().nonnegative(),
    trackingStartedAt: IsoUtcTimestampSchema,
  }),
]);
export type CounterProgress = z.infer<typeof CounterProgressSchema>;

type AchievementProgressV3Like = {
  completed: boolean;
  manualOverride: boolean;
  counter?: CounterProgress;
  checklistCompletion?: Record<string, boolean>;
};

function refineAchievementProgressV3(
  value: AchievementProgressV3Like,
  ctx: IssueSink,
): void {
  if (value.counter !== undefined && value.checklistCompletion !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'Achievement progress cannot contain both counter and checklist state',
      path: ['checklistCompletion'],
    });
  }
  if (value.manualOverride && !value.completed) {
    ctx.addIssue({
      code: 'custom',
      message: 'A completion override requires completed to be true',
      path: ['completed'],
    });
  }
  if (
    value.counter === undefined &&
    value.checklistCompletion === undefined &&
    value.manualOverride
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Binary progress cannot use a completion override',
      path: ['manualOverride'],
    });
  }
}

const AchievementProgressV3Fields = {
  achievementId: NonBlankStringSchema,
  completed: z.boolean(),
  manualOverride: z.boolean(),
  counter: CounterProgressSchema.optional(),
  checklistCompletion: z
    .record(NonBlankStringSchema, z.boolean())
    .optional(),
  notes: z.string().optional(),
  lastUpdated: IsoUtcTimestampSchema,
  provenance: ProgressProvenanceSchema,
};

export const AchievementProgressV3Schema = z
  .strictObject(AchievementProgressV3Fields)
  .superRefine(refineAchievementProgressV3);
export type AchievementProgressV3 = z.infer<
  typeof AchievementProgressV3Schema
>;

type OrphanedAchievementProgressV3Like = AchievementProgressV3Like & {
  trackingModeAtRemoval: 'binary' | 'counter' | 'checklist';
};

function refineOrphanedAchievementProgressV3(
  value: OrphanedAchievementProgressV3Like,
  ctx: IssueSink,
): void {
  const hasCounter = value.counter !== undefined;
  const hasChecklist = value.checklistCompletion !== undefined;

  if (value.trackingModeAtRemoval === 'binary' && (hasCounter || hasChecklist)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Binary orphan progress cannot contain tracker fields',
      path: ['trackingModeAtRemoval'],
    });
  } else if (
    value.trackingModeAtRemoval === 'counter' &&
    (!hasCounter || hasChecklist)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Counter orphan progress requires only counter tracker state',
      path: ['trackingModeAtRemoval'],
    });
  } else if (
    value.trackingModeAtRemoval === 'checklist' &&
    (!hasChecklist || hasCounter)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Checklist orphan progress requires only checklist tracker state',
      path: ['trackingModeAtRemoval'],
    });
  }
}

export const OrphanedAchievementProgressV3Schema = z
  .strictObject({
    ...AchievementProgressV3Fields,
    trackingModeAtRemoval: TrackingModeSchema,
  })
  .superRefine(refineAchievementProgressV3)
  .superRefine(refineOrphanedAchievementProgressV3);
export type OrphanedAchievementProgressV3 = z.infer<
  typeof OrphanedAchievementProgressV3Schema
>;

type RunProgressLike = {
  pinnedAchievementIds: string[];
  progress: Record<string, { achievementId: string }>;
  orphanedProgress: Record<string, Array<{ achievementId: string }>>;
};

function refineRunProgress(value: RunProgressLike, ctx: IssueSink): void {
  Object.entries(value.progress).forEach(([achievementId, progress]) => {
    if (progress.achievementId !== achievementId) {
      ctx.addIssue({
        code: 'custom',
        message: `Progress record key '${achievementId}' does not match embedded achievementId '${progress.achievementId}'`,
        path: ['progress', achievementId],
      });
    }
  });
  value.pinnedAchievementIds.forEach((achievementId, index) => {
    if (!value.progress[achievementId]) {
      ctx.addIssue({
        code: 'custom',
        message: `Pinned achievement '${achievementId}' does not exist in active progress`,
        path: ['pinnedAchievementIds', index],
      });
    }
  });
  Object.entries(value.orphanedProgress).forEach(([achievementId, history]) => {
    history.forEach((orphan, index) => {
      if (orphan.achievementId !== achievementId) {
        ctx.addIssue({
          code: 'custom',
          message: `Orphan history entry '${achievementId}' does not match embedded achievementId '${orphan.achievementId}'`,
          path: ['orphanedProgress', achievementId, index],
        });
      }
    });
  });
}

export const RunProgressSchema = z
  .strictObject({
    runId: NonBlankStringSchema,
    name: NonBlankStringSchema,
    createdAt: IsoUtcTimestampSchema,
    activeStage: z.enum(['story', 'missables', 'cleanup']).optional(),
    pinnedAchievementIds: distinctNonBlankIds.max(5),
    progress: z.record(NonBlankStringSchema, AchievementProgressV3Schema),
    orphanedProgress: z.record(
      NonBlankStringSchema,
      z.array(OrphanedAchievementProgressV3Schema).min(1),
    ),
  })
  .superRefine(refineRunProgress);
export type RunProgress = z.infer<typeof RunProgressSchema>;

type RunLedgerLike = {
  activeRunId: string;
  runs: Record<string, { runId: string }>;
};

function refineRunLedger(value: RunLedgerLike, ctx: IssueSink): void {
  Object.entries(value.runs).forEach(([runId, run]) => {
    if (run.runId !== runId) {
      ctx.addIssue({
        code: 'custom',
        message: `Run key '${runId}' does not match embedded runId '${run.runId}'`,
        path: ['runs', runId],
      });
    }
  });
  if (!value.runs[value.activeRunId]) {
    ctx.addIssue({
      code: 'custom',
      message: `activeRunId '${value.activeRunId}' does not reference a run in this set`,
      path: ['activeRunId'],
    });
  }
}

const RunLedgerFields = {
  setId: NonBlankStringSchema,
  activeRunId: NonBlankStringSchema,
  runs: z.record(NonBlankStringSchema, RunProgressSchema),
};

export const RunLedgerSetV3Schema = z
  .strictObject(RunLedgerFields)
  .superRefine(refineRunLedger);
export type RunLedgerSetV3 = z.infer<typeof RunLedgerSetV3Schema>;

export const AchievementSetProgressV3Schema = z
  .strictObject({
    ...RunLedgerFields,
    version: NonBlankStringSchema,
  })
  .superRefine(refineRunLedger);
export type AchievementSetProgressV3 = z.infer<
  typeof AchievementSetProgressV3Schema
>;

export const RetiredAchievementSetProgressV3Schema = z
  .discriminatedUnion('retirementReason', [
    z.strictObject({
      ...RunLedgerFields,
      retirementReason: z.literal('removed_set'),
      version: NonBlankStringSchema,
    }),
    z.strictObject({
      ...RunLedgerFields,
      retirementReason: z.literal('schema_2_absent_orphans'),
    }),
  ])
  .superRefine(refineRunLedger);
export type RetiredAchievementSetProgressV3 = z.infer<
  typeof RetiredAchievementSetProgressV3Schema
>;

type GameProgressV3Like = {
  preferredSetId?: string;
  sets: Record<string, { setId: string }>;
  retiredSets: Record<string, { setId: string }>;
};

function refineGameProgressV3(value: GameProgressV3Like, ctx: IssueSink): void {
  Object.entries(value.sets).forEach(([setId, set]) => {
    if (set.setId !== setId) {
      ctx.addIssue({
        code: 'custom',
        message: `Set progress key '${setId}' does not match embedded setId '${set.setId}'`,
        path: ['sets', setId],
      });
    }
  });
  Object.entries(value.retiredSets).forEach(([setId, set]) => {
    if (set.setId !== setId) {
      ctx.addIssue({
        code: 'custom',
        message: `Retired set key '${setId}' does not match embedded setId '${set.setId}'`,
        path: ['retiredSets', setId],
      });
    }
  });
  if (value.preferredSetId !== undefined && !value.sets[value.preferredSetId]) {
    ctx.addIssue({
      code: 'custom',
      message: `preferredSetId '${value.preferredSetId}' does not exist in active sets`,
      path: ['preferredSetId'],
    });
  }
  Object.keys(value.sets).forEach((setId) => {
    if (value.retiredSets[setId]) {
      ctx.addIssue({
        code: 'custom',
        message: `Set '${setId}' cannot be both active and retired`,
        path: ['sets', setId],
      });
    }
  });
}

export const GameProgressV3Schema = z
  .strictObject({
    gameId: NonBlankStringSchema,
    preferredSetId: NonBlankStringSchema.optional(),
    sets: z.record(NonBlankStringSchema, AchievementSetProgressV3Schema),
    retiredSets: z.record(
      NonBlankStringSchema,
      RetiredAchievementSetProgressV3Schema,
    ),
  })
  .superRefine(refineGameProgressV3);
export type GameProgressV3 = z.infer<typeof GameProgressV3Schema>;

type UndoSnapshotV3Like = {
  runId: string;
  previous: { runId: string };
};

function refineUndoSnapshotV3(value: UndoSnapshotV3Like, ctx: IssueSink): void {
  if (value.previous.runId !== value.runId) {
    ctx.addIssue({
      code: 'custom',
      message: `Undo previous.runId '${value.previous.runId}' does not match snapshot runId '${value.runId}'`,
      path: ['previous', 'runId'],
    });
  }
}

export const ProgressUndoSnapshotV3Schema = z
  .strictObject({
    setId: NonBlankStringSchema,
    runId: NonBlankStringSchema,
    guardedSetVersion: NonBlankStringSchema,
    previous: RunProgressSchema,
  })
  .superRefine(refineUndoSnapshotV3);
export type ProgressUndoSnapshotV3 = z.infer<
  typeof ProgressUndoSnapshotV3Schema
>;

type LocalProgressStoreV3Like = {
  lastGameId?: string;
  gameProgress: Record<string, { gameId: string }>;
  undoState?: Record<string, unknown>;
};

function refineLocalProgressStoreV3(
  value: LocalProgressStoreV3Like,
  ctx: IssueSink,
): void {
  Object.entries(value.gameProgress).forEach(([gameId, game]) => {
    if (game.gameId !== gameId) {
      ctx.addIssue({
        code: 'custom',
        message: `Game progress key '${gameId}' does not match embedded gameId '${game.gameId}'`,
        path: ['gameProgress', gameId],
      });
    }
  });
  if (value.lastGameId !== undefined && !value.gameProgress[value.lastGameId]) {
    ctx.addIssue({
      code: 'custom',
      message: `lastGameId '${value.lastGameId}' does not exist in gameProgress`,
      path: ['lastGameId'],
    });
  }
  Object.keys(value.undoState ?? {}).forEach((gameId) => {
    if (!value.gameProgress[gameId]) {
      ctx.addIssue({
        code: 'custom',
        message: `Undo state key '${gameId}' does not exist in gameProgress`,
        path: ['undoState', gameId],
      });
    }
  });
}

export const LocalProgressStoreV3Schema = z
  .strictObject({
    schemaVersion: z.literal(HUNT_MEMORY_STORE_SCHEMA_VERSION),
    lastGameId: NonBlankStringSchema.optional(),
    gameProgress: z.record(NonBlankStringSchema, GameProgressV3Schema),
    undoState: z
      .record(NonBlankStringSchema, ProgressUndoSnapshotV3Schema)
      .optional(),
  })
  .superRefine(refineLocalProgressStoreV3);
export type LocalProgressStoreV3 = z.infer<typeof LocalProgressStoreV3Schema>;

export const MigratedCounterAssumptionSchema = z.strictObject({
  gameId: NonBlankStringSchema,
  setId: NonBlankStringSchema,
  achievementId: NonBlankStringSchema,
  location: z.enum(['active', 'orphan', 'undo']),
  assumedCertainty: z.literal('exact'),
  value: z.number().int().nonnegative(),
});
export type MigratedCounterAssumption = z.infer<
  typeof MigratedCounterAssumptionSchema
>;

export const MigratedSetTargetSchema = z.strictObject({
  gameId: NonBlankStringSchema,
  setId: NonBlankStringSchema,
  destination: z.enum(['active', 'retired']),
});
export type MigratedSetTarget = z.infer<typeof MigratedSetTargetSchema>;

export const MigratedRunTargetSchema = z.strictObject({
  gameId: NonBlankStringSchema,
  setId: NonBlankStringSchema,
  destination: z.enum(['active', 'retired']),
  runId: z.literal('legacy-v2'),
});
export type MigratedRunTarget = z.infer<typeof MigratedRunTargetSchema>;

export const PreservedUndoTargetSchema = z.strictObject({
  gameId: NonBlankStringSchema,
  setId: NonBlankStringSchema,
  runId: z.literal('legacy-v2'),
  guardedSetVersion: NonBlankStringSchema,
});
export type PreservedUndoTarget = z.infer<typeof PreservedUndoTargetSchema>;

export const ProgressMigrationReportSchema = z.strictObject({
  sourceSchemaVersion: z.literal('2.0'),
  targetSchemaVersion: z.literal('3.0'),
  migratedAt: IsoUtcTimestampSchema,
  migratedGameIds: z.array(NonBlankStringSchema),
  migratedSets: z.array(MigratedSetTargetSchema),
  createdRuns: z.array(MigratedRunTargetSchema),
  counterAssumptions: z.array(MigratedCounterAssumptionSchema),
  preservedUndoTargets: z.array(PreservedUndoTargetSchema),
  warnings: z.array(z.string()),
});
export type ProgressMigrationReport = z.infer<
  typeof ProgressMigrationReportSchema
>;

export const ProgressMigrationTransformSuccessSchema = z.strictObject({
  success: z.literal(true),
  store: LocalProgressStoreV3Schema,
  report: ProgressMigrationReportSchema,
});
export type ProgressMigrationTransformSuccess = z.infer<
  typeof ProgressMigrationTransformSuccessSchema
>;

export const ProgressMigrationTransformFailureSchema = z.strictObject({
  success: z.literal(false),
  // STORAGE_WRITE_ERROR belongs to the later storage wrapper, not this pure transform.
  code: z.enum([
    'INVALID_SOURCE_STORE',
    'TRANSFORMATION_ERROR',
    'INVALID_TARGET_STORE',
  ]),
  message: z.string(),
  conflicts: z.array(z.string()),
});
export type ProgressMigrationTransformFailure = z.infer<
  typeof ProgressMigrationTransformFailureSchema
>;

export const ProgressMigrationTransformResultSchema = z.discriminatedUnion(
  'success',
  [
    ProgressMigrationTransformSuccessSchema,
    ProgressMigrationTransformFailureSchema,
  ],
);
export type ProgressMigrationTransformResult = z.infer<
  typeof ProgressMigrationTransformResultSchema
>;
