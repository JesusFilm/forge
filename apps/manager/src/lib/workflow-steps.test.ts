import { describe, expect, it } from "vitest"
import { buildInitialSteps } from "@/lib/workflow-steps"

describe("buildInitialSteps", () => {
  it("includes mux_upload in the persisted job steps", () => {
    expect(buildInitialSteps().map((step) => step.name)).toContain("mux_upload")
  })
})
