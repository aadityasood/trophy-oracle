# Trophy Oracle AI Pipeline

## Guiding Rule

The AI may explain, organize, and reason over achievement evidence and set-local progress state, but it may not invent facts. Achievement names, rewards, unlock conditions, checklist items, missability, and point-of-no-return warnings must come from the source-of-truth data. Product-scope refusals use the fixed v1 product boundary, not achievement evidence.

The AI model remains strictly read-only; it can suggest or recommend progress updates, but it must never mutate progress directly. All mutations and confirmed actions are applied exclusively by the deterministic UI/domain layer after explicit user confirmation.

## Pipeline

1. Load Game
   - Match the search query to a local game record.
   - Load metadata, theme, the selected platform-specific achievement set, and achievement-set-aware evaluation examples.
   - Restore `lastGameId`, the game's `preferredSetId`, and that set's `activeStage` when valid local state exists.

2. Normalize
   - Validate required fields.
   - Convert achievement labels and guide stages into internal enums.
   - Reject records missing achievement IDs, names, or evidence summaries.
   - Enforce unique IDs, platform/reward compatibility, set-local prerequisites, tracking constraints, confidence range, and edition-safe set identity.

3. Retrieve
   - Build searchable chunks from achievement descriptions, evidence notes, labels, warnings, and grounded spoiler-safe hints.
   - For full guide generation, retrieve by stage.
   - For Q&A, retrieve by semantic similarity and label filters.
   - Keep retrieval, supplied progress context, pins, and completion calculations inside the selected achievement set. A `crossPlatformGroupId` is equivalence metadata only.
   - Before explicit spoiler reveal, expose `spoilerSafeHint` instead of exact fields marked as hidden by that hint.

4. Classify
   - Use deterministic rules as the primary logic and as a fallback if the local model inference is unavailable:
     - point_of_no_return implies missable.
     - collectible implies cleanup unless marked story-critical.
     - online implies optional caution.
   - Use the local model only to explain or refine ambiguous cases when available.

5. Plan
   - Group achievements into a single unified three-step roadmap model:
     - Story
     - Missables
     - Grind/Cleanup
   - Sort missables before related point-of-no-return events.
   - Keep post-game-safe achievements out of missable warnings.
   - Drive the display label dynamically from the active platform: "Platinum Roadmap" on PlayStation, and "100% Roadmap" elsewhere.
   - Build and restore each roadmap independently by achievement-set ID, including its active stage and Focus Board pins.

6. Generate
   - Send the local model a constrained prompt with retrieved context.
   - Request structured JSON output for guide cards and Q&A answers.
   - Require achievement-ID citations for non-refusal guide and Q&A claims.
   - Ensure summaries default to grounded `spoilerSafeHint` values. Exact hidden names, descriptions, warnings, or checklist details require explicit user action before they enter model context.
   - Permit deterministic arithmetic over the selected set's trusted progress context, such as remaining bounded-counter or checklist work.

7. Guard
   - If evidence is weak, answer with "not enough evidence in the local dataset."
   - Reject uncited non-refusal claims and any citation outside the selected set.
   - A grounded refusal may cite relevant achievement evidence when available, but citations are optional for refusals and must not be invented.
   - Questions about unsupported imports, accounts, sync, scraping, or live-platform state use a deterministic v1 product-boundary refusal; they do not treat product policy as achievement evidence.
   - Surface uncertainty in the AI Lab panel.

8. Evaluate
   - Run fixed questions from the set-aware eval set.
   - Compare cited achievement IDs against expected evidence IDs within the specified achievement set. For refusals, nonempty expected evidence identifies relevant evidence that may be cited, not a mandatory citation.
   - Supply only the record's declared set-local `progressContext`, product-policy context, and spoiler-reveal state.
   - Track answer groundedness, deterministic progress derivations, missing warnings, and unsupported claims.
   - Validate platform-progress isolation as a deterministic structural/domain invariant rather than asking the model to assert cross-set policy.

## Model Runtime

V1 should support a local model through an adapter. Ollama is the recommended first runtime because it is easy to install and exposes a local HTTP API. The app should not hard-code business logic to Ollama.

Adapter responsibilities:

- Check whether a local model service is available.
- Send structured prompts.
- Parse JSON responses.
- Return clear local-model error states.

## Deterministic No-Model Fallback

If the adapter is unavailable or structured output cannot be parsed:

- Build the roadmap from `expectedStage`, deterministic label rules, prerequisites, and source ordering within the selected set.
- Render grounded source excerpts or `spoilerSafeHint` values with achievement-ID citations.
- Answer only direct evidence lookups and deterministic calculations over supplied set-local progress; otherwise return the standard grounded refusal.
- Keep all progress mutations behind the same explicit deterministic UI/domain confirmation path.

The fallback must not synthesize unsupported prose or copy progress, pins, active stage, or undo state between sets.

## Showcase Features

The UI should expose:

- Selected platform-specific and edition-specific achievement sets.
- Retrieved evidence for each guide section.
- Achievement labels and confidence.
- Why an achievement was assigned to a stage.
- Q&A citations.
- Unsupported-answer refusals.
- Evaluation examples and expected evidence IDs.
