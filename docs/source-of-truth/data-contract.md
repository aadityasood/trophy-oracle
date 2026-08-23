# Trophy Oracle Data Contract

## Purpose

The data contract defines the source of truth for Trophy Oracle V1. The AI pipeline treats these files as trusted evidence and avoids claims outside them.

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

## Versioned Progress Store (Current Runtime: Schema 2.0)

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

## Manual Progress Rules (Current Runtime: Schema 2.0)

- **Set Identity**: Map keys must match their embedded `gameId`, `setId`, and `achievementId`. `preferredSetId`, every set-progress key, every pin, and every progress entry must reference the same game and set hierarchy.
- **Restoration**: `lastGameId` restores the most recent game, `preferredSetId` restores that game's selected achievement set, and `activeStage` restores that set's roadmap stage. Invalid or deleted references are cleared during reconciliation rather than redirected to another platform or edition.
- **Tracker Values**: `counterValue` is present only for counter tracking and is a nonnegative integer. `checklistCompletion` is present only for checklist tracking and contains only current checklist item IDs. Binary tracking has no tracker fields, stores direct user-controlled `completed`, and always uses `manualOverride: false`.
- **Derived Completion**: With `manualOverride: false`, a bounded counter is complete at `counterValue >= target`, a checklist is complete when every defined item is true, and an open counter has no automatic completion threshold. `completed` mirrors that derived result; binary `completed` remains the direct user-controlled state.
- **Completion Override**: The override mechanism applies only to counter tracking (bounded or open) and checklist tracking. Marking one of those achievements complete outside its derived rule sets `manualOverride` and `completed` to `true`. Clearing the override recomputes `completed` from that mode's tracker state. Binary achievements have no second completion mechanism and must never set `manualOverride` to `true`.
- **One-Step Undo**: Each game has at most one snapshot, representing the most recent set mutation within that game. Before any mutation to a set's progress, pins, notes, counters, checklists, completion override, or active stage, save the entire current `AchievementSetProgress` as `previous` with the same `setId`. Switching the selected or preferred set without mutating either set does not create or clear the snapshot. A later mutation in another set of the same game replaces the prior snapshot, so the earlier set mutation is no longer undoable. Before confirmation, the UI must identify the snapshot's `setId` and the set that will be restored. Undo restores exactly that one set, including its version, pins, stage, progress, provenance, notes, and timestamps, then clears the game's snapshot. The snapshot cannot recurse because `AchievementSetProgress` contains no undo state.
- **Timestamps**: Every achievement-progress mutation updates that record's `lastUpdated` with an ISO-8601 UTC string. Undo restores the previous timestamp instead of creating a synthetic progress edit.
- **Pins**: Each set may pin at most 5 distinct achievement IDs from that same set. Switching sets changes which set's pins are shown; it never clears or copies another set's pins.
- **Completion Isolation**: Completion fractions use only current, non-orphan achievement records in one set. They never combine equivalent records or progress from another platform or edition.

## Dataset Reconciliation Rules (Current Runtime: Schema 2.0)

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

## Planned Hunt Memory Progress Store (Schema 3.0)

This planned schema adds run ledgers and honest counter certainty to local persistence. It is a planned contract and not yet implemented in runtime code.

```ts
type CounterProgress =
  | { certainty: "exact"; value: number }
  | { certainty: "at_least"; minimum: number }
  | { certainty: "estimated"; estimate: number }
  | { certainty: "unknown"; observedSinceStart: number; trackingStartedAt: string };

type AchievementProgressV3 = {
  achievementId: string;
  completed: boolean;
  manualOverride: boolean; // always false for binary; may override counter/checklist completion
  counter?: CounterProgress; // active counter progress if tracking.mode === "counter"
  checklistCompletion?: { [itemId: string]: boolean }; // active completion if tracking.mode === "checklist"
  notes?: string;
  lastUpdated: string; // ISO-8601 UTC string
  provenance: ProgressProvenance;
};

type OrphanedAchievementProgressV3 = AchievementProgressV3 & {
  trackingModeAtRemoval: TrackingConfiguration["mode"];
};

type RunProgress = {
  runId: string; // unique within the achievement set, e.g. "legacy-v2", "default-run"
  name: string; // user-facing display label, e.g. "Existing Progress", "Main Run"
  createdAt: string; // ISO-8601 UTC string
  activeStage?: "story" | "missables" | "cleanup";
  pinnedAchievementIds: string[]; // at most 5 distinct achievement IDs in active progress
  progress: { [achievementId: string]: AchievementProgressV3 };
  // Each value is a nonempty oldest-to-newest history. Multiple records prevent
  // an incompatible earlier orphan from being overwritten by a later removal.
  orphanedProgress: { [achievementId: string]: OrphanedAchievementProgressV3[] };
};

type RunLedgerSetV3 = {
  setId: string;
  activeRunId: string; // references an existing key in runs
  runs: { [runId: string]: RunProgress };
};

type AchievementSetProgressV3 = RunLedgerSetV3 & {
  version: string; // AchievementSet.version at the last successful reconciliation
};

type RetiredAchievementSetProgressV3 =
  | (RunLedgerSetV3 & {
      retirementReason: "removed_set";
      version: string; // preserved version from the formerly active set
    })
  | (RunLedgerSetV3 & {
      retirementReason: "schema_2_absent_orphans";
      version?: never; // Schema 2.0 had no set version for an already-absent set
    });

type GameProgressV3 = {
  gameId: string;
  preferredSetId?: string;
  sets: { [setId: string]: AchievementSetProgressV3 };
  retiredSets: { [setId: string]: RetiredAchievementSetProgressV3 };
};

type ProgressUndoSnapshotV3 = {
  setId: string;
  runId: string;
  guardedSetVersion: string;
  previous: RunProgress;
};

type LocalProgressStoreV3 = {
  schemaVersion: "3.0";
  lastGameId?: string;
  gameProgress: { [gameId: string]: GameProgressV3 };
  undoState?: { [gameId: string]: ProgressUndoSnapshotV3 }; // at most one run snapshot per game
};
```

## Planned Hunt Memory Run Rules (Schema 3.0)

- **Run Identity and Display Label**:
  - `runId` is a nonblank, immutable identifier unique within its parent achievement set. Map keys in `AchievementSetProgressV3.runs` must match their embedded `runId`.
  - `name` is a nonblank user-facing label (such as "Main Run", "Cleanup Run", or "New Game Plus"). Duplicate display names within the same set or across sets are allowed.
  - Every initialized set contains at least one run and one valid `activeRunId` pointing to an existing run in that same set.
  - Fresh achievement sets initialized under Schema 3.0 use default run ID `default-run` and display name `Main Run`.
  - Achievement sets migrated from Schema 2.0 use run ID `legacy-v2` and display name `Existing Progress`.
  - Every progress and orphan map key matches the embedded `achievementId`. Each orphan history is nonempty, ordered oldest to newest, and contains only records for its map key.
- **Run-Local State and Isolation**:
  - `activeStage`, pins (up to 5 distinct IDs), active achievement progress, tracker state, notes, provenance, timestamps, and orphaned progress are run-local.
  - `preferredSetId` remains game-level set selection. `lastGameId` remains store-level game selection.
  - Switching `activeRunId` changes which run is active in that set. Run switching is selection-only and does not create or clear undo.
  - Progress never transfers automatically across runs, sets, editions, platforms, or `crossPlatformGroupId` links.
- **User-Created Runs**:
  - The create-run operation accepts a game ID, active set ID, caller-supplied `runId`, caller-supplied display name, and caller-supplied ISO-8601 UTC timestamp. A value is nonblank only when it contains a non-whitespace character. Valid values are stored exactly as supplied.
  - A valid new run initializes every current achievement with `completed: false`, `manualOverride: false`, `provenance: "manual"`, the supplied timestamp as `lastUpdated`, no notes, and mode-correct tracker state. Counters start at `{ certainty: "exact", value: 0 }`; checklists start with every current item `false`; binary records have no tracker state.
  - Pins, active stage, and orphan history start empty. No progress, completion, notes, certainty, provenance, or timestamps carry over from another run.
  - The new run uses the supplied timestamp as `createdAt` and becomes the set's active run. Run creation neither creates nor clears progress undo.
  - Duplicate run IDs, blank IDs or names, invalid timestamps, missing game or set targets, and retired-set targets return a typed failure without mutation. Duplicate display names are allowed.

```ts
type CreateRunFailureCode =
  | "INVALID_RUN_ID"
  | "INVALID_RUN_NAME"
  | "INVALID_TIMESTAMP"
  | "DUPLICATE_RUN_ID"
  | "GAME_NOT_FOUND"
  | "SET_NOT_FOUND"
  | "SET_RETIRED";

type CreateRunResult =
  | { success: true; store: LocalProgressStoreV3; runId: string }
  | { success: false; code: CreateRunFailureCode; message: string };
```

- **Active and Retired Set Identity**:
  - Map keys in both `sets` and `retiredSets` match embedded `setId` values. The same set ID cannot exist in both maps.
  - Retired sets preserve their active-run selection and complete run ledger but are excluded from active selection, completion, roadmap, and recommendation calculations.
- **Run-Aware One-Step Undo**:
  - Each game retains at most one undo snapshot in `undoState[gameId]`.
  - The snapshot stores `setId`, `runId`, the current set version as `guardedSetVersion`, and the complete previous `RunProgress` of exactly that run. `previous.runId` must equal `runId`.
  - Before any mutation to a run's progress, pins, notes, counters, checklists, completion override, or active stage, save that run's current `RunProgress` as `previous`.
  - Activating undo requires an active target set, an existing target run, and `currentSet.version === guardedSetVersion`. Failure returns a typed result without mutation. Success restores only that run's previous state and clears the game's snapshot.
  - Undo leaves the current game, set, and run selection unchanged.
  - A subsequent mutation in any run of the same game replaces that game's previous undo snapshot. Mutations in another game remain independent.
- **Excluded Run Operations**:
  - Run cloning, merging, carry-over rules, destructive run deletion, structural undo, and cross-run completion aggregation are excluded from this specification and reserved for future design work.

## Planned Counter Certainty Rules (Schema 3.0)

- **Certainty Variants**:
  - Counter tracking uses a discriminated union on `certainty` with four variants:
    1. `exact`: `{ certainty: "exact", value: number }` with a nonnegative integer `value`.
    2. `at_least`: `{ certainty: "at_least", minimum: number }` with a nonnegative integer `minimum`.
    3. `estimated`: `{ certainty: "estimated", estimate: number }` with a nonnegative integer `estimate`.
    4. `unknown`: `{ certainty: "unknown", observedSinceStart: number, trackingStartedAt: string }` with a nonnegative integer `observedSinceStart` and an ISO-8601 UTC timestamp `trackingStartedAt`.
  - The union prohibits impossible certainty and value combinations. Optional numeric fields are not permitted.
- **Tracking Mode Applicability**:
  - Counter certainty is valid only for counter tracking (`tracking.mode === "counter"`). Binary and checklist tracking cannot contain counter-certainty state.
- **Derived Completion for Bounded Counters (with `manualOverride: false`)**:
  - `exact`: Completes automatically when `value >= target`.
  - `at_least`: Completes automatically when `minimum >= target` because the true count is guaranteed to meet or exceed the target.
  - `estimated`: Never completes automatically, even if `estimate >= target`.
  - `unknown`: Never completes automatically, even if `observedSinceStart >= target`.
- **Open Counters and Completion Overrides**:
  - Open counters (without a `target`) never auto-complete under any certainty variant.
  - Explicit completion override (`manualOverride: true`, `completed: true`) is available for counters and checklists.
  - Binary achievements cannot use completion overrides.
- **Display and Precision Rules**:
  - Stored observations remain nonnegative integers and are not clamped to a bounded target. Values above a target remain intact.
  - `exact`: May display exact remaining count (`max(0, target - value)`) and exact percentage (`min(100, floor((value / target) * 100))%`).
  - `at_least`: May display a clearly labelled lower bound (such as "At least 15 / 20"), `max(0, target - minimum)` as an at-most remaining value, and `min(100, floor((minimum / target) * 100))%` as a labelled lower-bound percentage. It never presents either bound as an exact claim.
  - `estimated`: May display an explicitly approximate count, `max(0, target - estimate)` as approximate remaining, and `min(100, floor((estimate / target) * 100))%` as an approximate percentage. It never presents those values as exact.
  - `unknown`: Displays only direct observations since tracking began (such as "+5 tracked since <timestamp>"), and never a full-progress percentage or remaining count.
  - Open counters show their stored observation with the certainty label but no percentage or remaining value.
- **Roadmap and Stage Completion Arithmetic**:
  - Roadmap completion remains achievement-based: completed non-orphan achievements divided by total active non-orphan achievements in the active run.
  - Incomplete achievements with uncertain counters (`at_least < target`, `estimated`, `unknown`) count as 0 toward roadmap completion until completed.
  - Uncertain unfinished counters never contribute invented fractional progress to stage or set completion totals.
- **Deterministic Mutations and Model Boundary**:
  - Updating a counter value or certainty is one explicit deterministic user action with an ISO-8601 UTC timestamp and one-step undo.
  - The AI or Oracle model may explain certainty states, but it cannot select or mutate them.

## Planned Dataset Reconciliation Rules (Schema 3.0)

```ts
type RunReconciliationDelta = {
  runId: string;
  addedAchievementIds: string[];
  quarantinedAchievementIds: string[];
  restoredOrphanedAchievementIds: string[];
  addedChecklistItems: ChecklistItemDelta[];
  removedChecklistItems: ChecklistItemDelta[];
  removedPinnedAchievementIds: string[];
};

type AchievementSetReconciliationDeltaV3 = {
  setId: string;
  fromVersion?: string;
  toVersion?: string;
  runDeltas: RunReconciliationDelta[];
};

type ReconciliationDeltaReportV3 = {
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
```

When updating a game's achievement sets under Schema 3.0:

1. **Identity and version gate**: Reconcile only exact game, set, achievement, and checklist-item IDs. For a surviving active set, require its stored `version` to match the supplied previous set definition before mutating any run. On mismatch, leave the complete set and every run unchanged and report a schema conflict. Platform, edition, `platformGameId`, and `crossPlatformGroupId` never substitute for stable IDs.
2. **Independent run reconciliation**: After the set-level gate passes, process every run independently and return a `RunReconciliationDelta` for every run. Empty arrays are required when a category has no changes.
3. **Preserve matching achievements**: Preserve completion, manual override, tracker state, notes, provenance, and `lastUpdated` for an achievement ID that remains with a compatible tracking mode. Recompute derived completion against the current definition unless a valid counter or checklist override is active. Binary progress always has `manualOverride: false`.
4. **Initialize additions**: For each run, a newly added achievement with no compatible orphan starts with mode-correct default manual progress at the caller-supplied reconciliation timestamp. Counters start exact at zero, checklist items start false, binary has no tracker state, and `completed` and `manualOverride` start false. Record achievement and checklist additions in the complete delta arrays.
5. **Restore compatible orphans**: For a returning achievement, consider only orphan records under the same game, set, run, and achievement ID. Binary matches only binary, checklist only checklist, and counter matches counter. Restore the newest compatible record, remove only that record from its history, apply current checklist-item rules, and report the restoration. Older or incompatible records remain quarantined.
6. **Retain incompatible orphans**: Never coerce an incompatible tracker shape or progress value. Keep every incompatible record in its orphan history, initialize default active progress when no compatible record exists, and report a schema conflict with the set, run, achievement, old mode, and new mode.
7. **Reconcile checklists without invention**: Preserve current item IDs, initialize added item IDs as false, delete removed item IDs from active checklist state, and report exact added and removed item arrays. Quarantined checklist records retain their removal-time state.
8. **Quarantine removals without overwrite**: Append removed active progress to the achievement's orphan history with `trackingModeAtRemoval`; never replace an earlier record. Remove it from active progress and report it. Orphans remain outside completion calculations.
9. **Repair pins**: Preserve only distinct pins that still reference active compatible progress, up to five per run. Remove and report pins for removed achievements and incompatible tracking-mode replacements.
10. **Retire removed sets intact**: Move a removed active set's complete ledger from `sets[setId]` to `retiredSets[setId]` with `retirementReason: "removed_set"` and its stored version. Preserve `activeRunId`, every run, run IDs and names, `createdAt`, progress, orphan histories, pins, stage, notes, provenance, and progress timestamps. Clear a matching `preferredSetId` and matching undo snapshot. The retired ledger is excluded from active calculations, and its ID appears in `retiredSetIds`.
11. **Restore reappearing sets conservatively**: A `removed_set` ledger may return to `sets` only when its stored version exactly equals the reappearing definition's version and every active record in every run validates against that definition. Otherwise leave it in `retiredSets`, add its ID to `retainedRetiredSetIds`, and report the conflict. A `schema_2_absent_orphans` ledger has no active historical progress or stored version: create the active set at the returning version, preserve its `legacy-v2` run, initialize current achievements, and apply the normal compatible-orphan rules. A successful move removes the retired entry and reports the ID in `restoredRetiredSetIds`.
12. **Repair undo before mutation**: Clear and report an undo snapshot when its set is removed, its guarded version differs from the incoming set version, or reconciliation will mutate its target run. A cleared report names both `setId` and `runId`. Reconciliation never restores an undo snapshot.
13. **Advance versions and report completely**: Advance a surviving active set to the new set version only after every run reconciles successfully. Return every set delta plus complete retired, restored, retained, preferred-selection, undo, and schema-conflict fields needed for deterministic tests. Order set, run, achievement, checklist-item, and retired-set arrays lexicographically by their stable IDs; order conflicts by the operation sequence above and then by those same IDs.

## Planned Schema 2.0 to 3.0 Migration Contract

```ts
type MigratedCounterAssumption = {
  gameId: string;
  setId: string;
  achievementId: string;
  location: "active" | "orphan" | "undo";
  assumedCertainty: "exact";
  value: number;
};

type MigratedSetTarget = {
  gameId: string;
  setId: string;
  destination: "active" | "retired";
};

type MigratedRunTarget = MigratedSetTarget & {
  runId: "legacy-v2";
};

type ProgressMigrationReport = {
  sourceSchemaVersion: "2.0";
  targetSchemaVersion: "3.0";
  migratedAt: string; // ISO-8601 UTC string
  migratedGameIds: string[];
  migratedSets: MigratedSetTarget[];
  createdRuns: MigratedRunTarget[];
  counterAssumptions: MigratedCounterAssumption[];
  preservedUndoTargets: {
    gameId: string;
    setId: string;
    runId: "legacy-v2";
    guardedSetVersion: string;
  }[];
  warnings: string[];
};

type ProgressMigrationResult =
  | {
      success: true;
      store: LocalProgressStoreV3;
      report: ProgressMigrationReport;
    }
  | {
      success: false;
      code:
        | "INVALID_SOURCE_STORE"
        | "TRANSFORMATION_ERROR"
        | "INVALID_TARGET_STORE"
        | "STORAGE_WRITE_ERROR";
      message: string;
      conflicts: string[];
    };
```

### Migration Rules

1. **Strict Source Gate**:
   - Migration accepts only valid `schemaVersion: "2.0"` stores.
   - Malformed JSON, unsupported schema versions (including "1.0" or future versions), or structural validation failures return `INVALID_SOURCE_STORE`.
   - Stored bytes remain untouched on source validation failure.
2. **Pre-Transformation Validation**:
   - Parse and validate input with the Schema 2.0 schema before starting transformation.
   - The Schema 3.0 schema must never be loosened to accept 2.0 shapes directly.
   - The migration operation requires a caller-supplied ISO-8601 UTC timestamp. Reject an invalid timestamp without reading a hidden clock or mutating storage.
3. **Store, Game, and Set Preservation**:
   - Preserve `lastGameId`, every game map key and embedded `gameId`, and each valid `preferredSetId` unchanged.
   - Initialize every `GameProgressV3` with separate `sets` and `retiredSets` maps. Start `retiredSets` empty, then populate it only from absent-set orphan maps under rule 6.
   - Preserve each active set map key, embedded `setId`, and stored `version` before adding its deterministic run ledger.
4. **Deterministic Run Creation**:
   - For every existing achievement set in `GameProgress.sets`, create exactly one run with:
     - `runId: "legacy-v2"`
     - `name: "Existing Progress"`
     - `createdAt`: set to the migration ISO-8601 UTC timestamp.
     - `activeStage`: preserved from `AchievementSetProgress.activeStage`.
     - `pinnedAchievementIds`: preserved from `AchievementSetProgress.pinnedAchievementIds`.
     - `progress`: transformed from `AchievementSetProgress.progress`.
     - `orphanedProgress`: each record from `GameProgress.orphanedProgress[setId]` transformed into a one-element history.
   - Set `AchievementSetProgressV3.activeRunId = "legacy-v2"`.
5. **Counter Certainty Assumption**:
   - Convert every valid 2.0 `counterValue` to `CounterProgress { certainty: "exact", value: counterValue }`, including values in active progress, game-level orphan progress, and undo snapshot progress.
   - This assumption preserves the exact numeric value and auto-completion semantics of Schema 2.0.
   - Add one `counterAssumptions` entry per conversion with game ID, set ID, achievement ID, location, and value. Do not collapse duplicate achievement IDs across locations.
6. **Orphan Progress Migration**:
   - If `GameProgress.orphanedProgress[setId]` belongs to an active set, move each record to that set's `legacy-v2` run as a one-element orphan history. Preserve `trackingModeAtRemoval` and every progress field.
   - For every orphan map whose set ID is absent from `GameProgress.sets`, create one `retiredSets[setId]` entry with `retirementReason: "schema_2_absent_orphans"`, no invented version, and one `legacy-v2` run. That run has the migration timestamp as `createdAt`, empty active progress, pins, and stage, and the complete converted orphan map. Even an explicitly stored empty orphan map preserves its set identity in this retired destination.
   - Report active and retired destinations separately. Never attach an absent set's orphan map to another set.
7. **Undo Snapshot Migration**:
   - For each game in `undoState`, convert `ProgressUndoSnapshot` to `ProgressUndoSnapshotV3` targeting `runId: "legacy-v2"`.
   - Require the target active set to exist and require its current stored version to equal `snapshot.previous.version`. Otherwise fail the complete migration with `TRANSFORMATION_ERROR`.
   - Set `guardedSetVersion` from `snapshot.previous.version`. Construct `previous` with `runId: "legacy-v2"`, `name: "Existing Progress"`, the migration timestamp as `createdAt`, and the snapshot's preserved active stage, pins, and fully converted progress.
   - Schema 2.0 snapshots did not capture game-level orphans. Progress mutations also did not mutate orphans, and reconciliation cleared affected undo before changing them. Therefore construct `previous.orphanedProgress` as a deep converted copy of the target set's current `GameProgress.orphanedProgress[setId]`. This preserves current quarantined data without claiming it was stored inside the historical snapshot.
   - Convert and report counters in undo progress with `location: "undo"`. If any required field or record cannot be transformed safely, fail the complete migration rather than clearing or weakening undo.
8. **Post-Transformation Validation**:
   - Validate the entire transformed object against the Schema 3.0 schema before writing to storage.
9. **All-or-Nothing Atomic Storage Write**:
   - The original raw storage bytes remain untouched until the transformed store validates and one replacement write succeeds.
   - Parse, timestamp, transformation, target validation, or write failure returns a typed failure with fatal conflicts and without mutating saved data. A successful report may contain only nonfatal `warnings`; fatal conflicts cannot accompany `success: true`.
   - Order migration report arrays lexicographically by game ID, set ID, run ID, and achievement ID. For otherwise identical counter-assumption identities, use location order `active`, `orphan`, then `undo`.
   - The storage-key rollout is an implementation decision. Whichever supported key strategy is selected must preserve this one-write replacement boundary and the original bytes on failure.
10. **Idempotent Storage State**:
   - A successful migration writes `schemaVersion: "3.0"`.
   - Subsequent store loads parse Schema 3.0 directly and do not run migration again.

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
