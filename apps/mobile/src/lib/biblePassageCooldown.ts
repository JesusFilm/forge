/**
 * Per-video failure cooldown for the Bible passage companion read.
 *
 * A failed read never populates the Apollo cache, so without this every
 * re-entry and every next video repeats the request under the same stall that
 * caused the failure. Module-scope state, not hook-lifetime refs, so a remount
 * cannot reset it; callers pass `now` so expiry is testable without a clock.
 *
 * Deliberately a separate module from `watchHome/heroStreamCooldown.ts` rather
 * than a shared factory: that one carries a per-window warn budget and a
 * pull-to-refresh release that Home owns, and folding this in would put the
 * watch screen inside Home's blast radius.
 */

export const PASSAGE_COOLDOWN_BASE_MS = 60_000
export const PASSAGE_COOLDOWN_MAX_MS = 600_000

type CooldownEntry = {
  consecutiveFailures: number
  blockedUntil: number
}

const cooldowns = new Map<string, CooldownEntry>()

/** True while the slug's failure window is open — do not attempt a read. */
export function isPassageReadSuppressed(slug: string, now: number): boolean {
  const entry = cooldowns.get(slug)
  return entry != null && entry.blockedUntil > now
}

/** Record a failed read: doubles the window per consecutive failure, capped. */
export function registerPassageReadFailure(slug: string, now: number): void {
  const existing = cooldowns.get(slug)
  // Inside an open window a registration is an echo of the same failure, not a
  // new one — doubling for it would punish one outage twice.
  if (existing && existing.blockedUntil > now) return
  const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1
  const windowMs = Math.min(
    PASSAGE_COOLDOWN_BASE_MS * 2 ** (consecutiveFailures - 1),
    PASSAGE_COOLDOWN_MAX_MS,
  )
  cooldowns.set(slug, { consecutiveFailures, blockedUntil: now + windowMs })
}

/** A successful read proves the path works again — forget the slug. */
export function clearPassageReadCooldown(slug: string): void {
  cooldowns.delete(slug)
}

export function resetBiblePassageCooldownsForTests(): void {
  cooldowns.clear()
}
