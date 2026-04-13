import { describe, expect, it } from "vitest"
import { buildInitialSteps } from "@/lib/workflow-steps"

describe("buildInitialSteps", () => {
  it("includes mux_upload in the persisted job steps", () => {
    expect(buildInitialSteps().map((step) => step.name)).toContain("mux_upload")
  })

  it("appends the skipped theology validation and Bible quotes placeholder after mux_upload", () => {
    const steps = buildInitialSteps()
    const finalStep = steps.at(-1)
    const previousStep = steps.at(-2)

    expect(previousStep?.name).toBe("mux_upload")
    expect(finalStep).toMatchObject({
      name: "theology_validation_bible_quotes",
      status: "skipped",
      retries: 0,
    })
  })
})
