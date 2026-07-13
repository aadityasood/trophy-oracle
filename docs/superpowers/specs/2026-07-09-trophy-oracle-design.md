# Trophy Oracle Design

## Product Intent

Trophy Oracle is a local-first AI portfolio app for turning game achievement and progress data into grounded roadmaps. A user searches a game, selects a platform-specific and edition-specific achievement set, and the app loads a trusted dataset. The app then generates a structured guide, and lets the user track manual progress and ask follow-up questions against the same evidence.

The project showcases ML engineering work, not just a generic AI wrapper. The visible system makes the AI pipeline legible: retrieval, classification, planning, grounding, confidence, and evaluation.

## V1 Scope

V1 uses a built-in demo dataset with fictional games. This keeps the first version reliable, legal, and portfolio-ready while the AI architecture is built. Real live achievement scraping, syncing, or platform integrations are later work.

Included in v1:

- Search over built-in demo games.
- Selection of platform-specific and edition-specific achievement sets (e.g. PlayStation, Xbox, Steam).
- Game-specific accent colors and visual tone.
- Roadmap output with three stages: Story, Missables, Grind/Cleanup, mapped to a single unified model. The display label is derived dynamically from the active platform (e.g. "Platinum Roadmap" on PlayStation, "100% Roadmap" on Steam/Xbox/other).
- Local AI generation through an adapter designed for Ollama or another local runtime.
- Retrieval over trusted achievement/evidence records.
- Achievement classification labels such as story, missable, grind, collectible, online, difficulty, and point_of_no_return.
- Q&A that grounds achievement answers in retrieved game and set context, with deterministic refusal for unsupported v1 capabilities.
- Manual progress tracking supporting binary, counter (bounded and open), and checklist tracking modes.
- Strictly set-local progress: platform and edition sets keep independent completion, pins, active stage, and orphan state even when achievements are marked equivalent. Undo is one game-scoped last-mutation snapshot that records one set at a time, not an independent history for every set.
- UI features for manual completion overrides, one-step undo (covering progress, counters, checklists, notes, pins, and active stage), up to 5 pinned Focus Board achievements per set, and last-updated timestamps.
- Local restoration of the most recent game, its preferred achievement set, and that set's active roadmap stage.
- Grounded spoiler-safe hints by default, with explicit reveal before exact hidden names, conditions, warnings, or checklist details enter the UI or model context.
- A deterministic set-local roadmap and evidence/refusal experience when local model inference is unavailable.
- AI Lab panel showing retrieved evidence, achievement labels, confidence, active tracking mode configuration, and refusal/grounding behavior.

Not included in v1:

- Paid cloud AI APIs.
- Live achievement scraping.
- Live platform authentication (PSN, Xbox Live, Steam).
- Accounts, telemetry, cloud sync, or cross-platform progress transfer.
- Training a model from scratch.
- Desktop packaging.

## UX Shape

The first screen is the actual search experience, not a marketing page. The app opens in dark mode with a sleek, game-like interface. A single search bar asks for a game title. When a demo game is selected, the user is prompted to choose a platform edition (e.g. PlayStation, Xbox, Steam). The interface then shifts its accent colors based on that game's source-of-truth theme.

After search and selection, the app shows a polished loading state that feels like the system is analyzing achievement evidence. The result screen has three primary columns or sections representing the unified roadmap stages:

1. Story - safe progression achievements and recommended play order.
2. Missables - warnings, point-of-no-return moments, and save advice.
3. Grind/Cleanup - collectibles, difficulty, post-game, and repetition-heavy achievements.

A Focus Board at the top displays up to 5 achievements pinned in the selected set, showing that set's current tracker values or checklist completion. Switching platforms or editions shows the destination set's own board without clearing or copying pins. Clicking on an achievement details card allows the user to write manual notes, check/uncheck status, adjust counters, or tick checklist items. Selection-only set switches preserve the game's undo snapshot; a later mutation in another set replaces it. Before undo confirmation, the UI identifies the snapshot's recorded set, and undo restores only that set even when another set is currently viewed.

A Q&A panel lets users ask questions like "What should I do before the final mission?" or "Which achievements can I leave for post-game?" Answers cite the local evidence used.

An AI Lab panel is visible enough for portfolio value. It shows retrieved evidence, achievement labels, confidence, any refusal/grounding behavior, and details on progress reconciliation.

## AI Architecture

The app separates the AI system into clear units:

- Data source: loads versioned source-of-truth game JSON containing unique achievement sets.
- Normalizer: validates and converts achievement records into internal objects.
- Retriever: ranks achievement/evidence chunks relevant to the current guide stage or question.
- Classifier: assigns deterministic and model-assisted labels to achievements.
- Planner: groups achievements into Story, Missables, and Grind/Cleanup stages.
- Generator: asks the local model to produce structured guidance using only retrieved context.
- Guardrail: blocks unsupported claims, returns "not enough evidence" when needed, keeps hidden details behind explicit spoiler reveal, and ensures the model cannot mutate progress. All mutations are handled by the deterministic UI/domain layer after confirmation.
- Evaluator: runs fixed portfolio test questions against set-local evidence and optional read-only progress fixtures. Platform-progress isolation remains a structural/domain invariant rather than a model claim.

The local model is a replaceable dependency. V1 targets Ollama because it exposes a local HTTP interface, but the code keeps a model adapter boundary so llama.cpp, LM Studio, or a future fine-tuned model can replace it later. If no adapter is available, deterministic classification, roadmap grouping, grounded evidence excerpts, progress arithmetic, and refusal behavior keep the core demo usable.

## Data Philosophy

The source-of-truth files define what the AI is allowed to know. The model does not invent achievement names, conditions, missable warnings, or point-of-no-return claims.

Every generated guide section and non-refusal achievement answer traces back to achievement IDs and evidence records. Grounded refusals may cite relevant evidence but do not require it; product-boundary refusals come from the fixed v1 scope. This makes the system explainable and gives the portfolio a concrete ML-engineering story.

## Visual Direction

The base interface is dark, sleek, and compact. Use high-contrast cards, subtle borders, glass-like surfaces only where useful, and restrained motion. Avoid a generic landing-page hero.

Each game provides its own accent palette in the data source. The UI applies those colors to focus rings, progress indicators, active stage tabs, loading glow, and chart or label highlights.

## Success Criteria

- A visitor can understand the product in under 10 seconds.
- A technical reviewer can see that this is a local AI/RAG/classification system.
- The app works without paid APIs.
- The demo data runs the full experience immediately.
- Generated answers cite evidence and avoid unsupported claims.
- Future real achievement ingestion can plug into the same data contract.
