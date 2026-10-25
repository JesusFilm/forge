/**
 * KTD3: the number of feed players. A static device tier plus a demotion when
 * the standby fails fast twice in one launch. Memory and the stored demotion
 * are inputs, so the rule stays pure.
 */

/**
 * KTD3's "below 4 GB", in reported bytes: a phone sold as 4 GB reports about
 * 3.7 GiB and keeps two players; one sold as 3 GB reports about 2.8 GiB.
 */
export const LOW_MEMORY_THRESHOLD_BYTES = 3.5 * 1024 ** 3

/** A standby error counts only this soon after its source was set. */
export const DEMOTION_ERROR_WINDOW_MS = 8_000

/** Counted standby errors in one launch that demote the launch. */
export const DEMOTION_STANDBY_ERROR_COUNT = 2

/** A stored demotion applies for this long, and only on the same app version. */
export const DEMOTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type PlayerMode = "two" | "one"

/** React Native's `Platform.OS` values, so the caller passes it directly. */
export type DevicePlatform = "ios" | "android" | "windows" | "macos" | "web"

export type StoredDemotion = {
  demotedAtMs: number
  appVersion: string
}

export type PlayerModeInput = {
  platform: DevicePlatform
  /** Null when the adapter could not read the value. */
  totalMemoryBytes: number | null
  standbyErrorsThisLaunch: number
  storedDemotion: StoredDemotion | null
  appVersion: string
  nowMs: number
}

/**
 * Only a fast failure beside a healthy active player points at the device.
 * expo-video reports a decoder failure only as an untyped message, so a slow
 * load, or an error after the window, never counts.
 */
export function standbyErrorCountsTowardDemotion(input: {
  msSinceSourceSet: number
  activeHealthy: boolean
}): boolean {
  return (
    input.activeHealthy && input.msSinceSourceSet <= DEMOTION_ERROR_WINDOW_MS
  )
}

export function launchDemoted(standbyErrorsThisLaunch: number): boolean {
  return standbyErrorsThisLaunch >= DEMOTION_STANDBY_ERROR_COUNT
}

function storedDemotionApplies(input: PlayerModeInput): boolean {
  const stored = input.storedDemotion
  if (stored == null || stored.appVersion !== input.appVersion) return false
  return input.nowMs - stored.demotedAtMs < DEMOTION_MAX_AGE_MS
}

function belowMemoryThreshold(input: PlayerModeInput): boolean {
  if (input.platform !== "android") return false
  const bytes = input.totalMemoryBytes
  // An unreadable value is unknown, and an unknown device gets two players.
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return false
  return bytes < LOW_MEMORY_THRESHOLD_BYTES
}

export function resolvePlayerMode(input: PlayerModeInput): PlayerMode {
  if (launchDemoted(input.standbyErrorsThisLaunch)) return "one"
  if (storedDemotionApplies(input)) return "one"
  if (belowMemoryThreshold(input)) return "one"
  return "two"
}
