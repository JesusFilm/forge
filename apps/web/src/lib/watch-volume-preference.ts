const WATCH_VOLUME_PREFERENCE_KEY = "forge.watch.volumePreference"

export type WatchVolumePreference = {
  muted: boolean
  volume: number
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined"
}

function isFiniteVolume(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  )
}

export function readWatchVolumePreference(): WatchVolumePreference | null {
  if (!isBrowserStorageAvailable()) return null

  try {
    const raw = window.localStorage.getItem(WATCH_VOLUME_PREFERENCE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null

    const record = parsed as Record<string, unknown>
    if (typeof record.muted !== "boolean") return null
    if (!isFiniteVolume(record.volume)) return null

    return {
      muted: record.muted,
      volume: record.volume,
    }
  } catch {
    return null
  }
}

export function writeWatchVolumePreference(
  preference: WatchVolumePreference,
): void {
  if (!isBrowserStorageAvailable()) return
  if (!isFiniteVolume(preference.volume)) return

  try {
    window.localStorage.setItem(
      WATCH_VOLUME_PREFERENCE_KEY,
      JSON.stringify({
        muted: preference.muted,
        volume: preference.volume,
      }),
    )
  } catch {
    // Storage can be unavailable in private browsing or quota failures.
  }
}
