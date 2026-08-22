export const WATCH_INTRODUCTION_STORAGE_KEY = "forge.watch_introduction.v1"

const WATCH_INTRODUCTION_COMPLETED_VALUE = "completed"

export type WatchIntroductionCompletion =
  | "completed"
  | "incomplete"
  | "unavailable"

export function readWatchIntroductionCompletion(): WatchIntroductionCompletion {
  if (typeof window === "undefined") return "unavailable"

  try {
    return window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY) ===
      WATCH_INTRODUCTION_COMPLETED_VALUE
      ? "completed"
      : "incomplete"
  } catch {
    // Do not auto-open a tour that the browser cannot remember dismissing.
    return "unavailable"
  }
}

export function markWatchIntroductionCompleted(): boolean {
  if (typeof window === "undefined") return false

  try {
    window.localStorage.setItem(
      WATCH_INTRODUCTION_STORAGE_KEY,
      WATCH_INTRODUCTION_COMPLETED_VALUE,
    )
    return true
  } catch {
    // Storage is optional in private browsing and hardened environments.
    return false
  }
}
