import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildInitialSteps,
  formatStepName,
  FORGE_WORKFLOW_STEPS,
} from "@/lib/workflow-steps"

describe("buildInitialSteps", () => {
  it("uses the canonical persisted Forge workflow step inventory", () => {
    expect(FORGE_WORKFLOW_STEPS).toEqual([
      "transcription",
      "translation",
      "chapters",
      "metadata",
      "embeddings",
      "mux_upload",
      "audio_cleanup",
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

  it("keeps the CMS job-step enum aligned with persisted manager steps", () => {
    const cmsJobStepSchema = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "..",
          "cms",
          "src",
          "components",
          "enrichment",
          "job-step.json",
        ),
        "utf8",
      ),
    ) as {
      attributes?: { name?: { enum?: string[] } }
    }
    const cmsStepNames = cmsJobStepSchema.attributes?.name?.enum ?? []

    expect(cmsStepNames).toEqual(FORGE_WORKFLOW_STEPS)
  })

  it("keeps the generated GraphQL contract aligned with persisted manager steps", () => {
    const graphqlEnv = readFileSync(
      join(
        process.cwd(),
        "..",
        "..",
        "packages",
        "graphql",
        "src",
        "graphql-env.d.ts",
      ),
      "utf8",
    )

    for (const stepName of FORGE_WORKFLOW_STEPS) {
      expect(graphqlEnv).toContain(`'${stepName}'`)
    }
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

describe("formatStepName", () => {
  it("preserves SEO acronym casing", () => {
    expect(formatStepName("seo_improvements")).toBe("SEO Improvements")
  })
})
