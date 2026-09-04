import type { LocalProgressStoreV3 } from './hunt-memory-schema';

export type ChecklistItemDeltaV3 = {
  achievementId: string;
  itemIds: string[];
};

export type RunReconciliationDelta = {
  runId: string;
  addedAchievementIds: string[];
  quarantinedAchievementIds: string[];
  restoredOrphanedAchievementIds: string[];
  addedChecklistItems: ChecklistItemDeltaV3[];
  removedChecklistItems: ChecklistItemDeltaV3[];
  removedPinnedAchievementIds: string[];
};

export type AchievementSetReconciliationDeltaV3 = {
  setId: string;
  fromVersion?: string;
  toVersion?: string;
  runDeltas: RunReconciliationDelta[];
};

export type ReconciliationDeltaReportV3 = {
  gameId: string;
  fromGameVersion: string;
  toGameVersion: string;
  setDeltas: AchievementSetReconciliationDeltaV3[];
  retiredSetIds: string[];
  restoredRetiredSetIds: string[];
  retainedRetiredSetIds: string[];
  clearedPreferredSetId?: string;
  clearedUndoTarget?: { setId: string; runId: string };
  schemaConflicts: string[];
};

export type HuntMemoryReconciliationResult = {
  store: LocalProgressStoreV3;
  report: ReconciliationDeltaReportV3;
};

export type ConflictRuleNumber = 1 | 6 | 8 | 11;

export type TrackedSchemaConflict = {
  rule: ConflictRuleNumber;
  identityKey: string;
  message: string;
};
