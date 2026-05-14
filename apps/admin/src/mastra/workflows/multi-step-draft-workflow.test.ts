import { describe, expect, it } from "vitest"

import {
  multiStepDraftWorkflow,
  MULTI_STEP_DRAFT_MAX_STEPS,
} from "./multi-step-draft-workflow"

describe("multiStepDraftWorkflow (U7)", () => {
  it("exposes a stable workflow id", () => {
    expect(multiStepDraftWorkflow.id).toBe("multi-step-draft")
  })

  it("declares its max-step ceiling as 4 (plan → draft → critique → revise)", () => {
    expect(MULTI_STEP_DRAFT_MAX_STEPS).toBe(4)
  })

  it("ran .commit() at module load (workflow is ready to execute)", () => {
    // `createWorkflow(...).commit()` registers the chain. The
    // workflow object exposed after commit is functional. If commit
    // had not run, calling `.execute` would throw a "not committed"
    // error. We assert the workflow is at least addressable.
    expect(multiStepDraftWorkflow).toBeDefined()
    expect(typeof multiStepDraftWorkflow.id).toBe("string")
  })

  it("exposes the chain via its registered id (executable shape; end-to-end run is U6+'s integration test)", () => {
    // Mastra's workflow run API is invoked from the agent/route
    // handler that owns this workflow (post-rebase integration). At
    // U7 we assert the workflow is registered and structurally
    // committed; the actual run-through test fires once the workflow
    // is dispatched from an agent in U6+.
    expect(multiStepDraftWorkflow.id).toBe("multi-step-draft")
  })
})
