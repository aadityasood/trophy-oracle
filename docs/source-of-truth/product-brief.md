# Trophy Oracle Product Brief

## One-Line Pitch

Trophy Oracle is a local AI system that turns trusted game achievement and progress data into grounded roadmaps and evidence-backed Q&A.

## Portfolio Angle

This is an ML-engineering showcase. The app should demonstrate a practical AI pipeline:

- Local model inference.
- Retrieval over trusted achievement evidence.
- Achievement classification and roadmap planning.
- Structured generation with citations.
- Confidence, evidence, and evaluation visibility.

The product should still feel polished, but the "AI Lab" side of the interface should make the engineering work visible.

## Primary User Flow

1. User searches a game title.
2. User selects an edition and platform-specific achievement set.
3. App matches the selection against the built-in source-of-truth dataset.
4. App applies the game's theme accent colors.
5. App retrieves achievement evidence and classifies achievements.
6. App generates a three-step roadmap guide:
   - Step 1: Story
   - Step 2: Missables
   - Step 3: Grind/Cleanup
7. User tracks manual progress (binary check, count increment, checklist tick) or pins up to 5 focus achievements within the selected achievement set.
8. User asks questions about the guide.
9. App grounds achievement answers in retrieved local evidence, cites non-refusal claims, and uses a deterministic product-boundary refusal for unsupported capabilities.

On later launches, the local progress store restores the most recently opened game, that game's preferred achievement set, and that set's active roadmap stage. Pins, notes, counters, and checklist state are restored only from the same achievement set.

## V1 Product Boundary

V1 is local-first and demo-data-first.

In scope:

- Fictional built-in demo games with PlayStation, Xbox, and Steam sets.
- Independent progress, completion calculations, pins, active stage, and orphan state for every platform- and edition-specific achievement set; equivalent achievements never copy progress automatically. Each game keeps at most one last-mutation undo snapshot, which records and restores only one set after the UI identifies it. Selection-only set switches preserve that snapshot, while a later mutation in another set replaces it.
- Local AI adapter boundary.
- RAG-style evidence retrieval.
- Deterministic plus model-assisted achievement labeling.
- Versioned manual progress tracking with one-step undo, notes, and focus board pinning.
- Grounded spoiler-safe hints by default, with an explicit reveal action before exact hidden details are shown.
- A deterministic roadmap and evidence/refusal fallback when local model inference is unavailable.
- AI Lab panel for transparency.
- Game-specific accent theme.

Out of scope:

- Paid AI APIs.
- Real-time web achievement/trophy search.
- Scraping production trophy or achievement sites.
- Live platform logins (PSN, Xbox Live, Steam).
- Accounts, telemetry, cloud sync, or cross-platform progress transfer.
- Model fine-tuning.
- Desktop packaging.

## Later Versions

V2 can add real data ingestion, user-imported progress files, richer evaluation reports, and a labeled dataset editor.

V3 can add a fine-tuned small local model or adapter trained on curated achievement-roadmap examples.
