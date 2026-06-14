// In-memory TTL launch-slot guard for the Shorts Studio launch routes
// (render + retry) — clone of the smart-crop retry route's claimRetrySlot
// semantics (plan 2026-06-11-002 decision 2 "Double-launch guard").
//
// A second launch for the same job while one is being dispatched gets a 409
// instead of a duplicate workflow run. The slot MUST be claimed synchronously
// BEFORE any await and released in a try/finally wrapping the ENTIRE
// post-claim body (root CLAUDE.md: fire-and-forget slot-leak guard — a sync
// throw between claim and dispatch must not leak the slot). The TTL bounds
// staleness if an entry somehow outlives its request. The map is shared by
// the render and retry routes deliberately: both launch workflows on the
// same JobRecord, so they must contend for the same slot.
//
// Single-replica assumption: manager runs one instance (same caveat as the
// smart-crop retry guard and the admin-trigger idempotency map).

const SHORTS_LAUNCH_IN_FLIGHT_TTL_MS = 30_000

const launchInFlight = new Map<string, number>()

export function claimShortsLaunchSlot(
  jobId: string,
  now: () => number = Date.now,
): boolean {
  const current = now()
  const expiresAt = launchInFlight.get(jobId)
  if (expiresAt !== undefined && expiresAt > current) {
    return false
  }
  launchInFlight.set(jobId, current + SHORTS_LAUNCH_IN_FLIGHT_TTL_MS)
  return true
}

export function releaseShortsLaunchSlot(jobId: string): void {
  launchInFlight.delete(jobId)
}

// Test helper — the map is module state shared across route handlers.
export function clearShortsLaunchSlots(): void {
  launchInFlight.clear()
}
