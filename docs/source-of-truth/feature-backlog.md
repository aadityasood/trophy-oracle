# Trophy Oracle Feature Backlog

This file records concrete product features that need more detail than the main product brief. An entry describes planned behavior, not functionality available in the current application. Current behavior remains defined by `product-brief.md` and the implementation.

## FL-001: Area Sweep And Route Guidance

**Status:** Required V1 proving feature

**Pilot:** Dark Souls II: Scholar of the First Sin, one PlayStation achievement set

**Product family:** Completion Packs, Hunt Memory, spoiler controls, grounded Oracle

The exact PlayStation release, region, and supported game version must be confirmed before pack authoring begins. V1 is not complete until this pilot works during a real platinum playthrough rather than only against fictional fixtures.

### Player Problem

Completion guides often identify an item but do not remember the player's edition, current area, active playthrough, prerequisites, previous discoveries, or preferred spoiler level. In games with hidden paths, NPC conditions, covenant rewards, enemy drops, and New Game Plus requirements, a missed item can be difficult to diagnose and expensive to recover.

### Product Goal

Help the player find an unfinished achievement-related item from their current location without forcing full spoilers. Guidance must explain availability and prerequisites before giving directions, preserve progress separately for each run, and never pretend that a route or map marker exists when the Completion Pack lacks evidence.

### Core Player Flow

1. The player selects the supported Completion Pack, active run, in-game area, and nearest checkpoint or bonfire. The pack fixes the platform release region, edition, and supported game version.
2. **Area Sweep** lists unfinished achievement-related objectives in that area, grouped as available now, blocked, uncertain, or planned for a later run.
3. The player opens an objective and chooses a Hint Ladder level:
   - **Hint:** Area-level nudge with no exact room, NPC, or route.
   - **Route:** Checkpoint-to-objective directions using ordered landmarks.
   - **Exact:** Precise interaction, container, enemy, NPC, or map marker plus requirements.
4. The player confirms **Found**, **Not Available**, or **Save For Later**. Only explicit confirmation changes progress.
5. **Not Available** evaluates trusted requirements and identifies a missing key, quest state, covenant rank, boss condition, edition mismatch, or unsupported guide gap.

The initial application does not read the running game or infer the player's position. Location is selected manually through an area, checkpoint, map marker, or **I'm Here** action.

### Route Card

Each route card may contain:

- game edition and achievement-set ID;
- objective and related achievement IDs;
- in-game area and nearest checkpoint;
- availability state and run recommendation;
- ordered route steps using stable landmarks;
- prerequisites and failure conditions;
- acquisition method: world item, NPC reward, enemy drop, covenant reward, trade, or later-run purchase;
- optional map ID and coordinates;
- spoiler level for every revealable field;
- trusted evidence references and last-verified game version.

If an exact route, coordinate, or requirement is absent, the interface says so. The Oracle cannot fill missing guide fields from model memory.

### Map Experience

Map support is progressive rather than mandatory:

1. **Route Cards:** Text and landmark guidance work without a map.
2. **Schematic Area Maps:** Original diagrams show checkpoints, connections, hazards, and objective markers without copying commercial map art.
3. **Interactive Map Layers:** A permitted or locally supplied image supports pan, zoom, filters, markers, route lines, and run-aware completion state.

Useful filters include unfinished only, available now, missables, spells, gestures, NPCs, enemy drops, farming locations, bosses, and later-run objectives. Exact markers stay absent from the document until the player reveals the exact guidance level.

### Dark Souls II Pilot

The first pack targets one confirmed PlayStation edition because original Dark Souls II and Scholar of the First Sin may use different placements and requirements. It covers every objective needed for that edition's platinum without becoming an every-item database:

- achievement-related spells and gestures;
- NPC quest rewards and survival conditions;
- boss-soul trades that should not be consumed prematurely;
- covenant or farming requirements;
- area-exit sweeps for high-risk objectives;
- later-run and New Game Plus routing.

The pilot succeeds only when the owner can use one real run to plan the platinum, finish an area normally, run a spoiler-controlled Area Sweep, and receive accurate directions for remaining achievement work through the final required achievement.

### V1 Boundary

V1 requires:

- manual edition, run, area, and checkpoint or bonfire selection;
- Area Sweep states for available, blocked, uncertain, and later-run objectives;
- Hint, Route, and Exact guidance for every achievement-relevant pilot objective;
- edition-aware prerequisites, failure conditions, and evidence references;
- run-local location and objective state changed only through explicit confirmation;
- original schematic area maps with validated markers for achievement-relevant pilot locations;
- useful deterministic guide lookup and explicit data-gap refusals when local inference is unavailable.

V1 does not require a copied or commercial full-world map, every non-achievement item, automatic player-location detection, live platform imports, or model-generated route facts. Route cards remain the primary source of directions, and the schematic map supports those cards.

Model-backed natural-language questions and answers are not part of this feature's V1 acceptance gate. The deterministic interface must expose the same trusted route and availability records directly. When local inference is added, it reads those records instead of becoming a second source of game facts.

### Grounded Oracle Behavior

The Oracle may answer questions such as:

- "What achievement items remain near this bonfire?"
- "Give me a hint without showing the exact room."
- "Why is this item unavailable in my current run?"
- "Which unfinished objectives should I collect before the boss?"
- "Move this objective to my New Game Plus plan."

Answers use only the selected Completion Pack, edition, active run, location state, spoiler permission, and cited evidence. The Oracle is read-only. It may propose a progress change, but the deterministic interface requires confirmation.

### Map Rights And Trust

- Do not scrape, copy, trace, or redistribute a commercial guide map without permission.
- Public packs may use original schematic maps, properly licensed assets, or links to external maps.
- A user may load a map image locally when the later import contract supports it; the image remains local and untrusted.
- Map files, coordinates, routes, and pack metadata require versioning, provenance, size limits, strict validation, and safe failure.
- Conflicting or outdated route evidence is shown as uncertain rather than silently selected.
- Future imported pack text, URLs, map files, and model context are untrusted. Packs cannot provide executable HTML, override application or model policy, or introduce unvalidated external navigation.

### Delivery Order

1. Complete Hunt Memory run, progress, undo, reconciliation, and safe activation work.
2. Define the trusted location, route, evidence, edition, and spoiler contract for bundled Completion Packs.
3. Author and validate the achievement-focused Dark Souls II pilot pack.
4. Build route cards, manual area/checkpoint selection, and Area Sweep filtering.
5. Add original schematic area maps with validated interactive markers.
6. Ground Oracle location questions in the same pack records without allowing invented facts.
7. Consider user-imported packs, permitted full-map layers, and read-only platform imports after V1.

### Decisions Before Implementation

1. Define the bundled pack schema and validation gate before authoring routes. It must identify the platform release region, edition, supported game version, evidence provenance, last verification, areas, checkpoints, route cards, availability conditions, spoiler levels, and stable marker IDs.
2. Define deterministic availability precedence. Unsupported or conflicting evidence is uncertain. A known future-run requirement is later-run. A known unsatisfied current-run requirement is blocked. An objective is available only when every authored requirement and required player input is confirmed. Missing or estimated player state remains uncertain.
3. Keep active area, checkpoint, and reveal choices run-local and durable, but treat navigation and reveal selection as non-undoable context changes. Save For Later is an explicit objective-planning mutation and may replace the game-scoped one-step undo snapshot. The Schema 3.0 contract must represent these choices before runtime activation.
4. Decide and test backup, rollback, and stale-tab behavior before replacing Schema 2.0 bytes with Schema 3.0 under the existing browser-storage key.
5. Use route cards as the primary direction format. Choose the smallest accessible original schematic representation that supports per-area connections, stable markers, keyboard and touch operation, and equivalent text. Measure the authored pilot before setting a bundle limit or adding a map library.
6. Before external beta, define evidence refresh ownership, warn about conflicting tabs, monitor local-storage size and write failures, and verify every pilot route against the supported release.

### Acceptance Criteria

- A player can select an area or checkpoint and see only unfinished objectives for the active edition and run.
- A hint can be revealed without exact location text or coordinates appearing in the document.
- Exact guidance names the starting checkpoint, ordered landmarks, acquisition interaction, prerequisites, and evidence.
- Fixed items, NPC rewards, random drops, covenant rewards, trades, and later-run objectives produce different appropriate guidance.
- **Not Available** returns an evidence-backed reason or an explicit guide-data gap.
- Map markers render only from validated coordinates and permitted or local map assets.
- The Oracle cannot invent routes, reveal hidden details without permission, or mutate progress directly.
- Progress and location state remain local and isolated between runs, editions, and platforms.
- The owner can use one supported Dark Souls II run to plan and finish the platinum without relying on fictional records.

### Dependencies And Exclusions

Dependencies:

- stable Hunt Memory runs, progress, reconciliation, and runtime activation;
- a spoiler-safe bundled Completion Pack contract and validation gate;
- trusted real-game evidence with edition and version metadata;
- deterministic evidence lookup, with progress-aware Oracle retrieval and citations added when ready.

Excluded from the first delivery:

- automatic screen recognition or reading game memory;
- live GPS-style positioning;
- mods, overlays injected into the game, or automated controller input;
- copied community guide prose or unlicensed map assets;
- automatic progress mutation;
- a complete every-item database for the pilot game.

### Research Signals

- Players use area-by-area checklists after exploring to reduce spoilers and avoid missing achievement-related work: https://www.reddit.com/r/steamachievements/comments/1hspn88
- Dark Souls II players identify spells, gestures, NPC rewards, and quest conditions as difficult to track without a guide: https://www.reddit.com/r/DarkSouls2/comments/hcsepg
- Scholar of the First Sin guidance must be edition-aware because placements differ from the original release: https://www.xboxachievements.com/game/dark-souls-2-scholar-of-the-first-sin/guide/
- Leaflet supports non-geographical image maps, coordinates, overlays, and markers through `CRS.Simple`: https://leafletjs.com/examples/crs-simple/crs-simple.html
