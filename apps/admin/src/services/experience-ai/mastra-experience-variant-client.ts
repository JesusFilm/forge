/**
 * Caller for the standalone persona-variant route (`/forge-experience-variant`).
 *
 * Mirrors `mastra-experience-section-client.ts`: `config_missing` short-circuit
 * when the caller vars are unset, `POST /forge-experience-variant` with a
 * `Bearer` (reusing MASTRA_BASE_URL + MASTRA_SERVICE_API_KEY) over `node:http`
 * (Next's patched global `fetch` fails over Railway private networking), and a
 * discriminated `{ ok, draft, personaId } | { ok:false, reason, retryable }`
 * envelope.
 *
 * `MASTRA_VARIANTS_TIMEOUT_MS` (default 200s) is deliberately LARGER than
 * mastra's internal multi-step budget (180s) so the mastra-side timeout wins the
 * race and returns a clean `{ reason:"timeout" }` envelope rather than a generic
 * `network_error` retry storm
 * (`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`).
 *
 * The response `draft` is re-validated against the single-sourced
 * `DraftExperienceSchema`; admin's `normalizeExperienceDraft` stays the gate
 * after this client returns.
 */

import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

import { env } from "@/config/env"
import {
  DraftExperienceSchema,
  type DraftExperience,
  type VideoCandidate,
} from "@forge/experience-schema"

export type MastraExperienceVariantLaunchInput = {
  topic: string
  locale: string
  personaId: string
  candidates: readonly VideoCandidate[]
  exemplar?: string
}

export type MastraExperienceVariantFailureReason =
  | "config_missing"
  | "auth_failed"
  | "network_error"
  | "parse_error"
  // The route's own discriminated reasons (experience-variant-route.ts):
  | "invalid_input"
  | "timeout"
  | "generation_failed"
  | "internal_error"

export type MastraExperienceVariantLaunchResult =
  | { ok: true; draft: DraftExperience; personaId: string }
  | {
      ok: false
      reason: MastraExperienceVariantFailureReason
      retryable: boolean
    }

export type LaunchMastraExperienceVariantOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const ROUTE_FAILURE_REASONS = new Set<MastraExperienceVariantFailureReason>([
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
 * Render an unknown thrown value as a Railway-logsV2-safe plain string (NEVER
 * JSON.stringify — logsV2 silences stringified payloads from the Next runtime).
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

/** Fallback when the env-configured variants timeout is missing/invalid. */
const DEFAULT_VARIANTS_TIMEOUT_MS = 200_000

/**
 * Normalize the request timeout to a positive number. `env.MASTRA_VARIANTS_TIMEOUT_MS`
 * is TYPED `number` but at runtime can arrive `undefined`/string because t3-env's
 * `skipValidation` path returns raw `process.env` without applying the Zod
 * default — passing that to a timer API throws `ERR_INVALID_ARG_TYPE`. Takes
 * `unknown` so the runtime guards aren't elided by the (wrong) static type.
 */
function resolveTimeoutMs(value: unknown): number {
  const ms = typeof value === "string" ? Number(value) : value
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? ms
    : DEFAULT_VARIANTS_TIMEOUT_MS
}

/** POST over `node:http` to dodge the Next-patched global `fetch`. */
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
        Object.assign(new Error("variant request timed out"), {
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

function parseVariantRouteResult(
  value: unknown,
): MastraExperienceVariantLaunchResult | null {
  const record = asRecord(value)
  if (!record || typeof record.ok !== "boolean") return null

  if (record.ok === true) {
    if (typeof record.personaId !== "string") return null
    const draft = DraftExperienceSchema.safeParse(record.draft)
    if (!draft.success) return null
    return { ok: true, draft: draft.data, personaId: record.personaId }
  }

  if (
    typeof record.reason !== "string" ||
    !ROUTE_FAILURE_REASONS.has(
      record.reason as MastraExperienceVariantFailureReason,
    ) ||
    typeof record.retryable !== "boolean"
  ) {
    return null
  }

  return {
    ok: false,
    reason: record.reason as MastraExperienceVariantFailureReason,
    retryable: record.retryable,
  }
}

export async function launchMastraExperienceVariant(
  input: MastraExperienceVariantLaunchInput,
  options: LaunchMastraExperienceVariantOptions = {},
): Promise<MastraExperienceVariantLaunchResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const body = {
    topic: input.topic,
    locale: input.locale,
    personaId: input.personaId,
    candidates: input.candidates,
    exemplar: input.exemplar,
  }

  const target = new URL("/forge-experience-variant", baseUrl)
  const headers = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
  }
  const bodyText = JSON.stringify(body)
  const timeoutMs = resolveTimeoutMs(
    options.timeoutMs ?? env.MASTRA_VARIANTS_TIMEOUT_MS,
  )

  let raw: RawResponse
  try {
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
    console.error(
      `[mastra-experience-variant] event=fetch_failed host=${target.host} ` +
        `transport=${options.fetchImpl ? "fetch" : "node-http"} ${describeFetchError(error)}`,
    )
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (raw.status === 401) {
    console.warn(`[mastra-experience-variant] event=auth_failed status=401`)
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  let payload: unknown
  try {
    payload = raw.bodyText.length > 0 ? JSON.parse(raw.bodyText) : undefined
  } catch {
    payload = undefined
  }

  const parsed = parseVariantRouteResult(payload)
  if (parsed) return parsed

  if (raw.status < 200 || raw.status >= 300) {
    console.warn(
      `[mastra-experience-variant] event=http_error status=${raw.status}`,
    )
    return {
      ok: false,
      reason: "network_error",
      retryable: raw.status >= 500 || raw.status === 429,
    }
  }

  console.warn(
    `[mastra-experience-variant] event=parse_error status=${raw.status} ` +
      `bodyOk=${String(asRecord(payload)?.ok ?? "absent")}`,
  )
  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseVariantRouteResult,
  resolveTimeoutMs,
}
