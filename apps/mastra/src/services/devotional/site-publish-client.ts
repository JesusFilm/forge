import { z } from "zod"

import {
  getDevotionalSiteIngestConfig,
  type DevotionalSiteIngestConfig,
} from "../../config/env"
import type { Devotional } from "./types"

/**
 * Submit a finished, safety-passed devotional to the watch-site "Today's
 * Devotional" ingest endpoint. Opt-in and best-effort: with no URL/token it
 * returns `config_missing` (the workflow treats that as publish-skipped, not a
 * failed run). Mirrors the Admin ingest-client transport: bearer auth, typed
 * failures, bounded timeout.
 */

const DEFAULT_TIMEOUT_MS = 15_000

export type SitePublishResult =
  | { ok: true; published: boolean }
  | {
      ok: false
      reason:
        | "config_missing"
        | "auth_failed"
        | "upstream_failed"
        | "invalid_response"
      retryable: boolean
      status?: number
    }

const IngestResponseSchema = z
  .object({
    published: z.boolean().optional(),
    accepted: z.boolean().optional(),
  })
  .passthrough()

export type PublishDevotionalInput = {
  devotional: Devotional
  config?: DevotionalSiteIngestConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** The wire payload — date is a top-level idempotency key alongside the body. */
function buildPayload(devotional: Devotional) {
  return {
    date: devotional.date,
    devotional: {
      hook: devotional.hook,
      scripture: devotional.scripture,
      video: devotional.video,
      videoMatch: devotional.videoMatch,
      reflection: devotional.reflection,
      questions: devotional.questions,
      furtherReading: devotional.furtherReading,
      blockOrder: devotional.blockOrder,
    },
  }
}

export async function publishDevotional(
  input: PublishDevotionalInput,
): Promise<SitePublishResult> {
  const config = input.config ?? getDevotionalSiteIngestConfig()
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!config.url || !config.apiKey) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let response: Response
  try {
    response = await fetchImpl(new URL(config.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildPayload(input.devotional)),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ok: false, reason: "upstream_failed", retryable: true }
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: response.status,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "upstream_failed",
      retryable: response.status >= 500,
      status: response.status,
    }
  }

  const body = await response.json().catch(() => undefined)
  const parsed = IngestResponseSchema.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_response",
      retryable: false,
      status: response.status,
    }
  }

  return {
    ok: true,
    published: parsed.data.published ?? parsed.data.accepted ?? true,
  }
}

export const _internal = { buildPayload }
