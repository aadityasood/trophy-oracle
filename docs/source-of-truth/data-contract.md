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
- The exact string `__proto__` is reserved and must not be used as a game ID, achievement-set ID, achievement ID, or checklist item ID. These identifiers become persisted object-record keys. Every other nonblank string, including inherited Object prototype member names such as `constructor` and `toString`, remains a valid identifier.
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
- **Persisted Map Keys**: Map keys in `gameProgress`, `undoState`, `sets`, `orphanedProgress`, `progress`, and `checklistCompletion` may be any nonblank string except the exact reserved string `__proto__`. Schema 2.0 validation rejects a store containing a reserved map key with a typed issue at that map's path instead of silently dropping it. All other nonblank strings, including `constructor` and `toString`, remain valid keys, and relationship checks use own-property semantics.
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

This planned schema adds run ledgers and honest counter certainty to local persistence. Domain and storage modules exist, but the live application still loads and saves Schema 2.0. The Schema 3.0 cutover and guide state below are not wired into the application.

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

type GuideStateV3 = {
  savedAchievementIds: string[];
  currentRunNumber?: number; // positive integer confirmed by the player, not inferred from run name
  routeContext?: {
    packId: string;
    packVersion: string;
    areaId?: string;
    checkpointId?: string;
    revealByRouteCardId?: { [routeCardId: string]: "route" | "exact" };
  };
};

type RunLedgerSetV3 = {
  setId: string;
  activeRunId: string; // references an existing key in runs
  runs: { [runId: string]: RunProgress };
  guideStateByRunId?: { [runId: string]: GuideStateV3 }; // optional for stores written before guide state exists
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
  - The exact string `__proto__` is not a valid `runId`. The create-run operation returns `INVALID_RUN_ID` for it without mutation and without exposing a store. Every other nonblank string remains valid, and run relationship checks use own-property semantics.
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
  - Run creation requires the supplied set definition version to exactly match the stored active set version. Blank IDs or names, invalid timestamps, missing game or set targets, retired-set targets, set version mismatches, and duplicate run IDs return a typed failure without mutation. Duplicate display names are allowed.

```ts
type CreateRunFailureCode =
  | "INVALID_RUN_ID"
  | "INVALID_RUN_NAME"
  | "INVALID_TIMESTAMP"
  | "DUPLICATE_RUN_ID"
  | "GAME_NOT_FOUND"
  | "SET_NOT_FOUND"
  | "SET_RETIRED"
  | "SET_VERSION_MISMATCH";

type CreateRunResult =
  | { success: true; store: LocalProgressStoreV3; runId: string }
  | { success: false; code: CreateRunFailureCode; message: string };
```

- **Active and Retired Set Identity**:
  - Map keys in both `sets` and `retiredSets` match embedded `setId` values. The same set ID cannot exist in both maps.
  - Retired sets preserve their active-run selection and complete run ledger but are excluded from active selection, completion, roadmap, and recommendation calculations.
- **Persisted Map Keys**: Persisted map keys (`gameProgress`, `undoState`, `sets`, `retiredSets`, `runs`, `progress`, `orphanedProgress`, and `checklistCompletion`) may be any nonblank string except the exact reserved string `__proto__`. Schema 3.0 validation rejects a store containing a reserved map key with a typed issue at that map's path instead of silently dropping it. Map keys must match their embedded identifiers, and reference fields (`activeRunId`, `preferredSetId`, `lastGameId`) are resolved with own-property semantics.
- **Guide State**: `guideStateByRunId` is an optional field of the shared active/retired set ledger. Each own key matches a run in that ledger; `__proto__` is reserved, while `constructor` and `toString` remain valid run IDs. A missing map or missing run entry means no guide choices, not invalid progress. Saved achievement IDs are distinct and must reference the same set when added; IDs later removed from its definition remain saved and removable rather than being silently discarded. The optional current run number is a positive integer confirmed by the player, not inferred from the run's name. A route context with `checkpointId` also has `areaId`, and that checkpoint belongs to that area. Every revealed card belongs to the exact referenced pack version. A missing or mismatched pack, or a removed area, checkpoint, or card ID, makes route context uninterpretable until the player explicitly resets or reconciles it. It never invalidates core progress or removes saved achievement IDs.
- **Guide/Undo Boundary**: Save For Later is a findable, removable run-local choice, not a progress mutation with one-step undo. Saving, removing, selecting an area or checkpoint, confirming a run number, and revealing a route card never create, clear, or replace `undoState`. `RunProgress` and its undo snapshot contain no guide state. Retiring or restoring a set carries its guide map with the complete ledger, without applying it to active completion calculations. A newly created run need not add an empty guide entry.
- **Run-Aware One-Step Undo**:
  - Each game retains at most one undo snapshot in `undoState[gameId]`.
  - The snapshot stores `setId`, `runId`, the current set version as `guardedSetVersion`, and the complete previous `RunProgress` of exactly that run. `previous.runId` must equal `runId`.
  - Before any mutation to a run's progress, pins, notes, counters, checklists, completion override, or active stage, save that run's current `RunProgress` as `previous`.
  - Activating undo requires an active target set, an existing target run, and `currentSet.version === guardedSetVersion`. Failure returns a typed result without mutation. Success restores only that run's previous state and clears the game's snapshot.
  - Undo leaves the current game, set, and run selection unchanged.
  - A subsequent mutation in any run of the same game replaces that game's previous undo snapshot. Mutations in another game remain independent.
- **Excluded Run Operations**:
  - Run cloning, merging, carry-over rules, destructive run deletion, structural undo, and cross-run completion aggregation are excluded from this specification and reserved for future design work.

## Planned Bundled Completion Pack (V1 Pilot)

The first pack is authored and bundled with the application for one confirmed game release. It is not a user-import format and does not change saved achievement progress. The pack has its own schema version and content version; neither is the progress-store schema version or the achievement-set version.

```ts
type BundledCompletionPack = {
  schemaVersion: "1.0";
  packId: string;
  packVersion: string;
  gameId: string;
  achievementSetId: string;
  achievementSetVersion: string;
  platform: PlatformId;
  edition: string;
  region: string;
  supportedGameVersion: string;
  verifiedAt: string; // ISO-8601 UTC string
  sources: { id: string; reference: string; verifiedAt: string; verificationNote: string }[];
  areas: { id: string; name: string }[];
  checkpoints: { id: string; areaId: string; name: string }[];
  objectives: { id: string; achievementIds: string[]; sourceIds: string[] }[];
  routeCards: {
    id: string;
    areaId: string;
    checkpointId?: string;
    objectiveIds: string[];
    sourceIds: string[];
    hint: string;
    route: string;
    exact: string;
    earliestRunNumber?: number;
    requiredAchievementIds: string[];
    markerIds: string[];
  }[];
  schematics: {
    id: string;
    areaId: string;
    assetId: string; // bundled original diagram, not a copied commercial map
    textEquivalent: string;
    markers: { id: string; routeCardId: string; x: number; y: number; textEquivalent: string }[];
  }[];
};
```

- **Identity and evidence**: `packId` identifies one pack; `packVersion` changes when a route, ID, source judgment, or interpretation changes. The exact game, set ID and version, platform, edition, region, and supported game version must match the selected release. Confirm them before authoring Dark Souls II content. `schemaVersion` controls pack parsing only. Each source reference is inspectable and has a verification note and ISO-8601 UTC date; a source string alone is not proof that a route is correct. No model or imported file may add facts to the bundled pack at runtime.
- **References**: Nonblank area, checkpoint, objective, route-card, source, schematic, and marker IDs are stable and unique within their respective pack collections; marker IDs are unique across the pack. Every reference resolves inside that pack. Objectives cite distinct, nonempty achievement IDs from its exact set and at least one source. Every route card refers to at least one objective and has its own nonempty source IDs supporting its guidance and availability claim, so it exposes at least one achievement citation backed by route-specific evidence. A marker belongs to its schematic's area and a route card in that area; the card's marker IDs resolve back to those markers. Normalized marker coordinates are within `[0, 1]`, and each schematic and marker has a useful text equivalent. An original schematic asset must be bundled or the schematic and its markers are unavailable; an asset reference is not a remote fetch instruction.
- **Availability**: A route card can assert only evidenced conditions represented above: a positive earliest run number and distinct required completed achievements in the same run and set. Conflicting or insufficient source evidence, an unconfirmed current run number when one is required, a missing progress record, or any unsupported condition yields `unknown`, never an invented claim of availability. A confirmed later-run requirement takes precedence over unmet current-run requirements; unmet requirements are shown as current-run blockers; only satisfied, evidence-backed conditions are `available`. Run names are not parsed to infer run number. Other game-specific conditions require a later contract addition before they can drive a status.
- **Spoilers**: `hint`, `route`, and `exact` are nonblank authored text. `hint` must be verified as safe to show without revealing route or exact details. Route and Exact are deliberate per-card reveals; absence from `revealByRouteCardId` means Hint only. Hidden route text, exact interactions, and marker coordinates are not placed in the unrevealed UI or model context. Changing one card's reveal level never reveals another card.
- **Compatibility**: A missing pack or incompatible pack version disables interpretation of saved route context without clearing it or touching progress. Saved achievement IDs remain findable and removable. The pack does not infer location, read the running game, scrape guides, or mutate player progress.

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
  repairedDerivedCompletionIds: string[];
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
3. **Validate and preserve matching achievements**: Before applying removal, addition, mode-change, or same-mode logic to an active record, require a supplied previous achievement definition and validate its tracker shape. If admission fails, infer the represented tracking mode from stored fields, append a preserved orphan to history, remove the active record and any matching pin, report the ID in `quarantinedAchievementIds` and a rule-3 schema conflict, and initialize default progress if present in the next definition. For admitted active records with compatible tracking modes, preserve notes, provenance, `lastUpdated`, override, and tracker state. Recompute derived completion for counters and checklists; if `completed` changes, record the ID in `repairedDerivedCompletionIds`. Binary progress remains direct user completion with `manualOverride: false`.
4. **Initialize additions**: For each run, a newly added achievement with no compatible orphan starts with mode-correct default manual progress at the caller-supplied reconciliation timestamp. Counters start exact at zero, checklist items start false, binary has no tracker state, and `completed` and `manualOverride` start false. Record achievement and checklist additions in the complete delta arrays.
5. **Restore compatible orphans**: For a returning achievement, consider only orphan records under the same game, set, run, and achievement ID. Binary matches only binary, checklist only checklist, and counter matches counter. Restore the newest compatible record, remove only that record from its history, apply current checklist-item rules, and report the restoration. Older or incompatible records remain quarantined.
6. **Retain incompatible orphans**: Never coerce an incompatible tracker shape or progress value. Keep every incompatible record in its orphan history, initialize default active progress when no compatible record exists, and report a schema conflict with the set, run, achievement, old mode, and new mode.
7. **Reconcile checklists without invention**: Preserve current item IDs, initialize added item IDs as false, delete removed item IDs from active checklist state, and report exact added and removed item arrays. Quarantined checklist records retain their removal-time state.
8. **Quarantine removals without overwrite**: Append removed active progress to the achievement's orphan history with `trackingModeAtRemoval`; never replace an earlier record. Remove it from active progress and report it. Orphans remain outside completion calculations.
9. **Repair pins**: Preserve only distinct pins that still reference active compatible progress, up to five per run. Remove and report pins for removed achievements and incompatible tracking-mode replacements.
10. **Retire removed sets intact**: Move a removed active set's complete ledger from `sets[setId]` to `retiredSets[setId]` with `retirementReason: "removed_set"` and its stored version. Preserve `activeRunId`, every run, run IDs and names, `createdAt`, progress, orphan histories, pins, stage, notes, provenance, and progress timestamps. Clear a matching `preferredSetId` and matching undo snapshot. The retired ledger is excluded from active calculations, and its ID appears in `retiredSetIds`.
11. **Restore reappearing sets conservatively**: A `removed_set` ledger may return to `sets` only when its stored version exactly equals the reappearing definition's version and every active record in every run validates against that definition. Otherwise leave it in `retiredSets`, add its ID to `retainedRetiredSetIds`, and report the conflict. A `schema_2_absent_orphans` ledger has no active historical progress or stored version: create the active set at the returning version, preserve its `legacy-v2` run, initialize current achievements, and apply the normal compatible-orphan rules. A successful move removes the retired entry and reports the ID in `restoredRetiredSetIds`.
12. **Repair undo before mutation**: Clear and report an undo snapshot when its set is removed, its guarded version differs from the incoming set version, or reconciliation will mutate its target run (including derived completion repairs). A cleared report names both `setId` and `runId`. Reconciliation never restores an undo snapshot.
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
   - A source store containing the exact reserved string `__proto__` as an own key at any persisted map level fails validation with `INVALID_SOURCE_STORE`. Migration never silently drops a persisted key, and stored bytes remain untouched on source validation failure.
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
9. **Separate-Key Cutover**:
   - The live Schema 2.0 key remains `trophy-oracle.progress.v2`. The planned active Schema 3.0 key is `trophy-oracle.progress.v3`. One immutable `trophy-oracle.progress.v3-cutover` record contains either `{ recordVersion: 1, source: "migrated-v2", rawV2: string }` with the exact original V2 string or `{ recordVersion: 1, source: "fresh" }` for a new store. There is no separate backup or initialized-marker key. The unwired V3 inspector reads these three keys but does not perform cutover writes or save V3 progress.
   - Loading alone never writes. A V2-backed upgrade requires an explicit player action after explaining the need to close older tabs and offering export. Under an exclusive Web Lock, recheck key presence, validate V2, transform and validate V3, then re-read the exact V2 bytes before writing. A changed source aborts without writing. Write the cutover record before V3; never replace V2. A fresh store writes the `fresh` record immediately before its first saved V3 mutation. A failed record write prevents the V3 write.
   - The two writes are not an atomic transaction. A record without V3 can mean an interrupted first write or later V3 loss; require explicit recovery and never silently re-migrate or reset. A valid V3 without a valid record is view/export-only until explicit repair. An invalid V3 fails closed. A failed or uncertain write requires read-back where possible and must never expose an unverified candidate as saved. A full site-data clear can remove every key, so local storage alone cannot detect or recover that loss.
   - A successful migration report may contain only nonfatal `warnings`; fatal conflicts cannot accompany `success: true`. Order report arrays lexicographically by game ID, set ID, run ID, and achievement ID. For otherwise identical counter-assumption identities, use location order `active`, `orphan`, then `undo`. The storage adapter needs distinct typed conflict, access, write, capability, and recovery results; the pure V2-to-V3 transformation does not by itself prove persistence.
10. **Idempotent Storage State**:
   - After a verified cutover, V3 is authoritative and subsequent loads parse it directly. V2 is historical only; never merge later V2 writes automatically into V3. An already-loaded V2 tab does not request the new lock and can still alter V2 without overwriting V3. Compare current V2 to the cutover source on load or focus and warn on divergence: for `migrated-v2`, compare against the preserved `rawV2`; for `fresh`, the baseline V2 state is absent, so newly present V2 bytes yield an unexpected legacy drift warning with the exact raw V2 string. In both cases, valid V3 remains authoritative and untouched. A V2 read error yields an unavailable warning and retains valid V3 without fallback. Precedence is strict: invalid V3 and cutover-without-V3 recovery fail closed before any V2 inspection. Rolling back to the old app reads V2 only and cannot show post-cutover V3 edits.
   - New-app cutover and ordinary V3 saves use the same exclusive Web Lock named `trophy-oracle.progress.v3-write` and exact raw V3 token checks. Ordinary saves are callable only after a verified cutover; they never perform first-write cutover, migration, load-time saving, or V2 fallback. This coordinates participating tabs, not older V2 tabs or scripts that ignore the lock. If Web Locks are unavailable, allow view/export but no persistent V3 edit and no V2 write fallback; return a typed non-success with zero writes. If storage itself is inaccessible, a clearly labelled session-only mode may allow unsaved work only when it cannot overwrite persisted data.
   - Inside the lock, storage is re-inspected; only valid `loaded-v3` with the exact expected raw V3 token proceeds. Candidates are validated against Schema 3.0 and serialized before writing. Byte-identical candidates perform no hidden writes. The cutover record is verified intact throughout the save; never write or remove the record, and never write or remove V2. Write V3 at most once and verify actual stored bytes via read-back. A post-write throw is verified success if candidate bytes committed and the cutover record is intact. An unchanged exact old token after a failed or swallowed write is a definite retryable failure; ambiguous, missing, conflicting, or unreadable outcomes require recovery. Expose verified new raw tokens and stores only on success. Do not claim native atomic compare-and-swap against writers that ignore Web Locks.
   - Accept one mutation at a time in later publication work: mark pending synchronously before awaiting the lock, visibly disable further edits, and report a busy result if another action arrives. Derive the action from the last confirmed store and publish it only after verified persistence. No-op actions do not write or change undo. After a completed cutover, a definite write failure with unchanged stored token keeps one candidate for explicit Retry or Discard; a failed first cutover instead enters recovery. A conflict or unreadable state stops saving until reload or recovery. Warn on navigation away while unsaved; an unsaved action can still be lost in a browser crash.

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
