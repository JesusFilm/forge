---
date: "2026-05-30"
topic: "search-eval-orchestrator"
---

# Search Eval Orchestrator Requirements

## Summary

Add a thin Mastra search eval orchestrator that runs the existing leaf
workflows in safe operator modes, summarizes their outputs, and keeps baseline
capture, comparison, native Evaluation sync, and release gating resumable.

---

## Problem Frame

The search eval leaf workflows are intentionally separate because they own
different safety boundaries: generated candidates are exploratory, offline
reports are artifact-backed, candidate review is human-gated, and native
Evaluation sync must be idempotent. Operators still need one workflow for the
normal evaluation path so production baseline capture and local baseline seeding
can build on a single production/local entry point instead of hand-coordinating
leaves.

---

## Requirements

- R1. The orchestrator coordinates existing leaf workflows without moving their
  implementation logic into the orchestrator.
- R2. The normal `full` mode captures a named seed baseline with production-safe
  defaults, then can sync that report and promoted truth into native Evaluation.
- R3. The `compare` mode compares current search behavior against an existing
  named baseline, then can sync the resulting report into native Evaluation.
- R4. The `release-gate` mode runs a comparison and returns a pass/fail state
  from explicit thresholds for losses, search failures, judge failures, judge
  disagreements, and calibration.
- R5. Every result returns a single operator summary with child workflow run ids,
  baseline/report ids, artifact paths, native Dataset/Scorer/Experiment ids,
  counts, and pass/fail state.
- R6. Partial failures remain legible and resumable, especially when an offline
  report exists but native sync or promoted sync fails.
- R7. The orchestrator never promotes generated, trace-derived, seed, or
  user-submitted candidates. It may submit seed or generated candidates only as
  pending/staged material when explicitly requested.
- R8. Defaults must make production baseline capture and local baseline seeding
  straightforward for follow-up tickets without implementing those tickets.

---

## Key Decisions

- **Thin coordinator:** The orchestrator calls leaf launch functions and reports
  their child run ids. Leaf workflows keep their Studio cards, service routes,
  validation, and independent tests.
- **Safe defaults:** Candidate generation and seed candidate submission are
  opt-in. Baseline capture and native sync are available by default because
  they operate on committed seed prompts and idempotent native sync contracts.
- **Resume by report id:** Operators can retry native report sync with a known
  report id instead of rerunning Admin search and judge calls after a late sync
  failure.

---

## Scope Boundaries

- Build the orchestrator workflow and protected service route in `apps/mastra`.
- Update roadmap and local Mastra docs for the new operator entry point.
- Do not add production scheduling, production data capture automation, or local
  seed scripts here; those remain follow-up work.
- Do not change Admin public search REST or GraphQL response shapes.

---

## Acceptance Examples

- AE1. Given default input, when an operator runs the orchestrator in `full`
  mode, then it captures `seed-baseline`, returns baseline/report artifact
  details, and does not generate or promote any candidates.
- AE2. Given `resumeReportId`, when native report sync is retried, then the
  orchestrator skips offline search execution and calls `sync-report` for that
  report id.
- AE3. Given `release-gate` mode and a comparison report with one loss, when
  the default maximum loss threshold is zero, then the workflow returns a
  failed pass/fail state with the report id/path preserved.
- AE4. Given candidate generation is enabled, when generation succeeds, then
  generated candidates remain staged and no candidate review `promote` action
  is called.

---

## Sources

- `docs/roadmap/content-discovery/feat-138-mastra-eval-query-generation.md`
- `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
- `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
- `docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md`
- `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
- `docs/solutions/architecture-patterns/mastra-native-evaluation-search-eval-bridge-pattern.md`
