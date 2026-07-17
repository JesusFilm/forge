---
date: 2026-06-15
topic: ai-experience-exemplar-generation
---

# AI Experience Generation — Real-Page Exemplars

## Summary

Replace the single frozen synthetic few-shot example in the AI experience
generator with **real published experiences matched to the prompt**. The
exemplar teaches layout rhythm and copy voice (with real video IDs stripped);
the AI still designs its own structure and selects its own candidate videos.
When no published page matches well enough, the generator falls back to the
Easter experience as a gold-standard floor.

## Problem Frame

The admin AI experience generator (`apps/admin/src/services/experience-ai/`)
drafts a page from a user prompt by sending the model a system brief, a
structural template, and one **frozen synthetic few-shot example** of three
blocks (hero → nav section → media section). Editors then iterate. The output
skews thin and skeletal compared to hand-crafted production pages.

The live Easter experience
(`/dashboard/experiences/cmpdhy1pa0000ca05mtvcuicw`) shows what "good" looks
like: a video hero, an opening navigation section, a media collection, then a
recurring devotional unit — `section → video + container(text) + bible-quote
carousel` — repeated ~8 times for distinct beats (_My Last Day_, _Why Did Jesus
Have to Die?_, _Did Jesus Come Back From the Dead?_, _Chosen Witness_,
_Invitation to Know Jesus Personally_ …), interspersed with topic video
carousels (_Did Jesus Defeat Death?_, _Easter Events Day By Day_, _New Believer
Course_). ~13 sections with rhythm and scripture integration.

The bet: if the model learns from real pages like this instead of a thin
synthetic example, generated drafts become richer and more layered while still
fitting the requested topic. Real pages are _quality references_, not molds —
the model keeps designing structure freely per prompt.

## Requirements

**Exemplar selection**

- R1. For each generation request, the generator selects exemplar(s) from
  **published** experiences by **relevance to the prompt**, using embedding
  similarity over the existing per-locale experience embeddings.
- R2. Matching prefers the **same locale** as the generation; cross-locale
  match is an acceptable fallback when same-locale candidates are insufficient.
- R3. A relevance/similarity threshold defines a "good enough" match. Below the
  threshold, no matched exemplar is used and the fallback applies. The
  threshold is tunable.
- R4. When no published page matches well enough, the generator falls back to
  the **Easter experience** as the exemplar.
- R5. The previous **frozen synthetic few-shot example is removed** from the
  prompt. Matched real pages, or the Easter fallback, are the only exemplar
  source. (Easter's always-availability guarantees the model always sees one
  real, high-quality example.)

**Exemplar content (what the model learns)**

- R6. An exemplar conveys **structure**: block kinds, nesting, ordering, and
  section rhythm of the real page.
- R7. An exemplar conveys **copy voice**: the real page's headings and body
  copy are shown as a tone/style reference.
- R8. An exemplar **must not** expose the real page's video IDs. The model fills
  videos exclusively from the prompt's candidate list (preserving the existing
  `candidateRef` invariant), and writes its own copy in the exemplar's voice.

**Output behavior**

- R9. The model continues to design structure freely per prompt — the exemplar
  is a quality reference, not a layout to clone. Existing draft invariants
  (candidate refs only, section-ref linking, strict JSON) remain enforced.
- R10. The change applies to **both** existing generation modes (full and
  quick).

## Key Decisions

- **Better exemplars, not a template clone.** Rejected literal
  structure-cloning ("pick a page, swap videos"); the model still composes its
  own page. Real pages teach quality and rhythm only.
- **Relevance-matched, not a fixed curated list and not an editor-curated
  pool.** Pure embedding relevance + Easter fallback. No new "is-exemplar" flag
  or approved-pool concept — keeps scope tight and avoids a curation surface.
- **Structure + copy voice, video IDs stripped.** Chosen over structure-only
  (loses voice) and full-verbatim (risks the model reusing Easter's actual
  videos/copy and conflicts with the candidate-ref invariant).
- **Easter is the fallback floor.** Guarantees a real, high-quality exemplar is
  always present, eliminating skeletal fallback output.
- **Replace the synthetic example.** Removed rather than retained as a deeper
  fallback, since the Easter fallback already guarantees a real example.

## Scope Boundaries

- **Not** building a literal template/structure-cloning mode.
- **Not** adding an editor-curated "exemplary" flag or approved-pool selection.
- **Not** changing the block schema, candidate-video selection, or the
  playable-video filter (this branch builds on top of that work).
- **Not** the manager-side topic content generation track (feat-020).
- **Not** changing bulk or multi-locale generation orchestration.

## Dependencies / Assumptions

- Builds on `fix/ai-video-candidates-playability` (commit `216a0967`), which is
  not yet on `main`. This branch is loosely coupled to that PR until it merges.
- Reuses the existing per-locale experience embeddings
  (`ExperienceLocale.embedding`, pgvector 1536). **Assumption:** the incoming
  prompt can be embedded with the same model/dimensions used for experience
  embeddings so cosine comparison is valid — to be confirmed in planning.
- **Assumption:** enough published experiences exist for relevance matching to
  be meaningful; the Easter fallback covers the cold-start/sparse case.
- **Assumption (planning):** how to derive a stripped "structure + voice"
  representation from a stored `blocks` JSON (block kinds + copy, no video IDs)
  is an implementation decision for `/ce-plan`.
- Number of exemplars surfaced (one vs a small set) is a tuning detail for
  planning.

## Success Criteria

- Generated drafts are visibly more layered (more sections, recurring units,
  scripture/voice cues) than the pre-change synthetic-example baseline, for the
  same prompt.
- Generated drafts never contain a real exemplar page's video IDs; all video
  refs resolve to prompt candidates.
- With no good match, output still uses the Easter exemplar (no skeletal
  fallback).
- Both full and quick modes exercise the new exemplar path.
