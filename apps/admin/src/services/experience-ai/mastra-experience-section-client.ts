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

import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

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

/**
 * Render an unknown thrown value as a Railway-logsV2-safe plain string. For
 * undici `fetch` failures the useful signal lives on `error.cause` (e.g.
 * ECONNREFUSED / EAI_AGAIN / ETIMEDOUT / UND_ERR_*); for AbortSignal.timeout it
 * is the `TimeoutError` name. NEVER JSON.stringify — Railway logsV2 silences
 * stringified payloads from the Next.js runtime.
 */
function describeFetchError(error: unknown): string {
  const err = error instanceof Error ? error : undefined
  const cause = err?.cause instanceof Error ? err.cause : undefined
  const rawCode =
    (cause as { code?: unknown } | undefined)?.code ??
    (err as { code?: unknown } | undefined)?.code
  return (
    `name=${err?.name ?? "unknown"} ` +
    `code=${typeof rawCode === "string" ? rawCode : "none"} ` +
    `cause=${cause?.name ?? "none"} ` +
    `message=${err?.message ?? String(error)}`
  )
}

type RawResponse = { status: number; bodyText: string }

/** Fallback when the env-configured section timeout is missing/invalid. */
const DEFAULT_SECTION_TIMEOUT_MS = 75_000

/**
 * Normalize the request timeout to a positive number. `env.MASTRA_SECTION_TIMEOUT_MS`
 * is TYPED `number`, but at runtime it can arrive `undefined` (or a string)
 * because t3-env's `skipValidation` path returns raw `process.env` without
 * applying the Zod default — and passing that to `req.setTimeout` /
 * `AbortSignal.timeout` throws `ERR_INVALID_ARG_TYPE`. Takes `unknown` so the
 * runtime guards aren't elided by the (wrong) static type.
 */
function resolveTimeoutMs(value: unknown): number {
  const ms = typeof value === "string" ? Number(value) : value
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? ms
    : DEFAULT_SECTION_TIMEOUT_MS
}

/**
 * POST the request over `node:http` instead of the global `fetch`.
 *
 * Why: in the Next.js standalone runtime the framework-patched global `fetch`
 * fails to reach `forge-mastra` over Railway's private network (a plain `node`
 * process in the SAME container reaches it fine), so the editor only ever saw
 * an opaque "service unavailable". `node:http` is NOT patched by Next, so it
 * uses the same un-instrumented network stack that works from a raw process.
 * The injected-`fetchImpl` path (tests/overrides) keeps using `fetch`.
 */
function postViaNode(
  target: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<RawResponse> {
  const request = target.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise<RawResponse>((resolve, reject) => {
    const req = request(
      target,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            bodyText: Buffer.concat(chunks).toString("utf8"),
          }),
        )
        res.on("error", reject)
      },
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        Object.assign(new Error("section request timed out"), {
          name: "TimeoutError",
        }),
      )
    })
    req.on("error", reject)
    req.end(body)
  })
}

/** Transport used when a caller injects `fetchImpl` (unit tests / overrides). */
async function postViaFetch(
  fetchImpl: typeof fetch,
  target: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<RawResponse> {
  const response = await fetchImpl(target, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: response.status, bodyText: await response.text() }
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

  const target = new URL("/forge-experience-section", baseUrl)
  const headers = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
  }
  const bodyText = JSON.stringify(body)
  const timeoutMs = resolveTimeoutMs(
    options.timeoutMs ?? env.MASTRA_SECTION_TIMEOUT_MS,
  )

  let raw: RawResponse
  try {
    // Prod default is `node:http` to dodge the Next-patched global `fetch`
    // that fails over Railway private networking; tests/overrides inject
    // `fetchImpl` and keep the `fetch` path.
    raw = options.fetchImpl
      ? await postViaFetch(
          options.fetchImpl,
          target,
          headers,
          bodyText,
          timeoutMs,
        )
      : await postViaNode(target, headers, bodyText, timeoutMs)
  } catch (error) {
    // The connection-level cause was previously swallowed here, leaving the
    // editor with an opaque "service unavailable" and no way to tell a refused
    // connection from a DNS miss from a timeout. Surface it (plain string;
    // logsV2 drops JSON.stringify from the Next.js runtime).
    console.error(
      `[mastra-experience-section] event=fetch_failed host=${target.host} ` +
        `transport=${options.fetchImpl ? "fetch" : "node-http"} ${describeFetchError(error)}`,
    )
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (raw.status === 401) {
    console.warn(`[mastra-experience-section] event=auth_failed status=401`)
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  let payload: unknown
  try {
    payload = raw.bodyText.length > 0 ? JSON.parse(raw.bodyText) : undefined
  } catch {
    payload = undefined
  }

  const parsed = parseSectionRouteResult(payload)
  if (parsed) return parsed

  if (raw.status < 200 || raw.status >= 300) {
    console.warn(
      `[mastra-experience-section] event=http_error status=${raw.status}`,
    )
    return {
      ok: false,
      reason: "network_error",
      retryable: raw.status >= 500 || raw.status === 429,
    }
  }

  // 2xx whose body did not match the discriminated envelope / the
  // single-sourced DraftVideoSectionSchema (e.g. a generator↔admin schema skew).
  console.warn(
    `[mastra-experience-section] event=parse_error status=${raw.status} ` +
      `bodyOk=${String(asRecord(payload)?.ok ?? "absent")}`,
  )
  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseSectionRouteResult,
  resolveTimeoutMs,
}
