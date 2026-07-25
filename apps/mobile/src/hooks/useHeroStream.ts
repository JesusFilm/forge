import { useEffect, useRef, useState } from "react"

import { getApolloClient } from "../lib/apolloClient"
import { datadogLog } from "../lib/datadog"
import { GET_VIDEO_BY_SLUG } from "../lib/queries"
import { HOME_LOCALE } from "../lib/watchHome/config"
import { selectHeroStreamUrl } from "../lib/watchHome/heroStream"
import {
  checkHeroStreamCooldown,
  clearHeroStreamCooldown,
  registerHeroStreamFailure,
  type HeroStreamCooldownCheck,
} from "../lib/watchHome/heroStreamCooldown"

// One structured log per slug per window keeps the suppression observable
// without becoming its own flood (feat-267).
function logCooldownSkip(slug: string, check: HeroStreamCooldownCheck): void {
  if (check.warnRemainingMs == null) return
  datadogLog.warn("hero_stream.cooldown_skip", {
    slug,
    remaining_ms: check.warnRemainingMs,
  })
}

// Stream-resolution path (KTD-2 lazy half): the bulk home query is card-lean,
// so hero slides carry no stream. GET_VIDEO_BY_SLUG still projects the dub list,
// so one cache-first per-video query yields a playable HLS (the source /watch plays).

export type HeroStreamState = {
  streamUrl: string | null
  resolving: boolean
  /** No playable variant or the fetch failed — the pager skips the slide. */
  failed: boolean
}

const IDLE_STATE: HeroStreamState = {
  streamUrl: null,
  resolving: false,
  failed: false,
}

/**
 * Resolve a playable HLS URL for a hero slide's video slug. Pass null for mux
 * insert slides (they carry their own src) — the hook stays idle. Selection
 * order + validateStreamingUrl gating live in selectHeroStreamUrl.
 */
export function useHeroStream(slug: string | null): HeroStreamState {
  const [state, setState] = useState<HeroStreamState>(IDLE_STATE)
  // Stale-response guard (mirrors watch.tsx's search guard): a slide change
  // bumps the id so a superseded resolution can't land on the new slide.
  const requestIdRef = useRef(0)

  useEffect(() => {
    const thisRequest = ++requestIdRef.current
    if (!slug) {
      setState(IDLE_STATE)
      return
    }

    // Failure cooldown (feat-267): within a slug's window, fail immediately
    // with NO network — an idle Home otherwise retries dead slugs forever.
    const cooldown = checkHeroStreamCooldown(slug, Date.now())
    if (cooldown.suppressed) {
      logCooldownSkip(slug, cooldown)
      setState({ streamUrl: null, resolving: false, failed: true })
      return
    }

    setState({ streamUrl: null, resolving: true, failed: false })
    getApolloClient()
      .query({
        query: GET_VIDEO_BY_SLUG,
        variables: { slug, locale: HOME_LOCALE },
        fetchPolicy: "cache-first",
      })
      .then((result) => {
        // Cooldown bookkeeping is module-global: run it even for stale
        // responses (the guard below only protects this hook's setState).
        clearHeroStreamCooldown(slug)
        if (requestIdRef.current !== thisRequest) return
        const streamUrl = selectHeroStreamUrl(
          result.data?.videoBySlug?.variants,
        )
        // R37: a curated slide dropped for no playable variant is a silent loss.
        if (streamUrl == null) {
          datadogLog.warn("hero_stream.failed", { reason: "no_variant", slug })
        }
        setState({ streamUrl, resolving: false, failed: streamUrl == null })
      })
      .catch(() => {
        registerHeroStreamFailure(slug, Date.now())
        if (requestIdRef.current !== thisRequest) return
        datadogLog.warn("hero_stream.failed", { reason: "query_failed", slug })
        setState({ streamUrl: null, resolving: false, failed: true })
      })
  }, [slug])

  return state
}

// ── Next-slide prefetch ─────────────────────────────────────────────
// Mirrors Discover's capped prefetch (app/(tabs)/watch.tsx): deduped by slug,
// capped in flight so fast swiping can't burst the per-video query. cache-first
// makes a resolved slug a network no-op; a failed prefetch releases its slug.

const MAX_PREFETCH_INFLIGHT = 3
const prefetchedSlugs = new Set<string>()
let prefetchInFlight = 0

export function prefetchHeroStream(slug: string | null | undefined): void {
  if (!slug) return
  if (prefetchedSlugs.has(slug)) return
  if (prefetchInFlight >= MAX_PREFETCH_INFLIGHT) return
  // Prefetch shares the failure cooldown (feat-267): releasing a failed slug
  // for retry is what let prefetch participate in the idle retry loop.
  const cooldown = checkHeroStreamCooldown(slug, Date.now())
  if (cooldown.suppressed) {
    logCooldownSkip(slug, cooldown)
    return
  }
  // Apollo cache is the real dedupe; this only bounds the in-flight bookkeeping.
  if (prefetchedSlugs.size > 100) prefetchedSlugs.clear()
  prefetchedSlugs.add(slug)
  prefetchInFlight += 1
  try {
    getApolloClient()
      .query({
        query: GET_VIDEO_BY_SLUG,
        variables: { slug, locale: HOME_LOCALE },
        fetchPolicy: "cache-first",
      })
      .then(() => {
        clearHeroStreamCooldown(slug)
      })
      .catch(() => {
        registerHeroStreamFailure(slug, Date.now())
        // Async failure: release the slug so a later attempt can retry.
        prefetchedSlugs.delete(slug)
      })
      .finally(() => {
        prefetchInFlight -= 1
      })
  } catch {
    // Synchronous throw from getApolloClient() or .query() setup: roll back the
    // reserved slot so the counter and set stay consistent (slot-leak guard).
    prefetchedSlugs.delete(slug)
    prefetchInFlight -= 1
  }
}
