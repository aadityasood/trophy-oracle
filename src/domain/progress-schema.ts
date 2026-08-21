import { z } from 'zod';
import {
  NonBlankStringSchema,
  ProgressProvenanceSchema,
  distinctNonBlankIds,
  isIsoUtcString,
} from './progress-schema-common';

export {
  NonBlankStringSchema,
  ProgressProvenanceSchema,
  distinctNonBlankIds,
  isIsoUtcString,
} from './progress-schema-common';
export type { ProgressProvenance } from './progress-schema-common';

export const CURRENT_STORE_SCHEMA_VERSION = '2.0';

export const AchievementProgressSchema = z.strictObject({
  achievementId: NonBlankStringSchema,
  completed: z.boolean(),
  manualOverride: z.boolean(),
  counterValue: z.number().int().nonnegative().optional(),
  checklistCompletion: z
    .record(NonBlankStringSchema, z.boolean())
    .optional(),
  notes: z.string().optional(),
  lastUpdated: z.string().refine(isIsoUtcString, {
    message: 'lastUpdated must be a valid ISO-8601 UTC timestamp',
  }),
  provenance: ProgressProvenanceSchema,
});
export type AchievementProgress = z.infer<typeof AchievementProgressSchema>;

export const OrphanedAchievementProgressSchema = AchievementProgressSchema.extend({
  trackingModeAtRemoval: z.enum(['binary', 'counter', 'checklist']),
})
  .strict()
  .superRefine((progress, ctx) => {
    if (progress.trackingModeAtRemoval === 'binary') {
      if (progress.manualOverride) {
        ctx.addIssue({
          code: 'custom',
          message: 'Binary progress cannot use manualOverride',
          path: ['manualOverride'],
        });
      }
      if (progress.counterValue !== undefined || progress.checklistCompletion !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Binary progress cannot contain tracker fields',
          path: ['trackingModeAtRemoval'],
        });
      }
    } else if (progress.trackingModeAtRemoval === 'counter') {
      if (progress.counterValue === undefined || progress.checklistCompletion !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Counter progress requires only counterValue tracker state',
          path: ['trackingModeAtRemoval'],
        });
      }
    } else if (
      progress.checklistCompletion === undefined ||
      progress.counterValue !== undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Checklist progress requires only checklistCompletion tracker state',
        path: ['trackingModeAtRemoval'],
      });
    }

    if (progress.manualOverride && !progress.completed) {
      ctx.addIssue({
        code: 'custom',
        message: 'A completion override requires completed to be true',
        path: ['completed'],
      });
    }
  });
export type OrphanedAchievementProgress = z.infer<
  typeof OrphanedAchievementProgressSchema
>;

export const AchievementSetProgressSchema = z
  .strictObject({
    setId: NonBlankStringSchema,
    version: NonBlankStringSchema,
    activeStage: z.enum(['story', 'missables', 'cleanup']).optional(),
    pinnedAchievementIds: distinctNonBlankIds.max(5),
    progress: z.record(NonBlankStringSchema, AchievementProgressSchema),
  })
  .superRefine((setProgress, ctx) => {
    Object.entries(setProgress.progress).forEach(([achievementId, progress]) => {
      if (progress.achievementId !== achievementId) {
        ctx.addIssue({
          code: 'custom',
          message: `Progress record key '${achievementId}' does not match embedded achievementId '${progress.achievementId}'`,
          path: ['progress', achievementId],
        });
      }
    });

    setProgress.pinnedAchievementIds.forEach((achievementId, index) => {
      if (!setProgress.progress[achievementId]) {
        ctx.addIssue({
          code: 'custom',
          message: `Pinned achievement '${achievementId}' does not exist in active progress`,
          path: ['pinnedAchievementIds', index],
        });
      }
    });
  });
export type AchievementSetProgress = z.infer<
  typeof AchievementSetProgressSchema
>;

export const GameProgressSchema = z
  .strictObject({
    gameId: NonBlankStringSchema,
    preferredSetId: NonBlankStringSchema.optional(),
    sets: z.record(NonBlankStringSchema, AchievementSetProgressSchema),
    orphanedProgress: z.record(
      NonBlankStringSchema,
      z.record(NonBlankStringSchema, OrphanedAchievementProgressSchema),
    ),
  })
  .superRefine((gameProgress, ctx) => {
    Object.entries(gameProgress.sets).forEach(([setId, setProgress]) => {
      if (setProgress.setId !== setId) {
        ctx.addIssue({
          code: 'custom',
          message: `Set progress key '${setId}' does not match embedded setId '${setProgress.setId}'`,
          path: ['sets', setId],
        });
      }
    });

    if (
      gameProgress.preferredSetId !== undefined &&
      !gameProgress.sets[gameProgress.preferredSetId]
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `preferredSetId '${gameProgress.preferredSetId}' does not exist in game sets`,
        path: ['preferredSetId'],
      });
    }

    Object.entries(gameProgress.orphanedProgress).forEach(
      ([setId, orphanMap]) => {
        Object.entries(orphanMap).forEach(([achievementId, orphan]) => {
          if (orphan.achievementId !== achievementId) {
            ctx.addIssue({
              code: 'custom',
              message: `Orphan progress key '${achievementId}' does not match embedded achievementId '${orphan.achievementId}'`,
              path: ['orphanedProgress', setId, achievementId],
            });
          }
        });
      },
    );
  });
export type GameProgress = z.infer<typeof GameProgressSchema>;

export const ProgressUndoSnapshotSchema = z
  .strictObject({
    setId: NonBlankStringSchema,
    previous: AchievementSetProgressSchema,
  })
  .superRefine((snapshot, ctx) => {
    if (snapshot.setId !== snapshot.previous.setId) {
      ctx.addIssue({
        code: 'custom',
        message: `Undo snapshot setId '${snapshot.setId}' does not match previous.setId '${snapshot.previous.setId}'`,
        path: ['setId'],
      });
    }
  });
export type ProgressUndoSnapshot = z.infer<typeof ProgressUndoSnapshotSchema>;

export const LocalProgressStoreSchema = z
  .strictObject({
    schemaVersion: NonBlankStringSchema,
    lastGameId: NonBlankStringSchema.optional(),
    gameProgress: z.record(NonBlankStringSchema, GameProgressSchema),
    undoState: z
      .record(NonBlankStringSchema, ProgressUndoSnapshotSchema)
      .optional(),
  })
  .superRefine((store, ctx) => {
    if (store.schemaVersion !== CURRENT_STORE_SCHEMA_VERSION) {
      ctx.addIssue({
        code: 'custom',
        message: `Unsupported store schemaVersion '${store.schemaVersion}', expected '${CURRENT_STORE_SCHEMA_VERSION}'`,
        path: ['schemaVersion'],
      });
    }

    Object.entries(store.gameProgress).forEach(([gameId, gameProgress]) => {
      if (gameProgress.gameId !== gameId) {
        ctx.addIssue({
          code: 'custom',
          message: `Game progress key '${gameId}' does not match embedded gameId '${gameProgress.gameId}'`,
          path: ['gameProgress', gameId],
        });
      }
    });

    if (store.lastGameId !== undefined && !store.gameProgress[store.lastGameId]) {
      ctx.addIssue({
        code: 'custom',
        message: `lastGameId '${store.lastGameId}' does not exist in gameProgress`,
        path: ['lastGameId'],
      });
    }

    Object.entries(store.undoState ?? {}).forEach(([gameId]) => {
      const gameProgress = store.gameProgress[gameId];
      if (!gameProgress) {
        ctx.addIssue({
          code: 'custom',
          message: `Undo state key '${gameId}' does not exist in gameProgress`,
          path: ['undoState', gameId],
        });
      }
    });
  });
export type LocalProgressStore = z.infer<typeof LocalProgressStoreSchema>;

export const ChecklistItemDeltaSchema = z.strictObject({
  achievementId: NonBlankStringSchema,
  itemIds: distinctNonBlankIds.min(1),
});
export type ChecklistItemDelta = z.infer<typeof ChecklistItemDeltaSchema>;

export const AchievementSetReconciliationDeltaSchema = z.strictObject({
  setId: NonBlankStringSchema,
  fromVersion: NonBlankStringSchema.optional(),
  toVersion: NonBlankStringSchema.optional(),
  addedAchievementIds: distinctNonBlankIds,
  quarantinedAchievementIds: distinctNonBlankIds,
  restoredOrphanedAchievementIds: distinctNonBlankIds,
  addedChecklistItems: z.array(ChecklistItemDeltaSchema),
  removedChecklistItems: z.array(ChecklistItemDeltaSchema),
  removedPinnedAchievementIds: distinctNonBlankIds,
});
export type AchievementSetReconciliationDelta = z.infer<
  typeof AchievementSetReconciliationDeltaSchema
>;

export const ReconciliationDeltaReportSchema = z.strictObject({
  gameId: NonBlankStringSchema,
  fromGameVersion: NonBlankStringSchema,
  toGameVersion: NonBlankStringSchema,
  setDeltas: z.array(AchievementSetReconciliationDeltaSchema),
  clearedPreferredSetId: NonBlankStringSchema.optional(),
  clearedUndoSetId: NonBlankStringSchema.optional(),
  schemaConflicts: z.array(NonBlankStringSchema),
});
export type ReconciliationDeltaReport = z.infer<
  typeof ReconciliationDeltaReportSchema
>;
