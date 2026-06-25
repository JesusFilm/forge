---
date: 2026-06-22
topic: video-anchored-experience-generation
---

# Video-Anchored Experience Generation — Grounded Context Pack + Section Generator

## Summary

Shift AI experience generation from _theme-prompt → retrieve videos → free-write
everything_ to _anchor on a specific video → compose the experience from that
video's real, structured data_. The model's job changes from **author** (invents
FAQ, scripture, and descriptions from a theme) to **composer/curator** (selects,
phrases, and writes connective prose over the video's curated study questions,
Bible citations, scene analysis, and transcript). This attacks three current
weaknesses at a shared root: generated-content quality/relevance, scripture
hallucination, and the verified candidate-wiring bug in the draft path.

Two deliverables, built together:

- **(C) Video context pack** — a reusable service that, given a video + locale,
  assembles a typed grounding object from populated per-video sources. Consumed
  by the new section generator _and_ retro-fittable into the existing
  theme-prompt pipeline.
- **(A) Video-section generator** — given an anchor video, produces one
  schema-valid, grounded experience "section unit" (video + description + FAQ +
  scripture card + optional quiz) composed from the pack. Editors stack units to
  build a page.

---

## Problem Frame

Today's pipeline (`apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts`,
plan → draft → critique → revise → normalize) is theme-prompt-driven: the editor
types a theme, `loadExperienceAiVideoCandidates()` does pgvector retrieval to find
candidate videos, and the model free-writes the description, FAQ, scripture, and
quiz. Three structural weaknesses:

1. **The model authors facts it shouldn't.** FAQ questions are invented; Bible
   verse _text_ is free-generated (`DraftBibleQuoteItemSchema` carries `reference`
   - `text` as free strings; `lookupBibleVerse` only resolves a book) and rendered
     verbatim to a public ministry audience — the highest-severity hallucination
     surface.
2. **The draft path is mis-wired (verified).** On the JesusFilm gateway path the
   drafter runs with `toolChoice: "none"` _and_ `buildDraftPrompt`
   (`multi-step-draft-workflow.ts:362-370`) never threads the candidate list into
   the draft step — contradicting the code comment's own assumption at lines
   154-166. The drafter must invent video ids, which `resolveVideoCandidate`
   rejects with `UNKNOWN_VIDEO_REF`.
3. **Rich curated data sits unused.** The admin DB holds per-video study
   questions, Bible citations, scene analysis, and transcripts — none of which
   the generator consumes.

Anchoring generation on a chosen video and composing from that video's real data
removes the retrieval ambiguity (the anchor _is_ the candidate), grounds FAQ and
scripture in curated source material, and shrinks the model's authoring surface to
connective prose only.

**Data readiness (verified against local `forge_admin`, 2026-06-22):**

| Source                                           | Rows   | Verdict                                                     |
| ------------------------------------------------ | ------ | ----------------------------------------------------------- |
| `video` (non-deleted)                            | 1,104  | —                                                           |
| `video_study_question` (text ≠ '')               | 44,506 | FAQ grounding viable now                                    |
| `bible_citation`                                 | 1,268  | Scripture-reference grounding viable now                    |
| videos with **both** study questions + citations | 649    | Anchor sweet-spot                                           |
| `video_scene_locale`                             | 0      | Scene enrichment absent in this env — must be optional      |
| `video_transcript_chunk`                         | 0      | Transcript enrichment absent in this env — must be optional |

The reliable grounding floor is **study questions + citations + title/description**.
Scene/transcript are optional enrichment that may be absent (they depend on
manager's scene-analysis pipeline + Mastra embedding backfill).

---

## Actors

- **A1. Admin editor** — selects an anchor video and receives a grounded section
  (or a draft built from grounded sections) staged for review.
- **A2. Context pack service (C)** — assembles the typed per-video grounding
  object from populated sources; records provenance and source presence.
- **A3. Section generator (A)** — a Mastra agent/workflow that composes one
  schema-valid section unit from the pack.
- **A4. Existing generation pipeline** — second consumer of the pack (retrofit),
  so theme-driven drafts also ground FAQ/scripture.
- **A5. Normalize + staged-review layer** — the existing boundary validator and
  `StagedDraftCard`/apply path the generated output flows through.

---

## Key Flows

- **F1. Anchor → grounded section (happy path)**
  - **Trigger:** Editor picks an anchor video (+ locale) and requests a section.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** (1) Context pack assembled for (video, locale). (2) Section
    generator composes one unit: media from the video, description anchored to
    scene themes/transcript, FAQ from study questions, scripture card from
    citations, optional quiz. (3) Output validates against the canonical block
    union. (4) Result stages into the review/apply path with provenance.
  - **Outcome:** A grounded, schema-valid, reviewable section whose facts trace to
    real video data.
  - **Covered by:** R1, R4, R5, R6, R7, R9, R10

- **F2. Graceful degradation (no scene/transcript)**
  - **Trigger:** Anchor video has study questions + citations but no scene/
    transcript rows.
  - **Actors:** A2, A3
  - **Steps:** Pack records which sources were present; generator grounds FAQ +
    scripture references + description from title/description + study questions;
    scene-derived enrichment is skipped, not faked.
  - **Outcome:** A usable grounded section without scene/transcript data.
  - **Covered by:** R2, R3, R6, R8

- **F3. Retrofit existing pipeline (lower priority, same foundation)**
  - **Trigger:** Editor runs the existing theme-prompt generation.
  - **Actors:** A2, A4
  - **Steps:** The pipeline requests context packs for its retrieved candidates so
    its drafted FAQ/scripture ground in real data instead of free invention.
  - **Outcome:** Theme-driven drafts inherit the grounding without a separate flow.
  - **Covered by:** R4, R12

---

## Requirements

**Context pack (C)**

- R1. Given `(videoId, locale)`, assemble a typed pack from: `VideoStudyQuestion`
  (FAQ candidates, deduped + ordered), `BibleCitation` (references: book +
  `chapterStart/End` + `verseStart/End` + `osisId`), `VideoSceneLocale`
  (`themes`, `spiritualContext`, `demographics`, `description`), `VideoTranscript`
  (summary/excerpt), `VideoLocale` (title/description), `VideoImage` (media).
- R2. Every source is optional. The pack records which sources were present
  (provenance) and never throws because a source is empty.
- R3. The pack is locale-aware: prefer the requested locale's study questions /
  scene data; record when it falls back to another locale or omits.
- R4. The pack is a reusable typed object with no dependency on the section
  generator — both A3 and A4 can consume it.

**Section generator (A)**

- R5. Given an anchor video (+ locale), produce ONE schema-valid section unit
  grounded in the pack: video media, heading + description, FAQ
  (`relatedQuestions`), scripture (`bibleQuotesCarousel`), optional quiz.
- R6. FAQ items derive from real study questions (select / rephrase, never
  invent). When none exist, FAQ is omitted — not fabricated.
- R7. Scripture cards use real citations (grounded reference). The model never
  free-generates verse text; verse text is either retrieved from a real source or
  the card renders reference-only.
- R8. The model composes/curates over the pack and writes connective prose
  (description, quiz framing) anchored to the pack's themes/context; it does not
  assert facts the pack doesn't support.
- R9. Output validates against the canonical block union (`src/domain/blocks.ts`)
  and stages through the existing normalize + review/apply path — it does not
  bypass the boundary validator.
- R10. Each generated unit carries provenance (which study questions / citations
  it used) surfaced to the editor for verification before publish.

**Composition**

- R11. An editor can add a grounded section for a chosen video into an experience,
  composing multiple units into a page. Anchor selection is explicit, not silently
  retrieved.

**Retrofit (extends, does not replace)**

- R12. The existing theme-prompt pipeline can request context packs for its
  retrieved candidates so theme-driven drafts also ground FAQ/scripture.

---

## Acceptance Examples

- AE1. **Covers R5, R6.** Given an anchor video with 5 study questions, when a
  section is generated, the `relatedQuestions` block's items each trace to one of
  those study questions (verbatim or rephrased), and none are invented.
- AE2. **Covers R7.** Given an anchor video with 2 Bible citations, when a section
  is generated, the `bibleQuotesCarousel` references match those citations and no
  verse text is free-generated (reference-only or sourced text only).
- AE3. **Covers R2, R8.** Given an anchor video with study questions + citations
  but zero scene/transcript rows, when a section is generated, it still produces a
  grounded FAQ + scripture + description and skips scene-derived enrichment
  without fabricating it.
- AE4. **Covers R6.** Given an anchor video with no study questions, when a section
  is generated, the FAQ block is omitted rather than populated with invented
  questions.
- AE5. **Covers R10.** Given a generated section, when the editor reviews it, they
  can see which study questions and citations each block was sourced from before
  applying.

---

## Success Criteria

- **Human outcome:** an editor can turn a video into a grounded, publishable
  experience section in one action, and trust that the FAQ and scripture come from
  real curated data, not model invention.
- **Grounding invariant:** every generated FAQ item traces to a real study
  question and every scripture reference traces to a real citation — zero
  hallucinated references reach the public surface; verse text is never
  free-generated.
- **Feasibility today:** for the ~649 videos with both study questions and
  citations, a grounded section can be generated without scene/transcript data.
- **Reusability proven:** the context pack is consumed by at least one additional
  pipeline (the retrofit, R12) — not a one-off generator helper.

---

## Scope Boundaries

- **Not** replacing the theme-prompt pipeline. This adds a video-anchored entry
  point plus a retrofit; the existing flow stays.
- **Not** building scene-analysis or transcript backfill — those depend on
  manager's pipeline + Mastra embedding workflows. The pack degrades without them.
- **Not** the whole-page-from-one-anchor assembler (Shape B) — deferred until the
  section unit and structural validity are proven (a full page multiplies an
  ungrounded failure surface).
- **No block-schema change required** — `relatedQuestions` and
  `bibleQuotesCarousel` already exist. Adding a scripture "speaker" or video
  "tagline" field is out unless explicitly chosen later.
- **Verse-text sourcing** is a bounded sub-decision (reference-only vs. integrate
  a verse-text source); either way the model does not free-generate verse text.
- The 2026-06-15 structural-validity hardening is complementary, not in scope
  here; the section generator outputs through the same normalize/boundary gate and
  benefits from that work when it lands.

---

## Key Decisions

- **Ground generation in per-video structured data; model = composer, not author.**
  Rationale: attacks quality, scripture grounding, and candidate-wiring at the
  root. Data is verified populated (44,506 study questions; 1,268 citations; 649
  videos with both).
- **Build the context pack as a reusable service (C), with the section generator
  (A) as its first consumer.** Rationale: the pack retro-fixes the existing
  pipeline's grounding too (R12) — higher leverage than a standalone generator.
- **Pack degrades gracefully; scene/transcript are optional.** Rationale: verified
  0 rows in the local env; cannot hard-depend on enrichment that may be absent.
- **Anchor is an explicit editor choice.** Rationale: removes the retrieval
  ambiguity behind the current `UNKNOWN_VIDEO_REF` failure mode.
- **Never free-generate verse text.** Rationale: ministry-grade correctness;
  citations ground the reference, text must be sourced or omitted.

---

## Dependencies / Assumptions

- Depends on Core sync having populated `VideoStudyQuestion` + `BibleCitation`
  (verified populated locally; **confirm in prod** before relying on coverage).
- Scene/transcript richness depends on manager scene-analysis + the Mastra
  scene/transcript embedding backfills (verified empty locally; treated as
  optional).
- Verse-text rendering depends on a verse-text source decision (open).
- Built on existing Mastra agent/workflow infra, the canonical block union,
  the normalize stage, and the staged-review (`StagedDraftCard`) path.

---

## Outstanding Questions

### Deferred to Planning

- **[Affects R11][Product]** Entry point: a "Generate experience from this video"
  action on a video detail page, an anchor-picker inside the experience editor, or
  both?
- **[Affects R7][Product/Technical]** Verse text: render reference-only scripture
  cards, or integrate a verse-text source (licensed Bible API / local versified
  corpus keyed by `osisId`/chapter/verse/translation)?
- **[Affects R5, R6][Technical]** Study-question selection: how many per section,
  ordering, rephrase vs verbatim, and locale-fallback behavior when the requested
  locale has none.
- **[Affects R5][Technical]** Does the section generator reuse the 4-stage
  workflow or a lighter single-pass agent? The unit is much smaller than a full
  page, so a single grounded pass may outperform plan→draft→critique→revise.
- **[Affects R12][Scope]** Retrofit timing: same milestone as A, or a follow-up
  once the section unit is validated.
- **[Affects all][Ops]** Confirm prod data readiness (study-question + citation
  coverage across the videos editors actually anchor on).
