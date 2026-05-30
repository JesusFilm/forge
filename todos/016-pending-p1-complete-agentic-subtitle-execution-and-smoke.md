---
status: pending
priority: p1
issue_id: "016"
tags: [mastra, manager, subtitle-enrichment, smoke-test]
dependencies: []
---

# Complete Mastra Subtitle Execution And Smoke Proof

## Problem Statement

The first Mastra subtitle enrichment implementation adds the Manager-to-Mastra
route, Mastra workflow registration, feature flag, Manager callback ingestion,
and prototype workflow progress events. It does not yet perform real subtitle
transcription, target subtitle translation artifact generation, or Mux subtitle
publication from inside Mastra.

The required full user smoke is also incomplete: the branch has HTTP/browser
proof for Mastra health and anonymous API rejection, but not a Manager Coverage
to job detail browser flow or Mastra Studio run visibility proof.

## Findings

- `apps/mastra/src/mastra/workflows/subtitle-enrichment-workflow.ts` currently
  emits prototype workflow events for transcription, translation, and
  `mux_upload`.
- Manager callback ingestion is covered by tests, and Mastra-to-Manager event
  delivery was smoke-tested against a local stub callback server.
- Screenshots saved under `output/playwright/` prove Mastra health and
  unauthorized built-in API behavior.
- Real artifact creation and Mux publication remain unimplemented and should not
  be treated as shipped.

## Proposed Solutions

### Option 1: Extract Pure Subtitle Runtime Primitives

**Approach:** Move the provider-neutral transcription, translation artifact,
and Mux subtitle publication primitives into a shared package or Mastra-owned
module, then call them from Mastra steps.

**Pros:**
- Keeps Manager as a consumer/control plane.
- Avoids cross-importing Manager internals.
- Enables focused Mastra workflow tests for each artifact step.

**Cons:**
- Requires careful extraction from existing Manager workflow code.
- Needs artifact compatibility tests to avoid job detail regressions.

**Effort:** 1-2 days

**Risk:** Medium

---

### Option 2: Keep Execution In Manager Temporarily

**Approach:** Let Mastra orchestrate but call a Manager execution endpoint for
subtitle actions.

**Pros:**
- Faster initial smoke path.
- Reuses current Manager runtime code with less extraction.

**Cons:**
- Violates the intended platform boundary.
- Keeps Manager as workflow host in practice.

**Effort:** 0.5-1 day

**Risk:** High

## Recommended Action

Use Option 1. Extract only the pure runtime pieces needed for subtitle-only V1,
keep canonical job updates in Manager callbacks, and add browser proof only
after real artifact and Mux behavior is wired.

## Technical Details

Affected files:

- `apps/mastra/src/mastra/workflows/subtitle-enrichment-workflow.ts`
- `apps/mastra/src/mastra/workflows/subtitle-enrichment-workflow.test.ts`
- `apps/manager/src/workflows/videoEnrichment.ts`
- `apps/manager/src/services/subtitleTranslation/index.ts`
- `apps/manager/src/services/mux-sync/index.ts`
- `apps/manager/src/app/api/enrich/route.ts`

Related proof files:

- `output/playwright/mastra-subtitle-health-smoke.png`
- `output/playwright/mastra-subtitle-unauthorized-smoke.png`

## Resources

- Plan: `docs/plans/2026-05-05-feat-mastra-subtitle-enrichment-workflow-plan.md`
- Roadmap: `docs/roadmap/media-generation/feat-116-mastra-subtitle-enrichment-backend.md`

## Acceptance Criteria

- [ ] Mastra workflow performs real source transcription or reuses approved
  source subtitle artifacts.
- [ ] Mastra workflow generates target subtitle artifacts using the current
  Manager-compatible artifact keys and metadata shape.
- [ ] Mastra workflow publishes subtitles to Mux or records a compatible Mux
  sync failure report without masking prior successful artifacts.
- [ ] Manager job detail receives real Mastra callback events and no
  non-subtitle steps are left pending.
- [ ] Browser smoke proves Manager Coverage to job detail flow.
- [ ] Browser or HTTP proof verifies the matching Mastra workflow run is visible
  behind operator auth.
- [ ] Anonymous Studio/API rejection proof remains in place.

## Work Log

### 2026-05-05 - Follow-Up Captured

**By:** Codex

**Actions:**
- Captured the remaining real execution and user-smoke work after implementing
  the backend bridge and prototype event flow.
- Linked the todo from the implementation plan so the incomplete Phase 4 and
  Phase 6 items stay visible.

**Learnings:**
- The platform boundary can be tested with contracts and event callbacks before
  moving provider-specific subtitle execution into Mastra.
- The work should not be called complete until real artifact and Mux behavior is
  proven from a Manager user flow.
