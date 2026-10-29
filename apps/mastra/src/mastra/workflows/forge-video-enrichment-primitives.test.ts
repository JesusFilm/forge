import { createStep, createWorkflow } from "@mastra/core/workflows"
import { describe, expect, it } from "vitest"
import { z } from "zod"

const PrimitiveInputSchema = z
  .object({
    title: z.string(),
    scenes: z.array(z.string()),
  })
  .strict()

const TranscriptOutputSchema = z
  .object({
    transcriptId: z.string(),
    wordCount: z.number(),
  })
  .strict()

const SceneOutputSchema = z
  .object({
    sceneCount: z.number(),
    labels: z.array(z.string()),
  })
  .strict()

const ParallelOutputSchema = z
  .object({
    branchKeys: z.array(z.string()),
    transcriptId: z.string(),
    sceneCount: z.number(),
  })
  .strict()

const LanguagePlanSchema = z
  .object({
    languageIds: z.array(z.string()),
  })
  .strict()

const LanguageResultSchema = z
  .object({
    languageId: z.string(),
  })
  .strict()

const ParallelBranchInputSchema = z
  .object({
    "build-transcript": TranscriptOutputSchema,
    "inspect-scenes": SceneOutputSchema,
  })
  .strict()

const buildTranscriptStep = createStep({
  id: "build-transcript",
  inputSchema: PrimitiveInputSchema,
  outputSchema: TranscriptOutputSchema,
  execute: async ({ inputData }) => ({
    transcriptId: `transcript:${inputData.title}`,
    wordCount: inputData.title.split(/\s+/).length,
  }),
})

const inspectScenesStep = createStep({
  id: "inspect-scenes",
  inputSchema: PrimitiveInputSchema,
  outputSchema: SceneOutputSchema,
  execute: async ({ inputData }) => ({
    sceneCount: inputData.scenes.length,
    labels: inputData.scenes.map((scene) => scene.toUpperCase()),
  }),
})

const joinParallelBranchesStep = createStep({
  id: "join-parallel-branches",
  inputSchema: ParallelBranchInputSchema,
  outputSchema: ParallelOutputSchema,
  execute: async ({ inputData }) => ({
    branchKeys: Object.keys(inputData).sort(),
    transcriptId: inputData["build-transcript"].transcriptId,
    sceneCount: inputData["inspect-scenes"].sceneCount,
  }),
})

const planLanguagesStep = createStep({
  id: "plan-languages",
  inputSchema: LanguagePlanSchema,
  outputSchema: z.array(z.string()),
  execute: async ({ inputData }) => inputData.languageIds,
})

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("forge video enrichment Mastra primitives", () => {
  it("keys .parallel output by branch step id", async () => {
    const workflow = createWorkflow({
      id: "forge-video-enrichment-parallel-primitive-spike",
      inputSchema: PrimitiveInputSchema,
      outputSchema: ParallelOutputSchema,
    })
      .parallel([buildTranscriptStep, inspectScenesStep])
      .then(joinParallelBranchesStep)
      .commit()

    const run = await workflow.createRun({
      runId: "run-forge-video-enrichment-parallel-primitive-spike",
    })
    const result = await run.start({
      inputData: {
        title: "Life of Jesus",
        scenes: ["birth", "ministry", "resurrection"],
      },
    })

    expect(result.status).toBe("success")
    if (result.status !== "success") {
      throw new Error(`Unexpected workflow status: ${result.status}`)
    }
    expect(result.result).toEqual({
      branchKeys: ["build-transcript", "inspect-scenes"],
      transcriptId: "transcript:Life of Jesus",
      sceneCount: 3,
    })
  })

  it("honors .foreach concurrency caps", async () => {
    let activeCount = 0
    let maxActiveCount = 0

    const enrichLanguageStep = createStep({
      id: "enrich-language",
      inputSchema: z.string(),
      outputSchema: LanguageResultSchema,
      execute: async ({ inputData }) => {
        activeCount += 1
        maxActiveCount = Math.max(maxActiveCount, activeCount)

        await wait(10)

        activeCount -= 1
        return { languageId: inputData }
      },
    })

    const workflow = createWorkflow({
      id: "forge-video-enrichment-foreach-primitive-spike",
      inputSchema: LanguagePlanSchema,
      outputSchema: z.array(LanguageResultSchema),
    })
      .then(planLanguagesStep)
      .foreach(enrichLanguageStep, { concurrency: 2 })
      .commit()

    const run = await workflow.createRun({
      runId: "run-forge-video-enrichment-foreach-primitive-spike",
    })
    const result = await run.start({
      inputData: { languageIds: ["en", "es", "fr", "pt"] },
    })

    expect(result.status).toBe("success")
    if (result.status !== "success") {
      throw new Error(`Unexpected workflow status: ${result.status}`)
    }
    expect(result.result).toEqual([
      { languageId: "en" },
      { languageId: "es" },
      { languageId: "fr" },
      { languageId: "pt" },
    ])
    expect(maxActiveCount).toBeGreaterThan(1)
    expect(maxActiveCount).toBeLessThanOrEqual(2)
  })
})

it("executes a nested workflow and settles explicit parallel failure envelopes", async () => {
  const schema = z.object({ value: z.string() })
  const events: string[] = []
  const child = createWorkflow({
    id: "enrichment-child-spike",
    inputSchema: schema,
    outputSchema: schema,
  })
    .then(
      createStep({
        id: "child-work",
        inputSchema: schema,
        outputSchema: schema,
        execute: async ({ inputData }) => {
          events.push("child")
          return inputData
        },
      }),
    )
    .commit()
  const settled = z.object({ ok: z.boolean() })
  const fast = createStep({
    id: "settled-failure",
    inputSchema: schema,
    outputSchema: settled,
    execute: async () => ({ ok: false }),
  })
  const slow = createStep({
    id: "settled-success",
    inputSchema: schema,
    outputSchema: settled,
    execute: async () => {
      await wait(5)
      events.push("sibling-settled")
      return { ok: true }
    },
  })
  const parent = createWorkflow({
    id: "enrichment-nested-settlement-spike",
    inputSchema: schema,
    outputSchema: settled,
  })
    .then(child)
    .parallel([fast, slow])
    .then(
      createStep({
        id: "aggregate-after-settlement",
        inputSchema: z.object({
          "settled-failure": settled,
          "settled-success": settled,
        }),
        outputSchema: settled,
        execute: async ({ inputData }) => {
          events.push("aggregate")
          return { ok: Object.values(inputData).every((result) => result.ok) }
        },
      }),
    )
    .commit()
  const run = await parent.createRun({ runId: "nested-enrichment-run" })
  const result = await run.start({ inputData: { value: "fixture" } })
  expect(result.status).toBe("success")
  expect(events).toEqual(["child", "sibling-settled", "aggregate"])
  if (result.status === "success") expect(result.result).toEqual({ ok: false })
})
