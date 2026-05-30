---
status: complete
priority: p2
issue_id: "019"
tags: [code-review, mastra, architecture]
dependencies: ["016"]
---

# Start Real Mastra Subtitle Runs

## Problem Statement

`POST /forge-subtitle-enrichment-runs` currently calls
`launchSubtitleEnrichmentWorkflow(...)` directly instead of creating a real
Mastra workflow run through the registered workflow runtime. As a result, the
custom route returns a synthetic `mastraRunId`, emits prototype callbacks
synchronously, and does not prove that the run exists in Mastra Studio.

## Findings

- `apps/mastra/src/mastra/index.ts` wires the service route to
  `launchSubtitleEnrichmentWorkflow(...)` directly.
- `apps/mastra/src/mastra/workflows/subtitle-enrichment.ts:19`
  exposes a plain function that emits callbacks and returns a synthetic run id.
- `apps/mastra/src/mastra/workflows/subtitle-enrichment.ts:57`
  registers a Mastra step, but the service route does not start that registered
  workflow.
- The PR body and plan already mark Studio run visibility as unproven.

## Proposed Solutions

### Option 1: Launch Through `mastra.getWorkflow(...)`

**Approach:** Have the custom route create/start a Mastra workflow run using the
registered `subtitleEnrichmentWorkflow`, then return the actual run id.

**Pros:**
- Aligns implementation with the app boundary.
- Enables Studio run visibility and runtime storage.
- Keeps callbacks inside workflow execution.

**Cons:**
- Requires adapting current tests to the Mastra runtime API.

**Effort:** Medium

**Risk:** Medium

---

### Option 2: Keep Direct Function But Rename It As A Prototype Launcher

**Approach:** Keep current behavior, but explicitly scope the route as a
prototype and do not claim Mastra run ownership.

**Pros:**
- Low effort.
- Honest about current behavior.

**Cons:**
- Does not satisfy the platform backend requirement.
- Leaves Studio/run proof blocked.

**Effort:** Small

**Risk:** High for the feature goal

## Recommended Action

Use Option 1 before marking the PR ready. The route should return a real Mastra
run id and Studio should show the matching run.

## Technical Details

Affected files:

- `apps/mastra/src/mastra/index.ts`
- `apps/mastra/src/mastra/workflows/subtitle-enrichment.ts`
- `apps/mastra/src/mastra/workflows/subtitle-enrichment.test.ts`

## Resources

- PR: https://github.com/JesusFilm/forge/pull/886
- Related todo: `todos/016-pending-p1-complete-agentic-subtitle-execution-and-smoke.md`

## Acceptance Criteria

- [x] The service route starts a registered Mastra workflow run.
- [x] The response uses the actual Mastra run id or a documented stable mapping.
- [x] Mastra Studio/operator API can show the matching subtitle run.
- [x] Tests prove route-to-workflow runtime wiring, not only direct function
  invocation.

## Work Log

### 2026-05-05 - Review Finding

**By:** Codex

**Actions:**
- Reviewed Mastra route and workflow wiring.
- Confirmed the service route bypasses the registered workflow runtime.

**Learnings:**
- Workflow registration alone is not enough to prove Mastra owns runtime
  execution.

### 2026-05-05 - Runtime Launch Fix

**By:** Codex

**Actions:**
- Changed the subtitle custom route to start `subtitleEnrichmentWorkflow`
  through the Mastra runtime context.
- Kept deterministic run ids with `subtitleEnrichmentRunId(...)` and return the
  started Mastra run id.
- Passed Manager callback dependencies into the registered workflow step.
- Added a Mastra registry test proving the route calls
  `getWorkflow("subtitleEnrichmentWorkflow")`, `createRun(...)`, and
  `startAsync(...)`.
- Smoke tested a running local Mastra server; the subtitle route returned 202
  with `subtitle-enrichment:smoke:job-1:subtitle:fr`.

**Learnings:**
- Mastra custom route handlers expose the runtime via `context.get("mastra")`,
  so the route can remain a thin service boundary while Studio owns the run.
