---
title: "fix: Refresh yt-mapper v2 rollout docs"
type: "fix"
date: "2026-07-07"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
roadmap: "docs/roadmap/content-discovery/feat-232-yt-video-mapper-arbitrary-raw-clip-matching.md"
---

# fix: Refresh yt-mapper v2 rollout docs

## Goal Capsule

| Field             | Value                                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective         | Merge the updated yt-video-mapper v2 rollout documentation and continue monitoring the production v2 index backfill.                                                                                                                            |
| Authority         | User request on 2026-07-07, production Railway state, `docs/solutions/architecture-patterns/mapper-arbitrary-raw-clip-fingerprinting-pattern.md`, and `docs/roadmap/content-discovery/feat-232-yt-video-mapper-arbitrary-raw-clip-matching.md`. |
| Execution profile | Lightweight documentation merge plus operational monitoring. Code hotfixes are out of this plan unless monitoring reveals a systemic failure.                                                                                                   |
| Stop conditions   | Stop before code changes if index failures appear systemic; create a separate hotfix PR through the formal CE pipeline.                                                                                                                         |
| Tail ownership    | `ce-work` validates and merges docs; monitoring continues after merge; any hotfix restarts the formal pipeline.                                                                                                                                 |

## Product Contract

### Summary

The previous compound docs captured the v2 visual fingerprint architecture but became stale after production was actually switched to `official-media-signature-v2`, a live v2 smoke passed, and the v2 backfill started. The docs need to reflect the real rollout state and the reindex upsert/skip behavior.

### Problem Frame

Future agents should not read the solution note and believe v2 reindexing is still only a future step. They also need the indexing nuance: `index:media` writes through upsert, but normal reruns skip variants already indexed for the same algorithm, so they are resumable rather than forced refreshes.

### Requirements

- R1. Update the solution note to reflect production v2 activation, live v2 raw/multipart smoke, and the backfill state.
- R2. Document that v2 rows coexist with v1 rows and that production must be restarted or redeployed after changing the Railway algorithm variable.
- R3. Document the upsert key and the normal rerun skip behavior so future extractor changes do not assume automatic refresh.
- R4. Update the roadmap ticket to distinguish completed first v2 smoke from broader follow-up evaluation and smoke coverage.
- R5. Validate markdown formatting and frontmatter parser safety.
- R6. Merge the documentation update through a PR after CI passes.
- R7. Monitor the v2 index run after merge and only open a hotfix if failures indicate a systemic code or operational issue.

## Planning Contract

### Key Technical Decisions

- KTD1. Keep this PR documentation-only. The production API is already live on v2 and the indexer is running, so code changes would expand scope.
- KTD2. Treat isolated FFmpeg timeouts as monitoring data, not immediate hotfix triggers. A hotfix is warranted only if failures cluster around a deterministic bug, unsafe retry behavior, or a backfill-stopping condition.
- KTD3. Keep the v2 rollout docs in the existing compound solution note rather than creating a duplicate learning. The existing note has the same problem, root, and solution shape.

### Scope Boundaries

- In scope: docs updates, validation, PR, merge, and index monitoring.
- Deferred to follow-up work: audio landmarks, temporal consistency, HLS/DASH segment validation, streaming upload storage, production-scale `EXPLAIN`, and broad labeled evaluation.
- Outside this plan: changing matcher/indexer code unless monitoring reveals a systemic production failure.

## Implementation Units

### U1. Refresh compound docs

- **Goal:** Update durable docs to match the final production rollout state.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** None.
- **Files:** `docs/solutions/architecture-patterns/mapper-arbitrary-raw-clip-fingerprinting-pattern.md`, `docs/roadmap/content-discovery/feat-232-yt-video-mapper-arbitrary-raw-clip-matching.md`.
- **Approach:** Fold production v2 activation, v2 smoke, and reindex semantics into the existing architecture-pattern learning and roadmap ticket.
- **Patterns to follow:** `docs/solutions/integration-issues/yt-video-mapper-multipart-upload-empty-complete-polling-contract.md` for concrete production symptom and prevention wording.
- **Test scenarios:** Documentation-only. Confirm the solution note no longer says v2 reindex is only a future step; confirm the roadmap still lists remaining follow-up work.
- **Verification:** Diff is limited to the plan and docs named above.

### U2. Validate docs

- **Goal:** Prove the markdown artifacts are parser-safe and formatted.
- **Requirements:** R5.
- **Dependencies:** U1.
- **Files:** Same as U1 plus this plan file.
- **Approach:** Run the CE frontmatter validator on the solution note and run Prettier over the changed markdown files.
- **Test scenarios:** Documentation-only. Validator must pass; formatter must leave stable output.
- **Verification:** Validation commands exit 0.

### U3. Merge documentation PR

- **Goal:** Land the doc refresh on `main`.
- **Requirements:** R6.
- **Dependencies:** U1, U2.
- **Files:** GitHub PR metadata only.
- **Approach:** Commit the documentation changes, push a branch, open a PR against `JesusFilm/forge`, wait for checks, and squash merge after green CI.
- **Test scenarios:** PR checks cover repository formatting and docs-safe validation gates configured in CI.
- **Verification:** PR is merged and branch state is clean.

### U4. Monitor v2 index backfill

- **Goal:** Keep production indexing under observation after the docs merge.
- **Requirements:** R7.
- **Dependencies:** U3 can merge while monitoring continues.
- **Files:** No repo file changes.
- **Approach:** Poll `mapper_index_run` for the active `official-media-signature-v2` run and inspect `failure_summary` when `variants_failed` increases. Treat isolated URL/FFmpeg timeouts as expected long-tail media failures unless they become systemic.
- **Test scenarios:** Operational check. The run should continue advancing `variants_attempted` and `variants_indexed`; failures should remain bounded and summarized.
- **Verification:** Report current attempted, indexed, failed, signature count, and any failure pattern.

### U5. Gate any hotfix

- **Goal:** Prevent ad hoc production code changes.
- **Requirements:** R7.
- **Dependencies:** U4.
- **Files:** To be determined only if a hotfix is needed.
- **Approach:** If monitoring shows a systemic failure, start a separate formal CE pipeline before code changes, then open a hotfix PR with its own plan, work, review, and compound phases.
- **Test scenarios:** Any hotfix plan must define tests for the observed failure before implementation.
- **Verification:** No hotfix code lands without a formal phase report.

## Verification Contract

| Gate                      | Applies to | Done signal                                                                    |
| ------------------------- | ---------- | ------------------------------------------------------------------------------ |
| CE frontmatter validation | U1, U2     | `mapper-arbitrary-raw-clip-fingerprinting-pattern.md` passes the CE validator. |
| Markdown formatting       | U1, U2     | Prettier reports stable formatting for changed markdown.                       |
| PR checks                 | U3         | GitHub checks pass on the documentation PR.                                    |
| Production monitor        | U4         | Active v2 index run is still running or terminal with understood summary.      |

## Definition of Done

- The doc refresh is merged to `main`.
- The solution note reflects live v2 activation, live v2 smoke, and v2 reindex semantics.
- The roadmap ticket distinguishes completed first smoke from remaining follow-up work.
- The active v2 indexer is monitored and the current status is reported.
- Any systemic indexing failure is handled only through a new formal CE hotfix pipeline.
