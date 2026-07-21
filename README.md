# Trophy Oracle

Trophy Oracle is a local-first achievement companion for players who want a clear completion roadmap and a reliable place to track progress that games do not expose.

It is designed as a small ML-engineering portfolio project: trusted achievement data, structured guide generation, grounded question answering, deterministic fallbacks, and eventually local model inference without paid AI APIs.

> **Project status:** Active early development. The cross-platform data contract and trusted React application foundation are complete. Manual progress tracking, the final interface, and local AI features are next.

## The Idea

Achievement progress support is inconsistent across games and platforms. The achievements that most need counters often leave players using notes or spreadsheets.

Trophy Oracle is built around that gap:

- Track PlayStation trophies, Xbox achievements, and Steam achievements independently.
- Use binary, counter, and checklist tracking for hidden or incomplete in-game progress.
- Organize completion into Story, Missables, and Cleanup.
- Keep progress local and private.
- Ask questions against trusted guide evidence rather than an unconstrained chatbot.
- Fall back to deterministic guidance when a local model is unavailable.

## What Works Today

- Search across three fictional demo games.
- Select platform- and edition-specific achievement sets.
- Derive `Platinum Roadmap` for PlayStation and `100% Roadmap` elsewhere.
- Apply game-specific accent colors.
- Validate bundled data through a strict Zod trusted-data gate.
- Show a calm failure state instead of exposing raw validation details.
- Preserve a spoiler-safe foundation by withholding achievement details.
- Verify behavior with 25 focused schema and interface tests.

The current interface is a functional foundation. Its visual identity, tracker controls, and animation system will be redesigned during the dedicated UI phase.

## Roadmap

- [x] Platform-neutral achievement and progress contracts
- [x] Fictional PlayStation, Xbox, and Steam demo data
- [x] React application shell and trusted-data validation
- [ ] Versioned manual progress engine, persistence, undo, and reconciliation
- [ ] Focus Board, roadmap tracking, notes, and spoiler controls
- [ ] Iterative game-aware visual design and purposeful animation
- [ ] Grounded retrieval, cited Q&A, and deterministic evaluation
- [ ] Local model adapter, initially targeting Ollama
- [ ] JSON backup/restore and offline PWA behavior

Live platform authentication, cloud sync, telemetry, scraping, and paid model APIs are intentionally outside the first version.

## Local Development

### Requirements

- A current Node.js release
- npm

### Run the app

```bash
npm ci
npm run dev
```

Vite will print the local URL, normally `http://localhost:5173`.

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
- Browser-local persistence in the upcoming progress-engine phase
- Local model inference in a later AI phase

## Source Of Truth

The product and data behavior are specified before implementation:

- [Product brief](docs/source-of-truth/product-brief.md)
- [Data contract](docs/source-of-truth/data-contract.md)
- [AI pipeline](docs/source-of-truth/ai-pipeline.md)
- [Design specification](docs/superpowers/specs/2026-07-09-trophy-oracle-design.md)
- [Fictional demo dataset](data/source-of-truth/demo-games.json)
- [Evaluation questions](data/source-of-truth/eval-questions.json)

All bundled games and achievement records are fictional. They exist to make progress behavior, retrieval, evaluation, and failure handling reproducible without relying on live platform services.

## ML Engineering Focus

The eventual AI layer is deliberately narrow. It will retrieve evidence for one selected achievement set, produce structured roadmap output, cite supported claims, refuse unsupported requests, and remain unable to change user progress directly. Progress mutations stay inside the deterministic application layer and always require explicit user action.
