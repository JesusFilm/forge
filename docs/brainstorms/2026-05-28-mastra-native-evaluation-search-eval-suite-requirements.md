---
date: 2026-05-28
topic: mastra-native-evaluation-search-eval-suite
related:
  - docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md
  - docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md
  - docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md
  - docs/roadmap/content-discovery/feat-141-mastra-retrieval-strategy-investigation.md
  - docs/solutions/architecture-patterns/mastra-native-evaluation-search-eval-bridge-pattern.md
  - docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md
---

# Mastra Native Evaluation Search Eval Suite

## Summary

Feat-142 should make Mastra Studio's native Evaluation area the primary
operator surface for search evals. Operators should be able to understand and
use search eval runs through native Datasets, Scorers, Experiments, and Overview
signals without opening JSON artifacts first; custom artifacts remain an audit
and full-fidelity backing layer.

---

## Problem Frame

Feat-138, feat-139, and feat-140 create the pieces of a safer search-eval loop:
generated candidate prompts, seed and comparison reports, and human promotion
into durable regression truth. Those pieces are useful, but the operator
experience is still fragmented if the real understanding lives in workflow cards
and filesystem artifacts.

Feat-142 is the convergence ticket. It should turn the safe search-eval domain
into actual native Mastra Evaluation records and make local reproduction part of
the product contract, not a side quest. A developer should be able to start
Admin and Mastra locally, run the same sync and experiment path used elsewhere,
and see the expected native Evaluation records in Studio.

---

## Key Decisions

- **Native Evaluation normalization first:** Transform every safe search-eval
  concept into native Mastra Evaluation records wherever that preserves operator
  meaning. Artifacts remain backing evidence, not the first place operators go.
- **Meaning beats force-fitting:** If a native field cannot express a
  search-specific concept without hiding meaning, the native record should still
  carry a clear summary and a safe link or metadata pointer to the backing
  detail.
- **One path across environments:** Local, staging, and production should use
  the same sync and run behavior with environment-specific configuration, stable
  names, and idempotent writes.
- **Keep the safety boundary:** Native Evaluation integration must not collapse
  generated-candidate staging, human promotion, and durable regression truth
  into one unsafe state.

---

## Actors

- A1. Operator: Uses Mastra Studio to inspect search eval Datasets, Scorers,
  Experiments, and roll-up signals.
- A2. Developer: Runs the suite locally and verifies the same native Evaluation
  shapes that staging or production would create.
- A3. Mastra: Owns the operator-facing native Evaluation suite, offline
  experiments, scoring, and search-specific report metadata.
- A4. Admin: Owns live search behavior, search-eval storage, sanitization,
  review metadata, retention policy, and authenticated HTTP contracts.
- A5. Planner or future investigator: Uses feat-142 native Evaluation evidence
  as the basis for feat-141 retrieval strategy decisions.

---

## Key Flows

- F1. Native Evaluation sync
  - **Trigger:** A developer or operator runs the search-eval native sync for an
    environment.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Mastra reads safe seed and promoted search-eval truth through
    Admin contracts, transforms it into native Dataset items, registers or
    updates search-eval Scorers, and reuses or updates stable native records
    instead of duplicating them.
  - **Outcome:** Studio shows real native search-eval Datasets and Scorers for
    the chosen environment.
  - **Covered by:** R1, R2, R3, R4, R5, R11

- F2. Native experiment run
  - **Trigger:** An operator runs an offline search eval after native records
    exist.
  - **Actors:** A1, A3, A4
  - **Steps:** Mastra runs the eval against Admin search, records sanitized item
    results as a native Experiment, transforms pairwise search quality outcomes
    into native scores and reasons, and attaches safe search-specific summary
    metadata.
  - **Outcome:** Studio's Experiments and Overview areas communicate the run's
    quality signal without requiring a JSON artifact as the starting point.
  - **Covered by:** R6, R7, R8, R9, R10, R12

- F3. Local reproduction
  - **Trigger:** A developer needs to verify feat-142 outside production.
  - **Actors:** A2, A3, A4
  - **Steps:** The developer starts local Admin and Mastra with local URLs,
    bearer keys, storage, database, and artifact configuration, runs the same
    sync and experiment path, and inspects the resulting records in Studio.
  - **Outcome:** Local verification proves the same operator experience and
    idempotency behavior expected in staging and production.
  - **Covered by:** R11, R12, R13, R14

---

## Requirements

**Native operator surface**

- R1. Mastra Studio's native Evaluation area must be the canonical operator
  surface for the search eval suite.
- R2. Operators must be able to understand and use a search eval run inside
  Studio without opening a custom JSON artifact first.
- R3. Seed prompt sets and human-promoted regression prompts must become native
  Dataset items when they are safe to expose.
- R4. Generated, trace-derived, user-submitted, pending, rejected, archived, or
  unsanitized candidates must not enter durable native Datasets.
- R5. Native record names and metadata must clearly distinguish local, staging,
  and production records.

**Scoring and experiments**

- R6. Offline search eval runs must create native Experiments where Mastra can
  represent the run without misleading operators.
- R7. Pairwise search quality outcomes should be transformed into native Scorer
  output, including enough score, reason, and safe metadata for operators to
  distinguish wins, losses, ties, both-irrelevant cases, judge disagreements,
  judge failures, and search failures.
- R8. Native Experiments must preserve the search-eval context operators need:
  baseline identity, prompt source, locale mix, search configuration, generated
  or promoted state, cost, timing, calibration status, and report linkage when
  applicable.
- R9. Native comparison and overview signals should be used when they preserve
  the search-eval meaning.
- R10. If native Mastra fields cannot express a search-specific detail cleanly,
  the native record must still expose a meaning-preserving summary and point to
  the sanitized backing detail.

**Reproducibility and idempotency**

- R11. Native Evaluation sync and experiment creation must be idempotent:
  rerunning sync should update or reuse stable records rather than duplicating
  Datasets, Scorers, Experiments, or items.
- R12. Local, staging, and production must use the same code path, changing only
  environment-specific configuration such as Admin URLs, bearer keys, Mastra
  storage, database URLs, artifact roots, and environment labels.
- R13. A fresh local developer environment must be able to create and inspect
  the expected native Evaluation records in Studio without manual database
  writes or hand-edited native records.
- R14. The local development path must document required Admin and Mastra
  configuration, commands, expected native records, and the idempotency check.

**Safety boundaries**

- R15. Mastra must not move into the live search request path.
- R16. Live query embedding generation and live search orchestration must remain
  Admin-owned.
- R17. Mastra must read and mutate Admin-owned search-eval state only through
  authenticated Admin HTTP contracts.
- R18. Native Evaluation records must not expose raw sensitive trace text,
  vectors, provider secrets, bearer tokens, unsanitized source payloads, or raw
  production trace details.
- R19. Existing leaf workflows for eval query generation, candidate review, and
  offline search eval should remain independently usable unless implementation
  evidence proves a safer and clearer consolidation.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R6, R8.** Given a native search eval run has completed,
  when an operator opens Mastra Studio's Evaluation area, they can identify the
  Dataset, Scorer, Experiment, headline result, failure categories, and backing
  report reference without opening filesystem JSON first.
- AE2. **Covers R3, R4, R18.** Given Admin has seed prompts, promoted
  candidates, pending generated candidates, and trace-derived rows, when Mastra
  syncs native Datasets, only seed and sanitized promoted truth appear as native
  Dataset items.
- AE3. **Covers R7, R10.** Given a pairwise comparison produces a judge
  disagreement or both-irrelevant result, when it is written to native
  Evaluation, Studio does not collapse it into an ordinary tie or green score
  without explanation.
- AE4. **Covers R11, R12, R13.** Given a developer runs native sync twice in a
  fresh local environment, when they inspect Studio after the second run, the
  expected records are still singular and updated rather than duplicated.
- AE5. **Covers R15, R16, R17.** Given a live user performs a public search,
  when feat-142 is enabled, Admin continues to handle live search behavior and
  Mastra's native Evaluation suite remains offline.

---

## Success Criteria

- Operators can use native Mastra Evaluation as the first stop for search eval
  understanding.
- Custom JSON artifacts are useful for audit and full-fidelity backing detail,
  but they are not the primary operator UX.
- Native Datasets contain only seed and sanitized promoted truth.
- Native Scorers and Experiments preserve the difference between search
  quality, judge uncertainty, provider failure, and search failure.
- Local reproduction proves the same sync, run, idempotency, and Studio-visible
  record behavior expected in staging and production.
- Feat-141 can use native Evaluation records as its primary evidence source for
  retrieval strategy investigation.

---

## Scope Boundaries

- Do not build a separate custom search-eval suite UI unless native Mastra
  Evaluation cannot represent a required operator concept with meaning intact.
- Do not make filesystem artifact paths the only way to inspect baselines,
  reports, or comparison outcomes.
- Do not promote generated or user-submitted candidates without feat-140 human
  review and sanitization.
- Do not change public search REST or GraphQL response shapes.
- Do not query Admin's database directly from Mastra.
- Do not treat artifact-backed reports as native Evaluation integration unless
  real native records are created.

---

## Dependencies / Assumptions

- Feat-140 provides sanitized promoted truth and a stable native Dataset item
  shape for Mastra to sync.
- The installed Mastra runtime supports native Dataset, Scorer, Experiment, and
  comparison APIs plus Studio routes for those records.
- Admin remains the durable owner of search-eval review, sanitization, raw trace
  retention, and live search behavior.
- Some search-specific report detail may remain too rich for native Evaluation,
  but native records should carry enough summary and linkage that operators do
  not start in JSON.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- Verify exactly how native Scorers should encode pairwise win/loss/tie,
  both-irrelevant, judge-disagreement, judge-failure, and search-failure
  categories without losing operator meaning.
- Decide how stable native record keys, names, and versions should be derived
  for local, staging, and production.
- Confirm the smallest safe metadata payload that native Experiments should
  carry while keeping raw trace and provider details out.
- Verify whether native comparison and Overview APIs can express the desired
  roll-up directly, or whether the system should attach a native summary plus
  backing report link.

---

## Sources / Research

- `docs/roadmap/content-discovery/feat-142-mastra-search-eval-suite-operator-workflow.md`
- `docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md`
- `docs/roadmap/content-discovery/feat-140-search-eval-human-promotion-regression-gates.md`
- `docs/roadmap/content-discovery/feat-141-mastra-retrieval-strategy-investigation.md`
- `docs/solutions/architecture-patterns/mastra-native-evaluation-search-eval-bridge-pattern.md`
- `docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md`
- `apps/mastra/AGENTS.md`
- `apps/admin/AGENTS.md`
