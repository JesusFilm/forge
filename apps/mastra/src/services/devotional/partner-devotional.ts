import { getFirecrawlConfig, type FirecrawlConfig } from "../../config/env"
import { scrapeFirecrawl } from "../firecrawl-client"
import type { GroundingSnippet } from "./devotional-writer"

/**
 * Fetch a SPECIFIC partner devotional page and return it as clean structured
 * text, for the "adapt a partner devotional into our own reflection" flow.
 *
 * Unlike the writer's auto-discovery grounding (which Firecrawl-SEARCHES partner
 * domains for a relevant teaching), this scrapes one operator-chosen URL — e.g.
 * a Cru "Today's Promise" entry — so you can test adapting a known devotional.
 * The result plugs straight into the writer's `grounding` seam via
 * `toGroundingSnippet`; the writer still rewrites it in its own words (the
 * prompt forbids verbatim copying).
 *
 * Best-effort + typed: no Firecrawl key (or a scrape failure) yields a typed
 * failure, never a throw. Bounded text keeps the writer prompt small.
 */

/** Cap the partner text fed to the writer — grounding, not a transcript. */
export const MAX_PARTNER_TEXT_LENGTH = 6000

export type PartnerDevotional = {
  url: string
  title: string | null
  /** Clean, length-capped main-content text (markdown) from the partner page. */
  text: string
}

export type FetchPartnerDevotionalResult =
  | { ok: true; devotional: PartnerDevotional }
  | {
      ok: false
      reason: "config_missing" | "empty" | "upstream_failed"
      retryable: boolean
      details?: string
    }

export type FetchPartnerDevotionalInput = {
  url: string
  config?: FirecrawlConfig
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function fetchPartnerDevotional(
  input: FetchPartnerDevotionalInput,
): Promise<FetchPartnerDevotionalResult> {
  const config = input.config ?? getFirecrawlConfig()
  if (!config.apiKey) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      details: "FIRECRAWL_API_KEY is required to fetch partner devotionals",
    }
  }

  const response = await scrapeFirecrawl({
    url: input.url,
    onlyMainContent: true,
    config,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  })

  if (!response.ok) {
    return {
      ok: false,
      reason: "upstream_failed",
      retryable: response.retryable,
      details: response.reason,
    }
  }

  const text = response.result.markdown.trim().slice(0, MAX_PARTNER_TEXT_LENGTH)
  if (!text) {
    return { ok: false, reason: "empty", retryable: true }
  }

  return {
    ok: true,
    devotional: { url: input.url, title: response.result.title, text },
  }
}

/** Adapt a fetched partner devotional into the writer's grounding-snippet shape. */
export function toGroundingSnippet(
  devotional: PartnerDevotional,
): GroundingSnippet {
  return {
    url: devotional.url,
    title: devotional.title,
    snippet: devotional.text,
  }
}
