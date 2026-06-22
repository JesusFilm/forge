/**
 * Multi-step planning workflow — plan → skeleton → fill → critique → revise.
 *
 * A `@mastra/core/workflows` workflow with fixed sequential steps. The step cap
 * is implicit in the chain length (no recursion is possible), which satisfies
 * the no-runaway-loops invariant. A wall-clock cap is applied at invocation
 * time via `AbortSignal.timeout()` — the workflow itself doesn't enforce it.
 *
 * Ported (consolidation U4) from
 * `apps/admin/src/mastra/workflows/multi-step-draft-workflow.ts` into the
 * standalone service. Only the env import path changes (`@/config/env` →
 * `../../config/env`); the generation contract is single-sourced from
 * `@forge/experience-schema` so generator and admin re-validator cannot drift.
 *
 * Each step's `execute` calls a Mastra agent via the injected `mastra`
 * parameter (NOT a module import — that would close a cycle through
 * `mastra/index.ts`). Token caps per step come from `TOKEN_CAPS.multiStepDraft*`.
 *
 * Memory-less by construction: no `agent.generate({ memory: ... })` or
 * `threadId:` option is ever passed. The workflow agents
 * (experience-planner / skeleton / fill / critic / reviser) are also defined
 * without `memory` — defense in depth.
 *
 * Each step's body is extracted as an exported `executeXStep` function so unit
 * tests can drive them with a synthetic Mastra surface and deterministic
 * agent.generate mocks. The `createStep` wrappers delegate to those executors.
 */

import { createStep, createWorkflow } from "@mastra/core/workflows"
import type { Mastra } from "@mastra/core"
import { z } from "zod"

import { env } from "../../config/env"
import { TOKEN_CAPS } from "../budgets"
import {
  coerceDraftEnvelope,
  DraftExperienceSchema,
  extractJsonObject,
  getFillSchemaForType,
  SkeletonSchema,
  validateSkeleton,
} from "@forge/experience-schema"
import type {
  DraftExperience,
  Skeleton,
  SkeletonNode,
} from "@forge/experience-schema"

// ---------------------------------------------------------------------------
// Typed step boundary error
// ---------------------------------------------------------------------------

export type WorkflowStepName =
  | "plan"
  | "draft"
  | "skeleton"
  | "fill"
  | "critique"
  | "revise"
export type WorkflowStepFailureReason =
  | "schema_mismatch"
  | "agent_error"
  | "timeout"
  // The provider stopped because it hit the output-token ceiling
  // (`finishReason === "length"`), so the emitted text/object is a
  // TRUNCATED prefix. Non-repairable: re-prompting with the same cap
  // truncates again. Classified to UPSTREAM_ERROR at the action layer,
  // NOT routed into the repair loop. Guarded strictly on
  // `=== "length"` — never `!== "stop"` (finishReason is optional, and
  // providers that omit it must take the normal parse path).
  | "truncated"

/**
 * Typed error thrown by any step when its body cannot produce valid output.
 * The action layer classifies on these discriminator fields — `step` +
 * `reason` — and maps to the outer error union. Never regex on `err.message`
 * (cf.
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

// Open shape — the action passes whatever the candidate-loader returns. The
// workflow only stringifies a few fields into prompts, so the schema stays
// lenient. Pinned on `videoId` (the real `VideoCandidate` shape) per the
// consolidation plan's wire contract; other fields stay optional + passthrough.
const candidateSchema = z
  .object({
    videoId: z.string().optional(),
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
  // Optional structure-and-voice reference (a real published page, video ids
  // already stripped). Threaded into the planner + drafter prompts. Both
  // quick-draft and multi-step-draft consume the same builders, so this covers
  // both modes.
  exemplar: z.string().optional(),
})
type WorkflowInput = z.infer<typeof inputSchema>

const planSchema = inputSchema.extend({
  plan: z.string(),
})
type PlanStepOutput = z.infer<typeof planSchema>

// DraftExperience is the canonical output shape — re-use directly rather than
// re-declaring it inside the workflow so a schema bump over there propagates
// here.
const draftSchema = planSchema.extend({
  draft: DraftExperienceSchema,
})
type DraftStepOutput = z.infer<typeof draftSchema>

// Two-phase generation — skeleton step output carries the plan fields plus the
// validated structure-only skeleton. The fill step then consumes it and
// re-emits the SAME `draftSchema` envelope the legacy draft step produced, so
// `critiqueStep.inputSchema` and the action's `result.draft` cast stay valid
// for BOTH workflows.
//
// `skeleton` is typed loosely as a passthrough object here: the skeleton step
// has already run `validateSkeleton` (the structural gate) before emitting, so
// re-asserting the full tree shape in the step boundary schema would be
// redundant. Mastra's step-boundary parse only needs to carry the value
// through to the fill step.
const skeletonSchema = planSchema.extend({
  skeleton: z.object({ nodes: z.array(z.unknown()) }).passthrough(),
})
type SkeletonStepOutput = z.infer<typeof skeletonSchema> & {
  skeleton: Skeleton
}

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

// `structuredOutput.schema` is a generic Zod schema, not pinned to
// `DraftExperienceSchema`: the two-phase fill step threads a per-node flat
// block schema, and the draft/revise steps thread per-phase schemas. The agent
// only forwards it to the provider as the constrained-decoding JSON schema, so
// the generic `z.ZodType` is the honest type.
type AgentResult = { text: string; object?: unknown; finishReason?: string }

type MastraAgent = {
  generate: (
    prompt: string,
    opts: {
      abortSignal?: AbortSignal
      maxOutputTokens: number
      toolChoice?: "auto" | "none" | "required"
      structuredOutput?: { schema: z.ZodType }
    },
  ) => Promise<AgentResult>
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
 * Whether the draft/revise steps should request provider-native structured
 * output. Gated to the JesusFilm gateway path (same gate the agents use): vLLM
 * guided decoding (`response_format: json_schema`) makes schema-invalid drafts
 * impossible at the decoder level, AND `toolChoice: "none"` keeps the model out
 * of tool round-trips — the gateway's LiteLLM translation 500s with a `'role'`
 * KeyError on multi-tool conversations. The workflow gets video candidates
 * pre-loaded in its input, so the drafter does not need search tools here.
 * Google/OpenRouter keep the text → parse-ladder path that already works.
 */
function structuredDraftOutputEnabled(): boolean {
  return Boolean(
    env.AI_GATEWAY_CHAT_API_KEY && env.AI_GATEWAY_CHAT_ENABLED === "true",
  )
}

/**
 * Whether per-phase schema-constrained decoding (`structuredOutput`) may
 * ACTUALLY be sent to the provider. Two preconditions, both required:
 *
 *  1. `structuredDraftOutputEnabled()` — the active provider is the JesusFilm
 *     gateway (the only provider whose constrained-decoding surface we wire
 *     here; Gemini/OpenRouter take the free-text path).
 *  2. `AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED === "true"` — an operator
 *     flipped the trusted flag, which only happens after the BlocksSchema smoke
 *     gate is green for that provider.
 *
 * Even on the gateway path, structured opts are withheld until the provider's
 * constrained decoding is verified. The DEFAULT (flag unset/"false", or a
 * non-gateway provider) takes the free-text + coercion + repair + validator
 * path and still produces a valid draft — the final guarantee never depends on
 * constrained decoding.
 */
function constrainedDecodingTrusted(): boolean {
  return (
    structuredDraftOutputEnabled() &&
    env.AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED === "true"
  )
}

/**
 * Per-phase structured-output opts. When constrained decoding is trusted
 * (gateway + trusted flag), constrain the call to `schema` so off-shape output
 * is prevented at the decoder and keep the model out of tool round-trips
 * (`toolChoice: "none"`). When NOT trusted, return `{}` so the agent keeps its
 * free-text path (coercion + schema parse carry correctness). Skeleton phase
 * passes `SkeletonSchema`, fill passes the per-node flat block schema,
 * draft/revise pass `DraftExperienceSchema`.
 */
function structuredOptsFor(schema: z.ZodType): {
  toolChoice?: "auto" | "none" | "required"
  structuredOutput?: { schema: z.ZodType }
} {
  if (!constrainedDecodingTrusted()) return {}
  return { toolChoice: "none", structuredOutput: { schema } }
}

async function callAgent(
  mastra: MastraSurface,
  step: WorkflowStepName,
  agentId: string,
  prompt: string,
  maxOutputTokens: number,
  abortSignal: AbortSignal | undefined,
  extraOpts: {
    toolChoice?: "auto" | "none" | "required"
    structuredOutput?: { schema: z.ZodType }
  } = {},
): Promise<AgentResult> {
  const agent = mastra.getAgentById(agentId)
  let result: AgentResult
  try {
    result = await agent.generate(prompt, {
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
  // Truncation guard. A `finishReason === "length"` means the provider hit the
  // output-token ceiling mid-document, so `result.text` / `result.object` is a
  // TRUNCATED prefix — parsing it would succeed-then-fail or silently drop tail
  // blocks. Fail closed BEFORE any parse so it covers EVERY phase. Guard
  // strictly on the literal `"length"` — `finishReason` is optional and
  // providers that omit it (or report "stop"/"tool_calls"/etc.) must take the
  // normal path. Non-repairable: re-prompting with the same cap truncates
  // again, so it maps to UPSTREAM_ERROR at the action layer and never enters
  // the repair loop. Plain-string log (Railway logsV2 silences JSON.stringify
  // payloads from this runtime path).
  if (result.finishReason === "length") {
    console.warn(
      `[draft-workflow] event=output_truncated step=${step} finish_reason=length`,
    )
    throw new WorkflowStepError(
      step,
      "truncated",
      `agent output truncated on step '${step}' (finishReason=length)`,
    )
  }
  return result
}

/**
 * Lift the agent's JSON output to the flat {title, metaDescription, blocks}
 * shape DraftExperienceSchema expects.
 *
 * The draft-experience and experience-reviser prompts instruct the model to
 * emit a chat-style envelope ({diff:{scalars:{title:{after},
 * metaDescription:{after}}, blocks}} or {mutations:{...}}) because those
 * prompts are also wired into the default chat agent, which lifts the same
 * shapes. The workflow path consumes the agent output directly via
 * DraftExperienceSchema and historically rejected anything but the flat shape,
 * so every workflow run failed with WorkflowStepError(reason=schema_mismatch).
 * This helper mirrors the chat-path lifter so both consumers accept the same
 * agent contract.
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

// `extractJsonObject` is the shared balanced-brace scanner in
// `@forge/experience-schema` — imported above so the workflow's first-pass
// parse handles the SAME envelope shapes the chat path tolerates (free-tier
// models wrap structured output in prose or ```json fences even when the
// prompt says JSON-only).

/**
 * Lift the agent output to the flat DraftExperience shape, then run the
 * deterministic, pure, LOSSY coercion BEFORE any `DraftExperienceSchema`
 * validation. Coercion fixes the cheapest near-miss drifts (discriminator
 * casing, unknown keys, illegal/unknown blocks, known-safe defaults) so the
 * post-normalize repair loop fires less often.
 *
 * Every coercion is emitted as a plain-string `[draft-workflow]
 * event=coercion_applied kind=<kind>` log line — NOT `JSON.stringify`, because
 * Railway logsV2 silences JSON-stringified payloads from this runtime path (see
 * `docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md`).
 */
function liftAndCoerce(parsed: unknown): unknown {
  const lifted = liftToDraftExperienceShape(parsed)
  const { draft, coercions } = coerceDraftEnvelope(lifted)
  for (const coercion of coercions) {
    console.warn(
      `[draft-workflow] event=coercion_applied kind=${coercion.kind}`,
    )
  }
  return draft
}

async function parseDraftEnvelope(
  step: WorkflowStepName,
  text: string,
): Promise<DraftExperience> {
  // Three-tier fallback ladder, matching the chat service's resilience.
  // Without this, malformed-but-recoverable LLM output (markdown fences,
  // trailing prose, missing commas, unescaped quotes) triggers
  // WorkflowStepError(schema_mismatch), which Mastra's executeStepWithRetry
  // then RETRIES — each retry is another 15–30s LLM call.
  //
  // 1) Raw JSON.parse on the trimmed text (cheap, covers happy path).
  // 2) extractJsonObject + JSON.parse (covers fence + prose wrappers).
  // 3) extractJsonObject + jsonrepair + JSON.parse (covers near-valid JSON:
  //    trailing commas, missing closers, unescaped quotes).
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
  const lifted = liftAndCoerce(parsed)
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
 * Frame the optional structure-and-voice exemplar. The reference teaches layout
 * rhythm and copy tone only — the editor prompt stays authoritative for
 * content, and videos come exclusively from the candidate list (the exemplar
 * has its video ids stripped upstream). Returns null when no exemplar was
 * supplied so the default-path prompt is byte-identical to the pre-feature
 * behaviour.
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

function buildSkeletonPrompt(input: PlanStepOutput): string {
  const parts = [
    "Planning outline (use as narrative-arc context):",
    input.plan || "(no outline provided)",
    "",
    `Editor prompt: ${input.prompt}`,
    `Locale: ${input.locale}`,
  ]
  // Exemplar (when supplied) is a structure-and-voice reference — for the
  // skeleton phase its value is the LAYOUT RHYTHM (block-type ordering/nesting).
  const reference = exemplarSection(input.exemplar)
  if (reference) parts.push("", reference)
  parts.push(
    "",
    "Emit the page STRUCTURE only (the ordered block-type tree). No content.",
  )
  return parts.join("\n")
}

/**
 * Build the per-node fill prompt. Carries the overall context (plan + editor
 * prompt), the exact block type to fill, and the blocks filled SO FAR (for
 * coherence — a later fill can see earlier filled blocks).
 */
function buildFillPrompt(args: {
  plan: string
  prompt: string
  locale: string
  nodeType: string
  sectionRef?: string
  priorBlocks: readonly unknown[]
  exemplar?: string
}): string {
  const priorContext =
    args.priorBlocks.length > 0
      ? JSON.stringify(args.priorBlocks)
      : "(none yet — this is the first block)"
  const parts = [
    "Planning outline (overall narrative-arc context):",
    args.plan || "(no outline provided)",
    "",
    `Editor prompt: ${args.prompt}`,
    `Locale: ${args.locale}`,
  ]
  // Exemplar (when supplied) is a structure-and-voice reference — for the fill
  // phase its value is the COPY TONE/VOICE (write your own copy in a comparable
  // register; never reuse its words or videos verbatim).
  const reference = exemplarSection(args.exemplar)
  if (reference) parts.push("", reference)
  parts.push(
    "",
    "Blocks already written before this one (continue the narrative; do not contradict or repeat them):",
    priorContext,
    "",
    `Now write exactly ONE block of type "${args.nodeType}"${
      args.sectionRef ? ` (sectionRef "${args.sectionRef}")` : ""
    }.`,
    `Return a single flat block object whose "t" is "${args.nodeType}".`,
  )
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
 * Resolve a draft-producing step's result to a validated DraftExperience.
 * Prefers the provider-validated `object` from structured output (already
 * schema-enforced at decode time on the gateway path); falls back to the text →
 * extract → jsonrepair ladder for providers that answered with plain text, or
 * in the unexpected case where the structured object still misses the Zod
 * schema.
 */
async function resolveDraft(
  step: WorkflowStepName,
  result: AgentResult,
): Promise<DraftExperience> {
  if (result.object !== undefined) {
    const parsed = DraftExperienceSchema.safeParse(liftAndCoerce(result.object))
    if (parsed.success) return parsed.data
  }
  const text =
    result.text.length > 0 || result.object === undefined
      ? result.text
      : JSON.stringify(result.object)
  return parseDraftEnvelope(step, text)
}

// ---------------------------------------------------------------------------
// Two-phase generation — JSON parse + per-node fill helpers
// ---------------------------------------------------------------------------

/**
 * Parse an agent's JSON output to an unknown object using the same three-tier
 * resilience ladder `parseDraftEnvelope` uses (raw → extractJsonObject →
 * jsonrepair). Prefers a provider-validated structured `object` when present.
 * Throws `WorkflowStepError(step, "schema_mismatch")` when nothing parses.
 */
async function parseAgentJson(
  step: WorkflowStepName,
  result: AgentResult,
): Promise<unknown> {
  if (result.object !== undefined && typeof result.object === "object") {
    return result.object
  }
  const text =
    result.text.length > 0 || result.object === undefined
      ? result.text
      : JSON.stringify(result.object)
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
          parsed = JSON.parse(jsonrepair(extracted))
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
      `agent output was not valid JSON on step '${step}'`,
      parseError,
    )
  }
  return parsed
}

/**
 * Lift a skeleton agent's output to the `{ nodes: [...] }` envelope. Tolerates
 * a bare top-level array (`[node, node]`) and the chat-style
 * `{ skeleton: { nodes } }` / `{ nodes }` shapes free-tier models emit.
 */
function liftSkeletonEnvelope(parsed: unknown): unknown {
  if (Array.isArray(parsed)) return { nodes: parsed }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.nodes)) return { nodes: obj.nodes }
    if (
      obj.skeleton &&
      typeof obj.skeleton === "object" &&
      Array.isArray((obj.skeleton as Record<string, unknown>).nodes)
    ) {
      return obj.skeleton
    }
  }
  return parsed
}

/**
 * Count the fillable nodes in a skeleton tree (every node EXCEPT the pure
 * nesting shells `section`/`container`, whose content is filled as their
 * children). Used only for the structured start log so operators can see the
 * fill fan-out.
 */
function countFillableNodes(nodes: readonly SkeletonNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.type === "section" || node.type === "container") {
      count += countFillableNodes(node.children ?? [])
    } else {
      count += 1
    }
  }
  return count
}

/**
 * Synthesize a baseline title + metaDescription from the editor prompt and
 * planning outline. The skeleton/fill phases produce STRUCTURE + per-block
 * CONTENT — neither owns the page scalars — so the fill step derives a
 * deterministic, always-non-empty baseline here. The downstream critique →
 * revise pass polishes these into editorial copy; `quick-draft` (no revise)
 * keeps the baseline. Both always satisfy `DraftExperienceSchema`'s `.min(1)`
 * on title + metaDescription.
 */
function synthesizeScalars(input: PlanStepOutput): {
  title: string
  metaDescription: string
} {
  const prompt = input.prompt.trim()
  const title = (prompt.split(/[.!?\n]/)[0] || prompt || "Untitled experience")
    .trim()
    .slice(0, 120)
  const planFirstSentence = (input.plan || "").trim().split(/[.!?\n]/)[0] || ""
  const metaSource = planFirstSentence || prompt || title
  const metaDescription = metaSource.trim().slice(0, 200) || title
  return {
    title: title || "Untitled experience",
    metaDescription: metaDescription || title || "Untitled experience",
  }
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
    structuredOptsFor(DraftExperienceSchema),
  )
  const draft = await resolveDraft("draft", result)
  return { ...ctx.inputData, draft }
}

export async function executeSkeletonStep(
  ctx: StepContext<PlanStepOutput>,
): Promise<SkeletonStepOutput> {
  const result = await callAgent(
    ctx.mastra,
    "skeleton",
    "experience-skeleton",
    buildSkeletonPrompt(ctx.inputData),
    TOKEN_CAPS.multiStepDraftSkeleton,
    ctx.abortSignal,
    structuredOptsFor(SkeletonSchema),
  )
  const parsed = await parseAgentJson("skeleton", result)
  const lifted = liftSkeletonEnvelope(parsed)
  const validation = validateSkeleton(lifted)
  if (!validation.ok) {
    // Plain-string log (Railway logsV2 silences JSON.stringify payloads from
    // this runtime path) — the fail-fast structural gate.
    console.warn(
      `[draft-workflow] event=skeleton_validation_failed code=${validation.code}`,
    )
    throw new WorkflowStepError(
      "skeleton",
      "schema_mismatch",
      `skeleton failed structural validation: ${validation.message}`,
    )
  }
  console.warn(
    `[draft-workflow] event=skeleton_validated top_level_nodes=${validation.skeleton.nodes.length} fillable_nodes=${countFillableNodes(
      validation.skeleton.nodes,
    )}`,
  )
  return { ...ctx.inputData, skeleton: validation.skeleton }
}

/**
 * Fill a single fillable skeleton node: call the fill agent constrained to that
 * node's flat block schema, passing prior filled blocks for coherence. Parses,
 * lifts/coerces, and validates against the per-node schema. On failure throws
 * `WorkflowStepError("fill", "schema_mismatch")`.
 *
 * `sectionRef` from the skeleton is stamped onto the filled block (the skeleton
 * owns nesting/addressing; the fill owns content).
 */
async function fillSingleNode(
  ctx: StepContext<SkeletonStepOutput>,
  node: SkeletonNode,
  priorBlocks: readonly unknown[],
): Promise<Record<string, unknown>> {
  const fillSchema = getFillSchemaForType(node.type)
  if (fillSchema === undefined) {
    // Should be unreachable — callers only invoke this for fillable
    // (non-shell) nodes — but keep the boundary honest.
    throw new WorkflowStepError(
      "fill",
      "schema_mismatch",
      `no fill schema for node type '${node.type}'`,
    )
  }
  const result = await callAgent(
    ctx.mastra,
    "fill",
    "experience-fill",
    buildFillPrompt({
      plan: ctx.inputData.plan,
      prompt: ctx.inputData.prompt,
      locale: ctx.inputData.locale,
      nodeType: node.type,
      sectionRef: node.sectionRef,
      priorBlocks,
      exemplar: ctx.inputData.exemplar,
    }),
    TOKEN_CAPS.multiStepDraftFill,
    ctx.abortSignal,
    structuredOptsFor(fillSchema),
  )
  const parsed = await parseAgentJson("fill", result)
  // The fill agent may wrap its single block in a chat-style envelope; lift +
  // coerce the same way the draft path does, then unwrap a single-element
  // blocks array if the model nested it.
  let candidate: unknown = liftToDraftExperienceShape(parsed)
  if (
    candidate &&
    typeof candidate === "object" &&
    Array.isArray((candidate as Record<string, unknown>).blocks)
  ) {
    const blocks = (candidate as Record<string, unknown>).blocks as unknown[]
    candidate = blocks[0]
  }
  // Coerce the single block (discriminator casing, unknown-key strip) before
  // the per-node schema parse. Wrap it as a one-block envelope so the shared
  // coercion (which expects `{ blocks }`) applies, then unwrap.
  const { draft: coercedEnvelope, coercions } = coerceDraftEnvelope({
    blocks: [candidate],
  })
  for (const coercion of coercions) {
    console.warn(
      `[draft-workflow] event=coercion_applied kind=${coercion.kind}`,
    )
  }
  const coercedBlock = Array.isArray(
    (coercedEnvelope as Record<string, unknown>).blocks,
  )
    ? ((coercedEnvelope as Record<string, unknown>).blocks as unknown[])[0]
    : candidate
  // Stamp the skeleton's sectionRef when the model omitted it.
  if (
    node.sectionRef &&
    coercedBlock &&
    typeof coercedBlock === "object" &&
    (coercedBlock as Record<string, unknown>).sectionRef === undefined
  ) {
    ;(coercedBlock as Record<string, unknown>).sectionRef = node.sectionRef
  }
  const validated = fillSchema.safeParse(coercedBlock)
  if (!validated.success) {
    throw new WorkflowStepError(
      "fill",
      "schema_mismatch",
      `filled block for type '${node.type}' did not satisfy its schema: ${validated.error.message}`,
    )
  }
  return validated.data as Record<string, unknown>
}

/**
 * Assemble one skeleton node into a Draft block, filling content SEQUENTIALLY
 * in document order. `accumulator` is the running flat list of every block
 * filled so far (top-level + nested), used as coherence context for each
 * subsequent fill. Returns the assembled block.
 *
 *  - `section` shell → `{ t: "section", sectionRef?, content: [...] }`,
 *    children filled in order as section-scope blocks.
 *  - `container` shell → `{ t: "container", sectionRef?, slots: [{ content }] }`,
 *    children filled in order as container-scope blocks, one slot per child.
 *  - leaf → the filled block itself.
 */
async function assembleNode(
  ctx: StepContext<SkeletonStepOutput>,
  node: SkeletonNode,
  accumulator: unknown[],
): Promise<Record<string, unknown>> {
  if (node.type === "section") {
    const content: Record<string, unknown>[] = []
    for (const child of node.children ?? []) {
      const childBlock = await assembleNode(ctx, child, accumulator)
      content.push(childBlock)
    }
    const shell: Record<string, unknown> = { t: "section", content }
    if (node.sectionRef) shell.sectionRef = node.sectionRef
    return shell
  }
  if (node.type === "container") {
    const slots: Array<{ content: Record<string, unknown>[] }> = []
    for (const child of node.children ?? []) {
      const childBlock = await assembleNode(ctx, child, accumulator)
      slots.push({ content: [childBlock] })
    }
    const shell: Record<string, unknown> = { t: "container", slots }
    if (node.sectionRef) shell.sectionRef = node.sectionRef
    return shell
  }
  // Leaf — fill its content, threading the running accumulator so this fill can
  // see every block written before it (coherence).
  const filled = await fillSingleNode(ctx, node, accumulator)
  accumulator.push(filled)
  return filled
}

export async function executeFillStep(
  ctx: StepContext<SkeletonStepOutput>,
): Promise<DraftStepOutput> {
  const { skeleton } = ctx.inputData
  const accumulator: unknown[] = []
  const blocks: Record<string, unknown>[] = []
  // SEQUENTIAL fill in declared skeleton order — no Promise.all. Order is
  // deterministic (the skeleton array IS the order) and each fill sees the
  // blocks filled before it via the shared accumulator.
  for (const node of skeleton.nodes) {
    const block = await assembleNode(ctx, node, accumulator)
    blocks.push(block)
  }
  const scalars = synthesizeScalars(ctx.inputData)
  // Run the assembled draft through the SAME coercion + DraftExperienceSchema
  // machinery the legacy draft path uses. Coercion drops any block that slipped
  // through (defense in depth); the schema parse is the gate.
  const lifted = liftAndCoerce({
    title: scalars.title,
    metaDescription: scalars.metaDescription,
    blocks,
  })
  const parsed = DraftExperienceSchema.safeParse(lifted)
  if (!parsed.success) {
    throw new WorkflowStepError(
      "fill",
      "schema_mismatch",
      `assembled fill draft did not satisfy DraftExperienceSchema: ${parsed.error.message}`,
      parsed.error,
    )
  }
  // Strip the skeleton field; re-emit the SAME `{ ...planFields, draft }`
  // envelope the legacy draft step produced (load-bearing contract).
  const { skeleton: _skeleton, ...planFields } = ctx.inputData
  void _skeleton
  return { ...planFields, draft: parsed.data }
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
    structuredOptsFor(DraftExperienceSchema),
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

// NOTE: the legacy single-shot `draftStep` createStep was retired in the
// two-phase rebuild — neither workflow chains it anymore. Its executor
// `executeDraftStep` is RETAINED (exported) because the repair loop re-prompts
// a single agent directly and the executor + its structured-output path stay
// unit-tested; only the workflow wiring moved to skeleton → fill.

const skeletonStep = createStep({
  id: "skeleton",
  inputSchema: planSchema,
  outputSchema: skeletonSchema,
  execute: async (args: WorkflowExecuteArg<PlanStepOutput>) =>
    executeSkeletonStep(args as unknown as StepContext<PlanStepOutput>),
})

const fillStep = createStep({
  id: "fill",
  inputSchema: skeletonSchema,
  outputSchema: draftSchema,
  // Arg typed as `unknown` payload: `skeletonSchema` infers
  // `skeleton.nodes: unknown[]` (the step-boundary schema is a passthrough —
  // the structural shape was already asserted by `validateSkeleton` in the
  // skeleton step), but `SkeletonStepOutput` narrows `nodes` to
  // `SkeletonNode[]`. The executor re-casts; this wrapper only needs to forward
  // the runtime value.
  execute: async (args: WorkflowExecuteArg<unknown>) =>
    executeFillStep(args as unknown as StepContext<SkeletonStepOutput>),
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
 * Multi-step draft workflow. Five sequential named steps: plan → skeleton →
 * fill → critique → revise. The single fragile draft step was split into a
 * structure-only skeleton step (validated BEFORE any content) plus a sequential
 * per-block fill step. Step cap is structural — no `.unless()`, no `.loop()`,
 * no recursion (the fill step's per-node loop is internal to one step).
 */
export const multiStepDraftWorkflow = createWorkflow({
  id: "multi-step-draft",
  inputSchema,
  outputSchema: revisedSchema,
  // Disable Mastra's default step retry: schema_mismatch on a free-tier LLM is
  // recoverable via parseAgentJson's three-tier ladder (raw → extractJsonObject
  // → jsonrepair). Letting the engine retry the step on top of that just stacks
  // another 15–30s LLM call per attempt for the same failure mode the parser
  // already handled. A genuine failure should fail fast and surface
  // UPSTREAM_ERROR to the editor immediately, not after multi-minute silent
  // retries.
  retryConfig: { attempts: 0 },
})
  .then(planStep)
  .then(skeletonStep)
  .then(fillStep)
  .then(critiqueStep)
  .then(reviseStep)

multiStepDraftWorkflow.commit()

/**
 * Maximum number of steps this workflow will execute. Exported so the
 * cost-budget tests can assert structural invariance: any change to the chain
 * length would change this constant, which fails the cap check. 5 (plan →
 * skeleton → fill → critique → revise); the fill step's per-node fan-out is
 * internal to that single step and does not add to the structural step count.
 */
export const MULTI_STEP_DRAFT_MAX_STEPS = 5

/**
 * Quick-draft workflow — plan → skeleton → fill. The "speed mode" counterpart
 * of `multiStepDraftWorkflow`: skips the critique + revise steps so wall-clock
 * drops at the cost of the second-pass refinement (no automatic copy-edit, no
 * structural critique applied). It keeps the SAME structural validity guarantee
 * the full workflow has — the skeleton is validated and the fill is per-block
 * schema-constrained either way.
 *
 * Reuses the same `planStep` + `skeletonStep` + `fillStep` executors registered
 * above, so a change to any step's prompt or token cap is picked up by BOTH
 * workflows in lockstep. The action layer picks the workflow id by `input.mode`
 * and unwraps the result against the same `DraftExperienceSchema` either way.
 *
 * Output shape is `draftSchema` (the planSchema-extended-with-draft envelope),
 * not `revisedSchema`. The action's `(result as { draft: DraftExperience })
 * .draft` cast works for both because both shapes carry `.draft` at the top
 * level — revisedSchema is `{ draft }`, draftSchema is `{ ...planFields, draft }`
 * (the fill step's load-bearing envelope contract).
 */
export const quickDraftWorkflow = createWorkflow({
  id: "quick-draft",
  inputSchema,
  outputSchema: draftSchema,
  // Same retry rationale as multiStepDraftWorkflow above — parseAgentJson's
  // resilient ladder already absorbs the only recoverable failure mode; an
  // engine-level retry just compounds wall-clock for nothing.
  retryConfig: { attempts: 0 },
})
  .then(planStep)
  .then(skeletonStep)
  .then(fillStep)

quickDraftWorkflow.commit()

/**
 * Step count for the quick-draft path. Same structural-invariance role as
 * `MULTI_STEP_DRAFT_MAX_STEPS`. 3 (plan → skeleton → fill).
 */
export const QUICK_DRAFT_MAX_STEPS = 3
