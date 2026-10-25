import type { MuxSyncComparison } from "@/types/job"

export const MUX_OVERRIDE_RESUME_AFTER_MS = 60_000

export function isStaleOverridePending(
  comparison: MuxSyncComparison,
  now: number = Date.now(),
): boolean {
  if (comparison.status !== "override_pending") {
    return false
  }

  const updatedAtMs =
    typeof comparison.updatedAt === "string"
      ? Date.parse(comparison.updatedAt)
      : Number.NaN

  return (
    Number.isFinite(updatedAtMs) &&
    now - updatedAtMs >= MUX_OVERRIDE_RESUME_AFTER_MS
  )
}

export function canRetryMuxSyncOverride(
  comparison: MuxSyncComparison,
  now: number = Date.now(),
): boolean {
  return (
    comparison.canOverride === true || isStaleOverridePending(comparison, now)
  )
}
