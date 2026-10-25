import { describe, expect, it } from "vitest"

import {
  DraftExperienceSchema,
  type DraftExperience,
} from "@forge/experience-schema"

import {
  handleExperienceDraftRouteRequest,
  type DraftWorkflowMastra,
} from "./experience-draft-route"
import { WorkflowStepError } from "./multi-step-draft"

const SERVICE_KEYS = ["test-service-key"] as const
const AUTH = "Bearer test-service-key"

const VALID_DRAFT: DraftExperience = {
  title: "Hope in difficult seasons",
  metaDescription:
    "A short reflection on hope, with scripture and a guiding video.",
  blocks: [
    {
      t: "text",
      heading: "Hope is anchored",
      contentParagraphs: ["Scripture grounds hope in unchanging truth."],
    },
    {
      t: "cta",
      heading: "Hope is anchored",
      body: "Scripture grounds hope. Discover what that means for today.",
      buttonLabel: "Watch now",
    },
  ],
}

type StartResult = { status: string; result?: unknown; error?: unknown }

function makeMastra(
  opts: {
    start?: (args: { inputData: unknown }) => Promise<StartResult>
  } = {},
) {
  const workflowIds: string[] = []
  const startCalls: Array<{ inputData: unknown }> = []
  let cancelCount = 0
  const start =
    opts.start ??
    (async () => ({ status: "success", result: { draft: VALID_DRAFT } }))
  const mastra: DraftWorkflowMastra = {
    getWorkflowById: (id: string) => {
      workflowIds.push(id)
      return {
        createRun: async () => ({
          start: (args: { inputData: unknown }) => {
            startCalls.push(args)
            return start(args)
          },
          cancel: async () => {
            cancelCount += 1
          },
          runId: "run-1",
        }),
      }
    },
  }
  return {
    mastra,
    workflowIds,
    startCalls,
    getCancelCount: () => cancelCount,
  }
}

describe("handleExperienceDraftRouteRequest", () => {
  describe("auth", () => {
    it("returns 401 when the bearer is missing", async () => {
      const { mastra } = makeMastra()
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: undefined,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(outcome.status).toBe(401)
      expect(outcome.body).toEqual({ error: "Service bearer required" })
    })

    it("returns 401 when the bearer does not match the allowlist", async () => {
      const { mastra, workflowIds } = makeMastra()
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: "Bearer wrong-key",
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(outcome.status).toBe(401)
      // Never reaches the workflow.
      expect(workflowIds).toEqual([])
    })
  })

  describe("happy path", () => {
    it("returns { ok:true, draft } that passes DraftExperienceSchema", async () => {
      const { mastra } = makeMastra()
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({
          prompt: "A page about hope",
          locale: "en",
          candidates: [{ videoId: "v1", title: "Hope" }],
        }),
        getMastra: () => mastra,
      })
      expect(outcome.status).toBe(200)
      expect(outcome.body).toMatchObject({ ok: true })
      if ("ok" in outcome.body && outcome.body.ok) {
        expect(
          DraftExperienceSchema.safeParse(outcome.body.draft).success,
        ).toBe(true)
        expect(outcome.body.draft.title).toBe(VALID_DRAFT.title)
      }
    })

    it("forwards prompt/locale/candidates/exemplar to the workflow inputData (not mode)", async () => {
      const { mastra, startCalls } = makeMastra()
      await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({
          prompt: "grief",
          locale: "es",
          candidates: [{ videoId: "v1" }],
          exemplar: "{...}",
          mode: "multi",
        }),
        getMastra: () => mastra,
      })
      expect(startCalls).toHaveLength(1)
      expect(startCalls[0].inputData).toEqual({
        prompt: "grief",
        locale: "es",
        candidates: [{ videoId: "v1" }],
        exemplar: "{...}",
      })
      expect(startCalls[0].inputData).not.toHaveProperty("mode")
    })
  })

  describe("workflow selection by mode", () => {
    it('mode "quick" runs the quick-draft workflow', async () => {
      const { mastra, workflowIds } = makeMastra()
      await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope", mode: "quick" }),
        getMastra: () => mastra,
      })
      expect(workflowIds).toEqual(["quick-draft"])
    })

    it("absent mode runs the multi-step-draft workflow", async () => {
      const { mastra, workflowIds } = makeMastra()
      await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(workflowIds).toEqual(["multi-step-draft"])
    })
  })

  describe("invalid input", () => {
    it("returns 400 / invalid_input on a malformed body (missing prompt)", async () => {
      const { mastra, workflowIds } = makeMastra()
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ locale: "en" }),
        getMastra: () => mastra,
      })
      expect(outcome.status).toBe(400)
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "invalid_input",
        retryable: false,
      })
      // Never reaches the workflow.
      expect(workflowIds).toEqual([])
    })

    it("returns 400 / invalid_input when the JSON body could not be read", async () => {
      const { mastra } = makeMastra()
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => {
          throw new Error("bad json")
        },
        getMastra: () => mastra,
      })
      expect(outcome.status).toBe(400)
      expect(outcome.body).toMatchObject({ ok: false, reason: "invalid_input" })
    })
  })

  describe("internal timeout", () => {
    it("classifies an exceeded budget as { ok:false, reason:timeout, retryable:true } and cancels the run", async () => {
      // A run.start that never resolves; the tiny budget fires first.
      const { mastra, getCancelCount } = makeMastra({
        start: () => new Promise<StartResult>(() => {}),
      })
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
        budgetMs: 20,
      })
      expect(outcome.status).toBe(504)
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "timeout",
        retryable: true,
      })
      // Best-effort cancel fired so the run stops burning LLM calls.
      expect(getCancelCount()).toBe(1)
    })
  })

  describe("workflow failure classification", () => {
    it("maps a non-success workflow result to generation_failed (502)", async () => {
      const { mastra } = makeMastra({
        start: async () => ({ status: "failed" }),
      })
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(outcome.status).toBe(502)
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "generation_failed",
      })
    })

    it("maps a thrown WorkflowStepError(timeout) to reason=timeout", async () => {
      const { mastra } = makeMastra({
        start: async () => {
          throw new WorkflowStepError("plan", "timeout", "aborted")
        },
      })
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "timeout",
        retryable: true,
      })
    })

    it("maps a thrown WorkflowStepError(schema_mismatch) to generation_failed (not retryable)", async () => {
      const { mastra } = makeMastra({
        start: async () => {
          throw new WorkflowStepError("fill", "schema_mismatch", "off-shape")
        },
      })
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "generation_failed",
        retryable: false,
      })
    })

    it("maps a thrown WorkflowStepError(agent_error) to generation_failed (retryable)", async () => {
      const { mastra } = makeMastra({
        start: async () => {
          throw new WorkflowStepError("draft", "agent_error", "provider 500")
        },
      })
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "generation_failed",
        retryable: true,
      })
    })

    it("returns generation_failed when the workflow succeeds but carries no schema-valid draft", async () => {
      const { mastra } = makeMastra({
        start: async () => ({
          status: "success",
          result: { draft: { title: "x" } },
        }),
      })
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(outcome.status).toBe(502)
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "generation_failed",
        retryable: false,
      })
    })
  })

  describe("create-run failure", () => {
    it("returns internal_error (500) when createRun throws", async () => {
      const mastra: DraftWorkflowMastra = {
        getWorkflowById: () => ({
          createRun: async () => {
            throw new Error("pool exhausted")
          },
        }),
      }
      const outcome = await handleExperienceDraftRouteRequest({
        authHeader: AUTH,
        serviceKeys: SERVICE_KEYS,
        readJson: async () => ({ prompt: "hope" }),
        getMastra: () => mastra,
      })
      expect(outcome.status).toBe(500)
      expect(outcome.body).toMatchObject({
        ok: false,
        reason: "internal_error",
        retryable: true,
      })
    })
  })
})
