# Trophy Oracle Product Brief

## Product Positioning

Trophy Oracle is a local-first, spoiler-aware completion cockpit. It remembers the active hunt and helps a player safely finish a game.

Platform profiles and public trackers record lifetime trophy and achievement unlocks. They do not preserve active playthrough context, separate multiple runs, or track incomplete counters that the game hides. Trophy Oracle fills that gap with private completion state. Planned Hunt Memory and grounded Oracle work will add run context, uncertain progress, session planning, and evidence-bound guidance.

Trophy Oracle is not a social network, leaderboard, profile showcase, or generic game backlog tracker. It complements official platforms and community guides by owning active completion state.

## Current Foundation And Target Direction

The working application is a deterministic React foundation built around bundled fictional demo data. It supports game search, platform and edition set selection, manual progress tracking, a three-stage roadmap, set-local pins, notes, one game-scoped undo snapshot, spoiler controls, and deterministic Oracle Focus recommendations.

The target architecture adds Hunt Memory and a grounded local Oracle. Retrieval, inference-backed questions and answers, generated explanations, citation validation, confidence reporting, evaluation views, and the AI Lab are planned. They are not part of the current application.

## V1 Proving Experience

V1 must prove that Trophy Oracle can guide a real completion run, not only demonstrate its architecture with fictional data. The release target is one validated PlayStation Completion Pack for Dark Souls II: Scholar of the First Sin, with the exact release, region, and supported game version confirmed before authoring.

The owner must be able to use one active run to plan the platinum, select the current area and nearest bonfire, see unfinished achievement work, reveal progressively more precise directions, understand blocked or later-run requirements, and view validated markers on original schematic area maps. The pack covers every platinum-relevant objective for the selected edition, not every item in the game.

This experience remains planned until implemented and validated during a real playthrough. It does not read the running game, scrape guides, copy commercial maps, infer the player's position, or let a model invent route facts or change progress.

## Player Flow

Today, a player can:

1. Search the bundled fictional demo games.
2. Select a platform and edition-specific achievement set.
3. Move between Story, Missables, and Grind/Cleanup roadmap stages.
4. Track binary achievements, counters, checklists, notes, and completion overrides.
5. Pin up to five achievements in the selected set.
6. Review deterministic Oracle Focus recommendations and reveal protected details when ready.
7. Restore the latest game, preferred set, active stage, and set-local progress from browser storage when valid saved data exists.

The planned Hunt Memory and Oracle flow will add named runs, honest certainty, parked-session summaries, point-of-no-return checks, approximate session planning, grounded questions and answers, and visible recommendation receipts.

## Signature Feature Family: Hunt Memory

Hunt Memory is the planned state layer for active completion runs. It captures the ephemeral details that platform APIs and generic trackers ignore.

Hunt Memory includes four core capabilities (planned for future phases):

1. **Run Ledger**
   - Stores named playthrough contexts (such as Blind Run, Cleanup Run, or New Game Plus).
   - Uses an immutable run ID unique within each achievement set and a user-facing display name.
   - Starts each user-created run with fresh default progress and no carried notes, pins, certainty, or completion state.
   - Keeps active stage, pins, achievement progress, tracker state, notes, timestamps, and orphaned progress strictly run-local.
   - Preserves a removed set's complete run ledger in game-level retired storage outside active completion calculations.
   - Retains one version-guarded, run-aware undo snapshot per game that restores only the previous state of its target run without modifying current selection.
   - Defines an explicit, lossless migration from Schema 2.0 stores into a deterministic legacy run.
   - Never assumes that counters, collectibles, or story progress carry over between runs unless the game evidence explicitly confirms it.

2. **Honest Counters**
   - Supports four explicit progress certainty states: exact, at-least (minimum), estimated, or unknown (tracking starting now).
   - Prevents false precision. Bounded counters with exact or at-least certainty auto-complete when the recorded count reaches the target. Estimated and unknown counters never auto-complete.
   - The interface preserves observations above a target, clamps derived remaining values to zero, caps displayed percentages at 100, and never presents uncertain bounds or estimates as exact.
   - Roadmap and stage completion remain achievement-based, so uncertain counters do not contribute invented fractional percentages.
   - Separates direct player observations from imported or platform-reported totals.

3. **Resume Capsule**
   - Provides a local "Park Run" action when a player steps away from a game.
   - Records current location or chapter, last confirmed progress, intended next step, and active missable warnings.
   - Displays a compact summary on return: Last Time, Next Action, and Active Risks.

4. **Safety Gate**
   - Warns the player before known points of no return.
   - Lists unfinished missable achievements, uncertain counters relevant to the cutoff, and recommended save slots.
   - Acts strictly as an advisory check. It never blocks the player and never mutates progress state automatically.

## Supporting Backlog Features

Detailed feature definitions live in [feature-backlog.md](./feature-backlog.md). These entries are planned product direction, not current application behavior.

- **Tonight Mode:** The player chooses a 20, 45, or 90 minute budget and a Chill, Grind, or Challenge preference. Plans are approximate and constraint-aware. A future data contract must define structured, evidence-backed effort ranges, buckets, or another deterministic representation before scheduling is implemented. The product must not invent exact fit from the current free-text `estimatedEffort` field.
- **Completion Target:** An explicit goal setting per game (such as PlayStation Platinum, base-game 100%, or all-content/DLC completion). This adjusts roadmap filtering without redefining platform rewards or altering recorded progress.
- **Oracle Receipt:** A transparent explanation panel for every recommendation. It details why an item was suggested, cites relevant achievement IDs and evidence, lists active constraints, and notes data uncertainty.
- **Knowledge Transfer:** Cross-platform equivalence mapping allows games on different platforms to share trusted guide knowledge. Progress, pins, runs, and undo history remain strictly isolated by achievement-set ID.
- **AI Lab:** A planned portfolio view for future retrieval results, citations, confidence, refusals, and evaluation behavior. It is separate from the current Oracle Focus list and tracker evidence display.
- **Completion Packs:** V1 includes one bundled, validated Dark Souls II pilot pack containing achievement data, evidence, routes, and schematic-map markers. User-imported packs remain deferred and will require versioning, provenance, validation, integrity checks, and safe handling as untrusted input. A later ingestion and security contract will choose the signing, trust, and verification mechanism.

## Grounded Oracle Direction

The planned Oracle will answer player questions using trusted achievement evidence and explicit Hunt Memory context. It is not implemented today.

Key architecture principles:

- **Evidence Grounding:** The Oracle reads only retrieved achievement records from the selected set, active run state, progress certainty, and explicit spoiler permissions.
- **Read-Only Oracle Boundary:** The Oracle cannot modify progress, certainty values, run ledgers, notes, pins, or Safety Gate states. It can suggest an update, but applying changes requires explicit user confirmation through the deterministic interface.
- **Strict Citation and Refusal:** Every factual non-refusal claim must cite achievement IDs from the selected set. If evidence is insufficient, the Oracle returns a grounded refusal rather than guessing.
- **No-Inference Core:** Existing progress arithmetic, roadmap and stage projections, Oracle Focus ranking, trusted evidence display or direct lookup, and explicit refusals remain available without local inference. Semantic retrieval, generated explanations, inference-backed questions and answers, and citation validation remain planned.

## Development Sequence

1. Define the public product direction and backlog.
2. Define a versioned Hunt Memory data contract and migration policy.
3. Build the deterministic Hunt Memory engine and persistence behavior with tests.
4. Define the bundled Completion Pack location, route, edition, evidence, and spoiler contract.
5. Author the validated Dark Souls II pilot pack and build Area Sweep, progressive route guidance, and schematic maps.
6. Apply the game-reactive visual identity, responsive density, purposeful motion, reduced-motion behavior, and readable time presentation.
7. Validate the full supported platinum route during a real Dark Souls II run and release V1.
8. After V1, add Resume Capsule, Safety Gate, and session-planning interactions.
9. Add grounded retrieval, evaluation, deterministic fallback behavior, and a local inference adapter.
10. Consider user-imported Completion Packs and read-only platform ingestion.

The visual overhaul follows the signature feature contracts so the interface is built around concrete user workflows.

## Current V1 Implementation Boundary

The current codebase is a working local foundation using bundled demo data.

### Currently Implemented (Working Today)

- Three fictional demo games with PlayStation, Xbox, and Steam achievement sets.
- Independent progress tracking, completion math, pins, active stage, and orphan quarantine for each platform and edition set.
- Versioned browser-local progress with one game-scoped undo snapshot for the latest set mutation.
- Tracking modes for binary checkboxes, bounded/open counters, and multi-item checklists.
- Focus Board supporting up to 5 pinned achievements per set with quick controls.
- Three-stage roadmap (Story, Missables, Grind/Cleanup) with persisted active stage and dynamic platform labels ("Platinum Roadmap" or "100% Roadmap").
- Deterministic, spoiler-safe Oracle Focus recommendations prioritizing warnings, active stage match, partial progress, and canonical ordering.
- Spoiler protections that mask hidden details until the player chooses to reveal them.
- Game-specific accent theme colors.
- Read-only protection for unsupported saved-data versions and session-only behavior when browser storage is unavailable.

### Required Before V1 Is Complete

- Hunt Memory runtime features required by the pilot: Run Ledger and Honest Counters (the Schema 3.0 data contract is defined; runtime implementation remains planned).
- One bundled, validated Dark Souls II: Scholar of the First Sin PlayStation Completion Pack for a confirmed edition and game version.
- Manual area and bonfire selection, Area Sweep, Hint/Route/Exact guidance, and evidence-backed availability reasons.
- Original schematic area maps with validated markers for achievement-relevant pilot objectives.
- Responsive game-reactive styling, accessible motion, reduced-motion behavior, and readable time presentation.
- A real-playthrough validation showing that the owner can plan and finish the supported platinum route.

### Planned After V1

- Resume Capsule and Safety Gate as separate Hunt Memory workflows. V1 still presents authored missable and point-of-no-return warnings through the roadmap, Area Sweep, and route cards.
- Tonight Mode session planning.
- Selectable Completion Targets (Platinum, 100%, All DLC).
- Oracle Receipts with explicit constraint records.
- Grounded retrieval, inference-backed questions and answers, citation validation, and AI Lab evaluation views.
- A local inference adapter.
- User-imported Completion Packs, custom datasets, permitted map layers, and platform imports.

### Explicit Non-Goals

- No leaderboards, public profiles, rarity scoring, or social feeds.
- No live network login or background synchronization with PSN, Xbox Live, Steam, or RetroAchievements.
- No automated web scraping of third-party guide websites.
- No cloud accounts, remote servers, or external telemetry.
- No paid third-party AI APIs.
- No automatic progress guessing without user confirmation.
- No generated achievement facts, missable warnings, or save advice outside trusted dataset records.

## Unresolved Implementation Questions

The run ledger storage schema, certainty arithmetic rules, and Schema 2.0 to 3.0 migration policy are specified in the data contract. These remaining technical questions are reserved for future data contract and engineering tasks:

1. **Completion Target Partitioning / DLC Grouping:** How base-game achievements and DLC packs are separated, indexed, and evaluated without violating platform-specific reward definitions.
2. **Tonight Mode Effort:** Which structured effort ranges, buckets, provenance rules, and estimation behavior can support approximate planning without false precision.
3. **Bundled Completion Pack Contract:** The exact schema for release region, edition, game version, source provenance, last verification, areas, checkpoints, route cards, availability conditions, spoiler levels, and schematic markers.
4. **Guide State Ownership:** How run-local area, checkpoint, reveal level, and Save For Later state persist without allowing navigation changes to evict the one-step progress undo snapshot.
5. **Schema 3.0 Cutover Recovery:** Which backup, rollback, and stale-tab behavior protects existing local progress before the same-key migration is activated.
6. **Schematic Map Representation:** The smallest accessible data and rendering format that supports original per-area diagrams, stable marker IDs, text equivalents, and measured bundle limits.
7. **Completion Pack Trust:** Which validation, provenance, integrity, trust, and verification mechanisms safely handle future untrusted local files.
