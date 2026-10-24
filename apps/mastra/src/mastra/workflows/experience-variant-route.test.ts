import { describe, expect, it } from "vitest"

import type { DraftExperience } from "@forge/experience-schema"

import {
  handleExperienceVariantRouteRequest,
  type DraftWorkflowMastra,
} from "./experience-variant-route"

const SERVICE_KEYS = ["test-service-key"] as const
const AUTH = "Bearer test-service-key"

const VALID_DRAFT: DraftExperience = {
  title: "Easter, for a grieving heart",
  metaDescription: "Comfort and quiet hope in the Easter story.",
  blocks: [
    {
      t: "text",
      heading: "You are not alone",
      contentParagraphs: ["Grief is heavy. The Easter story meets it gently."],
    },
    {
      t: "cta",
      heading: "Sit with the story",
      body: "Take a moment with the hope of the resurrection.",
      buttonLabel: "Watch",
    },
  ],
}

type StartResult = { status: string; result?: unknown; error?: unknown }

function makeMastra(
  start: (args: { inputData: unknown }) => Promise<StartResult> = async () => ({
    status: "success",
    result: { draft: VALID_DRAFT },
  }),
) {
  const startCalls: Array<{ inputData: unknown }> = []
  const workflowIds: string[] = []
  const mastra: DraftWorkflowMastra = {
    getWorkflowById: (id: string) => {
      workflowIds.push(id)
      return {
        createRun: async () => ({
          start: (args: { inputData: unknown }) => {
            startCalls.push(args)
            return start(args)
          },
          cancel: async () => {},
          runId: "run-1",
        }),
      }
    },
  }
  return { mastra, startCalls, workflowIds }
}

function body(topic: string, personaId: string) {
  return { topic, locale: "en", candidates: [], personaId }
}

describe("handleExperienceVariantRouteRequest", () => {
  it("generates a variant and carries the personaId back (200)", async () => {
    const { mastra, startCalls } = makeMastra()
    const outcome = await handleExperienceVariantRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: async () => body("Easter", "grieving"),
      getMastra: () => mastra,
    })
    expect(outcome.status).toBe(200)
    expect(outcome.body).toMatchObject({
      ok: true,
      personaId: "grieving",
      draft: { title: VALID_DRAFT.title },
    })
    // the persona was composed into the prompt that reaches the workflow
    const inputData = startCalls[0]?.inputData as { prompt?: string }
    expect(inputData.prompt).toContain("Grieving")
    expect(inputData.prompt).toContain("Easter")
  })

  it("runs the quick-draft workflow, not the 5-step multi-step pipeline", async () => {
    const { mastra, workflowIds } = makeMastra()
    const outcome = await handleExperienceVariantRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: async () => body("Easter", "grieving"),
      getMastra: () => mastra,
    })
    expect(outcome.status).toBe(200)
    // Persona fan-out delegates to quick-draft for reliability on slow models.
    expect(workflowIds).toContain("quick-draft")
    expect(workflowIds).not.toContain("multi-step-draft")
  })

  it("rejects a missing/invalid bearer with 401", async () => {
    const { mastra, startCalls } = makeMastra()
    const outcome = await handleExperienceVariantRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: SERVICE_KEYS,
      readJson: async () => body("Easter", "grieving"),
      getMastra: () => mastra,
    })
    expect(outcome.status).toBe(401)
    expect(startCalls).toHaveLength(0)
  })

  it("rejects invalid input (missing topic) with 400 invalid_input", async () => {
    const { mastra } = makeMastra()
    const outcome = await handleExperienceVariantRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: async () => ({ personaId: "grieving" }),
      getMastra: () => mastra,
    })
    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatchObject({ ok: false, reason: "invalid_input" })
  })

  it("rejects an unknown persona with 400 without invoking the workflow", async () => {
    const { mastra, startCalls } = makeMastra()
    const outcome = await handleExperienceVariantRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: async () => body("Easter", "no-such-persona"),
      getMastra: () => mastra,
    })
    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatchObject({ ok: false, reason: "invalid_input" })
    expect(startCalls).toHaveLength(0)
  })

  it("returns a retryable timeout (504) when generation exceeds the budget", async () => {
    const { mastra } = makeMastra(() => new Promise<StartResult>(() => {}))
    const outcome = await handleExperienceVariantRouteRequest({
      authHeader: AUTH,
      serviceKeys: SERVICE_KEYS,
      readJson: async () => body("Easter", "grieving"),
      getMastra: () => mastra,
      budgetMs: 20,
    })
    expect(outcome.status).toBe(504)
    expect(outcome.body).toMatchObject({
      ok: false,
      reason: "timeout",
      retryable: true,
    })
  })
})
