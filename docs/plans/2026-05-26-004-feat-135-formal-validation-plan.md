---
title: Formal Validation for feat-135 Mastra Embedding Hardening
type: feat
status: completed
date: 2026-05-26
origin: docs/plans/2026-05-26-003-feat-mastra-embedding-workflow-hardening-plan.md
roadmap: docs/roadmap/content-discovery/feat-135-mastra-embedding-workflow-hardening.md
---

# Formal Validation for feat-135 Mastra Embedding Hardening

## Summary

Validate the completed feat-135 hardening work in a running local environment,
exercise Mastra Studio with the embedded browser, run a real-data embedding
smoke, and then complete a formal Compound Engineering review and compound pass.
This plan does not expand the feature scope; it proves the branch behaves as
intended before PR creation.

## Problem Frame

The implementation already consolidated provider validation, Admin ingest
client behavior, generation mode semantics, Admin outcome language, retired
legacy Manager/Admin scaffolding, and updated durable docs. The remaining risk
is that unit tests do not prove the developer environment, Mastra Studio
workflow discovery, service-route auth scoping, or live provider integration are
healthy together.

## Requirements

- R1. Start the relevant local developer environment for Manager and Mastra
  without requiring CMS or Strapi services.
- R2. Use the embedded browser to click through Mastra Studio and verify the
  workflow surface for transcript, scene, and experience embedding workflows.
- R3. Verify Mastra service-bearer auth remains scoped to explicit
  `/forge-*` service routes so built-in Studio workflow calls are not blocked.
- R4. Run a real-data embedding smoke that exercises the hardened provider
  validation path with representative source text.
- R5. If runtime validation exposes a code defect, use `ce-debug` before
  changing implementation.
- R6. Re-run formal Compound Engineering review and compound phases after
  validation.

## Scope Boundaries

- Do not add new embedding workflow behavior unless validation proves a defect.
- Do not change public REST or GraphQL response shapes.
- Do not add CMS support or depend on CMS services.
- Do not enter external authentication credentials during browser validation.
- Do not create a generic Admin embedding ingest endpoint.

## Context & Research

- `docs/plans/2026-05-26-003-feat-mastra-embedding-workflow-hardening-plan.md`
  is the implementation plan and remains the source of truth for feature scope.
- `docs/roadmap/content-discovery/feat-135-mastra-embedding-workflow-hardening.md`
  requires the post-migration hardening pass and focused validation.
- `apps/mastra/src/mastra/workflows/` contains the three workflows to verify in
  Studio.
- `apps/mastra/src/services/embedding-provider.ts` contains the shared provider
  validation path to exercise with real text.
- `apps/mastra/src/mastra/index.ts` and Mastra middleware must keep bearer auth
  scoped to explicit service routes, not Studio's built-in workflow APIs.
- Manager authenticated product pages may redirect to external Auth in local
  browser runs. If that happens, treat it as an environment limitation unless a
  code defect is found in the changed Manager surfaces.

## Key Technical Decisions

- Validate Mastra Studio directly because workflow failures and workflow
  discovery are operator-facing Mastra responsibilities.
- Use a small provider smoke with representative text rather than a broad
  backfill, keeping provider cost and data mutation risk low.
- Use HTTP checks for service auth boundaries because they prove the Studio API
  contract more directly than static review.
- Keep Admin database mutation out of this pass unless a defect requires it; the
  feature did not include Prisma schema changes and focused Admin contract tests
  already cover storage behavior.

## Implementation Units

### U1. Local Environment and Browser Studio Check

**Goal:** Bring up the local services needed for workflow validation and verify
Mastra Studio renders and exposes the three embedding workflows.

**Requirements:** R1, R2, R3

**Dependencies:** none

**Files:** Test expectation: none -- this unit validates runtime behavior and
does not require code changes unless a defect is found.

**Approach:** Start Mastra locally with a scoped service bearer key and open
Studio in the embedded browser. Click the Workflows area and confirm transcript,
scene, and experience embedding workflows are discoverable. Start Manager in
mock mode to confirm the local environment can boot without CMS, while avoiding
external Auth credential entry.

**Patterns to follow:** `apps/mastra/AGENTS.md`,
`docs/solutions/integration-issues/mastra-studio-api-auth-guard.md`

**Test scenarios:**

- Mastra Studio root loads without framework error overlays.
- The Workflows page lists transcript, scene, and experience embedding
  workflows.
- Built-in workflow API calls are not rejected by the service bearer middleware.
- Manager mock-mode dev server starts without CMS dependencies.

**Verification:** Embedded browser screenshot or DOM evidence shows the Studio
workflow surface, and HTTP checks show Studio workflow APIs are not blocked by
service-route auth.

### U2. Real-Data Provider Smoke

**Goal:** Exercise the shared provider validation path with representative
source text and real provider output when local credentials are available.

**Requirements:** R4, R5

**Dependencies:** U1

**Files:** Test expectation: none -- this unit uses runtime smoke commands. If a
defect is found, add or update the focused service/workflow tests that cover the
defect.

**Approach:** Use the Mastra package provider helper with a short representative
piece of content. Confirm returned vector count, dimensions, and finite numeric
values. If live provider credentials are unavailable, record the environment
gap and run the same validation path with deterministic real-shaped vectors
through the workflow helper.

**Patterns to follow:** `apps/mastra/src/services/embedding-provider.test.ts`,
`apps/mastra/src/mastra/workflows/transcript-embedding.ts`

**Test scenarios:**

- One representative text item returns exactly one vector.
- The vector has the expected provider dimensions.
- Every returned vector value is finite.
- Provider validation throws if count, dimensions, or numeric values are bad.

**Verification:** The smoke output records count, dimensions, finite-value
status, and model/provider metadata without printing secrets.

### U3. Focused Regression Gate

**Goal:** Re-run the focused validation needed after any runtime validation or
debugging.

**Requirements:** R5

**Dependencies:** U1, U2

**Files:** Test expectation: use existing tests unless validation requires code
changes.

**Approach:** If validation discovers no code defect, rely on the already passed
focused package gates and run only additional checks necessary to prove runtime
health. If a code defect is fixed, re-run the affected package tests,
typecheck, lint, and `git diff --check`.

**Patterns to follow:** The verification section in
`docs/plans/2026-05-26-003-feat-mastra-embedding-workflow-hardening-plan.md`

**Test scenarios:**

- Mastra test/typecheck/lint remain green for provider/workflow changes.
- Admin focused ingest/search tests remain green for storage contract changes.
- Manager test/typecheck/lint remain green after removal of legacy scaffolding.

**Verification:** Validation commands complete successfully or failures are
documented with the exact blocker.

### U4. Formal CE Review and Compound

**Goal:** Complete the required formal Compound Engineering review and durable
learning pass after runtime validation.

**Requirements:** R6

**Dependencies:** U1, U2, U3

**Files:**

- Modify if needed:
  `docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md`
- Modify if needed:
  `docs/plans/2026-05-26-004-feat-135-formal-validation-plan.md`

**Approach:** Run the formal Compound Engineering code-review skill against the
current branch diff. Resolve any actionable findings that are in scope. Then run
the formal compound skill to ensure durable ownership and validation learnings
are captured or refreshed.

**Patterns to follow:** `docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md`

**Test scenarios:** Test expectation: none -- this unit is process validation.
Any code changes made from review findings must carry their own focused tests.

**Verification:** The review phase reports no unresolved blocking findings, the
compound phase reports whether it created or refreshed documentation, and this
plan status is moved to `completed`.

## Verification

- Mastra Studio is opened in the embedded browser and the Workflows page is
  checked.
- Mastra built-in workflow API access is checked without bearer auth.
- A representative real-data provider validation smoke is run, or a credentials
  blocker is documented with deterministic fallback coverage.
- Any discovered code defect is debugged with `ce-debug` and validated with
  focused tests.
- Formal `ce-code-review` is completed as the `ce:review` phase.
- Formal `ce-compound` is completed.

## Outcome

- Mastra Studio was opened in the embedded browser and showed transcript,
  scene, and experience embedding workflows.
- Mastra built-in workflow APIs remained reachable without the service bearer,
  while explicit `/forge-*` routes still required the configured bearer.
- A live provider smoke returned one finite 1536-dimensional vector for
  representative text and rejected a bad provider-count shape.
- Formal review findings were fixed with additional focused coverage for
  duplicate/non-finite provider results, retryable Admin ingest failures, and
  model-upgrade outcomes.
- Formal compound refreshed
  `docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md`.
