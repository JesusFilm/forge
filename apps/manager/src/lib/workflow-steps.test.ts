import { describe, expect, it } from "vitest"
import {
  buildInitialSteps,
  buildShortsInitialSteps,
  buildSmartCropInitialSteps,
  formatStepName,
  FORGE_WORKFLOW_STEPS,
  resetShortsStepsForLaunch,
} from "@/lib/workflow-steps"
import type { JobStepState } from "@/types/job"

describe("buildInitialSteps", () => {
  it("uses the canonical persisted Forge workflow step inventory", () => {
    expect(FORGE_WORKFLOW_STEPS).toEqual([
      "audio_cleanup",
      "transcription",
      "structured_transcript",
      "translation",
      "chapters",
      "metadata",
      "embeddings",
      "mux_upload",
      "theology_validation_bible_quotes",
      "seo_improvements",
    ])
    expect(buildInitialSteps().map((step) => step.name)).toEqual(
      FORGE_WORKFLOW_STEPS,
    )
  })

  it("includes mux_upload in the persisted job steps", () => {
    expect(buildInitialSteps().map((step) => step.name)).toContain("mux_upload")
  })

  it("includes audio cleanup in the persisted job steps", () => {
    expect(buildInitialSteps().map((step) => step.name)).toContain(
      "audio_cleanup",
    )
  })

  it("includes the SEO placeholder as the final persisted job step", () => {
    expect(buildInitialSteps().at(-1)?.name).toBe("seo_improvements")
  })

  it("appends skipped placeholders after audio cleanup with SEO last", () => {
    const steps = buildInitialSteps()
    const finalStep = steps.at(-1)
    const previousStep = steps.at(-2)

    expect(previousStep).toMatchObject({
      name: "theology_validation_bible_quotes",
      status: "skipped",
      retries: 0,
    })
    expect(finalStep).toMatchObject({
      name: "seo_improvements",
      status: "skipped",
      retries: 0,
    })
  })
})

describe("buildSmartCropInitialSteps", () => {
  it("builds the canonical step inventory, all pending", () => {
    const steps = buildSmartCropInitialSteps("canonical")
    expect(steps.map((step) => step.name)).toEqual([
      "smart_crop_fingerprint",
      "smart_crop_plan",
      "smart_crop_preview_render",
      "smart_crop_qa",
    ])
    expect(steps.every((step) => step.status === "pending")).toBe(true)
    expect(steps.every((step) => step.retries === 0)).toBe(true)
  })

  it("builds the localized step inventory, all pending", () => {
    const steps = buildSmartCropInitialSteps("localized")
    expect(steps.map((step) => step.name)).toEqual([
      "smart_crop_fingerprint",
      "smart_crop_align",
      "smart_crop_preview_render",
      "smart_crop_qa",
      "smart_crop_render",
      "smart_crop_mux_output",
    ])
    expect(steps.every((step) => step.status === "pending")).toBe(true)
  })

  it("does not change the enrichment step inventory", () => {
    expect(FORGE_WORKFLOW_STEPS).not.toContain("smart_crop_fingerprint")
  })
})

describe("buildShortsInitialSteps", () => {
  it("builds the prepare inventory, all pending", () => {
    const steps = buildShortsInitialSteps("prepare")
    expect(steps.map((step) => step.name)).toEqual(["shorts_prepare"])
    expect(steps.every((step) => step.status === "pending")).toBe(true)
    expect(steps.every((step) => step.retries === 0)).toBe(true)
  })

  it("builds the render inventory, all pending", () => {
    const steps = buildShortsInitialSteps("render")
    expect(steps.map((step) => step.name)).toEqual([
      "shorts_render",
      "shorts_mux_output",
    ])
    expect(steps.every((step) => step.status === "pending")).toBe(true)
  })

  it("does not change the enrichment step inventory", () => {
    expect(FORGE_WORKFLOW_STEPS).not.toContain("shorts_prepare")
  })
})

describe("resetShortsStepsForLaunch", () => {
  const completedPrepare: JobStepState = {
    name: "shorts_prepare",
    status: "completed",
    retries: 0,
    startedAt: "2026-06-11T00:00:00.000Z",
    finishedAt: "2026-06-11T00:05:00.000Z",
  }

  it("appends fresh render steps on the first render launch", () => {
    const steps = resetShortsStepsForLaunch([completedPrepare], "render")
    expect(steps.map((step) => [step.name, step.status])).toEqual([
      ["shorts_prepare", "completed"],
      ["shorts_render", "pending"],
      ["shorts_mux_output", "pending"],
    ])
  })

  it("replaces render steps in place on re-render (no duplicate rows)", () => {
    const steps = resetShortsStepsForLaunch(
      [
        completedPrepare,
        { name: "shorts_render", status: "completed", retries: 1 },
        {
          name: "shorts_mux_output",
          status: "failed",
          retries: 0,
          error: "mux_output_errored",
        },
      ],
      "render",
    )

    expect(steps.map((step) => [step.name, step.status])).toEqual([
      ["shorts_prepare", "completed"],
      ["shorts_render", "pending"],
      ["shorts_mux_output", "pending"],
    ])
    expect(steps.filter((step) => step.name === "shorts_render")).toHaveLength(
      1,
    )
    expect(
      steps.find((step) => step.name === "shorts_mux_output")?.error,
    ).toBeUndefined()
  })

  it("replaces the prepare step at the head, preserving render history", () => {
    const steps = resetShortsStepsForLaunch(
      [
        { name: "shorts_prepare", status: "failed", retries: 0, error: "boom" },
        { name: "shorts_render", status: "completed", retries: 0 },
      ],
      "prepare",
    )

    expect(steps.map((step) => [step.name, step.status])).toEqual([
      ["shorts_prepare", "pending"],
      ["shorts_render", "completed"],
    ])
  })
})

describe("formatStepName", () => {
  it("preserves SEO acronym casing", () => {
    expect(formatStepName("seo_improvements")).toBe("SEO Improvements")
  })

  it("renders Smart Crop QA with the acronym preserved", () => {
    expect(formatStepName("smart_crop_qa")).toBe("Smart Crop QA")
  })

  it("renders other smart-crop steps via the generic splitter", () => {
    expect(formatStepName("smart_crop_preview_render")).toBe(
      "Smart Crop Preview Render",
    )
  })
})
