import { Platform } from "react-native"

type StartupStage =
  | "root-mounted"
  | "home-mounted"
  | "primary-request"
  | "experience-request"
  | "requests-settled"
  | "snapshot-read"
  | "snapshot-parse"
  | "snapshot-model"
  | "snapshot-config"
  | "snapshot-index"
  | "snapshot-sections"
  | "snapshot-ready"
  | "live-model"
  | "home-navigation-layout"
  | "home-content-committed"
  | "details-query-ready"
  | "details-transport"
  | "details-cache-processing"
  | "details-normalized"
  | "resume-js-start"
  | "native-player-render"
  | "native-audio-options"
  | "native-player-committed"
  | "search-response"
  | "search-mapped"

export function traceHomeStartup(
  stage: StartupStage,
  startedAt?: number,
): void {
  if (
    Platform.OS !== "android" ||
    process.env.EXPO_PUBLIC_TV_STARTUP_TRACE !== "1"
  ) {
    return
  }
  const now = performance.now()
  console.info(
    "[tv-startup]",
    JSON.stringify({
      stage,
      clockMs: Math.round(now),
      ...(startedAt == null ? {} : { elapsedMs: Math.round(now - startedAt) }),
    }),
  )
}
