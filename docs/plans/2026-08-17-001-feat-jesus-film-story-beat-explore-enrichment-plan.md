---
title: "feat: JESUS film story-beat enrichment for the Explore panel"
type: feat
status: active
date: 2026-08-17
origin: docs/brainstorms/2026-08-17-jesus-film-story-beat-explore-enrichment-requirements.md
---

# ✨ JESUS film story-beat enrichment for the Explore panel

## Overview

The Explore panel (PR #1945) is live, and the JESUS film has 34 timed moments —
but their summaries are raw transcript dialogue, every `bibleVerses` list is
empty, and only 4 generic film-level questions exist. This plan turns the
film's subtitle-derived transcript into human-reviewed **story beats**
(summary + Luke reference + reflective question per beat) and loads them where
the panel reads, for one film, in English, with a mandatory human review gate
(see origin: R1–R5).

Deliverable of the sample is the **team's judgment** on whether to productize
across the catalog — not a pipeline (origin: Success Criteria).

## Problem Statement

`Video.moments` projects `video_transcript_chunk.content_summary` +
`bible_verses` (`apps/admin/src/graphql/types/video.ts:757` →
`apps/admin/src/services/video-moments.service.ts:39-78`). For JESUS those
columns hold Mastra's deterministic heuristics — dialogue excerpts and empty
verse lists — so the shipped panel shows subtitle fragments where a viewer
should see the story.

## Storage Decision (resolves origin R6 — the load-bearing question)

**Reviewed content gets a NEW human-owned table. Never the chunk rows.**
Research disqualified both in-place options with evidence:

1. **Overwrite `content_summary`/`bible_verses` — disqualified twice.**
   The transcript-embedding writer bulk-upserts
   `ON CONFLICT … DO UPDATE SET content_summary = EXCLUDED.content_summary,
bible_verses = EXCLUDED.bible_verses`
   (`apps/admin/src/services/transcript-embedding.service.ts:732-733`) — any
   repair/force/model-upgrade re-ingest clobbers manual edits. And
   `content_summary` is the first branch of
   `COALESCE(NULLIF(content_summary,''), NULLIF(raw_source_text,''), text)` in
   THREE search display surfaces: hybrid-search snippets
   (`hybrid-search-retrievers.ts:373-377`), scene-recommendations descriptions
   (`scene-recommendations-retriever.ts:213-217`), and the Typesense transcript
   document's `text` field (`typesense-watch-search-indexer.ts:586-590`; that
   field is `index: false` — stored for display, never lexically queried, per
   `typesense-watch-search-schema.ts`). Story prose there changes what search
   _shows_ even though ranking vectors don't move at query time.
2. **New nullable columns on `video_transcript_chunk` — disqualified.**
   Columns survive the `DO UPDATE` but not the ROW lifecycle: a
   pre-transaction prune deletes chunks outside the incoming index range
   (`transcript-embedding.service.ts:553-559`), and re-chunking (it has already
   happened once — `CHUNKING_VERSION = "enriched-transcript-v2"`) shifts
   `chunk_index` meaning, silently re-attaching a preserved display summary to
   a different time span. Misattribution is worse than loss.

A separate table has zero search coupling by construction (no retrieval SQL or
Typesense projection reads it) and zero clobber risk (no pipeline writes it),
and it lets the reviewer CORRECT beat boundaries in the sheet — timing is
human-owned, not chunk-owned.

### New model (migration `0053_video_moment` — verify the next free number at implementation time; hand-written forward-only SQL per `apps/admin/CLAUDE.md`)

```prisma
/// Human-reviewed story beats for the Explore panel. Editorial content —
/// no pipeline writes this table; the transcript chunks remain the
/// machine-owned fallback projection.
model VideoMomentEditorial {
  id            String   @id @default(cuid())
  videoId       String   @map("video_id")
  video         Video    @relation(fields: [videoId], references: [id], onDelete: Cascade)
  languageSlug  String   @map("language_slug")   // "english" family slug? NO — BCP-47 "en", matching video_transcript.language
  beatIndex     Int      @map("beat_index")
  startSeconds  Float    @map("start_seconds")
  endSeconds    Float?   @map("end_seconds")
  summary       String
  bibleVerses   String[] @map("bible_verses")
  question      String?                          // loaded in phase 1, exposed/rendered in phase 2 (R3)
  // Provenance + attribution (origin R4; devotional-exception spirit):
  reviewedBy    String   @map("reviewed_by")
  reviewedAt    DateTime @map("reviewed_at")
  sourceModel   String?  @map("source_model")    // generator model id, null if fully hand-written
  sourceTranscriptId String? @map("source_transcript_id") // authored-against transcript, informational only
  createdAt     DateTime @default(now()) @map("created_at")

  @@unique([videoId, languageSlug, beatIndex])
  @@index([videoId, languageSlug])
  @@map("video_moment_editorial")
}
```

`listVideoMoments` (`video-moments.service.ts`) gains one preference rule:
**if ≥1 editorial row exists for (videoId, resolved language), serve ONLY the
editorial set** (ordered by `beatIndex`), else the existing chunk projection.
All-or-nothing per film+language — no mixed raw/reviewed panels (resolves the
partial-load flow gap; origin R7's hide-don't-empty ladder is untouched).
Existing caps (default 150 / max 300) and en-fallback semantics stay.

## Proposed Solution — three phases

### Phase 0 — admin storage + preference (small PR)

- Prisma model + hand-written migration as above (`@@unique` is the loader's
  idempotency key).
- `video-moments.service.ts`: editorial-preference rule + tests:
  - editorial set present → chunk projection NOT queried (assert exclusivity,
    not just presence — deleting the preference must fail a test);
  - empty editorial → byte-identical current behavior (regression pin);
  - language fallback: requested language editorial → requested-language
    chunks → en editorial → en chunks (decide + pin exact ladder in tests).
- **No GraphQL change**: `VideoMoment` already exposes
  `startSeconds/endSeconds/summary/bibleVerses` (`schema.graphql:1916-1921`) —
  phase 1 ships with zero schema/codegen work and **zero TV changes** (the
  panel refetches per app launch: Apollo `no-cache` + in-memory 8-entry FIFO,
  `momentsSource.ts:19-26,87-97` — new data appears without a TV release).

### Phase 1 — generate → review → load (the sample)

**Generation script** (committed: `apps/admin/src/scripts/generate-video-moment-sheet.ts`),
mirroring `generate-persona-variants.ts`'s shape (DB → bounded LLM → Zod gate
→ artifact for humans, NEVER a DB write):

- Input: JESUS's `video_transcript_chunk` rows (`text`, `start_seconds`,
  `end_seconds`) — the subtitle-derived transcript (origin: enrich, don't
  re-extract).
- One bounded LLM pass (direct OpenRouter is precedented —
  `image-text-generation.service.ts`; Mastra HTTP also acceptable; either way
  `AbortSignal.timeout` per the outbound-timeout law) producing per beat:
  1–2 sentence third-person story summary (R1), Luke reference(s) (R2), one
  reflective question in the Core study-question voice (R3 content, phase-2
  rendering) (see origin: Key Decisions).
- Output: `beat-sheet.json` (loader input, Zod-validated) + a human-readable
  `beat-sheet.md` table (timestamp · summary · scripture · question) — the
  review artifact of origin R4. Reviewer edits, then signs by filling
  `reviewedBy` in the JSON.
- **Reference grammar is validated at generation time against the TV parser's
  exact contract** (`apps/tv/src/lib/moments/parseBibleReference.ts:20-21`):
  `Book C`, `Book C:V`, `Book C:V-V` only — full canonical English book name
  (optional ordinal 1–3), same-chapter ranges, plain hyphen/en-dash, numbers
  1–999, ≤4 refs per beat, NO OSIS dots / commas / cross-chapter / prose.
  Abbreviations parse but 404 on the verse fetch (`bibleVerses.ts:12-16`) —
  forbid them. Unparseable refs are **silently invisible** on TV
  (`MomentsPanel.tsx:118-121` renders parsed citations only — note: the parser
  header comment claiming "renders as plain text" is wrong; fix the comment in
  phase 2). The generator-side validator duplicates the anchored regex with a
  comment naming the TV file as source of truth + fixtures copied from
  `parseBibleReference.test.ts` (producer-consumer contract law: one source of
  truth, producer's literals in fixtures).

**Loader** (committed: `apps/admin/src/scripts/apply-video-moment-sheet.ts`),
JSON-in → Zod → apply, on the `cleanup-legacy-openai-embeddings.ts` safety
posture (NOT the local-only prod-refusing guard, and NOT run-embeds'
guard-free posture):

- Dry-run by default printing count projections (video resolved by slug →
  exactly ONE id; beat count; per-beat ref-parse results).
- Production execution only behind `--execute --allow-production-target
--report-out=<path>`; single `$transaction`; idempotent upsert on
  `(videoId, languageSlug, beatIndex)`; post-write row-count assertion;
  refuses a sheet with `reviewedBy` empty (the R4 gate is structural).
- All-or-nothing: the transaction replaces the film+language's editorial set
  wholesale (delete-then-insert INSIDE the transaction is acceptable here —
  single write path, human-triggered; a failed run leaves the prior set).
- Script code lands on main via normal PR BEFORE being run against prod
  (operator-CLI precedent per `apps/admin/CLAUDE.md`; Tier-2 review applies —
  data-writing script = sensitive surface).

**Verification** (origin: Success Criteria):

- Production probe: `videoBySlug(slug:"jesus"){ moments { … } }` returns the
  reviewed set (summaries are prose, verses parse).
- tvOS simulator: open Explore mid-film at ≥3 arbitrary positions → story beat
  - Luke citation card (with fetched verse text) for that moment; jump-to-scene
    rows show beat summaries.
- Search unchanged: trivially satisfied by construction (no chunk row/column
  is touched) — assert with a before/after `watchSearch` snapshot for 3 fixed
  JESUS-related queries anyway (falsifies the construction claim cheaply).

### Phase 2 — per-moment questions surface (R3; only after phase-1 content is approved and visible)

- Admin: add `question: String` to the `VideoMoment` Pothos type; run the
  6-step GraphQL change flow (root `CLAUDE.md`) — steps 4–5 target **apps/tv**
  (`momentsQuery.ts`), precedent commit `0f98eba4`.
- TV (smallest surface, from research): `momentsQuery.ts` selection,
  `momentsModel.ts:7-15` type + **`isRenderable` at `:33-35` must include
  `question`** (else a question-only moment classifies the film `empty` —
  pinned by a test), `momentsSource.ts` `parseMomentRow` narrowing
  (empty-string→null like summary), one Text block in `MomentsPanel.tsx`'s
  "This moment" box (`:151-175`) + the untimed list (`:199-205`). Film-level
  studyQuestions rendering (`:210-219`) is untouched.
- Fix the `parseBibleReference.ts` header comment (see phase 1 note).

## System-Wide Impact

- **Interaction graph:** `Video.moments` → `listVideoMoments` → NEW editorial
  preference → chunk fallback. The transcript-embedding pipeline, hybrid
  search, Typesense indexer, and sceneRecommendations never touch the new
  table; re-ingests/re-chunks can no longer affect what the panel shows for
  enriched films.
- **Error propagation:** loader failures roll back one transaction (prior set
  survives); TV fetch failures already degrade to `unavailable` → empty
  classification (`momentsSource.ts:93-110`) — unchanged.
- **State lifecycle:** editorial rows carry provenance
  (`sourceTranscriptId`, `sourceModel`, `reviewedBy/At`); chunk-row lifecycle
  (prune/re-chunk) is decoupled by design.
- **API surface parity:** web/mobile don't consume `moments` today; the field
  shape doesn't change in phase 1, so nothing to mirror. Phase 2's `question`
  is additive-nullable.
- **Integration test scenarios (beyond unit):**
  1. Editorial set present + chunk rows present → GraphQL returns editorial
     only (exclusivity).
  2. Editorial for `en`, request `es` with no `es` data → the pinned fallback
     ladder.
  3. Loader dry-run vs execute parity: identical projections, zero writes in
     dry-run (assert row counts).
  4. Generated sheet round-trip: every `bibleVerses` string parses with the
     TV regex fixtures (producer literals, feat-326 labeling for any synthetic
     case).
  5. Re-run the loader with an edited sheet → set replaced, no duplicates
     (idempotency on the unique key).

## Acceptance Criteria

- [ ] R1: JESUS panel "this moment" shows third-person story prose at
      arbitrary positions (simulator screenshots).
- [ ] R2: each beat shows its Luke citation with fetched verse text; zero
      unparseable refs in the loaded sheet (loader validation report).
- [ ] R3 (phase 2): active moment renders its question; question-only moments
      are renderable (isRenderable test).
- [ ] R4: loader refuses unsigned sheets; loaded rows carry
      `reviewedBy/reviewedAt`; beat sheet MD reviewed by a human before load.
- [ ] R5: one film (`jesus`), one language (`en`); nothing else written.
- [ ] R6: no chunk row/column mutated (loader touches only the new table);
      before/after watchSearch snapshot identical for 3 fixed queries.
- [ ] R7: films without editorial rows behave byte-identically (service
      regression test); panel degrade ladder untouched in phase 1.
- [ ] Roadmap: create `feat-364` for this work (reference
      content-discovery/feat-192 — spell out the LANE: a duplicate feat-192 id
      exists in media-generation); commit the currently-untracked origin
      brainstorm doc with phase 0.
- [ ] Tier-2 `/ce-code-review` before push on phase 0+1 (data-writing script =
      sensitive surface).

## Alternative Approaches Considered

- **Overwrite chunk columns** — rejected: clobbered by the embedding writer's
  `DO UPDATE` (`transcript-embedding.service.ts:732-733`); leaks story prose
  into three search display surfaces (R6 violation).
- **New display columns on chunk rows** — rejected: survives the upsert, dies
  by the row lifecycle (prune `:553-559`, re-chunk misattribution).
- **Mastra/manager durable pipeline** — rejected for the sample: the
  heavy-AI decomposition law triggers on durable pipeline ownership, which the
  origin doc explicitly excludes; the law binds if this productizes
  (origin: Deferred; the devotional exception is expressly non-precedent).
- **Write questions into `video_study_question`** — rejected: Core sync
  soft-deletes untouched `source=CORE` rows
  (`core-sync/video-localized-metadata.ts:278-287`), `MANAGER` misuses the
  editorial tier, and the table has no timecode column.

## Dependencies & Risks

- **Wrong-but-valid book names fetch the WRONG passage** under a
  right-looking reference (book names aren't validated at parse time) — the
  human review step is the control; the beat-sheet MD must render references
  prominently for checking.
- **Reviewer edits break the JSON** — loader's Zod gate + dry-run report is
  the control; the MD is for reading, the JSON for loading.
- **`languageSlug` semantics**: transcripts key on BCP-47 (`en`) while some
  video surfaces use family slugs (`english`) — the new table follows the
  transcript convention (`en`); pin with a test (this exact confusion cost a
  session earlier — `sceneRecommendations` locale is BCP-47).
- **Session cache**: an already-viewed film serves the cached panel until app
  relaunch (8-entry FIFO) — demo on a fresh launch.
- If generation later moves into a server process, outbound-timeout + byte-cap
  laws bind immediately (measured-not-computed caps).

## Sources & References

### Origin

- **Origin document:**
  [docs/brainstorms/2026-08-17-jesus-film-story-beat-explore-enrichment-requirements.md](../brainstorms/2026-08-17-jesus-film-story-beat-explore-enrichment-requirements.md)
  — carried forward: enrich-don't-re-extract; phased R1+R2 → R3; mandatory
  human review (R4); search-unaffected invariant (R6); one film / English
  (R5); hide-don't-empty preserved (R7). UNTRACKED at plan time — commit with
  phase 0.

### Internal References

- Moments resolver + service: `apps/admin/src/graphql/types/video.ts:757`,
  `apps/admin/src/services/video-moments.service.ts:29-89`
- Clobber/prune evidence: `apps/admin/src/services/transcript-embedding.service.ts:553-559,657-745`
- Search display coupling: `apps/admin/src/services/hybrid-search-retrievers.ts:373-389`,
  `typesense-watch-search-indexer.ts:586-590`, `scene-recommendations-retriever.ts:198-263`
- TV contracts: `apps/tv/src/lib/moments/{momentsModel.ts:33-99, momentsSource.ts:17-124, parseBibleReference.ts:20-72}`,
  `apps/tv/src/components/watch/MomentsPanel.tsx:104-225`
- Script postures: `apps/admin/src/scripts/{generate-persona-variants.ts, cleanup-legacy-openai-embeddings.ts:221-357, partner-keys.ts:263-283}`
  (note: `apply-experience-from-json.ts` / `seed-experience.ts` are UNTRACKED
  main-checkout files — mirror the shape, never import)
- Laws: producer-consumer report contract, pgvector bulk upsert, backfill
  claim-then-start, mocked-vs-real feat-326/327, opt-in env `.optional()` —
  root `CLAUDE.md` Known Patterns + `docs/solutions/…`

### Related Work

- PR #1945 (merge `1f87b839`; admin field `0f98eba4`, TV panel `b685dad9`)
- Roadmap: content-discovery/feat-192 (enrichment predecessor, status
  "implemented" — nonstandard value), feat-194 (scripture correction,
  complete); next free id `feat-364`
- Production probe 2026-08-17: 34 moments live for `jesus`/en; summaries are
  dialogue; verses empty; 4 Core study questions; 0 bible citations
