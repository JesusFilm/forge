/**
 * Per-slug failure cooldown for hero stream resolution (feat-267). A failed
 * GET_VIDEO_BY_SLUG never populates the Apollo cache, so an idle Home's
 * rotation retried failing slugs forever (258 RUM errors in one 16-min idle
 * session, Jul 15). Module-scope state (mirrors prefetchedSlugs — NOT
 * hook-lifetime refs, per the StrictMode remount law); callers pass `now`
 * explicitly so expiry is testable without clock stubbing. Pure TS.
 */

export const HERO_STREAM_COOLDOWN_BASE_MS = 60_000
export const HERO_STREAM_COOLDOWN_MAX_MS = 600_000

type CooldownEntry = {
  consecutiveFailures: number
  blockedUntil: number
  warnedThisWindow: boolean
}

const cooldowns = new Map<string, CooldownEntry>()

export type HeroStreamCooldownCheck = {
  /** True while the slug's failure window is open — do not attempt a query. */
  suppressed: boolean
  /**
   * Remaining window ms, non-null exactly once per window (the caller's
   * one-structured-log budget); null on every later check in that window.
   */
  warnRemainingMs: number | null
}

/**
 * Check (and, when suppressed, consume the per-window warn budget of) a
 * slug's cooldown. An expired window is not suppression; the entry is kept so
 * the next failure continues the backoff progression.
 */
export function checkHeroStreamCooldown(
  slug: string,
  now: number,
): HeroStreamCooldownCheck {
  const entry = cooldowns.get(slug)
  if (!entry || entry.blockedUntil <= now) {
    return { suppressed: false, warnRemainingMs: null }
  }
  const warnRemainingMs = entry.warnedThisWindow
    ? null
    : entry.blockedUntil - now
  entry.warnedThisWindow = true
  return { suppressed: true, warnRemainingMs }
}

/** Record a failed query: doubles the window per consecutive failure, capped. */
export function registerHeroStreamFailure(slug: string, now: number): void {
  const consecutiveFailures =
    (cooldowns.get(slug)?.consecutiveFailures ?? 0) + 1
  const windowMs = Math.min(
    HERO_STREAM_COOLDOWN_BASE_MS * 2 ** (consecutiveFailures - 1),
    HERO_STREAM_COOLDOWN_MAX_MS,
  )
  cooldowns.set(slug, {
    consecutiveFailures,
    blockedUntil: now + windowMs,
    warnedThisWindow: false,
  })
}

/** A successful query proves the network path works again — forget the slug. */
export function clearHeroStreamCooldown(slug: string): void {
  cooldowns.delete(slug)
}

export function resetHeroStreamCooldownsForTests(): void {
  cooldowns.clear()
}
