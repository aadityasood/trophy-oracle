# Trophy Oracle

Trophy Oracle is a local-first, spoiler-aware completion cockpit. It keeps achievement progress, roadmap state, pins, notes, and spoiler choices private in the browser.

The working application is a deterministic foundation built on fictional demo data. Hunt Memory is the planned signature feature family for named runs, honest counters, parked-session summaries, and point-of-no-return checks. Grounded local questions and answers are a later phase.

## What Works Today

The current codebase is a functional foundation using bundled fictional demo games:

- Search across three fictional demo titles.
- Select platform- and edition-specific achievement sets (PlayStation, Xbox, Steam).
- Automatically format dynamic headers: `Platinum Roadmap` on PlayStation and `100% Roadmap` elsewhere.
- Apply game-specific accent colors to the interface.
- Validate all bundled data through a strict Zod data gate.
- Track progress in browser storage with one game-scoped undo snapshot for the latest set mutation.
- Manage a set-local Focus Board with up to 5 pinned achievements and quick controls (binary checks, counters, checklists).
- Organize work across a three-stage roadmap (Story, Missables, Grind/Cleanup) with persisted active stage.
- View deterministic, spoiler-safe Oracle Focus recommendations based on urgency, stage match, partial progress, and canonical order.
- Protect against spoilers by masking hidden achievement names, conditions, and warnings until revealed.
- Keep unsupported saved-data versions read-only and use session-only progress when browser storage is unavailable.

## Planned Direction

- **Hunt Memory:** Run Ledger, Honest Counters, Resume Capsule, and Safety Gate.
- **Tonight Mode:** Approximate plans using 20, 45, or 90 minute presets and Chill, Grind, or Challenge preferences. Scheduling waits for structured, evidence-backed effort data.
- **Completion Targets:** Platform-appropriate Platinum, base-game 100%, or all-content scope without changing official rewards.
- **Grounded Oracle:** Read-only local reasoning with selected-set citations, spoiler consent, explicit refusals, and Oracle Receipts.
- **AI Lab:** A future view for retrieval, citations, confidence, refusals, and evaluation results. It is not implemented today.
- **Portable Completion Packs:** Deferred validated local files with versioning, provenance, integrity checks, and safe handling as untrusted input. The trust and verification mechanism is still open.

The no-inference path remains useful for progress arithmetic, roadmap and stage projections, Oracle Focus ranking, trusted evidence display or direct lookup, and explicit refusals. It does not promise parity with inference-backed questions, semantic retrieval, or generated explanations.

## Roadmap

1. Define the public product direction and backlog.
2. Define Hunt Memory data and migration rules.
3. Build deterministic run, certainty, and persistence behavior with tests.
4. Add Resume Capsule, Safety Gate, and approximate session planning.
5. Apply responsive game-reactive styling, accessible motion, and reduced-motion behavior.
6. Add grounded retrieval, evaluation, fallback rules, and a local inference adapter.
7. Consider Portable Completion Packs and real-data ingestion after the core is reliable.

## Non-Goals

To keep the application focused, private, and reliable, the following features are intentionally out of scope:

- No leaderboards, public profiles, rarity scoring, or social feeds.
- No live network login or background synchronization with PSN, Xbox Live, Steam, or RetroAchievements.
- No automated web scraping of third-party guide websites.
- No cloud accounts, remote servers, or telemetry tracking.
- No paid third-party AI APIs.
- No automatic progress guessing without user confirmation.
- No generated achievement facts, warnings, or save advice outside trusted dataset records.

## Local Development

### Requirements

- Node.js (current LTS release recommended)
- npm

### Run the app

```bash
npm ci
npm run dev
```

Vite will start the development server, usually at `http://localhost:5173`.

### Verify the project

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Technology

- React 19 and TypeScript
- Vite
- Tailwind CSS
- Zod
- Vitest and Testing Library
- Browser-local progress persistence
- Local inference in a later phase

## Source Of Truth

Product behavior and data contracts are documented in the repository:

- [Product brief](docs/source-of-truth/product-brief.md)
- [Data contract](docs/source-of-truth/data-contract.md)
- [AI pipeline](docs/source-of-truth/ai-pipeline.md)
- [Design specification](docs/superpowers/specs/2026-07-09-trophy-oracle-design.md)
- [Fictional demo dataset](data/source-of-truth/demo-games.json)
- [Evaluation questions](data/source-of-truth/eval-questions.json)

All bundled games and achievement records are fictional. They exercise the current deterministic tracker and provide structured fixtures for planned retrieval and evaluation work without third-party platform dependencies.
