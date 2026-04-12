import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildInitialSteps, FORGE_WORKFLOW_STEPS } from "@/lib/workflow-steps"

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
})
