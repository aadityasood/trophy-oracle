# Trophy Oracle Data Contract

## Purpose

The data contract defines the source of truth for Trophy Oracle v1. The AI pipeline treats these files as trusted evidence and avoids claims outside them.

## Game Record

```ts
type PlatformId = "playstation" | "xbox" | "steam" | "other";

type PlatformReward =
  | { type: "trophy"; grade: "bronze" | "silver" | "gold" | "platinum" }
  | { type: "gamerscore"; points: number }
  | { type: "achievement" };

type TrackingConfiguration =
  | { mode: "binary" }
  | { mode: "counter"; unit: string; target?: number; quickSteps?: number[] }
  | { mode: "checklist"; items: ChecklistItemDefinition[] };

type ChecklistItemDefinition = {
  id: string; // unique within the checklist
  name: string;
};

type GameRecord = {
  id: string;
  title: string;
  aliases: string[];
  sourceType: "fictional_demo" | "imported" | "scraped" | "manual";
  version: string; // game-record content version
  theme: GameTheme;
  summary: string;
  achievementSets: AchievementSet[];
};

type DemoGamesDataset = {
  schemaVersion: string; // source dataset schema version, independent of LocalProgressStore.schemaVersion
  notes: string;
  games: GameRecord[];
};
```

## Theme

```ts
type GameTheme = {
  primary: string;
  secondary: string;
  surfaceGlow: string;
  mood: string;
};
```

Theme colors drive the UI accent for the searched game.

## Achievement Set

```ts
type AchievementSet = {
  id: string; // globally unique dataset identifier, e.g. "stellar-drift-ps"
  platform: PlatformId;
  edition?: string; // optional edition identifier, e.g. "Game of the Year", "Remastered"
  platformGameId?: string; // optional read-only adapter correlation; never a v1 live-integration trigger
  version: string; // set-level content version
  achievements: AchievementRecord[];
};
```

## Achievement Record

```ts
type AchievementRecord = {
  id: string;
  name: string;
  description: string;
  evidence: string;
  reward: PlatformReward;
  tracking: TrackingConfiguration;
  labels: AchievementLabel[];
  expectedStage: "story" | "missables" | "cleanup";
  confidence: number; // inclusive pipeline confidence in [0, 1]
  prerequisites: string[]; // achievement IDs within the same set
  spoilerSafeHint?: string; // grounded replacement while exact hidden fields are not revealed
  warning?: string;
  estimatedEffort?: string;
  crossPlatformGroupId?: string; // equivalence metadata only; never a progress key
};
```

## Achievement Labels

```ts
type AchievementLabel =
  | "story"
  | "missable"
  | "grind"
  | "collectible"
  | "online"
  | "difficulty"
  | "point_of_no_return"
  | "post_game"
  | "skill"
  | "completion";
```

## Dataset Validation Invariants

- Game IDs and achievement-set IDs are nonempty and unique across the dataset. Achievement IDs are nonempty and unique within their set; checklist item IDs are nonempty, stable, and unique within their checklist.
- Two editions on the same platform remain separate sets. They require distinct set IDs and edition values that disambiguate them, and must never be merged by `platform`, `platformGameId`, or `crossPlatformGroupId`.
- PlayStation records use trophy rewards, Xbox records use gamerscore rewards, and Steam records use generic achievement rewards. Gamerscore points are positive integers.
- Counter `unit` is nonempty after trimming. `target`, when present, is a positive integer. `quickSteps`, when present, is a nonempty array of distinct positive integers; a one-element array is valid.
- Checklist tracking has a nonempty `items` array. Prerequisites refer only to existing achievement IDs in the same set.
- Stable achievement IDs must not be reused for unrelated achievements. An ID that reappears in the same set must identify the same logical achievement before quarantined progress can be considered for restoration.
- Confidence is inclusive `[0, 1]`.
- `spoilerSafeHint` is required whenever the UI hides that record's exact name, description, warning, or checklist detail by default, and the hint itself must be supported by trusted fields on that record.
- A `crossPlatformGroupId` links equivalent records for comparison only. Progress, completion, pins, active stage, orphan state, and reconciliation remain independent by achievement-set ID. Undo is game-scoped rather than an independent history per set: each game retains only its most recent set-mutation snapshot, which records one set ID.

## Versioned Progress Store

```ts
type ProgressProvenance = "manual" | "imported" | "platform";

type AchievementProgress = {
  achievementId: string;
  completed: boolean;
  manualOverride: boolean; // always false for binary; may override counter/checklist completion
  counterValue?: number; // active progress if tracking.mode === "counter"
  checklistCompletion?: { [itemId: string]: boolean }; // active completion if tracking.mode === "checklist"
  notes?: string;
  lastUpdated: string; // ISO-8601 UTC string
  provenance: ProgressProvenance; // V1 writes only "manual"; AI suggestions are UI-only metadata
};

type OrphanedAchievementProgress = AchievementProgress & {
  trackingModeAtRemoval: TrackingConfiguration["mode"];
};

type AchievementSetProgress = {
  setId: string;
  version: string; // AchievementSet.version at the last successful reconciliation
  activeStage?: "story" | "missables" | "cleanup";
  pinnedAchievementIds: string[];
  progress: { [achievementId: string]: AchievementProgress };
};

type GameProgress = {
  gameId: string;
  preferredSetId?: string;
  sets: { [setId: string]: AchievementSetProgress };
  orphanedProgress: { [setId: string]: { [achievementId: string]: OrphanedAchievementProgress } };
};

type ProgressUndoSnapshot = {
  setId: string;
  previous: AchievementSetProgress;
};

type LocalProgressStore = {
  schemaVersion: string; // store-level schema/database version (e.g. "2.0")
  lastGameId?: string;
  gameProgress: { [gameId: string]: GameProgress };
  undoState?: { [gameId: string]: ProgressUndoSnapshot }; // at most one set snapshot per game
};
```

## Manual Progress Rules

- **Set Identity**: Map keys must match their embedded `gameId`, `setId`, and `achievementId`. `preferredSetId`, every set-progress key, every pin, and every progress entry must reference the same game and set hierarchy.
- **Restoration**: `lastGameId` restores the most recent game, `preferredSetId` restores that game's selected achievement set, and `activeStage` restores that set's roadmap stage. Invalid or deleted references are cleared during reconciliation rather than redirected to another platform or edition.
- **Tracker Values**: `counterValue` is present only for counter tracking and is a nonnegative integer. `checklistCompletion` is present only for checklist tracking and contains only current checklist item IDs. Binary tracking has no tracker fields, stores direct user-controlled `completed`, and always uses `manualOverride: false`.
- **Derived Completion**: With `manualOverride: false`, a bounded counter is complete at `counterValue >= target`, a checklist is complete when every defined item is true, and an open counter has no automatic completion threshold. `completed` mirrors that derived result; binary `completed` remains the direct user-controlled state.
- **Completion Override**: The override mechanism applies only to counter tracking (bounded or open) and checklist tracking. Marking one of those achievements complete outside its derived rule sets `manualOverride` and `completed` to `true`. Clearing the override recomputes `completed` from that mode's tracker state. Binary achievements have no second completion mechanism and must never set `manualOverride` to `true`.
- **One-Step Undo**: Each game has at most one snapshot, representing the most recent set mutation within that game. Before any mutation to a set's progress, pins, notes, counters, checklists, completion override, or active stage, save the entire current `AchievementSetProgress` as `previous` with the same `setId`. Switching the selected or preferred set without mutating either set does not create or clear the snapshot. A later mutation in another set of the same game replaces the prior snapshot, so the earlier set mutation is no longer undoable. Before confirmation, the UI must identify the snapshot's `setId` and the set that will be restored. Undo restores exactly that one set, including its version, pins, stage, progress, provenance, notes, and timestamps, then clears the game's snapshot. The snapshot cannot recurse because `AchievementSetProgress` contains no undo state.
- **Timestamps**: Every achievement-progress mutation updates that record's `lastUpdated` with an ISO-8601 UTC string. Undo restores the previous timestamp instead of creating a synthetic progress edit.
- **Pins**: Each set may pin at most 5 distinct achievement IDs from that same set. Switching sets changes which set's pins are shown; it never clears or copies another set's pins.
- **Completion Isolation**: Completion fractions use only current, non-orphan achievement records in one set. They never combine equivalent records or progress from another platform or edition.

## Dataset Reconciliation Rules

```ts
type ChecklistItemDelta = {
  achievementId: string;
  itemIds: string[];
};

type AchievementSetReconciliationDelta = {
  setId: string;
  fromVersion?: string;
  toVersion?: string;
  addedAchievementIds: string[];
  quarantinedAchievementIds: string[];
  restoredOrphanedAchievementIds: string[];
  addedChecklistItems: ChecklistItemDelta[];
  removedChecklistItems: ChecklistItemDelta[];
  removedPinnedAchievementIds: string[];
};

type ReconciliationDeltaReport = {
  gameId: string;
  fromGameVersion: string;
  toGameVersion: string;
  setDeltas: AchievementSetReconciliationDelta[];
  clearedPreferredSetId?: string;
  clearedUndoSetId?: string;
  schemaConflicts: string[];
};
```

When updating a game's achievement sets:

1. **Match by identity**: Reconcile only matching game, set, achievement, and checklist-item IDs. Platform, edition, `platformGameId`, and `crossPlatformGroupId` never substitute for those keys.
2. **Preserve matching achievements**: Preserve `completed`, `manualOverride`, tracker state, notes, provenance, and `lastUpdated` for achievement IDs that remain in the same set.
3. **Re-admit compatible orphans**: When an achievement ID reappears in the same game and set, compare the new tracking mode with the orphan's required `trackingModeAtRemoval`, then restore its quarantined progress only if it is the same logical achievement and the modes are compatible. Binary is compatible only with binary, checklist only with checklist, and counter with counter; bounded/open counter changes remain counter-compatible. Apply the normal checklist item-ID rules and current bounded/open counter rules, force restored binary progress to `manualOverride: false`, and recompute completion against the current tracker definition unless a valid counter/checklist override is active. After successful restoration, remove the record from `orphanedProgress[setId]` and include its ID in `restoredOrphanedAchievementIds`. Never re-admit across game or set IDs, by `platform`, `platformGameId`, or `crossPlatformGroupId`.
4. **Reject incompatible orphan state**: If the reappearing achievement's tracking mode is incompatible or the orphan lacks trustworthy removal-time mode metadata, keep the old record quarantined, initialize the active achievement with default progress, and add a `schemaConflicts` entry. Never silently apply incompatible tracker or override state.
5. **Initialize additions**: For a new achievement with no compatible same-set orphan, initialize `completed: false`, `manualOverride: false`, default tracker state, `provenance: "manual"`, and the reconciliation time as `lastUpdated`. Initialize new checklist item IDs as `false` and include them in `addedChecklistItems`.
6. **Report checklist removals**: Delete progress for removed checklist item IDs and include those exact IDs, grouped by achievement ID, in `removedChecklistItems`.
7. **Quarantine removals**: Move progress for removed achievements, including every achievement in a removed set, to `orphanedProgress[setId]` and record the source definition's mode as `trackingModeAtRemoval`. Include exact IDs in `quarantinedAchievementIds`; orphans never count toward completion.
8. **Repair pins, selection, and undo**: Preserve valid set-local pins, remove pins for quarantined achievements, and report them in `removedPinnedAchievementIds`. If the preferred set is removed, clear it and report its ID as `clearedPreferredSetId`; do not choose a set from another platform automatically. If the game's undo snapshot targets any reconciled set, clear it and report that set ID as `clearedUndoSetId` so undo cannot restore stale content.
9. **Advance versions safely**: After successful reconciliation, update each surviving `AchievementSetProgress.version` to the matching set version. An unsupported `LocalProgressStore.schemaVersion` or other unsafe mismatch produces `schemaConflicts` and must not silently discard or rewrite progress.
10. **Return the delta**: Return one `ReconciliationDeltaReport` with every affected set, including empty arrays for unchanged set-delta categories so consumers do not infer missing work from absent keys.

## Q&A Evaluation Record

```ts
type EvalQuestion = {
  id: string;
  gameId: string;
  achievementSetId: string; // set-aware validation
  question: string;
  expectedEvidenceIds: string[]; // relevant achievement IDs within the specified set
  mustMention: string[];
  shouldRefuse?: boolean;
  revealSpoilers?: boolean; // defaults false; true records explicit reveal consent
  policyContext?: "v1_product_boundary";
  progressContext?: { [achievementId: string]: AchievementProgress };
};

type EvalQuestionDataset = {
  schemaVersion: string;
  notes: string;
  questions: EvalQuestion[];
};
```

## Grounding Rules

- Every guide card must cite at least one achievement ID.
- Every non-refusal Q&A answer must cite at least one achievement ID from the selected set.
- A refusal may cite relevant achievement evidence when available, but a citation is optional. For `shouldRefuse` evaluations, nonempty `expectedEvidenceIds` identify valid supporting evidence; omission alone does not fail an otherwise grounded refusal.
- If no achievement evidence supports the answer, the AI must refuse with a grounded limitation.
- Product-boundary questions may use only the fixed `v1_product_boundary` context and must not present policy as achievement evidence.
- `policyContext` is valid only for a deterministic product-boundary refusal with `shouldRefuse: true`; it does not authorize a generated product claim.
- Evaluation progress context is read-only, set-local, and keyed only by achievements in `achievementSetId`. Arithmetic derived from that state and the matching tracker definition is grounded; progress from any other set is unavailable.
- Exact fields protected by `spoilerSafeHint` remain out of retrieval and generation context unless the user or evaluation explicitly sets spoiler reveal.
- Confidence is a pipeline confidence, not a promise that the achievement data is globally complete.
- Fictional demo records must stay clearly marked as fictional demo data.
