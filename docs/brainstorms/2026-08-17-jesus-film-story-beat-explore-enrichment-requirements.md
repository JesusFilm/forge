---
date: 2026-08-17
topic: jesus-film-story-beat-explore-enrichment
---

# JESUS film — subtitle-derived story beats, scripture, and questions for the Explore panel

## Problem Frame

The in-player Explore panel shipped in PR #1945 and its `Video.moments` field is
live on production. The JESUS film (slug `jesus`, the ~2h feature) already has
**34 timed moments** — but their summaries are raw transcript dialogue
("I am writing to you, dear Theophilus…"), every sampled moment's
`bibleVerses` list is empty, and the film carries only 4 generic film-level
study questions. So the panel works mechanically on the flagship film but shows
subtitle fragments where a viewer should see the story.

This work is a one-film content sample: derive the story from the film's
subtitle-based transcript, and turn it into what the panel was built to show —
a story beat, the scripture it depicts, and a question worth pausing on.

## Requirements

- R1. **Story-beat summaries.** Every timed moment of the JESUS film gets a 1–2
  sentence third-person story summary (what is happening on screen during that
  span), and the Explore panel's "this moment" section shows that instead of
  raw dialogue.
- R2. **Scripture per beat.** Each beat carries the passage it depicts (the
  film dramatizes the Gospel of Luke, so beats map to Luke references), shown
  as the moment's scripture in the panel.
- R3. **Per-beat questions — phase 2 of the sample.** Each beat gets one
  reflective question derived from its story content, surfaced in the panel
  while that moment is active. Ships only after R1+R2 content is approved and
  visible, because it needs new storage and a panel change.
- R4. **Human review gate.** No generated content reaches the data the panel
  reads without a person approving it. The review artifact is one readable
  beat sheet (timestamp · story summary · scripture · question) that the
  reviewer can edit before load. AI-attributed Gospel narration, scripture
  attribution, and ministry questions are editorial surfaces.
- R5. **English only, JESUS film only.** Other languages and films are the
  rollout question this sample exists to answer, not part of it.
- R6. **Search must be unaffected.** The timed chunks feed search embeddings;
  the enriched display content must not change what search matches against.
  Display data and search data must be separable — mechanism is planning's,
  the invariant is product's.
- R7. **Degrade rules preserved.** A beat whose content was not approved shows
  nothing new; the panel's existing hide-don't-empty behavior stays intact.

## Success Criteria

- On the tvOS simulator against production data, opening Explore mid-JESUS at
  arbitrary positions shows a story beat and its Luke reference for that
  moment (R1+R2), and — in phase 2 — its question (R3).
- A reviewer can read and correct the entire film's beat sheet in one document
  before anything is loaded.
- Watch search behavior for JESUS-related queries is demonstrably unchanged
  after the load (R6).
- The team can judge from this one film whether the pipeline is worth
  productizing across the catalog — that judgment, not the pipeline, is the
  sample's deliverable.

## Scope Boundaries

- One film, one language. No batch pipeline, no scheduler, no editor UI —
  generation may be a run-once, human-in-the-loop process.
- Do not modify or replace the Core-sourced film-level `studyQuestions`; the 4
  editorial questions stay as they are.
- No re-extraction from VTT: the subtitle-derived timed transcript already
  exists as the 34 moments; this work enriches, it does not re-segment
  (whether 34 beats is the right granularity is a planning question, but
  building a new extraction pipeline is out).
- Per-moment questions (R3) ship second, never first.

## Key Decisions

- **Enrich the existing timed moments rather than re-derive from subtitles**:
  the timing skeleton is already live and the panel already reads it; the gap
  is content quality, not extraction.
- **Phased delivery (R1+R2 → R3)**: summaries and scripture light up the
  already-shipped panel with zero UI change, so the sample becomes visible —
  and reviewable by the team — at the earliest possible moment.
- **Human review is mandatory** (R4): follows the video-first-devotional
  precedent that AI-produced ministry content gets fresh human authorization
  before publish.
- **Question tone mirrors the existing Core study questions**: reflective and
  accessible ("How do the different groups respond to Jesus?"), not academic —
  consistency with the editorial voice over novelty.

## Dependencies / Assumptions

- `Video.moments` live on production admin (verified 2026-08-17: 34 rows for
  `jesus`, en).
- The TV Explore panel renders summary + scripture per moment today (PR #1945)
  and has a scripture-reference parser; R3 is the only part needing TV changes.
- Assumes the 34 chunks' spans are usable as story beats; if a chunk straddles
  two scenes badly, the reviewer smooths it in the beat sheet rather than the
  sample re-chunking.

## Outstanding Questions

### Resolve Before Planning

- (none)

### Deferred to Planning

- [Affects R6][Needs research] Where enriched display content lives relative to
  the search-coupled `content_summary` — separate column/table vs overwrite is
  THE load-bearing storage decision; verify what search embeddings actually
  read before choosing.
- [Affects R2][Technical] The exact `bibleVerses` string format TV's reference
  parser (`parseBibleReference`, shipped with the panel) accepts, so generated
  references render rather than drop.
- [Affects R3][Technical] How a per-moment question attaches (moments field
  gains a field vs sibling structure) and what the panel change looks like.
- [Affects R1][Technical] Generation tooling: one-shot script vs a Mastra
  bounded route; whichever is chosen, the heavy-AI decomposition law applies if
  this ever grows beyond a sample.
- [Affects R4][Technical] Load mechanism for approved content (script against
  admin's DB mirrors existing seed/backfill patterns) and its idempotency.

## Next Steps

→ `/ce:plan` for structured implementation planning
