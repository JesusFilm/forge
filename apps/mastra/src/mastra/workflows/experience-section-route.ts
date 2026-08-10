/**
 * One-shot buffered section route handler — video-anchored generation.
 *
 * Bearer-gated `/forge-experience-section` entrypoint: admin loads the video
 * context pack (study questions, citations, optional scene/transcript) + the
 * anchor candidate, then POSTs `{ locale, anchorCandidate, grounding }`; this
 * handler runs the single-pass `generate-video-section` AGENT on the standalone
 * Mastra instance and returns ONE discriminated JSON envelope. No mastra→admin
 * callback — admin re-validates, allowlist-filters against the pack, normalizes,
 * and persists from the response (ABAC + ContentRevision stay admin-side).
 *
 * Differs from `/forge-experience-draft` only in the RUN: a single
 * `agent.generate(...)` rather than a workflow chain. Everything else (bearer →
 * parse → run-with-internal-timeout → discriminated envelope) mirrors it.
 *
 * Budget: the agent call is wrapped in an internal `AbortSignal.timeout(
 * TIME_BUDGET_MS.section)` AND the signal is passed to `generate` so the
 * in-flight LLM call actually aborts. Admin's outbound caller budget MUST be
 * strictly larger than this internal budget so the admin classifier doesn't win
 * the race and trigger a retry storm
 * (`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`).
 *
 * Plain-string logging only (Railway logsV2 silences JSON.stringify payloads).
 */

import { z } from "zod"
import { resolveVideoDisplayTitle } from "@forge/content-display"

import {
  DraftVideoSectionSchema,
  extractJsonObject,
} from "@forge/experience-schema"
import type { DraftVideoSection } from "@forge/experience-schema"

import { env } from "../../config/env"
import { TOKEN_CAPS, TIME_BUDGET_MS } from "../budgets"
import { isValidServiceBearer } from "../../server/service-bearer"

// ---------------------------------------------------------------------------
// Wire contract — request body + discriminated result envelope
// ---------------------------------------------------------------------------

/** The anchor video, shipped as candidate `v01`. Passthrough so admin can add
 *  fields without a wire bump; the prompt only renders title/description. */
const anchorCandidateSchema = z
  .object({
    videoId: z.string().min(1),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    slug: z.string().optional(),
  })
  .passthrough()

const studyQuestionSchema = z.object({
  text: z.string().min(1),
  order: z.number().nullable().optional(),
})

const citationSchema = z.object({
  reference: z.string().min(1),
  osisId: z.string().nullable().optional(),
  chapterStart: z.number().nullable().optional(),
  chapterEnd: z.number().nullable().optional(),
  verseStart: z.number().nullable().optional(),
  verseEnd: z.number().nullable().optional(),
})

const sceneSchema = z.object({
  description: z.string(),
  themes: z.array(z.string()).default([]),
  spiritualContext: z.array(z.string()).default([]),
})

export const ExperienceSectionRequestSchema = z.object({
  locale: z.string().min(1).default("en"),
  anchorCandidate: anchorCandidateSchema,
  grounding: z.object({
    studyQuestions: z.array(studyQuestionSchema).default([]),
    citations: z.array(citationSchema).default([]),
    scene: z.array(sceneSchema).nullable().optional(),
    transcript: z.string().nullable().optional(),
  }),
})
export type ExperienceSectionRequest = z.infer<
  typeof ExperienceSectionRequestSchema
>

export type ExperienceSectionFailureReason =
  | "invalid_input"
  | "timeout"
  | "generation_failed"
  | "internal_error"

export type ExperienceSectionRouteResult =
  | { ok: true; draft: DraftVideoSection }
  | {
      ok: false
      reason: ExperienceSectionFailureReason
      retryable: boolean
      message?: string
    }

export type ExperienceSectionRouteOutcome = {
  status: number
  body: ExperienceSectionRouteResult | { error: string }
}

// ---------------------------------------------------------------------------
// Minimal Mastra agent surface (narrow so the handler is unit-testable
// without constructing the full Mastra instance)
// ---------------------------------------------------------------------------

type SectionAgentGenerateResult = { text: string; object?: unknown }

type SectionAgent = {
  generate: (
    prompt: string,
    opts: {
      maxOutputTokens?: number
      abortSignal?: AbortSignal
      toolChoice?: "none" | "auto" | "required"
      structuredOutput?: { schema: typeof DraftVideoSectionSchema }
    },
  ) => Promise<SectionAgentGenerateResult>
}

export type SectionAgentMastra = {
  getAgentById: (id: string) => SectionAgent
}

// ---------------------------------------------------------------------------
// Internal timeout
// ---------------------------------------------------------------------------

class SectionRouteTimeoutError extends Error {
  readonly name = "SectionRouteTimeoutError"
  constructor(readonly budgetMs: number) {
    super(`section agent exceeded ${budgetMs}ms internal budget`)
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  budgetMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SectionRouteTimeoutError(budgetMs))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

function statusForResult(result: ExperienceSectionRouteResult): number {
  if (result.ok) return 200
  switch (result.reason) {
    case "invalid_input":
      return 400
    case "timeout":
      return 504
    case "generation_failed":
      return 502
    case "internal_error":
      return 500
    default: {
      const exhaustive: never = result.reason
      return Number(exhaustive) || 500
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly — render the grounding into the per-call user message
// ---------------------------------------------------------------------------

export function buildSectionPrompt(input: ExperienceSectionRequest): string {
  const { anchorCandidate, grounding } = input
  const lines: string[] = []
  lines.push(`Locale: ${input.locale}`)
  const anchorTitle =
    resolveVideoDisplayTitle({
      requestedTitles: [anchorCandidate.title],
      slug: anchorCandidate.slug,
    }) ?? "Video"
  lines.push(`Anchor video (candidate "v01"): ${anchorTitle}`)
  if (anchorCandidate.description) {
    lines.push(`Anchor description: ${anchorCandidate.description}`)
  }

  if (grounding.studyQuestions.length > 0) {
    lines.push(
      "",
      "STUDY QUESTIONS (use as FAQ questions; do not invent others):",
    )
    for (const q of grounding.studyQuestions) lines.push(`- ${q.text}`)
  } else {
    lines.push("", "STUDY QUESTIONS: none — OMIT the relatedQuestions block.")
  }

  if (grounding.citations.length > 0) {
    lines.push(
      "",
      "BIBLE CITATIONS (copy verbatim into bibleQuotesCarousel quotes; NEVER write verse text):",
    )
    for (const c of grounding.citations) {
      lines.push(
        `- ${JSON.stringify({
          reference: c.reference,
          osisId: c.osisId ?? undefined,
          chapterStart: c.chapterStart ?? undefined,
          chapterEnd: c.chapterEnd ?? undefined,
          verseStart: c.verseStart ?? undefined,
          verseEnd: c.verseEnd ?? undefined,
        })}`,
      )
    }
  } else {
    lines.push(
      "",
      "BIBLE CITATIONS: none — OMIT the bibleQuotesCarousel block.",
    )
  }

  const sceneThemes = (grounding.scene ?? [])
    .flatMap((s) => [...s.themes, ...s.spiritualContext])
    .filter(Boolean)
  if (sceneThemes.length > 0) {
    lines.push(
      "",
      `SCENE THEMES / SPIRITUAL CONTEXT: ${sceneThemes.join(", ")}`,
    )
  }
  if (grounding.transcript) {
    lines.push(
      "",
      `TRANSCRIPT EXCERPT: ${grounding.transcript.slice(0, 2_000)}`,
    )
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Agent run + draft resolution
// ---------------------------------------------------------------------------

function resolveSectionDraft(
  result: SectionAgentGenerateResult,
): DraftVideoSection | null {
  // Prefer the provider-validated structured object (gateway path).
  if (result.object !== undefined) {
    const parsed = DraftVideoSectionSchema.safeParse(result.object)
    if (parsed.success) return parsed.data
  }
  // Fall back to the text → extract → parse ladder (Gemini / OpenRouter).
  const text =
    result.text.length > 0 || result.object === undefined
      ? result.text
      : JSON.stringify(result.object)
  const extracted = extractJsonObject(text)
  if (!extracted) return null
  try {
    const parsed = DraftVideoSectionSchema.safeParse(JSON.parse(extracted))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function runSectionAgent(
  mastra: SectionAgentMastra,
  input: ExperienceSectionRequest,
  budgetMs: number,
  structuredOutputEnabled: boolean,
): Promise<ExperienceSectionRouteResult> {
  const signal = AbortSignal.timeout(budgetMs)
  let result: SectionAgentGenerateResult
  try {
    const agent = mastra.getAgentById("generate-video-section")
    result = await withTimeout(
      agent.generate(buildSectionPrompt(input), {
        maxOutputTokens: TOKEN_CAPS.generateVideoSection,
        abortSignal: signal,
        // The gateway honors schema-constrained decoding + toolChoice:"none";
        // other providers use the text → parse ladder in resolveSectionDraft.
        ...(structuredOutputEnabled
          ? {
              toolChoice: "none" as const,
              structuredOutput: { schema: DraftVideoSectionSchema },
            }
          : {}),
      }),
      signal,
      budgetMs,
    )
  } catch (error) {
    if (error instanceof SectionRouteTimeoutError) {
      console.warn(
        `[forge-experience-section] event=agent_timeout budget_ms=${budgetMs}`,
      )
      return {
        ok: false,
        reason: "timeout",
        retryable: true,
        message: error.message,
      }
    }
    console.warn(
      `[forge-experience-section] event=agent_error message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    // Transient provider error — retryable.
    return {
      ok: false,
      reason: "generation_failed",
      retryable: true,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  const draft = resolveSectionDraft(result)
  if (!draft) {
    console.warn(`[forge-experience-section] event=result_missing_section`)
    // Re-prompting the same way mis-shapes again — not retryable.
    return {
      ok: false,
      reason: "generation_failed",
      retryable: false,
      message: "agent result did not carry a schema-valid section",
    }
  }
  return { ok: true, draft }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export type ExperienceSectionRouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  getMastra: () => SectionAgentMastra
  /** Internal wall-clock budget; defaults to `TIME_BUDGET_MS.section`. */
  budgetMs?: number
  /** Whether to request gateway structured-output; defaults to the gateway env gate. */
  structuredOutputEnabled?: boolean
}

export async function handleExperienceSectionRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  getMastra,
  budgetMs = TIME_BUDGET_MS.section,
  structuredOutputEnabled,
}: ExperienceSectionRouteHandlerInput): Promise<ExperienceSectionRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }

  const raw = await readJson().catch(() => undefined)
  const parsed = ExperienceSectionRequestSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn(
      `[forge-experience-section] event=invalid_input issues=${parsed.error.issues.length}`,
    )
    const result: ExperienceSectionRouteResult = {
      ok: false,
      reason: "invalid_input",
      retryable: false,
      message: "request body failed validation",
    }
    return { status: statusForResult(result), body: result }
  }

  const useStructured =
    structuredOutputEnabled ??
    Boolean(
      env.AI_GATEWAY_CHAT_API_KEY && env.AI_GATEWAY_CHAT_ENABLED === "true",
    )

  const result = await runSectionAgent(
    getMastra(),
    parsed.data,
    budgetMs,
    useStructured,
  )
  return { status: statusForResult(result), body: result }
}
