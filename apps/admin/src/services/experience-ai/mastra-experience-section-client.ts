/**
 * Caller for the standalone one-shot section route (`/forge-experience-section`).
 *
 * Mirrors `mastra-experience-draft-client.ts`: `config_missing` short-circuit
 * when the caller vars are unset, `POST /forge-experience-section` with a
 * `Bearer` (reusing MASTRA_BASE_URL + MASTRA_SERVICE_API_KEY), a single
 * `response.json()`, and a discriminated `{ ok } | { ok:false, reason, retryable }`
 * envelope.
 *
 * The request timeout (`MASTRA_SECTION_TIMEOUT_MS`, default 75s) is deliberately
 * LARGER than mastra's internal section budget (`TIME_BUDGET_MS.section`, 60s) so
 * the mastra-side timeout wins the race and returns a clean `{ reason:"timeout" }`
 * envelope — admin's fetch aborting first would surface as a generic
 * `network_error` and trip a retry storm
 * (`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`).
 *
 * The response `draft` is re-validated against the single-sourced
 * `DraftVideoSectionSchema` before it is trusted; admin's post-response allowlist
 * filter (`section-generator.ts`) + `normalizeExperienceDraft` stay the gates
 * after this client returns.
 */

import { env } from "@/config/env"
import {
  DraftVideoSectionSchema,
  type DraftVideoSection,
} from "@forge/experience-schema"

import type {
  ContextPackCitation,
  ContextPackScene,
  ContextPackStudyQuestion,
  ContextPackVideo,
} from "./video-context-pack.service"

export type MastraExperienceSectionLaunchInput = {
  locale: string
  anchorCandidate: ContextPackVideo & { videoId: string }
  grounding: {
    studyQuestions: readonly ContextPackStudyQuestion[]
    citations: readonly ContextPackCitation[]
    scene?: readonly ContextPackScene[] | null
    transcript?: string | null
  }
}

export type MastraExperienceSectionFailureReason =
  | "config_missing"
  | "auth_failed"
  | "network_error"
  | "parse_error"
  // The route's own discriminated reasons (experience-section-route.ts):
  | "invalid_input"
  | "timeout"
  | "generation_failed"
  | "internal_error"

export type MastraExperienceSectionLaunchResult =
  | { ok: true; draft: DraftVideoSection }
  | {
      ok: false
      reason: MastraExperienceSectionFailureReason
      retryable: boolean
    }

export type LaunchMastraExperienceSectionOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const ROUTE_FAILURE_REASONS = new Set<MastraExperienceSectionFailureReason>([
  "invalid_input",
  "timeout",
  "generation_failed",
  "internal_error",
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseSectionRouteResult(
  value: unknown,
): MastraExperienceSectionLaunchResult | null {
  const record = asRecord(value)
  if (!record || typeof record.ok !== "boolean") return null

  if (record.ok === true) {
    const draft = DraftVideoSectionSchema.safeParse(record.draft)
    if (!draft.success) return null
    return { ok: true, draft: draft.data }
  }

  if (
    typeof record.reason !== "string" ||
    !ROUTE_FAILURE_REASONS.has(
      record.reason as MastraExperienceSectionFailureReason,
    ) ||
    typeof record.retryable !== "boolean"
  ) {
    return null
  }

  return {
    ok: false,
    reason: record.reason as MastraExperienceSectionFailureReason,
    retryable: record.retryable,
  }
}

export async function launchMastraExperienceSection(
  input: MastraExperienceSectionLaunchInput,
  options: LaunchMastraExperienceSectionOptions = {},
): Promise<MastraExperienceSectionLaunchResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const body = {
    locale: input.locale,
    anchorCandidate: {
      videoId: input.anchorCandidate.videoId,
      title: input.anchorCandidate.title,
      description: input.anchorCandidate.description,
      slug: input.anchorCandidate.slug,
    },
    grounding: {
      studyQuestions: input.grounding.studyQuestions,
      citations: input.grounding.citations,
      scene: input.grounding.scene ?? null,
      transcript: input.grounding.transcript ?? null,
    },
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/forge-experience-section", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          options.timeoutMs ?? env.MASTRA_SECTION_TIMEOUT_MS,
        ),
      },
    )
  } catch {
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (response.status === 401) {
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  const parsed = parseSectionRouteResult(
    await response.json().catch(() => undefined),
  )
  if (parsed) return parsed

  if (!response.ok) {
    return {
      ok: false,
      reason: "network_error",
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseSectionRouteResult,
}
