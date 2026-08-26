import type { UiLocale } from "@/i18n/generated-ui-locales"

export const WATCH_INTRODUCTION_STORAGE_KEY = "forge.watch_introduction.v1"

const WATCH_INTRODUCTION_COMPLETED_VALUE = "completed"
const WATCH_INTRODUCTION_STORAGE_PROBE_KEY = `${WATCH_INTRODUCTION_STORAGE_KEY}.probe`

const WATCH_INTRODUCTION_AUTHORED_LOCALES: ReadonlySet<string> = new Set([
  "ar",
  "de",
  "en",
  "ru",
  "zh",
  "zh-Hans",
] satisfies readonly UiLocale[])

type WatchIntroductionCompletion = "completed" | "incomplete" | "unavailable"

export function isWatchIntroductionLocaleEligible(locale: string): boolean {
  return WATCH_INTRODUCTION_AUTHORED_LOCALES.has(locale)
}

export function readWatchIntroductionCompletion(): WatchIntroductionCompletion {
  if (typeof window === "undefined") return "unavailable"

  try {
    if (
      window.localStorage.getItem(WATCH_INTRODUCTION_STORAGE_KEY) ===
      WATCH_INTRODUCTION_COMPLETED_VALUE
    ) {
      return "completed"
    }

    window.localStorage.setItem(WATCH_INTRODUCTION_STORAGE_PROBE_KEY, "1")
    window.localStorage.removeItem(WATCH_INTRODUCTION_STORAGE_PROBE_KEY)
    return "incomplete"
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
