import { z } from "zod"

import {
  getDevotionalSiteIngestConfig,
  type DevotionalSiteIngestConfig,
} from "../../config/env"
import { requireHttpsUrl } from "../discovery/secure-url"
import { discardResponseBody, readResponseJsonCapped } from "./bounded-response"
import type { Devotional } from "./types"

/**
 * Submit a finished, safety-passed devotional to the watch-site "Today's
 * Devotional" ingest endpoint. Opt-in and best-effort: with no URL/token it
 * returns `config_missing` (the workflow treats that as publish-skipped, not a
 * failed run). Mirrors the Admin ingest-client transport: bearer auth, typed
 * failures, bounded timeout.
 */

const DEFAULT_TIMEOUT_MS = 15_000
/** Bytes. The success contract is a two-boolean JSON acknowledgment. */
export const SITE_PUBLISH_MAX_RESPONSE_BYTES = 64 * 1024

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
  .refine(
    (value) => value.published !== undefined || value.accepted !== undefined,
    "response must include published or accepted",
  )

export type PublishDevotionalInput = {
  devotional: Devotional
  videoAssets?: PublishedDevotionalVideoAssets
  config?: DevotionalSiteIngestConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
  abortSignal?: AbortSignal
}

export type PublishedDevotionalVideoAsset = {
  assetId: string
  artifactType: string
  ext: "mp4"
}

export type PublishedDevotionalVideoAssets = {
  portrait: PublishedDevotionalVideoAsset
  wide: PublishedDevotionalVideoAsset
}

/** The wire payload — date is a top-level idempotency key alongside the body. */
function buildPayload(
  devotional: Devotional,
  videoAssets?: PublishedDevotionalVideoAssets,
) {
  return {
    date: devotional.date,
    devotional: {
      hook: devotional.hook,
      scripture: devotional.scripture,
      video: devotional.video,
      videoMatch: devotional.videoMatch,
      reflection: devotional.reflection,
      questions: devotional.questions,
      prayer: devotional.prayer,
      furtherReading: devotional.furtherReading,
      blockOrder: devotional.blockOrder,
      videoAssets,
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

  let url: string
  try {
    url = requireHttpsUrl(config.url, "devotional site ingest URL")
  } catch {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        // The receiver must treat one devotional date as one publication. This
        // makes an acknowledgement retry safe after an ambiguous response.
        "idempotency-key": `daily-devotional:${input.devotional.date}`,
      },
      body: JSON.stringify(buildPayload(input.devotional, input.videoAssets)),
      redirect: "error",
      signal: input.abortSignal
        ? AbortSignal.any([AbortSignal.timeout(timeoutMs), input.abortSignal])
        : AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ok: false, reason: "upstream_failed", retryable: true }
  }

  if (response.status === 401 || response.status === 403) {
    await discardResponseBody(response)
    return {
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status: response.status,
    }
  }

  if (!response.ok) {
    await discardResponseBody(response)
    return {
      ok: false,
      reason: "upstream_failed",
      retryable: response.status >= 500,
      status: response.status,
    }
  }

  const body = await readResponseJsonCapped(
    response,
    SITE_PUBLISH_MAX_RESPONSE_BYTES,
  )
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
    published: parsed.data.published ?? parsed.data.accepted!,
  }
}

export const _internal = { buildPayload }
