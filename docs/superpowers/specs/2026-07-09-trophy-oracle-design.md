# Trophy Oracle Design Specification

## Product Intent

Trophy Oracle is a local-first, spoiler-aware completion cockpit for video game achievements and trophies. The current interface organizes set-local progress and protects hidden details. The target experience adds Hunt Memory and a grounded local Oracle.

Standard platform trackers show unlocked achievements, but they discard active playthrough context. They do not know if a player is on a fresh run or in post-game cleanup, which counters are uncertain, or whether a point of no return is approaching. Trophy Oracle addresses this gap with Hunt Memory: a local state system designed for the active completion run.

The current application is a deterministic foundation using bundled fictional demo data. Hunt Memory, grounded retrieval, local inference, citation checks, evaluation views, and AI Lab are planned. This document labels planned interactions instead of presenting them as working behavior.

## Current Working Baseline

The existing application provides a functional, deterministic foundation built on bundled fictional demo games:

- Game search across fictional demo titles.
- Selection of platform-specific and edition-specific achievement sets (PlayStation, Xbox, Steam).
- Game-specific accent colors and dark theme styling.
- Three-stage roadmap: Story, Missables, Grind/Cleanup, with dynamic header labeling ("Platinum Roadmap" on PlayStation, "100% Roadmap" elsewhere).
- Set-local progress engine supporting binary checkmarks, bounded/open counters, and checklists.
- Browser-local persistence with one game-scoped undo snapshot for the latest set mutation.
- Focus Board displaying up to 5 pinned achievements per set with quick controls.
- Deterministic spoiler-safe Oracle Focus recommendations based on urgency, stage match, partial progress, and canonical order.
- Spoiler protections that withhold hidden achievement names, conditions, and warnings until explicitly revealed.
- Read-only protection for unsupported saved-data versions and session-only behavior when browser storage is unavailable.

## Current Interaction Contract

### Screen Hierarchy

The main screen follows a stable reading order: product header and search, game results, selected game and set selector, three-stage roadmap, Focus Board, Oracle Focus, and the full tracker. The selected game and achievement set provide context for every surface below them.

### Search And Set Selection

- Search matches bundled titles and aliases. An empty query shows every demo game, while no results produces a plain status message.
- Game cards expose selected state and visible keyboard focus.
- Platform and edition choices use a labelled radio group. Selecting a set replaces the visible roadmap, pins, progress, and recommendations with that set's state.
- A game with no achievement set shows a non-destructive empty state.

### Roadmap, Focus, And Tracking

- The roadmap always uses Story, Missables, and Grind/Cleanup in that order. Its heading is `Platinum Roadmap` on PlayStation and `100% Roadmap` elsewhere.
- Each stage control shows completed, total, remaining, and percentage values derived only from the selected set. Active state is conveyed by control state and text, not color alone.
- The Focus Board holds no more than five pins from the selected set. An invalid pin attempt reports the issue without changing saved data.
- Oracle Focus is a deterministic current feature. It ranks eligible incomplete achievements by urgency, active-stage match, partial progress, canonical stage order, and source order. It is not AI Lab.
- Binary achievements use one direct completion checkbox. Counters accept nonnegative whole numbers. Checklists expose each current item as a labelled checkbox.
- Counter and checklist completion overrides require confirmation. Notes stay as local drafts until Save Notes, and Clear Notes is a deliberate action.

### Undo And Isolation

- Each game has one undo snapshot for its latest set mutation. A later mutation in another set of the same game replaces the older snapshot.
- The undo control names the platform or edition set that will be restored before the player activates it.
- Undo restores exactly that set's prior version, pins, stage, progress, provenance, notes, and timestamps, then clears the snapshot.
- Switching sets without a mutation does not create or clear undo.
- An unavailable or version-mismatched target disables undo and explains why.
- Progress, pins, active stage, orphaned state, and totals remain isolated by achievement-set ID. Cross-platform equivalence never acts as a progress key.

### Spoiler Safety

- Hidden names use neutral labels such as `Achievement 3` until reveal.
- Hidden descriptions, warnings, and checklist item names remain masked. A trusted spoiler-safe hint may appear in their place.
- Reveal and Hide are explicit controls. Reveal does not change progress.
- Evidence and exact warnings appear only after reveal.
- Planned retrieval and local inference must exclude protected fields until the player gives explicit spoiler consent.

## Signature Feature Family: Hunt Memory

Hunt Memory will expand the local state engine beyond simple checklist ticking. It adds structured context for active completion runs (planned for future phases).

### 1. Run Ledger
- Allows players to create and switch between named playthrough contexts (such as "Blind Playthrough", "Cleanup Run", or "NG+ Speedrun").
- Keeps the active run visible near the selected game and set.
- Keeps current-run progress distinct from lifetime records where the future data contract allows.
- Never assumes that counters, collectibles, or completion status carry over between runs unless verified by trusted evidence.
- Requires confirmation before an action could discard or merge run context. The future data contract will define storage and migration rules.

### 2. Honest Counters
- Replaces naive numbers with four distinct progress certainty states:
  - Exact: Verified by the player or system.
  - At-Least (Minimum): Confirmed minimum count when exact total is uncertain.
  - Estimated: Approximate count based on player memory or milestones.
  - Unknown: Tracking initiated from this point forward.
- Prevents false precision. The UI never calculates invented remaining counts or completion percentages from uncertain data.
- Keeps manual observations distinct from imported or platform-reported figures.
- Shows certainty and provenance beside the value without implying equal authority.

### 3. Resume Capsule
- A local "Park Run" action for when a player pauses or steps away from a game for weeks or months.
- Captures where the player stopped (chapter, location, save slot), last reliable progress, intended next step, and active missable warnings.
- On return, displays a compact summary:
  - Last Time: Where you left off and what was completed.
  - Next Step: The immediate recommended objective.
  - Risk / Caution: Active missable warnings or upcoming cutoffs.
- Leaves empty optional fields absent instead of filling them with guesses.

### 4. Safety Gate
- An advisory check that appears when approaching a known point of no return.
- Displays all incomplete missable achievements in the current stage, uncertain counters that must be resolved, and recommended manual save points.
- The gate is strictly advisory. It never blocks player actions and never mutates completion state automatically.
- Shows missing or weak evidence as a limitation instead of inferring safety.
- Lets the player go back or explicitly proceed.

## Supporting Features and Backlog

### Tonight Mode
An optional session planning tool. The player selects an available time budget (20, 45, or 90 minutes) and a desired play style:
- Chill: Story progress, low-stress exploration, or simple checklists.
- Grind: Repetitive counters, item collection, or level progression.
- Challenge: Difficult combat encounters, speedrun trials, or missable precision tasks.

Plans are approximate and constraint-aware. Scheduling must wait until a later data contract defines structured, evidence-backed effort ranges, buckets, or another deterministic representation. The current free-text `estimatedEffort` field cannot support exact-fit promises. If too little trusted effort data exists, the interface explains the limitation and offers unscheduled Focus items.

### Completion Target Selection
Allows the player to set their current milestone:
- Platinum / 100% Base Game: Focuses exclusively on base-game requirements.
- All DLC / Full Completion: Expands scope to include expansion content.

Adjusting the target updates roadmap grouping and progress metrics without redefining official platform rewards or mutating recorded achievement data.

The active target stays visible wherever it changes roadmap scope or totals. Changing it requires confirmation.

### Oracle Receipts
A future Oracle recommendation can include an expandable receipt showing:
- Selected achievement IDs and source evidence excerpts.
- Active run constraints and stage filters.
- Certainty status of relevant counters.
- Explicit notation when a query reaches a product boundary or data limitation.

### Cross-Platform Knowledge Transfer
Planned cross-platform equivalence may share trusted guide evidence, tips, and classification metadata. User progress, pins, run ledgers, and undo snapshots remain strictly isolated within each platform-specific set.

### Portable Completion Packs
Future support for versioned, validated local files containing game metadata, achievement definitions, evidence snippets, tracker configurations, and theme palettes. Packs require provenance, integrity checks, size limits, safe parsing, and validation before any state change. The later ingestion and security contract will choose the signing, trust, and verification mechanism.

## Planned Grounded Oracle And AI Lab

- The Oracle remains read-only. It cannot alter progress, certainty, runs, notes, pins, targets, or Safety Gate acknowledgements. Any proposed state change requires explicit player action through deterministic controls.
- Factual non-refusal answers cite achievement IDs from the selected set. Missing or out-of-set citations invalidate the answer.
- Unrevealed details stay out of retrieval and local inference until the player grants spoiler consent.
- Oracle Receipts can expand to show evidence excerpts, active constraints, relevant certainty, spoiler scope, and refusal limits.
- AI Lab is a planned portfolio view for retrieval results, citations, pipeline confidence, refusals, structured-output failures, and evaluation results. It is not a current tracker section.
- The no-inference path covers progress arithmetic, roadmap and stage projections, Oracle Focus ranking, trusted evidence display or direct lookup, and explicit refusals. It does not promise natural-language parity, semantic retrieval, or generated explanations.

## Status, Loading, And Failure Behavior

- Trusted demo data failure replaces the application with a clear alert. The interface must not continue with partially trusted records.
- Unavailable browser storage starts session-only mode and explains that progress will not be saved.
- Invalid saved progress stays untouched. A safe session fallback must not overwrite unreadable stored bytes.
- A saved set with a different data version remains visible but read-only until a supported reconciliation path exists.
- Missing set or achievement progress produces a non-destructive unavailable state.
- Future imports treat every file as untrusted. Validation, version checks, provenance, integrity checks, size limits, and safe parsing happen before any state change.
- Future retrieval and local-runtime work needs explicit idle, loading, success, refusal, malformed-output, unavailable-runtime, and retry states.
- Loading never reveals protected details or blocks current deterministic controls.

## Accessibility And Input

- Use native buttons, inputs, checkboxes, radio groups, fieldsets, and headings when those elements match the interaction.
- Every control has an accessible name that remains meaningful while achievement details are hidden.
- Keyboard focus is visible against the dark surface and does not depend on theme color alone.
- Status and error messages use appropriate live regions without repeating on every render.
- Touch targets should be at least 44 by 44 CSS pixels when layout permits. Closely grouped controls need enough spacing to avoid accidental activation.
- Text and controls must meet WCAG 2.2 AA contrast targets. Theme accents cannot reduce legibility.
- Zoom to 200 percent must preserve reading and control order without horizontal page scrolling.

## Responsive Behavior

- Mobile uses one content column, full-width search, stacked game details, and controls that wrap without clipping.
- Tablet may use two-column card grids while preserving the same reading order.
- Desktop can increase information density and use two or three columns for stage, Focus Board, or Oracle cards.
- The tracker remains readable in one primary column. Dense metadata wraps before it truncates essential labels.
- No breakpoint may hide progress controls, spoiler controls, status messages, or the set named by undo.

## Visual Identity And Motion

- Use a high-contrast dark base with game-reactive accents from trusted theme data.
- Accent color may identify selection, focus, progress, and subtle surface glow. State also needs text, shape, icon, or control semantics.
- Motion should explain selection, reveal, save, pin, undo, and panel changes. Avoid decorative loops and long entrance sequences.
- Respect `prefers-reduced-motion`. Reduced motion removes transforms and nonessential animation while preserving immediate state feedback.
- Show time and effort in plain language. Approximate values keep an approximation label.

## Development Sequence

1. Define the public product direction and backlog.
2. Define a versioned Hunt Memory data contract and migration policy.
3. Build the deterministic Hunt Memory engine and persistence behavior with tests.
4. Add Resume Capsule, Safety Gate, and session-planning interactions.
5. Apply the game-reactive visual identity, responsive density, purposeful motion, reduced-motion behavior, and readable time presentation.
6. Add grounded retrieval, evaluation, deterministic fallback behavior, and a local inference adapter.
7. Consider Portable Completion Packs and real-data ingestion only after Hunt Memory and grounded Oracle behavior are reliable.

## Non-Goals

- No social features, friends lists, leaderboards, or public profiles.
- No live synchronization or credential storage for PSN, Xbox Live, Steam, or RetroAchievements.
- No automated web scraping of third-party guide websites.
- No cloud hosting, remote databases, user accounts, or telemetry.
- No paid third-party AI APIs.
- No automated progress guessing without explicit player confirmation.
- No synthetic achievement data or AI-generated missable warnings.

## Unresolved Technical Questions

1. **Storage Schema for Multi-Run Ledgers:** How to store multiple runs per set cleanly in localStorage while keeping fast lookup and easy migration from the v1 format.
2. **Certainty Propagation Logic:** Mathematical rules for calculating overall progress percentages when some counters are exact, some are minimums, and others are unknown.
3. **DLC Grouping and Target Isolation:** Clean schema conventions for tagging DLC expansions without disrupting platform-specific trophy grades or gamerscore totals.
4. **Tonight Mode Effort:** Structured effort ranges, buckets, provenance rules, and estimation behavior that support approximate plans without false precision.
5. **Completion Pack Trust:** Validation, provenance, integrity, trust, and verification rules for safely handling untrusted local files.
