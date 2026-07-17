---
date: 2026-06-21
topic: watch-search-readiness-eval-suite
---

# Watch Search Readiness Eval Suite

## Summary

`feat-193` creates a reusable Watch search readiness suite that can answer
whether the current Admin search implementation is launch-ready across
`hybrid`, `keyword-first`, and `semantic-only` eval modes. The suite combines a
100-query prompt set with Mastra-run comparison reports so the team can inspect
ranked results, obvious failures, and summary metrics before shipping.

---

## Problem Frame

The team has been spot-checking search quality while public Watch search has
multiple possible retrieval behaviors. That creates confusion about whether a
given result set is good enough to launch, whether a mode improved or regressed,
and whether semantic retrieval is carrying its own relevance weight or only
looking acceptable because keyword retrieval rescued it.

Existing Mastra search eval infrastructure already supports seed prompts,
baseline capture, comparison reports, and release-gate summaries. This ticket
turns that infrastructure into a readiness suite for the current Watch launch
question and adds an internal semantic isolation mode for better diagnosis.

---

## Key Decisions

- **Three Admin-owned modes only.** The readiness suite covers `hybrid`,
  `keyword-first`, and `semantic-only` because they are all retrieval modes of
  the Admin search stack.
- **Semantic-only is diagnostic.** `semantic-only` exists to isolate vector and
  embedding relevance during evals; it is not a public Watch search behavior.
- **Algolia-backed comparison is out of scope.** This ticket does not create an
  Algolia parity mode, fallback mode, or follow-up ticket.
- **Mastra remains offline.** Mastra owns the eval dataset, runner, and report
  artifacts while Admin remains the search execution authority.

---

## Actors

- A1. **Search owner.** Uses the report to decide whether the current Watch
  search behavior is good enough to launch.
- A2. **Implementing engineer or agent.** Runs the suite while iterating on
  search retrieval, ranking, and embeddings.
- A3. **Admin search.** Executes each requested eval mode and returns ranked
  results.
- A4. **Mastra eval workflow.** Owns the prompt set, baseline comparison, judge
  output, and saved report artifacts.

---

## Requirements

**Dataset**

- R1. The suite must provide a reusable committed prompt set with 50-100
  realistic Watch search queries.
- R2. The prompt set must include product titles, felt needs, Bible topics,
  misspellings, synonyms, confusing queries, multilingual queries, and
  scene-like queries.
- R3. The prompt set must include real Algolia-derived query examples where
  available, including the highest-traffic query as a baseline case.

**Eval Modes**

- R4. The suite must run the same prompt set against `hybrid`,
  `keyword-first`, and `semantic-only` modes.
- R5. `semantic-only` must evaluate semantic/vector retrieval without keyword,
  title, or full-text retrieval contributing candidates.
- R6. The eval mode recorded in each report must identify the requested
  pipeline mode, not only whether semantic retrieval degraded at runtime.
- R7. `keyword-first` must preserve strong brand and product-title intent, so
  searches such as `bible project` and `Jesus` return the expected Bible Project
  and JESUS video results near the top.

**Reporting**

- R8. The report must include ranked results for each query and mode in enough
  detail that a reviewer can diagnose bad matches.
- R9. The report must include scored or judged comparison output, obvious
  failures, no-result cases, and summary metrics.
- R10. The report must support a human launch-readiness decision without requiring
  every reviewer to reread every raw result.

**Boundaries**

- R11. Admin must remain the search execution authority; Mastra must call Admin
  eval contracts rather than importing Admin code or reading Admin search tables.
- R12. The semantic-only mode must be isolated to internal eval execution unless
  a later product decision explicitly ships it to public Watch search.
- R13. The ticket must remove Algolia-backed comparison from its acceptance
  scope rather than producing an incomplete placeholder mode.

---

## Key Flows

- F1. Dataset-backed readiness run
  - **Trigger:** A search owner wants to assess whether Watch search is ready to
    launch.
  - **Actors:** A1, A3, A4
  - **Steps:** Mastra loads the committed prompt set, calls Admin search for the
    requested mode, captures ranked results, and writes a report artifact.
  - **Outcome:** A mode-specific readiness report exists with query-level
    evidence and summary metrics.
  - **Covered by:** R1, R2, R3, R4, R8, R9, R10

- F2. Semantic isolation comparison
  - **Trigger:** An engineer wants to know whether semantic retrieval is useful
    on its own.
  - **Actors:** A2, A3, A4
  - **Steps:** The suite runs the same prompt set against `semantic-only` and
    compares those results with another captured mode such as `hybrid` or
    `keyword-first`.
  - **Outcome:** The team can see whether vector retrieval finds relevant
    content without lexical retrieval hiding weaknesses.
  - **Covered by:** R4, R5, R6, R9

- F3. Launch-readiness review
  - **Trigger:** The team needs to decide whether to ship current Watch search.
  - **Actors:** A1, A2
  - **Steps:** Reviewers inspect summary metrics, high-severity failures,
    no-result cases, and representative query results across modes.
  - **Outcome:** The team can make a launch, hold, or iterate decision from the
    report.
  - **Covered by:** R8, R9, R10

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given the readiness suite prompt set, when a
  reviewer inspects it, then it contains 50-100 realistic prompts across the
  required query categories and includes the top Algolia-derived query.
- AE2. **Covers R4, R5.** Given the suite runs in `semantic-only` mode, when
  Admin executes the search, then keyword, title, and full-text retrieval do not
  contribute candidates.
- AE3. **Covers R7.** Given the suite runs in `keyword-first` mode, when it
  searches `bible project`, then Bible Project videos appear near the top of the
  ranked results.
- AE4. **Covers R7.** Given the suite runs in `keyword-first` mode, when it
  searches `Jesus`, then the JESUS film/video appears near the top of the ranked
  results.
- AE5. **Covers R6.** Given a report was produced for `keyword-first`, when the
  report metadata is inspected, then it records `keyword-first` as the requested
  pipeline mode even if the response also reports runtime search degradation.
- AE6. **Covers R8, R9, R10.** Given the suite finishes a comparison run, when
  the team opens the report, then they can see summary metrics, obvious
  failures, no-result cases, and per-query ranked results.
- AE7. **Covers R11, R12, R13.** Given this ticket is complete, when public
  Watch search runs, then it has not been changed to expose semantic-only search
  and the ticket has not added an Algolia-backed eval mode.

---

## Success Criteria

- The committed prompt set is broad enough that reviewers recognize realistic
  Watch searches instead of synthetic-only happy paths.
- `hybrid`, `keyword-first`, and `semantic-only` can be run through the Mastra
  eval workflow with comparable report output.
- The report makes launch-readiness failures visible at both summary and
  per-query levels.
- The team can explain whether a mode is ready, not ready, or inconclusive from
  the report.

---

## Scope Boundaries

- Algolia-backed eval comparison is out of scope.
- Public Watch search behavior changes are out of scope unless required to keep
  existing behavior stable.
- Search analytics logging is out of scope for this ticket.
- Multilingual search-language UX changes are out of scope for this ticket.
- Scene embedding ranking decisions are out of scope except where existing query
  prompts exercise scene-like searches.

---

## Dependencies / Assumptions

- Admin can expose or extend an internal eval search contract for requested
  pipeline modes without changing public search contracts.
- Mastra can pass a requested search mode through its offline eval runner and
  orchestrator schemas.
- The existing pairwise judge and report artifact model remains the correct
  comparison mechanism for launch-readiness decisions.
- The Algolia-derived query data used for the prompt set is treated as aggregate
  analytics, not user-identifying trace data.

---

## Sources / Research

- `docs/roadmap/content-discovery/feat-193-watch-search-readiness-eval-suite.md`
- `docs/brainstorms/2026-05-06-semantic-search-eval-harness-requirements.md`
- `docs/brainstorms/2026-05-30-search-eval-orchestrator-requirements.md`
- `docs/brainstorms/2026-06-01-production-search-eval-seed-baseline-requirements.md`
- `docs/brainstorms/2026-06-19-watch-multilingual-semantic-search-requirements.md`
- `apps/admin/src/services/hybrid-search.service.ts`
- `apps/admin/src/app/api/internal/search-eval/search/route.ts`
- `apps/mastra/src/services/offline-search-eval/`
- `apps/mastra/src/mastra/workflows/offline-search-eval.ts`
- `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts`
- `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
