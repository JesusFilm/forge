/**
 * Bearer-gated `/forge-experience-variant` entrypoint (persona-variant v1, U4).
 *
 * Admin loads candidates once and POSTs `{ topic, locale, candidates,
 * exemplar?, personaId }` per persona. This handler resolves the persona from
 * the Mastra-owned library, composes it into the editor prompt (U3), and runs
 * the SAME `multi-step-draft` generation path the draft route uses — by
 * delegating to `handleExperienceDraftRouteRequest`. The only additions over a
 * plain draft are persona resolution and carrying `personaId` back in the
 * envelope, so the budget, timeout, and error classification stay single-sourced.
 *
 * Reuses `MASTRA_SERVICE_API_KEYS` (no new credential). Plain-string logging
 * only (Railway logsV2 silences JSON.stringify payloads from this runtime path).
 */

import { z } from "zod"

import type { DraftExperience } from "@forge/experience-schema"

import { TIME_BUDGET_MS } from "../budgets"
import { isValidServiceBearer } from "../../server/service-bearer"
import { loadPersona } from "../../services/persona/persona-library"
import { buildPersonaTopicPrompt } from "../../services/persona/persona-prompt"
import {
  handleExperienceDraftRouteRequest,
  type DraftWorkflowMastra,
} from "./experience-draft-route"

const candidateSchema = z
  .object({
    videoId: z.string().optional(),
    ref: z.string().optional(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    slug: z.string().optional(),
  })
  .passthrough()

export const ExperienceVariantRequestSchema = z.object({
  topic: z.string().min(1),
  locale: z.string().min(1).default("en"),
  candidates: z.array(candidateSchema).default([]),
  exemplar: z.string().optional(),
  personaId: z.string().min(1),
})
export type ExperienceVariantRequest = z.infer<
  typeof ExperienceVariantRequestSchema
>

export type ExperienceVariantFailureReason =
  | "invalid_input"
  | "timeout"
  | "generation_failed"
  | "internal_error"

export type ExperienceVariantRouteResult =
  | { ok: true; draft: DraftExperience; personaId: string }
  | {
      ok: false
      reason: ExperienceVariantFailureReason
      retryable: boolean
      message?: string
    }

export type ExperienceVariantRouteOutcome = {
  status: number
  body: ExperienceVariantRouteResult | { error: string }
}

// Re-export the narrow Mastra surface so `index.ts` can type the getMastra thunk.
export type { DraftWorkflowMastra }

function invalidInput(message: string): ExperienceVariantRouteOutcome {
  return {
    status: 400,
    body: { ok: false, reason: "invalid_input", retryable: false, message },
  }
}

export type ExperienceVariantRouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  getMastra: () => DraftWorkflowMastra
  /** Internal workflow budget; defaults to the multi-step budget. */
  budgetMs?: number
}

export async function handleExperienceVariantRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  getMastra,
  budgetMs = TIME_BUDGET_MS.multiStepWorkflow,
}: ExperienceVariantRouteHandlerInput): Promise<ExperienceVariantRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }

  const raw = await readJson().catch(() => undefined)
  const parsed = ExperienceVariantRequestSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn(
      `[forge-experience-variant] event=invalid_input issues=${parsed.error.issues.length}`,
    )
    return invalidInput("request body failed validation")
  }

  const { topic, locale, candidates, exemplar, personaId } = parsed.data
  const persona = loadPersona(personaId)
  if (!persona) {
    console.warn(
      `[forge-experience-variant] event=unknown_persona personaId=${personaId}`,
    )
    return invalidInput(`unknown persona: ${personaId}`)
  }

  const prompt = buildPersonaTopicPrompt(topic, persona)

  // Delegate to the shared draft generation path (same budget + error
  // classification), feeding the persona-composed prompt.
  const draftOutcome = await handleExperienceDraftRouteRequest({
    authHeader,
    serviceKeys,
    readJson: () =>
      Promise.resolve({ prompt, locale, candidates, exemplar, mode: "multi" }),
    getMastra,
    budgetMs,
  })

  const body = draftOutcome.body
  if ("ok" in body) {
    if (body.ok) {
      console.warn(
        `[forge-experience-variant] event=generated personaId=${personaId}`,
      )
      return {
        status: draftOutcome.status,
        body: { ok: true, draft: body.draft, personaId },
      }
    }
    console.warn(
      `[forge-experience-variant] event=failed personaId=${personaId} reason=${body.reason} retryable=${body.retryable}`,
    )
    return { status: draftOutcome.status, body }
  }
  // `{ error }` shape — shouldn't occur after our own bearer check; pass through.
  return { status: draftOutcome.status, body }
}
