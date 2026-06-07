import { beforeEach, describe, expect, it, vi } from "vitest"

// The workflow reads the gateway gate (AI_GATEWAY_CHAT_*) at call time
// to decide whether draft/revise request provider-native structured
// output. Default both to undefined so every pre-existing test runs the
// plain text → parse-ladder path; structured-path tests flip them.
const mockEnv = vi.hoisted(() => ({
  env: {
    AI_GATEWAY_CHAT_API_KEY: undefined as string | undefined,
    AI_GATEWAY_CHAT_ENABLED: undefined as string | undefined,
  },
}))

vi.mock("@/config/env", () => mockEnv)

import {
  executeCritiqueStep,
  executeDraftStep,
  executePlanStep,
  executeReviseStep,
  liftToDraftExperienceShape,
  MULTI_STEP_DRAFT_MAX_STEPS,
  multiStepDraftWorkflow,
  WorkflowStepError,
} from "./multi-step-draft-workflow"
import { TOKEN_CAPS } from "../budgets"
import type { DraftExperience } from "@/services/experience-ai/experience-ai.schemas"

/**
 * Mocked-agent execute tests (U4) — exercise each step's body against
 * a synthetic Mastra surface with deterministic `agent.generate` mocks.
 * Branch shape only; the real-LLM contract gate is the U6 smoke
 * script.
 */

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
      body: "Scripture grounds hope in unchanging truth. Discover what that means for today.",
      buttonLabel: "Watch now",
    },
  ],
}

type MockAgentResponse = { text: string; object?: unknown }

function makeMockAgent(
  responses: MockAgentResponse,
  spy?: { calls: Array<{ prompt: string; opts: unknown }> },
) {
  return {
    generate: vi.fn(async (prompt: string, opts: unknown) => {
      spy?.calls.push({ prompt, opts })
      return responses
    }),
  }
}

function makeMockMastra(agentResponses: Record<string, MockAgentResponse>) {
  const callLog: Record<string, Array<{ prompt: string; opts: unknown }>> = {}
  const agentLookups: string[] = []
  const mastra = {
    getAgentById: vi.fn((id: string) => {
      agentLookups.push(id)
      callLog[id] ??= []
      return makeMockAgent(agentResponses[id], { calls: callLog[id] })
    }),
  }
  return { mastra, callLog, agentLookups }
}

describe("multiStepDraftWorkflow (U4 — real step bodies)", () => {
  beforeEach(() => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_CHAT_ENABLED = undefined
  })

  describe("structural invariants", () => {
    it("exposes a stable workflow id", () => {
      expect(multiStepDraftWorkflow.id).toBe("multi-step-draft")
    })

    it("declares its max-step ceiling as 4 (plan → draft → critique → revise)", () => {
      // Structural invariance — accidentally adding or removing a step
      // would change this constant and trip the test.
      expect(MULTI_STEP_DRAFT_MAX_STEPS).toBe(4)
    })
  })

  describe("executePlanStep", () => {
    it("looks up experience-planner agent and returns plan text", async () => {
      const { mastra, callLog, agentLookups } = makeMockMastra({
        "experience-planner": { text: "  An outline about hope.  " },
      })

      const result = await executePlanStep({
        inputData: { prompt: "hope", locale: "en", candidates: [] },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      expect(agentLookups).toEqual(["experience-planner"])
      expect(result.plan).toBe("An outline about hope.")
      // Forward the input data so the next step has it.
      expect(result.prompt).toBe("hope")
      expect(result.locale).toBe("en")
      expect(callLog["experience-planner"][0].opts).toMatchObject({
        maxOutputTokens: TOKEN_CAPS.multiStepDraftPlan,
      })
    })

    it("does NOT pass memory or threadId to agent.generate (R12)", async () => {
      const { mastra, callLog } = makeMockMastra({
        "experience-planner": { text: "plan" },
      })

      await executePlanStep({
        inputData: { prompt: "hope", locale: "en", candidates: [] },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      const opts = callLog["experience-planner"][0].opts as Record<
        string,
        unknown
      >
      expect(opts).not.toHaveProperty("memory")
      expect(opts).not.toHaveProperty("threadId")
    })
  })

  describe("executeDraftStep", () => {
    it("parses a valid JSON envelope and returns DraftExperience-shaped data", async () => {
      const { mastra, callLog, agentLookups } = makeMockMastra({
        "draft-experience": { text: JSON.stringify(VALID_DRAFT) },
      })

      const result = await executeDraftStep({
        inputData: {
          prompt: "hope",
          locale: "en",
          candidates: [],
          plan: "An outline about hope.",
        },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      expect(agentLookups).toEqual(["draft-experience"])
      expect(result.draft).toMatchObject({
        title: VALID_DRAFT.title,
        metaDescription: VALID_DRAFT.metaDescription,
      })
      expect(result.draft.blocks).toHaveLength(2)
      expect(callLog["draft-experience"][0].opts).toMatchObject({
        maxOutputTokens: TOKEN_CAPS.multiStepDraftDraft,
      })
    })

    it("throws WorkflowStepError(step=draft, reason=schema_mismatch) on malformed JSON", async () => {
      const { mastra } = makeMockMastra({
        "draft-experience": { text: "this is not JSON" },
      })

      await expect(
        executeDraftStep({
          inputData: {
            prompt: "hope",
            locale: "en",
            candidates: [],
            plan: "An outline.",
          },
          mastra: mastra as never,
          abortSignal: undefined,
        }),
      ).rejects.toMatchObject({
        name: "WorkflowStepError",
        step: "draft",
        reason: "schema_mismatch",
      })
    })

    it("throws WorkflowStepError(step=draft, reason=schema_mismatch) when JSON fails DraftExperienceSchema", async () => {
      const { mastra } = makeMockMastra({
        "draft-experience": {
          // Valid JSON but missing required fields.
          text: JSON.stringify({ title: "x" }),
        },
      })

      await expect(
        executeDraftStep({
          inputData: {
            prompt: "hope",
            locale: "en",
            candidates: [],
            plan: "An outline.",
          },
          mastra: mastra as never,
          abortSignal: undefined,
        }),
      ).rejects.toMatchObject({
        name: "WorkflowStepError",
        step: "draft",
        reason: "schema_mismatch",
      })
    })

    it("accepts the diff envelope shape the prompt instructs", async () => {
      // DRAFT_EXPERIENCE_PROMPT tells the model to emit
      // {diff:{scalars:{title:{after}, metaDescription:{after}}, blocks}}.
      // The lifter normalizes it to the flat shape DraftExperienceSchema
      // requires.
      const diffEnvelope = {
        diff: {
          scalars: {
            title: { before: "", after: VALID_DRAFT.title },
            metaDescription: {
              before: null,
              after: VALID_DRAFT.metaDescription,
            },
          },
          blocks: VALID_DRAFT.blocks,
        },
      }

      const { mastra } = makeMockMastra({
        "draft-experience": { text: JSON.stringify(diffEnvelope) },
      })

      const result = await executeDraftStep({
        inputData: {
          prompt: "hope",
          locale: "en",
          candidates: [],
          plan: "An outline.",
        },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      expect(result.draft).toMatchObject({
        title: VALID_DRAFT.title,
        metaDescription: VALID_DRAFT.metaDescription,
      })
      expect(result.draft.blocks).toHaveLength(VALID_DRAFT.blocks.length)
    })

    it("accepts the chat-style {mutations: ...} envelope", async () => {
      const mutationsEnvelope = { mutations: VALID_DRAFT }

      const { mastra } = makeMockMastra({
        "draft-experience": { text: JSON.stringify(mutationsEnvelope) },
      })

      const result = await executeDraftStep({
        inputData: {
          prompt: "hope",
          locale: "en",
          candidates: [],
          plan: "An outline.",
        },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      expect(result.draft).toMatchObject({
        title: VALID_DRAFT.title,
        metaDescription: VALID_DRAFT.metaDescription,
      })
    })
  })

  describe("structured output (gateway path)", () => {
    const baseInput = {
      prompt: "Hope page",
      locale: "en",
      candidates: [],
      plan: "1. hero 2. text 3. cta",
    }

    function enableGateway() {
      mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
      mockEnv.env.AI_GATEWAY_CHAT_ENABLED = "true"
    }

    it("requests structuredOutput + toolChoice none when the gateway is enabled", async () => {
      enableGateway()
      const { mastra, callLog } = makeMockMastra({
        "draft-experience": { text: "", object: VALID_DRAFT },
      })
      await executeDraftStep({ inputData: baseInput, mastra })
      const opts = callLog["draft-experience"][0].opts as {
        toolChoice?: string
        structuredOutput?: { schema?: unknown }
      }
      expect(opts.toolChoice).toBe("none")
      expect(opts.structuredOutput?.schema).toBeDefined()
    })

    it("prefers the provider-validated object over text parsing", async () => {
      enableGateway()
      const { mastra } = makeMockMastra({
        // text deliberately unparseable — only the object path can pass
        "draft-experience": { text: "not json at all", object: VALID_DRAFT },
      })
      const result = await executeDraftStep({ inputData: baseInput, mastra })
      expect(result.draft).toEqual(VALID_DRAFT)
    })

    it("falls back to the text ladder when the structured object misses the schema", async () => {
      enableGateway()
      const { mastra } = makeMockMastra({
        "draft-experience": {
          text: JSON.stringify(VALID_DRAFT),
          object: { definitely: "not a draft" },
        },
      })
      const result = await executeDraftStep({ inputData: baseInput, mastra })
      expect(result.draft).toEqual(VALID_DRAFT)
    })

    it("does NOT request structured output when the gateway is disabled", async () => {
      const { mastra, callLog } = makeMockMastra({
        "draft-experience": { text: JSON.stringify(VALID_DRAFT) },
      })
      await executeDraftStep({ inputData: baseInput, mastra })
      const opts = callLog["draft-experience"][0].opts as {
        toolChoice?: string
        structuredOutput?: unknown
      }
      expect(opts.toolChoice).toBeUndefined()
      expect(opts.structuredOutput).toBeUndefined()
    })

    it("applies the same structured options on the revise step", async () => {
      enableGateway()
      const { mastra, callLog } = makeMockMastra({
        "experience-reviser": { text: "", object: VALID_DRAFT },
      })
      const result = await executeReviseStep({
        inputData: { draft: VALID_DRAFT, notes: "tighten the cta" },
        mastra,
      })
      expect(result.draft).toEqual(VALID_DRAFT)
      const opts = callLog["experience-reviser"][0].opts as {
        toolChoice?: string
        structuredOutput?: { schema?: unknown }
      }
      expect(opts.toolChoice).toBe("none")
      expect(opts.structuredOutput?.schema).toBeDefined()
    })
  })

  describe("liftToDraftExperienceShape", () => {
    it("passes the flat shape through unchanged", () => {
      expect(liftToDraftExperienceShape(VALID_DRAFT)).toEqual(VALID_DRAFT)
    })

    it("lifts a diff envelope with {before, after} scalars", () => {
      const lifted = liftToDraftExperienceShape({
        diff: {
          scalars: {
            title: { before: "", after: "T" },
            metaDescription: { before: null, after: "M" },
          },
          blocks: [{ t: "text" }],
        },
      })
      expect(lifted).toEqual({
        title: "T",
        metaDescription: "M",
        blocks: [{ t: "text" }],
      })
    })

    it("lifts a diff envelope with plain-string scalars", () => {
      const lifted = liftToDraftExperienceShape({
        diff: {
          scalars: { title: "T", metaDescription: "M" },
          blocks: [],
        },
      })
      expect(lifted).toEqual({ title: "T", metaDescription: "M", blocks: [] })
    })

    it("lifts a {mutations: ...} envelope", () => {
      const lifted = liftToDraftExperienceShape({ mutations: VALID_DRAFT })
      expect(lifted).toEqual(VALID_DRAFT)
    })

    it("leaves non-object inputs alone", () => {
      expect(liftToDraftExperienceShape(null)).toBe(null)
      expect(liftToDraftExperienceShape("foo")).toBe("foo")
    })
  })

  describe("executeCritiqueStep", () => {
    it("looks up experience-critic agent and returns notes alongside the draft", async () => {
      const { mastra, callLog, agentLookups } = makeMockMastra({
        "experience-critic": {
          text: "- Headline could be more specific\n- Card 2 lacks scripture grounding",
        },
      })

      const result = await executeCritiqueStep({
        inputData: {
          draft: VALID_DRAFT,
          plan: "outline",
          prompt: "hope",
          locale: "en",
          candidates: [],
        },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      expect(agentLookups).toEqual(["experience-critic"])
      expect(result.draft).toEqual(VALID_DRAFT)
      expect(result.notes).toContain("Headline could be more specific")
      expect(callLog["experience-critic"][0].opts).toMatchObject({
        maxOutputTokens: TOKEN_CAPS.multiStepDraftCritique,
      })
    })
  })

  describe("executeReviseStep", () => {
    it("parses the revised draft and returns final DraftExperience", async () => {
      const revised = {
        ...VALID_DRAFT,
        title: "Hope that holds — anchored in scripture",
      }
      const { mastra, callLog, agentLookups } = makeMockMastra({
        "experience-reviser": { text: JSON.stringify(revised) },
      })

      const result = await executeReviseStep({
        inputData: {
          draft: VALID_DRAFT,
          notes: "Make the title more specific.",
        },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      expect(agentLookups).toEqual(["experience-reviser"])
      expect(result.draft.title).toBe(revised.title)
      expect(callLog["experience-reviser"][0].opts).toMatchObject({
        maxOutputTokens: TOKEN_CAPS.multiStepDraftRevise,
      })
    })

    it("throws WorkflowStepError(step=revise, reason=schema_mismatch) on malformed revised JSON", async () => {
      const { mastra } = makeMockMastra({
        "experience-reviser": { text: "}{ bad json {" },
      })

      await expect(
        executeReviseStep({
          inputData: { draft: VALID_DRAFT, notes: "notes" },
          mastra: mastra as never,
          abortSignal: undefined,
        }),
      ).rejects.toMatchObject({
        name: "WorkflowStepError",
        step: "revise",
        reason: "schema_mismatch",
      })
    })
  })

  describe("abort propagation (AE4)", () => {
    it("propagates an already-aborted signal as WorkflowStepError(reason=timeout)", async () => {
      const controller = new AbortController()
      controller.abort()

      // Mock agent that respects abortSignal — rejects with AbortError
      // when called with an aborted signal.
      const abortingAgent = {
        generate: vi.fn(
          async (_prompt: string, opts: { abortSignal?: AbortSignal }) => {
            if (opts?.abortSignal?.aborted) {
              const err = new Error("Aborted")
              ;(err as Error & { name: string }).name = "AbortError"
              throw err
            }
            return { text: "irrelevant" }
          },
        ),
      }

      const mastra = {
        getAgentById: vi.fn(() => abortingAgent),
      }

      await expect(
        executePlanStep({
          inputData: { prompt: "hope", locale: "en", candidates: [] },
          mastra: mastra as never,
          abortSignal: controller.signal,
        }),
      ).rejects.toMatchObject({
        name: "WorkflowStepError",
        step: "plan",
        reason: "timeout",
      })
    })
  })

  describe("WorkflowStepError discriminant", () => {
    it("carries typed step + reason fields", () => {
      const err = new WorkflowStepError("draft", "schema_mismatch", "boom")
      expect(err.name).toBe("WorkflowStepError")
      expect(err.step).toBe("draft")
      expect(err.reason).toBe("schema_mismatch")
      expect(err.message).toContain("boom")
    })
  })
})
