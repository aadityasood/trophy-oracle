import { z } from 'zod';

const NonBlankStringSchema = z.string().refine(
  (value) => value.trim().length > 0,
  { message: 'Must contain at least one non-whitespace character' },
);

export const PlatformIdSchema = z.enum([
  'playstation',
  'xbox',
  'steam',
  'other',
]);

export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const PlatformRewardSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('trophy'),
    grade: z.enum(['bronze', 'silver', 'gold', 'platinum']),
  }),
  z.strictObject({
    type: z.literal('gamerscore'),
    points: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal('achievement'),
  }),
]);

export type PlatformReward = z.infer<typeof PlatformRewardSchema>;

export const ChecklistItemDefinitionSchema = z.strictObject({
  id: NonBlankStringSchema,
  name: NonBlankStringSchema,
});

export type ChecklistItemDefinition = z.infer<
  typeof ChecklistItemDefinitionSchema
>;

export const TrackingConfigurationSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('binary'),
  }),
  z.strictObject({
    mode: z.literal('counter'),
    unit: NonBlankStringSchema,
    target: z.number().int().positive().optional(),
    quickSteps: z
      .array(z.number().int().positive())
      .min(1)
      .refine((steps) => new Set(steps).size === steps.length, {
        message: 'quickSteps must contain distinct positive integers',
      })
      .optional(),
  }),
  z.strictObject({
    mode: z.literal('checklist'),
    items: z
      .array(ChecklistItemDefinitionSchema)
      .min(1)
      .refine(
        (items) => {
          const ids = items.map((item) => item.id);
          return new Set(ids).size === ids.length;
        },
        { message: 'Checklist item IDs must be unique within the checklist' },
      ),
  }),
]);

export type TrackingConfiguration = z.infer<
  typeof TrackingConfigurationSchema
>;

export const AchievementLabelSchema = z.enum([
  'story',
  'missable',
  'grind',
  'collectible',
  'online',
  'difficulty',
  'point_of_no_return',
  'post_game',
  'skill',
  'completion',
]);

export type AchievementLabel = z.infer<typeof AchievementLabelSchema>;

export const AchievementRecordSchema = z.strictObject({
  id: NonBlankStringSchema,
  name: NonBlankStringSchema,
  description: NonBlankStringSchema,
  evidence: NonBlankStringSchema,
  reward: PlatformRewardSchema,
  tracking: TrackingConfigurationSchema,
  labels: z.array(AchievementLabelSchema),
  expectedStage: z.enum(['story', 'missables', 'cleanup']),
  confidence: z.number().min(0).max(1),
  prerequisites: z.array(NonBlankStringSchema),
  spoilerSafeHint: NonBlankStringSchema.optional(),
  warning: NonBlankStringSchema.optional(),
  estimatedEffort: NonBlankStringSchema.optional(),
  crossPlatformGroupId: NonBlankStringSchema.optional(),
});

export type AchievementRecord = z.infer<typeof AchievementRecordSchema>;

export const AchievementSetSchema = z.strictObject({
  id: NonBlankStringSchema,
  platform: PlatformIdSchema,
  edition: NonBlankStringSchema.optional(),
  platformGameId: NonBlankStringSchema.optional(),
  version: NonBlankStringSchema,
  achievements: z.array(AchievementRecordSchema),
});

export type AchievementSet = z.infer<typeof AchievementSetSchema>;

export const GameThemeSchema = z.strictObject({
  primary: NonBlankStringSchema,
  secondary: NonBlankStringSchema,
  surfaceGlow: NonBlankStringSchema,
  mood: NonBlankStringSchema,
});

export type GameTheme = z.infer<typeof GameThemeSchema>;

export const GameRecordSchema = z.strictObject({
  id: NonBlankStringSchema,
  title: NonBlankStringSchema,
  aliases: z.array(NonBlankStringSchema),
  sourceType: z.enum(['fictional_demo', 'imported', 'scraped', 'manual']),
  version: NonBlankStringSchema,
  theme: GameThemeSchema,
  summary: NonBlankStringSchema,
  achievementSets: z.array(AchievementSetSchema),
});

export type GameRecord = z.infer<typeof GameRecordSchema>;

export const DemoGamesDatasetSchema = z
  .strictObject({
    schemaVersion: NonBlankStringSchema,
    notes: z.string(),
    games: z.array(GameRecordSchema),
  })
  .superRefine((dataset, ctx) => {
    const gameIds = new Set<string>();
    const allSetIds = new Set<string>();

    dataset.games.forEach((game, gameIdx) => {
      if (gameIds.has(game.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate game ID: ${game.id}`,
          path: ['games', gameIdx, 'id'],
        });
      }
      gameIds.add(game.id);

      const platformEditionPairs = new Set<string>();

      game.achievementSets.forEach((set, setIdx) => {
        if (allSetIds.has(set.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate achievement set ID: ${set.id}`,
            path: ['games', gameIdx, 'achievementSets', setIdx, 'id'],
          });
        }
        allSetIds.add(set.id);

        const pairKey = `${set.platform}:${set.edition ?? ''}`;
        if (platformEditionPairs.has(pairKey)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate platform/edition pair '${pairKey}' in game ${game.id}`,
            path: ['games', gameIdx, 'achievementSets', setIdx],
          });
        }
        platformEditionPairs.add(pairKey);

        const setAchievementIds = new Set(
          set.achievements.map((achievement) => achievement.id),
        );
        const seenAchievementIds = new Set<string>();

        set.achievements.forEach((achievement, achievementIdx) => {
          if (seenAchievementIds.has(achievement.id)) {
            ctx.addIssue({
              code: 'custom',
              message: `Duplicate achievement ID '${achievement.id}' in set '${set.id}'`,
              path: [
                'games',
                gameIdx,
                'achievementSets',
                setIdx,
                'achievements',
                achievementIdx,
                'id',
              ],
            });
          }
          seenAchievementIds.add(achievement.id);

          const expectedRewardType =
            set.platform === 'playstation'
              ? 'trophy'
              : set.platform === 'xbox'
                ? 'gamerscore'
                : 'achievement';

          if (achievement.reward.type !== expectedRewardType) {
            ctx.addIssue({
              code: 'custom',
              message: `Platform '${set.platform}' requires '${expectedRewardType}' reward, got '${achievement.reward.type}' on '${achievement.id}'`,
              path: [
                'games',
                gameIdx,
                'achievementSets',
                setIdx,
                'achievements',
                achievementIdx,
                'reward',
              ],
            });
          }

          achievement.prerequisites.forEach((prerequisiteId, prerequisiteIdx) => {
            const prerequisitePath = [
              'games',
              gameIdx,
              'achievementSets',
              setIdx,
              'achievements',
              achievementIdx,
              'prerequisites',
              prerequisiteIdx,
            ];

            if (prerequisiteId === achievement.id) {
              ctx.addIssue({
                code: 'custom',
                message: `Achievement '${achievement.id}' cannot list itself as a prerequisite`,
                path: prerequisitePath,
              });
            } else if (!setAchievementIds.has(prerequisiteId)) {
              ctx.addIssue({
                code: 'custom',
                message: `Prerequisite '${prerequisiteId}' on achievement '${achievement.id}' does not exist in set '${set.id}'`,
                path: prerequisitePath,
              });
            }
          });

          const requiresSafeHint =
            achievement.warning !== undefined ||
            achievement.tracking.mode === 'checklist';

          if (requiresSafeHint && achievement.spoilerSafeHint === undefined) {
            ctx.addIssue({
              code: 'custom',
              message: `Achievement '${achievement.id}' with warning or checklist tracking requires a non-empty spoilerSafeHint`,
              path: [
                'games',
                gameIdx,
                'achievementSets',
                setIdx,
                'achievements',
                achievementIdx,
                'spoilerSafeHint',
              ],
            });
          }
        });
      });
    });
  });

export type DemoGamesDataset = z.infer<typeof DemoGamesDatasetSchema>;

export type DatasetLoadResult =
  | { success: true; data: DemoGamesDataset }
  | { success: false; error: string };

export function validateDemoGamesDataset(raw: unknown): DatasetLoadResult {
  const parseResult = DemoGamesDatasetSchema.safeParse(raw);
  if (parseResult.success) {
    return { success: true, data: parseResult.data };
  }

  const formattedError = parseResult.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  return { success: false, error: formattedError || parseResult.error.message };
}

export function getPlatformRoadmapLabel(platform: PlatformId): string {
  return platform === 'playstation' ? 'Platinum Roadmap' : '100% Roadmap';
}
