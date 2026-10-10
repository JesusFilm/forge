---
date: 2026-06-22
topic: search-eval-caller-specific-prompt-tracks
---

# Search Eval Caller-Specific Prompt Tracks

## Summary

The search eval suite should evaluate search by caller use case instead of
forcing public Watch search, AI experience generation, and semantic diagnostics
through one shared prompt set. The existing keyword-first Watch readiness set
stays in place for public search, while new agent-focused tracks judge whether
hybrid and semantic-only retrieval return useful source material for AI work.

---

## Problem Frame

The first prod-backed readiness run showed that `keyword-first` is the right
current lens for public Watch search because it preserves brand, product, and
title intent. That same run made `hybrid` and `semantic-only` look poor against
the public-search prompt set, but those modes serve a different job when agents
use them for experience generation, devotionals, recommendations, or content
discovery.

A single prompt set now mixes several jobs: public viewers looking for known
content, operators diagnosing embedding quality, and agents trying to discover
relevant source material. That makes reports easy to misread because a mode can
fail public title lookup while still being useful for machine retrieval.

---

## Key Decisions

- **Caller tracks define readiness.** Eval prompts and success criteria should
  be grouped by who is calling search and what that caller is trying to do.
- **Keep the public Watch track stable.** The current keyword-first Watch
  readiness set remains the launch-readiness track for viewer-facing search.
- **Agent tracks judge usefulness, not exact-title lookup.** Hybrid and
  semantic-only evals should measure whether search returns useful candidate
  material for an agent task.
- **Semantic-only remains diagnostic.** Semantic-only should isolate embedding
  retrieval quality and should not be treated as a public Watch launch mode.

---

## Actors

- A1. **Public Watch search reviewer.** Uses the existing Watch readiness track
  to decide whether viewer-facing search is launch-ready.
- A2. **AI experience-generation owner.** Uses agent-focused reports to decide
  whether search returns useful content candidates for generated experiences.
- A3. **Agent or workflow.** Calls search while assembling experiences,
  devotionals, recommendations, or related-content candidates.
- A4. **Search/embedding engineer.** Uses semantic diagnostics to understand
  whether content embeddings can retrieve relevant material without lexical
  help.

---

## Requirements

**Track Model**

- R1. The eval suite must support caller-specific prompt tracks for public
  Watch search, AI experience generation, and semantic diagnostics.
- R2. Each track must declare the caller, intended job, suitable search modes,
  and success criteria before results are judged.
- R3. The public Watch search track must keep the current keyword-first prompt
  set as its starting point.
- R4. A report must identify which caller track produced its prompts so readers
  do not compare modes against the wrong job.

**Public Watch Track**

- R5. The public Watch track must continue to prioritize product titles, brand
  names, exact titles, misspellings, common user queries, and multilingual
  viewer search behavior.
- R6. The public Watch track must continue to include `bible project` and
  `Jesus` as brand/product readiness cases for keyword-first search.
- R7. Hybrid and semantic-only results may be captured against the public Watch
  track for diagnosis, but their public launch score must not be inferred from
  this track unless the team explicitly chooses to ship them for public Watch.

**AI Experience-Generation Track**

- R8. The AI experience-generation track must focus on agent tasks such as
  finding videos for a theme, felt need, Bible topic, audience, persona, season,
  or devotional idea.
- R9. The AI track must judge whether returned results are useful source
  candidates for the agent, not whether they match an exact title.
- R10. The AI track must include prompts that resemble machine instructions,
  such as finding related videos for a topic or selecting material for a
  generated experience section.
- R11. The AI track must record enough result context for a reviewer to decide
  whether an agent could reasonably use the returned candidates.

**Semantic Diagnostic Track**

- R12. The semantic diagnostic track must isolate whether content embeddings can
  retrieve relevant material without keyword, title, or full-text retrieval
  rescuing the result set.
- R13. Semantic diagnostic prompts must emphasize concepts, paraphrases,
  transcript meaning, scene-like descriptions, and non-title thematic queries.
- R14. A poor semantic diagnostic score must be treated as embedding or corpus
  evidence, not as a direct public Watch launch blocker.

**Reporting**

- R15. Reports must avoid a single global readiness score that mixes caller
  tracks with different jobs.
- R16. Reports must summarize each track separately with mode, wins/losses or
  judged quality, no-result cases, and obvious failure examples.
- R17. Reports must make cross-track caveats visible, especially when a mode is
  bad for public title lookup but useful for agent retrieval.

---

## Key Flows

- F1. Public Watch readiness review
  - **Trigger:** The team needs to decide whether viewer-facing Watch search can
    launch.
  - **Actors:** A1
  - **Steps:** The reviewer runs or opens the public Watch track, checks
    keyword-first brand/product cases, and reviews summary failures.
  - **Outcome:** The team has a launch-readiness signal for public search.
  - **Covered by:** R3, R5, R6, R7, R15, R16

- F2. AI experience-generation retrieval review
  - **Trigger:** An owner wants to know whether agents can use search to find
    content for generated experiences or devotionals.
  - **Actors:** A2, A3
  - **Steps:** The AI track runs prompts shaped like agent retrieval tasks,
    captures hybrid and semantic-only results, and judges source-candidate
    usefulness.
  - **Outcome:** The team can tell whether search is useful for agent content
    discovery.
  - **Covered by:** R1, R2, R8, R9, R10, R11, R16, R17

- F3. Semantic retrieval diagnosis
  - **Trigger:** A search or embedding engineer wants to inspect whether the
    embedding corpus can retrieve relevant content without lexical help.
  - **Actors:** A4
  - **Steps:** The semantic diagnostic track runs concept, paraphrase,
    transcript, and scene-like prompts against semantic-only retrieval.
  - **Outcome:** The report identifies embedding or corpus weaknesses without
    confusing them with public launch readiness.
  - **Covered by:** R12, R13, R14, R16, R17

---

## Acceptance Examples

- AE1. **Covers R3, R5, R6.** Given the public Watch track, when the team
  reviews keyword-first search, then `bible project` and `Jesus` remain
  first-class readiness cases.
- AE2. **Covers R7, R15, R17.** Given hybrid performs poorly on exact-title
  public Watch prompts, when the report is read, then the report does not treat
  that alone as failure for AI experience generation.
- AE3. **Covers R8, R9, R10.** Given the AI experience-generation track, when a
  prompt asks for videos related to a Bible theme or devotional idea, then
  results are judged by agent usefulness rather than exact title match.
- AE4. **Covers R12, R13, R14.** Given the semantic diagnostic track, when
  semantic-only fails concept or paraphrase prompts, then the report frames the
  result as embedding/corpus evidence.
- AE5. **Covers R4, R16.** Given any report, when a reviewer opens its summary,
  then the caller track and search mode are visible before the score is
  interpreted.

---

## Success Criteria

- Public Watch search can keep using the existing keyword-first readiness signal
  without being diluted by agent-specific prompts.
- Hybrid and semantic-only can be evaluated against AI retrieval jobs they are
  meant to support.
- Reports help the team say "this mode is good for this caller" instead of
  producing a single misleading launch score.
- Future agents can use the report to choose a search mode without needing the
  meeting context that produced this distinction.

---

## Scope Boundaries

- This does not change public Watch search behavior.
- This does not introduce Algolia-backed execution or fallback comparison.
- This does not score final generated experience quality; it scores the search
  candidates available to the generating agent.
- This does not replace the existing keyword-first Watch prompt set.
- This does not decide scene embedding weighting except where semantic
  diagnostic prompts expose retrieval quality.

---

## Dependencies / Assumptions

- The existing Watch readiness prompt set remains useful for public
  keyword-first search.
- Hybrid and semantic-only are expected to be used by agents or workflows that
  value thematic/content relevance over exact title matching.
- The eval runner can report mode and prompt provenance clearly enough for
  humans and agents to separate caller tracks.

---

## Sources / Research

- `docs/brainstorms/2026-06-21-watch-search-readiness-eval-suite-requirements.md`
- `docs/roadmap/content-discovery/feat-193-watch-search-readiness-eval-suite.md`
- `CONCEPTS.md`
- `PRODUCT.md`
- `apps/mastra/src/services/offline-search-eval/seed-prompt-set.ts`
- `apps/mastra/src/mastra/workflows/offline-search-eval.ts`
- `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts`
