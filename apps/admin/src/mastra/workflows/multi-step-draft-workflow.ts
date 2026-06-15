/**
 * Multi-step planning workflow — plan → draft → critique → revise.
 *
 * A `@mastra/core/workflows` workflow with four fixed sequential
 * steps. The step cap is implicit in the chain length (no recursion
 * is possible), which satisfies plan C7 (no runaway loops). A
 * wall-clock cap is applied at invocation time via
 * `AbortSignal.timeout()` — the workflow itself doesn't enforce it.
 *
 * Each step's `execute` calls a Mastra agent via the injected
 * `mastra` parameter (NOT the `getMastra()` module import — that
 * would close the cycle `mastra/index.ts → workflow → mastra/index.ts`).
 * Token caps per step come from `TOKEN_CAPS.multiStepDraft*`.
 *
 * Memory-less by construction (R12): no `agent.generate({ memory: ... })`
 * or `threadId:` option is ever passed. The workflow agents
 * (experience-planner / critic / reviser) are also defined without
 * `memory: getMastraMemory()` — defense in depth.
 *
 * Each step's body is extracted as an exported `executeXStep`
 * function so unit tests can drive them with a synthetic Mastra
 * surface and deterministic agent.generate mocks. The `createStep`
 * wrappers delegate to those executors.
 */

import { createStep, createWorkflow } from "@mastra/core/workflows"
import type { Mastra } from "@mastra/core"
import { z } from "zod"

import { env } from "@/config/env"
import { TOKEN_CAPS } from "../budgets"
import { DraftExperienceSchema } from "@/services/experience-ai/experience-ai.schemas"
import type { DraftExperience } from "@/services/experience-ai/experience-ai.schemas"
import { extractJsonObject } from "@/services/experience-ai/extract-json-object"

// ---------------------------------------------------------------------------
// Typed step boundary error
// ---------------------------------------------------------------------------

export type WorkflowStepName = "plan" | "draft" | "critique" | "revise"
export type WorkflowStepFailureReason =
  | "schema_mismatch"
  | "agent_error"
  | "timeout"

/**
 * Typed error thrown by any step when its body cannot produce valid
 * output. The action layer (`generate-draft-action.ts`) classifies on
 * these discriminator fields — `step` + `reason` — and maps to the
 * outer `GenerateDraftActionErrorCode` union. Never regex on
 * `err.message` (cf.
 * `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md`).
 */
export class WorkflowStepError extends Error {
  readonly name = "WorkflowStepError"
  constructor(
    readonly step: WorkflowStepName,
    readonly reason: WorkflowStepFailureReason,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${step}] ${reason}: ${message}`)
  }
}

// ---------------------------------------------------------------------------
// Candidate video shape (passed through from the action layer)
// ---------------------------------------------------------------------------

// Open shape — the action passes whatever the candidate-loader
// returns. The workflow only stringifies a few fields into prompts,
// so the schema stays lenient.
const candidateSchema = z
  .object({
    coreId: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    slug: z.string().optional(),
  })
  .passthrough()

// ---------------------------------------------------------------------------
// Step schemas — typed Zod objects carrying DraftExperience-shaped data
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  prompt: z.string().min(1),
  locale: z.string().default("en"),
  candidates: z.array(candidateSchema).default([]),
  // Optional structure-and-voice reference (a real published page,
  // video ids already stripped — see experience-ai-exemplar-outline.ts).
  // Threaded into the planner + drafter prompts. Both quick-draft and
  // multi-step-draft consume the same builders, so this covers both modes.
  exemplar: z.string().optional(),
})
type WorkflowInput = z.infer<typeof inputSchema>

const planSchema = inputSchema.extend({
  plan: z.string(),
})
type PlanStepOutput = z.infer<typeof planSchema>

// DraftExperience is the canonical output shape — re-use directly
// rather than re-declaring it inside the workflow so a schema bump
// over there propagates here.
const draftSchema = planSchema.extend({
  draft: DraftExperienceSchema,
})
type DraftStepOutput = z.infer<typeof draftSchema>

const critiqueSchema = z.object({
  draft: DraftExperienceSchema,
  notes: z.string(),
})
type CritiqueStepOutput = z.infer<typeof critiqueSchema>

const revisedSchema = z.object({
  draft: DraftExperienceSchema,
})
type RevisedStepOutput = z.infer<typeof revisedSchema>

// ---------------------------------------------------------------------------
// Mastra runtime surface — the minimum we need from the injected param
// ---------------------------------------------------------------------------

type MastraAgent = {
  generate: (
    prompt: string,
    opts: {
      abortSignal?: AbortSignal
      maxOutputTokens: number
      toolChoice?: "auto" | "none" | "required"
      structuredOutput?: { schema: typeof DraftExperienceSchema }
    },
  ) => Promise<{ text: string; object?: unknown }>
}

type MastraSurface = {
  getAgentById: (id: string) => MastraAgent
}

type StepContext<I> = {
  inputData: I
  mastra: MastraSurface
  abortSignal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  )
}

/**
 * Whether the draft/revise steps should request provider-native
 * structured output. Gated to the JesusFilm gateway path
 * (same gate `resolveAgentModel` uses): vLLM guided decoding
 * (`response_format: json_schema`) makes schema-invalid drafts
 * impossible at the decoder level, AND `toolChoice: "none"` keeps the
 * model out of tool round-trips — the gateway's LiteLLM translation
 * 500s with a `'role'` KeyError on multi-tool conversations, which was
 * failing the draft step before any output existed (smoke gate 0/8 on
 * 2026-06-05, every failure `[draft] agent_error … "'role'"`). The
 * workflow gets video candidates pre-loaded in its input, so the
 * drafter does not need the search tools here. Google/OpenRouter keep
 * the text → parse-ladder path that already works for them.
 */
function structuredDraftOutputEnabled(): boolean {
  return Boolean(
    env.AI_GATEWAY_CHAT_API_KEY && env.AI_GATEWAY_CHAT_ENABLED === "true",
  )
}

const STRUCTURED_DRAFT_OPTS = {
  toolChoice: "none",
  structuredOutput: { schema: DraftExperienceSchema },
} as const

async function callAgent(
  mastra: MastraSurface,
  step: WorkflowStepName,
  agentId: string,
  prompt: string,
  maxOutputTokens: number,
  abortSignal: AbortSignal | undefined,
  extraOpts: {
    toolChoice?: "auto" | "none" | "required"
    structuredOutput?: { schema: typeof DraftExperienceSchema }
  } = {},
): Promise<{ text: string; object?: unknown }> {
  const agent = mastra.getAgentById(agentId)
  try {
    return await agent.generate(prompt, {
      abortSignal,
      maxOutputTokens,
      ...extraOpts,
    })
  } catch (err) {
    if (isAbortError(err)) {
      throw new WorkflowStepError(
        step,
        "timeout",
        `agent.generate aborted on step '${step}'`,
        err,
      )
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new WorkflowStepError(
      step,
      "agent_error",
      `agent.generate failed on step '${step}': ${msg}`,
      err,
    )
  }
}

/**
 * Lift the agent's JSON output to the flat {title, metaDescription,
 * blocks} shape DraftExperienceSchema expects.
 *
 * The draft-experience and experience-reviser prompts instruct the
 * model to emit a chat-style envelope ({diff:{scalars:{title:{after},
 * metaDescription:{after}}, blocks}} or {mutations:{...}}) because
 * those prompts are also wired into the default chat agent, which
 * lifts the same shapes in `experience-ai-chat.service.ts`. The
 * workflow path consumes the agent output directly via
 * DraftExperienceSchema and historically rejected anything but the
 * flat shape, so every workflow run failed with
 * WorkflowStepError(reason=schema_mismatch). This helper mirrors the
 * chat-path lifter so both consumers accept the same agent contract.
 */
export function liftToDraftExperienceShape(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed
  const obj = parsed as Record<string, unknown>

  // Chat-style {mutations: {...}}.
  if (obj.mutations && typeof obj.mutations === "object") {
    return obj.mutations
  }

  // Diff envelope {diff: {scalars: {...}, blocks: [...]}}.
  if (obj.diff && typeof obj.diff === "object") {
    const diff = obj.diff as Record<string, unknown>
    const scalars = (diff.scalars ?? {}) as Record<string, unknown>
    const lifted: Record<string, unknown> = {}

    const title = scalars.title
    if (typeof title === "string") {
      lifted.title = title
    } else if (
      title &&
      typeof title === "object" &&
      "after" in (title as Record<string, unknown>)
    ) {
      lifted.title = (title as { after: unknown }).after
    }

    const meta = scalars.metaDescription
    if (typeof meta === "string") {
      lifted.metaDescription = meta
    } else if (
      meta &&
      typeof meta === "object" &&
      "after" in (meta as Record<string, unknown>)
    ) {
      lifted.metaDescription = (meta as { after: unknown }).after
    }

    if (Array.isArray(diff.blocks)) {
      lifted.blocks = diff.blocks
    }
    return lifted
  }

  return parsed
}

// `extractJsonObject` is now the shared balanced-brace scanner in
// `@/services/experience-ai/extract-json-object` — imported above so the
// workflow's first-pass parse handles the SAME envelope shapes the chat
// path tolerates (free-tier models wrap structured output in prose or
// ```json fences even when the prompt says JSON-only).

async function parseDraftEnvelope(
  step: WorkflowStepName,
  text: string,
): Promise<DraftExperience> {
  // Three-tier fallback ladder, matching the chat service's
  // runMastraChat resilience. Without this, malformed-but-recoverable
  // LLM output (markdown fences, trailing prose, missing commas,
  // unescaped quotes) triggers WorkflowStepError(schema_mismatch),
  // which Mastra's executeStepWithRetry then RETRIES — each retry is
  // another 15–30s LLM call. The chat-turn path already does this
  // ladder; the workflow path did not, so quick-draft + multi-step-draft
  // were paying for repeated LLM calls on every model wobble.
  //
  // 1) Raw JSON.parse on the trimmed text (cheap, covers happy path).
  // 2) extractJsonObject + JSON.parse (covers fence + prose wrappers).
  // 3) extractJsonObject + jsonrepair + JSON.parse (covers near-valid
  //    JSON: trailing commas, missing closers, unescaped quotes).
  let parsed: unknown
  let parseError: unknown = null
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    parseError = err
    const extracted = extractJsonObject(text)
    if (extracted !== null) {
      try {
        parsed = JSON.parse(extracted)
        parseError = null
      } catch (innerErr) {
        parseError = innerErr
        try {
          const { jsonrepair } = await import("jsonrepair")
          const repaired = jsonrepair(extracted)
          parsed = JSON.parse(repaired)
          parseError = null
        } catch (repairErr) {
          parseError = repairErr
        }
      }
    }
  }
  if (parseError !== null) {
    throw new WorkflowStepError(
      step,
      "schema_mismatch",
      "agent output was not valid JSON",
      parseError,
    )
  }
  const lifted = liftToDraftExperienceShape(parsed)
  const result = DraftExperienceSchema.safeParse(lifted)
  if (!result.success) {
    throw new WorkflowStepError(
      step,
      "schema_mismatch",
      `agent JSON did not satisfy DraftExperienceSchema: ${result.error.message}`,
      result.error,
    )
  }
  return result.data
}

/**
 * Frame the optional structure-and-voice exemplar. The reference teaches
 * layout rhythm and copy tone only — the editor prompt stays
 * authoritative for content, and videos come exclusively from the
 * candidate list (the exemplar has its video ids stripped upstream).
 * Returns null when no exemplar was supplied so the default-path prompt
 * is byte-identical to the pre-feature behaviour.
 */
function exemplarSection(exemplar: string | undefined): string | null {
  if (!exemplar || exemplar.trim().length === 0) return null
  return [
    "Structure & voice reference (borrow the layout rhythm and copy tone; write your OWN copy and use ONLY the provided video candidates — do NOT reuse this reference's videos or copy verbatim):",
    exemplar,
  ].join("\n")
}

function buildPlanPrompt(input: WorkflowInput): string {
  const candidateHint =
    input.candidates.length > 0
      ? `Available video candidates (titles only): ${input.candidates
          .map((c) => c.title)
          .filter(Boolean)
          .slice(0, 12)
          .join("; ")}`
      : "No specific video candidates provided."
  const parts = [`Editor prompt: ${input.prompt}`, `Locale: ${input.locale}`]
  const reference = exemplarSection(input.exemplar)
  if (reference) parts.push(reference)
  parts.push(candidateHint)
  return parts.join("\n\n")
}

function buildDraftPrompt(input: PlanStepOutput): string {
  const parts = [
    "Planning outline (use as narrative-arc context):",
    input.plan || "(no outline provided)",
    "",
    `Editor prompt: ${input.prompt}`,
    `Locale: ${input.locale}`,
  ]
  const reference = exemplarSection(input.exemplar)
  if (reference) {
    parts.push("", reference)
  }
  return parts.join("\n")
}

function buildCritiquePrompt(input: DraftStepOutput): string {
  return ["Draft to review (JSON):", JSON.stringify(input.draft)].join("\n")
}

function buildRevisePrompt(input: CritiqueStepOutput): string {
  return [
    "Original draft (JSON):",
    JSON.stringify(input.draft),
    "",
    "Critique notes to apply:",
    input.notes,
  ].join("\n")
}

/**
 * Resolve a draft-producing step's result to a validated
 * DraftExperience. Prefers the provider-validated `object` from
 * structured output (already schema-enforced at decode time on the
 * gateway path); falls back to the text → extract → jsonrepair ladder
 * for providers that answered with plain text, or in the unexpected
 * case where the structured object still misses the Zod schema.
 */
async function resolveDraft(
  step: WorkflowStepName,
  result: { text: string; object?: unknown },
): Promise<DraftExperience> {
  if (result.object !== undefined) {
    const parsed = DraftExperienceSchema.safeParse(
      liftToDraftExperienceShape(result.object),
    )
    if (parsed.success) return parsed.data
  }
  const text =
    result.text.length > 0 || result.object === undefined
      ? result.text
      : JSON.stringify(result.object)
  return parseDraftEnvelope(step, text)
}

// ---------------------------------------------------------------------------
// Step executors — exported for unit-testing without a real Mastra runtime
// ---------------------------------------------------------------------------

export async function executePlanStep(
  ctx: StepContext<WorkflowInput>,
): Promise<PlanStepOutput> {
  const { text } = await callAgent(
    ctx.mastra,
    "plan",
    "experience-planner",
    buildPlanPrompt(ctx.inputData),
    TOKEN_CAPS.multiStepDraftPlan,
    ctx.abortSignal,
  )
  return { ...ctx.inputData, plan: text.trim() }
}

export async function executeDraftStep(
  ctx: StepContext<PlanStepOutput>,
): Promise<DraftStepOutput> {
  const result = await callAgent(
    ctx.mastra,
    "draft",
    "draft-experience",
    buildDraftPrompt(ctx.inputData),
    TOKEN_CAPS.multiStepDraftDraft,
    ctx.abortSignal,
    structuredDraftOutputEnabled() ? STRUCTURED_DRAFT_OPTS : {},
  )
  const draft = await resolveDraft("draft", result)
  return { ...ctx.inputData, draft }
}

export async function executeCritiqueStep(
  ctx: StepContext<DraftStepOutput>,
): Promise<CritiqueStepOutput> {
  const { text } = await callAgent(
    ctx.mastra,
    "critique",
    "experience-critic",
    buildCritiquePrompt(ctx.inputData),
    TOKEN_CAPS.multiStepDraftCritique,
    ctx.abortSignal,
  )
  return { draft: ctx.inputData.draft, notes: text.trim() }
}

export async function executeReviseStep(
  ctx: StepContext<CritiqueStepOutput>,
): Promise<RevisedStepOutput> {
  const result = await callAgent(
    ctx.mastra,
    "revise",
    "experience-reviser",
    buildRevisePrompt(ctx.inputData),
    TOKEN_CAPS.multiStepDraftRevise,
    ctx.abortSignal,
    structuredDraftOutputEnabled() ? STRUCTURED_DRAFT_OPTS : {},
  )
  const draft = await resolveDraft("revise", result)
  return { draft }
}

// ---------------------------------------------------------------------------
// createStep wrappers — delegate to the executors above
// ---------------------------------------------------------------------------

type WorkflowExecuteArg<I> = {
  inputData: I
  mastra: Mastra
  abortSignal?: AbortSignal
}

const planStep = createStep({
  id: "plan",
  inputSchema,
  outputSchema: planSchema,
  execute: async (args: WorkflowExecuteArg<WorkflowInput>) =>
    executePlanStep(args as unknown as StepContext<WorkflowInput>),
})

const draftStep = createStep({
  id: "draft",
  inputSchema: planSchema,
  outputSchema: draftSchema,
  execute: async (args: WorkflowExecuteArg<PlanStepOutput>) =>
    executeDraftStep(args as unknown as StepContext<PlanStepOutput>),
})

const critiqueStep = createStep({
  id: "critique",
  inputSchema: draftSchema,
  outputSchema: critiqueSchema,
  execute: async (args: WorkflowExecuteArg<DraftStepOutput>) =>
    executeCritiqueStep(args as unknown as StepContext<DraftStepOutput>),
})

const reviseStep = createStep({
  id: "revise",
  inputSchema: critiqueSchema,
  outputSchema: revisedSchema,
  execute: async (args: WorkflowExecuteArg<CritiqueStepOutput>) =>
    executeReviseStep(args as unknown as StepContext<CritiqueStepOutput>),
})

/**
 * Multi-step draft workflow. Four sequential named steps. Step cap
 * is structural — no `.unless()`, no `.loop()`, no recursion.
 */
export const multiStepDraftWorkflow = createWorkflow({
  id: "multi-step-draft",
  inputSchema,
  outputSchema: revisedSchema,
  // Disable Mastra's default step retry: schema_mismatch on a free-tier
  // LLM is recoverable via parseDraftEnvelope's three-tier ladder
  // (raw → extractJsonObject → jsonrepair). Letting the engine retry
  // the step on top of that just stacks another 15–30s LLM call per
  // attempt for the same failure mode the parser already handled.
  // A genuine failure should fail fast and surface UPSTREAM_ERROR to
  // the editor immediately, not after multi-minute silent retries.
  retryConfig: { attempts: 0 },
})
  .then(planStep)
  .then(draftStep)
  .then(critiqueStep)
  .then(reviseStep)

multiStepDraftWorkflow.commit()

/**
 * Maximum number of steps this workflow will execute. Exported so the
 * cost-budget tests can assert structural invariance: any change to
 * the chain length would change this constant, which fails the cap
 * check.
 */
export const MULTI_STEP_DRAFT_MAX_STEPS = 4

/**
 * Quick-draft workflow — plan → draft only. The "speed mode"
 * counterpart of `multiStepDraftWorkflow`: skips the critique +
 * revise steps so wall-clock drops by roughly half at the cost of
 * the second-pass refinement (no automatic copy-edit, no structural
 * critique applied).
 *
 * Reuses the same `planStep` + `draftStep` executors registered
 * above, so a change to either step's prompt or token cap is picked
 * up by BOTH workflows in lockstep. Action layer
 * (`generate-draft-action.ts`) picks the workflow id by
 * `input.mode` and unwraps the result against the same
 * `DraftExperienceSchema` either way.
 *
 * Output shape is `draftSchema` (the planSchema-extended-with-draft
 * envelope), not `revisedSchema`. The action's
 * `(result as { draft: DraftExperience }).draft` cast works for both
 * because both shapes carry `.draft` at the top level — revisedSchema
 * is `{ draft }`, draftSchema is `{ ...planFields, draft }`.
 */
export const quickDraftWorkflow = createWorkflow({
  id: "quick-draft",
  inputSchema,
  outputSchema: draftSchema,
  // Same retry rationale as multiStepDraftWorkflow above —
  // parseDraftEnvelope's resilient ladder already absorbs the only
  // recoverable failure mode; an engine-level retry just compounds
  // wall-clock for nothing.
  retryConfig: { attempts: 0 },
})
  .then(planStep)
  .then(draftStep)

quickDraftWorkflow.commit()

/**
 * Step count for the quick-draft path. Same structural-invariance
 * role as `MULTI_STEP_DRAFT_MAX_STEPS`.
 */
export const QUICK_DRAFT_MAX_STEPS = 2
