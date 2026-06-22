import { beforeEach, describe, expect, it, vi } from "vitest"

// The workflow reads the gateway gate (AI_GATEWAY_CHAT_*) AND the
// trusted-flag gate (AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED) at call time to
// decide whether each phase requests provider-native structured output. Default
// all three to the off state so every test runs the plain text → parse-ladder
// path; constrained-decoding tests flip them. The trusted flag is the
// precondition: even with the gateway enabled, structured opts are withheld
// until it is "true".
const mockEnv = vi.hoisted(() => ({
  env: {
    AI_GATEWAY_CHAT_API_KEY: undefined as string | undefined,
    AI_GATEWAY_CHAT_ENABLED: undefined as string | undefined,
    AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED: "false" as string | undefined,
  },
}))

vi.mock("../../config/env", () => mockEnv)

import {
  executeCritiqueStep,
  executeDraftStep,
  executeFillStep,
  executePlanStep,
  executeReviseStep,
  executeSkeletonStep,
  liftToDraftExperienceShape,
  MULTI_STEP_DRAFT_MAX_STEPS,
  multiStepDraftWorkflow,
  QUICK_DRAFT_MAX_STEPS,
  quickDraftWorkflow,
  WorkflowStepError,
} from "./multi-step-draft"
import { TOKEN_CAPS } from "../budgets"
import {
  DraftExperienceSchema,
  getFillSchemaForType,
  SkeletonSchema,
  type DraftExperience,
} from "@forge/experience-schema"

/**
 * Mocked-agent execute tests — exercise each step's body against a synthetic
 * Mastra surface with deterministic `agent.generate` mocks. Branch shape only;
 * the real-LLM contract gate is the relocated draft-workflow smoke.
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

describe("multiStepDraftWorkflow (real step bodies)", () => {
  beforeEach(() => {
    mockEnv.env.AI_GATEWAY_CHAT_API_KEY = undefined
    mockEnv.env.AI_GATEWAY_CHAT_ENABLED = undefined
    mockEnv.env.AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED = "false"
  })

  describe("structural invariants", () => {
    it("exposes a stable workflow id", () => {
      expect(multiStepDraftWorkflow.id).toBe("multi-step-draft")
    })

    it("declares its max-step ceiling as 5 (plan → skeleton → fill → critique → revise)", () => {
      // Structural invariance — accidentally adding or removing a step would
      // change this constant and trip the test.
      expect(MULTI_STEP_DRAFT_MAX_STEPS).toBe(5)
    })

    it("exposes a stable quick-draft workflow id", () => {
      expect(quickDraftWorkflow.id).toBe("quick-draft")
    })

    it("declares the quick-draft max-step ceiling as 3 (plan → skeleton → fill)", () => {
      expect(QUICK_DRAFT_MAX_STEPS).toBe(3)
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

    it("does NOT pass memory or threadId to agent.generate (workflow-only)", async () => {
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

  describe("exemplar injection", () => {
    const EXEMPLAR =
      '{"title":"Easter","blocks":[{"t":"videoHero","heading":"He is risen"}]}'

    it("includes the structure-and-voice reference in the plan prompt when an exemplar is supplied", async () => {
      const { mastra, callLog } = makeMockMastra({
        "experience-planner": { text: "plan" },
      })

      await executePlanStep({
        inputData: {
          prompt: "grief",
          locale: "en",
          candidates: [],
          exemplar: EXEMPLAR,
        },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      const prompt = callLog["experience-planner"][0].prompt
      expect(prompt).toContain("Structure & voice reference")
      expect(prompt).toContain(EXEMPLAR)
    })

    it("includes the reference in the draft prompt when an exemplar is supplied (covers quick-draft + multi-step via the shared builder)", async () => {
      const { mastra, callLog } = makeMockMastra({
        "draft-experience": { text: JSON.stringify(VALID_DRAFT) },
      })

      await executeDraftStep({
        inputData: {
          prompt: "grief",
          locale: "en",
          candidates: [],
          plan: "outline",
          exemplar: EXEMPLAR,
        },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      const prompt = callLog["draft-experience"][0].prompt
      expect(prompt).toContain("Structure & voice reference")
      expect(prompt).toContain(EXEMPLAR)
    })

    it("omits the reference (default path unchanged) when no exemplar is supplied", async () => {
      const { mastra, callLog } = makeMockMastra({
        "experience-planner": { text: "plan" },
        "draft-experience": { text: JSON.stringify(VALID_DRAFT) },
      })

      await executePlanStep({
        inputData: { prompt: "grief", locale: "en", candidates: [] },
        mastra: mastra as never,
        abortSignal: undefined,
      })
      await executeDraftStep({
        inputData: {
          prompt: "grief",
          locale: "en",
          candidates: [],
          plan: "outline",
        },
        mastra: mastra as never,
        abortSignal: undefined,
      })

      expect(callLog["experience-planner"][0].prompt).not.toContain(
        "Structure & voice reference",
      )
      expect(callLog["draft-experience"][0].prompt).not.toContain(
        "Structure & voice reference",
      )
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

    // Enable BOTH preconditions for actually sending structured opts: the
    // gateway provider gate AND the trusted flag. Constrained decoding is only
    // sent to the provider when both are on.
    function enableGateway() {
      mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
      mockEnv.env.AI_GATEWAY_CHAT_ENABLED = "true"
      mockEnv.env.AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED = "true"
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

  describe("abort propagation", () => {
    it("propagates an already-aborted signal as WorkflowStepError(reason=timeout)", async () => {
      const controller = new AbortController()
      controller.abort()

      // Mock agent that respects abortSignal — rejects with AbortError when
      // called with an aborted signal.
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

    it("accepts the two-phase step names (skeleton / fill)", () => {
      const skel = new WorkflowStepError("skeleton", "schema_mismatch", "x")
      const fill = new WorkflowStepError("fill", "schema_mismatch", "y")
      expect(skel.step).toBe("skeleton")
      expect(fill.step).toBe("fill")
    })
  })

  // -------------------------------------------------------------------------
  // Two-phase generation (skeleton → validate → sequential fill)
  // -------------------------------------------------------------------------
  describe("two-phase generation", () => {
    const PLAN_INPUT = {
      prompt: "A page about hope in difficult seasons",
      locale: "en",
      candidates: [] as never[],
      plan: "Audience: people in hardship. Hook: hope is anchored.",
    }

    // A valid skeleton: two leaf top-level nodes + one section with a child.
    const VALID_SKELETON = {
      nodes: [
        { type: "videoHero", sectionRef: "s01" },
        {
          type: "section",
          sectionRef: "s02",
          children: [{ type: "text" }],
        },
        { type: "cta" },
      ],
    }

    // Deterministic fill responses keyed by block type. The fill agent is
    // looked up by id "experience-fill"; we route per-call by inspecting the
    // prompt (which names the target type) so a single mock agent can serve
    // every node in document order.
    function makeFillMastra(opts?: { onFill?: (prompt: string) => void }): {
      mastra: { getAgentById: ReturnType<typeof vi.fn> }
      fillSpy: ReturnType<typeof vi.fn>
      skeletonResponse: { value: { text: string; object?: unknown } }
    } {
      const skeletonResponse: { value: { text: string; object?: unknown } } = {
        value: { text: JSON.stringify(VALID_SKELETON) },
      }
      const fillSpy = vi.fn(async (prompt: string) => {
        opts?.onFill?.(prompt)
        // Emit a block whose `t` matches the requested type in the prompt.
        if (/type "videoHero"/.test(prompt)) {
          return {
            text: JSON.stringify({
              t: "videoHero",
              candidateRef: "v01",
              heading: "Hope is anchored",
              subheading: "A short reflection",
            }),
          }
        }
        if (/type "text"/.test(prompt)) {
          return {
            text: JSON.stringify({
              t: "text",
              heading: "Hope grounded in scripture",
              contentParagraphs: [
                "Scripture grounds hope in unchanging truth.",
              ],
            }),
          }
        }
        if (/type "cta"/.test(prompt)) {
          return {
            text: JSON.stringify({
              t: "cta",
              heading: "Take the next step",
              body: "Watch the full reflection now.",
              buttonLabel: "Watch now",
            }),
          }
        }
        return { text: JSON.stringify({ t: "text", heading: "fallback" }) }
      })
      const mastra = {
        getAgentById: vi.fn((id: string) => {
          if (id === "experience-skeleton") {
            return { generate: vi.fn(async () => skeletonResponse.value) }
          }
          if (id === "experience-fill") {
            return { generate: fillSpy }
          }
          throw new Error(`unexpected agent id ${id}`)
        }),
      }
      return { mastra, fillSpy, skeletonResponse }
    }

    describe("executeSkeletonStep", () => {
      it("validates a good skeleton and forwards it + plan fields", async () => {
        const { mastra } = makeFillMastra()
        const result = await executeSkeletonStep({
          inputData: PLAN_INPUT,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        expect(result.skeleton.nodes).toHaveLength(3)
        expect(result.prompt).toBe(PLAN_INPUT.prompt)
        expect(result.plan).toBe(PLAN_INPUT.plan)
      })

      it("rejects a section-inside-section skeleton and logs skeleton_validation_failed", async () => {
        const warnSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => undefined)
        // The fill executor must NEVER be reached for an illegal skeleton.
        const fillSpy = vi.fn(async () => ({ text: "{}" }))
        const mastra = {
          getAgentById: vi.fn((id: string) => {
            if (id === "experience-skeleton") {
              return {
                generate: vi.fn(async () => ({
                  text: JSON.stringify({
                    nodes: [
                      { type: "videoHero" },
                      {
                        type: "section",
                        children: [
                          { type: "section", children: [{ type: "text" }] },
                        ],
                      },
                    ],
                  }),
                })),
              }
            }
            if (id === "experience-fill") return { generate: fillSpy }
            throw new Error(`unexpected agent id ${id}`)
          }),
        }

        await expect(
          executeSkeletonStep({
            inputData: PLAN_INPUT,
            mastra: mastra as never,
            abortSignal: undefined,
          }),
        ).rejects.toMatchObject({
          name: "WorkflowStepError",
          step: "skeleton",
          reason: "schema_mismatch",
        })

        // Fill spy is never called — validation fail-fasts before fill.
        expect(fillSpy).not.toHaveBeenCalled()
        // The structured fail log is emitted (plain string).
        const loggedFailure = warnSpy.mock.calls.some((c) =>
          String(c[0]).includes(
            "[draft-workflow] event=skeleton_validation_failed",
          ),
        )
        expect(loggedFailure).toBe(true)
        warnSpy.mockRestore()
      })

      it("rejects a skeleton with fewer than GENERATION_MIN_BLOCKS top-level nodes pre-fill", async () => {
        const warnSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => undefined)
        const fillSpy = vi.fn(async () => ({ text: "{}" }))
        const mastra = {
          getAgentById: vi.fn((id: string) => {
            if (id === "experience-skeleton") {
              return {
                generate: vi.fn(async () => ({
                  text: JSON.stringify({ nodes: [{ type: "text" }] }),
                })),
              }
            }
            if (id === "experience-fill") return { generate: fillSpy }
            throw new Error(`unexpected agent id ${id}`)
          }),
        }
        await expect(
          executeSkeletonStep({
            inputData: PLAN_INPUT,
            mastra: mastra as never,
            abortSignal: undefined,
          }),
        ).rejects.toMatchObject({
          name: "WorkflowStepError",
          step: "skeleton",
          reason: "schema_mismatch",
        })
        expect(fillSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
      })

      it("control: a valid skeleton proceeds and the fill spy IS called", async () => {
        const { mastra, fillSpy } = makeFillMastra()
        const skeletonOut = await executeSkeletonStep({
          inputData: PLAN_INPUT,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        // Drive the fill step with the validated skeleton.
        await executeFillStep({
          inputData: skeletonOut,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        expect(fillSpy).toHaveBeenCalled()
      })
    })

    describe("executeFillStep", () => {
      it("assembles a { ...planFields, draft } envelope whose draft passes DraftExperienceSchema (happy path)", async () => {
        const { mastra } = makeFillMastra()
        const skeletonOut = await executeSkeletonStep({
          inputData: PLAN_INPUT,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        const result = await executeFillStep({
          inputData: skeletonOut,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        // Envelope contract: plan fields preserved + a `.draft` carried.
        expect(result.prompt).toBe(PLAN_INPUT.prompt)
        expect(result.plan).toBe(PLAN_INPUT.plan)
        expect("skeleton" in result).toBe(false)
        const parsed = DraftExperienceSchema.safeParse(result.draft)
        expect(parsed.success).toBe(true)
        // Top-level blocks match the skeleton order: videoHero, section, cta.
        expect(result.draft.blocks.map((b) => b.t)).toEqual([
          "videoHero",
          "section",
          "cta",
        ])
        // The section shell carries its filled child.
        const section = result.draft.blocks[1]
        expect(section.t).toBe("section")
        if (section.t === "section") {
          expect(section.content.map((c) => c.t)).toEqual(["text"])
        }
      })

      it("fills SEQUENTIALLY in deterministic skeleton order; a later fill sees earlier filled blocks", async () => {
        const fillOrder: string[] = []
        // Capture, per fill call, whether the prompt carries the "(none yet)"
        // sentinel and whether it embeds the heading of an already-filled block
        // (the coherence accumulator threading forward in document order).
        const sawNoneYet: boolean[] = []
        const sawPriorHeading: boolean[] = []
        const { mastra } = makeFillMastra({
          onFill: (prompt) => {
            const match = /type "(\w+)"/.exec(prompt)
            if (match) fillOrder.push(match[1])
            sawNoneYet.push(/\(none yet/.test(prompt))
            // The videoHero fill (first) writes heading "Hope is anchored";
            // every LATER fill prompt must embed that prior block (its heading)
            // in the "blocks already written" context.
            sawPriorHeading.push(prompt.includes("Hope is anchored"))
          },
        })
        const skeletonOut = await executeSkeletonStep({
          inputData: PLAN_INPUT,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        await executeFillStep({
          inputData: skeletonOut,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        // Deterministic document order: videoHero, then the section's text
        // child, then cta.
        expect(fillOrder).toEqual(["videoHero", "text", "cta"])
        // The first fill saw "(none yet)"; the later fills did not.
        expect(sawNoneYet).toEqual([true, false, false])
        // The first fill had no prior heading; both later fills saw the
        // videoHero's heading threaded forward (coherence).
        expect(sawPriorHeading).toEqual([false, true, true])
      })
    })

    describe("workflow chain symmetry", () => {
      it("both workflows commit and expose .draft-carrying output schemas", () => {
        // Structural symmetry: multiStepDraftWorkflow ends on revisedSchema
        // ({ draft }); quickDraftWorkflow ends on draftSchema
        // ({ ...planFields, draft }). Both carry `.draft` at the top level (the
        // action's cast relies on this).
        expect(multiStepDraftWorkflow.id).toBe("multi-step-draft")
        expect(quickDraftWorkflow.id).toBe("quick-draft")
        // The fill step is the shared terminal producer of `.draft` for
        // quick-draft and the pre-critique producer for multi-step.
        expect(MULTI_STEP_DRAFT_MAX_STEPS).toBe(5)
        expect(QUICK_DRAFT_MAX_STEPS).toBe(3)
      })
    })
  })

  // -------------------------------------------------------------------------
  // Per-phase schema-constrained decoding (gated + truncation guard). Covers:
  // the final guarantee never depends on constrained decoding.
  // -------------------------------------------------------------------------
  describe("per-phase constrained decoding", () => {
    const PLAN_INPUT = {
      prompt: "A page about hope in difficult seasons",
      locale: "en",
      candidates: [] as never[],
      plan: "Audience: people in hardship. Hook: hope is anchored.",
    }

    // A valid skeleton: a leaf hero, a section with a text child, and a cta.
    const VALID_SKELETON = {
      nodes: [
        { type: "videoHero", sectionRef: "s01" },
        { type: "section", sectionRef: "s02", children: [{ type: "text" }] },
        { type: "cta" },
      ],
    }

    type FillCall = { prompt: string; opts: unknown }

    // A constrained-decoding-aware mock surface: every agent records the opts it
    // was called with so the test can assert whether structured opts were
    // threaded. The fill agent routes by the type named in the prompt (same
    // convention as the makeFillMastra helper).
    function makeConstrainedMastra(): {
      mastra: { getAgentById: ReturnType<typeof vi.fn> }
      opts: Record<string, FillCall[]>
    } {
      const opts: Record<string, FillCall[]> = {}
      const record = (id: string, prompt: string, callOpts: unknown) => {
        opts[id] ??= []
        opts[id].push({ prompt, opts: callOpts })
      }
      const mastra = {
        getAgentById: vi.fn((id: string) => {
          if (id === "experience-skeleton") {
            return {
              generate: vi.fn(async (prompt: string, o: unknown) => {
                record(id, prompt, o)
                return { text: JSON.stringify(VALID_SKELETON) }
              }),
            }
          }
          if (id === "experience-fill") {
            return {
              generate: vi.fn(async (prompt: string, o: unknown) => {
                record(id, prompt, o)
                if (/type "videoHero"/.test(prompt)) {
                  return {
                    text: JSON.stringify({
                      t: "videoHero",
                      candidateRef: "v01",
                      heading: "Hope is anchored",
                      subheading: "A short reflection",
                    }),
                  }
                }
                if (/type "text"/.test(prompt)) {
                  return {
                    text: JSON.stringify({
                      t: "text",
                      heading: "Hope grounded in scripture",
                      contentParagraphs: ["Scripture grounds hope."],
                    }),
                  }
                }
                return {
                  text: JSON.stringify({
                    t: "cta",
                    heading: "Take the next step",
                    body: "Watch the full reflection now.",
                    buttonLabel: "Watch now",
                  }),
                }
              }),
            }
          }
          if (id === "experience-reviser") {
            return {
              generate: vi.fn(async (prompt: string, o: unknown) => {
                record(id, prompt, o)
                return { text: "", object: VALID_DRAFT }
              }),
            }
          }
          throw new Error(`unexpected agent id ${id}`)
        }),
      }
      return { mastra, opts }
    }

    function optsOf(call?: FillCall): {
      toolChoice?: string
      structuredOutput?: { schema?: unknown }
    } {
      return (call?.opts ?? {}) as {
        toolChoice?: string
        structuredOutput?: { schema?: unknown }
      }
    }

    describe("default path (trusted flag OFF) — free-text + coercion", () => {
      beforeEach(() => {
        // Gateway provider enabled but constrained decoding NOT trusted — the
        // default. Even with the gateway on, no structured opts.
        mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
        mockEnv.env.AI_GATEWAY_CHAT_ENABLED = "true"
        mockEnv.env.AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED = "false"
      })

      it("skeleton step does NOT pass structuredOutput / toolChoice", async () => {
        const { mastra, opts } = makeConstrainedMastra()
        await executeSkeletonStep({
          inputData: PLAN_INPUT,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        const o = optsOf(opts["experience-skeleton"][0])
        expect(o.toolChoice).toBeUndefined()
        expect(o.structuredOutput).toBeUndefined()
      })

      it("fill step does NOT pass structuredOutput / toolChoice, yet still produces a valid draft via the free-text path", async () => {
        const { mastra, opts } = makeConstrainedMastra()
        const skeletonOut = await executeSkeletonStep({
          inputData: PLAN_INPUT,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        const result = await executeFillStep({
          inputData: skeletonOut,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        // Every fill call ran the free-text path (no structured opts).
        for (const call of opts["experience-fill"]) {
          const o = optsOf(call)
          expect(o.toolChoice).toBeUndefined()
          expect(o.structuredOutput).toBeUndefined()
        }
        // And coercion + validation still produced a valid draft (the guarantee
        // does not depend on constrained decoding).
        expect(DraftExperienceSchema.safeParse(result.draft).success).toBe(true)
        expect(result.draft.blocks.map((b) => b.t)).toEqual([
          "videoHero",
          "section",
          "cta",
        ])
      })

      it("revise step does NOT pass structuredOutput / toolChoice", async () => {
        const { mastra, opts } = makeConstrainedMastra()
        await executeReviseStep({
          inputData: { draft: VALID_DRAFT, notes: "tighten the cta" },
          mastra: mastra as never,
          abortSignal: undefined,
        })
        const o = optsOf(opts["experience-reviser"][0])
        expect(o.toolChoice).toBeUndefined()
        expect(o.structuredOutput).toBeUndefined()
      })
    })

    describe("trusted path (trusted flag ON) — per-phase structured opts", () => {
      beforeEach(() => {
        mockEnv.env.AI_GATEWAY_CHAT_API_KEY = "sk-test"
        mockEnv.env.AI_GATEWAY_CHAT_ENABLED = "true"
        mockEnv.env.AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED = "true"
      })

      it("skeleton step passes SkeletonSchema as the structured-output schema", async () => {
        const { mastra, opts } = makeConstrainedMastra()
        await executeSkeletonStep({
          inputData: PLAN_INPUT,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        const o = optsOf(opts["experience-skeleton"][0])
        expect(o.toolChoice).toBe("none")
        expect(o.structuredOutput?.schema).toBe(SkeletonSchema)
      })

      it("each fill call passes that node's flat block schema", async () => {
        const { mastra, opts } = makeConstrainedMastra()
        const skeletonOut = await executeSkeletonStep({
          inputData: PLAN_INPUT,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        await executeFillStep({
          inputData: skeletonOut,
          mastra: mastra as never,
          abortSignal: undefined,
        })
        // Fill order is videoHero, text (section child), cta — each gets its own
        // flat schema.
        const fills = opts["experience-fill"]
        expect(fills).toHaveLength(3)
        const heroOpts = optsOf(
          fills.find((c) => /type "videoHero"/.test(c.prompt)),
        )
        const textOpts = optsOf(fills.find((c) => /type "text"/.test(c.prompt)))
        const ctaOpts = optsOf(fills.find((c) => /type "cta"/.test(c.prompt)))
        expect(heroOpts.toolChoice).toBe("none")
        expect(heroOpts.structuredOutput?.schema).toBe(
          getFillSchemaForType("videoHero"),
        )
        expect(textOpts.structuredOutput?.schema).toBe(
          getFillSchemaForType("text"),
        )
        expect(ctaOpts.structuredOutput?.schema).toBe(
          getFillSchemaForType("cta"),
        )
      })

      it("revise step passes DraftExperienceSchema as the structured-output schema", async () => {
        const { mastra, opts } = makeConstrainedMastra()
        await executeReviseStep({
          inputData: { draft: VALID_DRAFT, notes: "tighten the cta" },
          mastra: mastra as never,
          abortSignal: undefined,
        })
        const o = optsOf(opts["experience-reviser"][0])
        expect(o.toolChoice).toBe("none")
        expect(o.structuredOutput?.schema).toBe(DraftExperienceSchema)
      })
    })

    describe('truncation guard (finishReason === "length")', () => {
      it("fails closed with WorkflowStepError(reason=truncated) and is NOT repaired", async () => {
        const warnSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => undefined)
        // An agent that returns a finishReason=length result. The text is
        // otherwise valid JSON — proving the guard fires on the truncation
        // signal, NOT on parse failure (it would parse fine if let through).
        const generate = vi.fn(async () => ({
          text: JSON.stringify(VALID_DRAFT),
          object: VALID_DRAFT,
          finishReason: "length",
        }))
        const mastra = { getAgentById: vi.fn(() => ({ generate })) }

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
          reason: "truncated",
        })
        // The agent was called exactly once — no repair / re-roll round-trip.
        expect(generate).toHaveBeenCalledTimes(1)
        const loggedTruncation = warnSpy.mock.calls.some((c) =>
          String(c[0]).includes("[draft-workflow] event=output_truncated"),
        )
        expect(loggedTruncation).toBe(true)
        warnSpy.mockRestore()
      })

      it('does NOT fail on a finishReason the provider reports as "stop"', async () => {
        const generate = vi.fn(async () => ({
          text: JSON.stringify(VALID_DRAFT),
          finishReason: "stop",
        }))
        const mastra = { getAgentById: vi.fn(() => ({ generate })) }
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
        expect(result.draft).toMatchObject({ title: VALID_DRAFT.title })
      })

      it("does NOT fail when finishReason is absent (providers that omit it)", async () => {
        const generate = vi.fn(async () => ({
          text: JSON.stringify(VALID_DRAFT),
        }))
        const mastra = { getAgentById: vi.fn(() => ({ generate })) }
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
        expect(result.draft).toMatchObject({ title: VALID_DRAFT.title })
      })
    })
  })
})
