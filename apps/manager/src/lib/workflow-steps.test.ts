import { describe, expect, it } from "vitest"
import { buildInitialSteps, formatStepName } from "@/lib/workflow-steps"

describe("buildInitialSteps", () => {
  it("includes the SEO placeholder as the final persisted job step", () => {
    expect(buildInitialSteps().map((step) => step.name)).toEqual([
      "transcription",
      "translation",
      "chapters",
      "metadata",
      "embeddings",
      "mux_upload",
      "seo_improvements",
    ])
  })
})

describe("formatStepName", () => {
  it("preserves SEO acronym casing", () => {
    expect(formatStepName("seo_improvements")).toBe("SEO Improvements")
  })
})
