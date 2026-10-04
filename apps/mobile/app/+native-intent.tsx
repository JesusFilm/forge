// KTD14, R1: expo-router (57.0.24, `build/getLinkingConfig.js` and
// `build/link/linking.js`) calls this with `initial: true` for the launch URL,
// and with `initial: false` for a URL that reaches a running app.
import { DAILY_PAUSE_WIDGET_URL } from "../src/lib/dailyPause/widgetTimeline"
import { requestPause } from "../src/lib/pauseCurtain"

/** A widget tap requests the curtain (KTD5): a cold launch opens Home under it,
 *  and on a running app null keeps the current screen, so a run on top stays.
 *  Every other URL passes through unchanged. */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string
  initial: boolean
}): string | null {
  if (path !== DAILY_PAUSE_WIDGET_URL) return path
  requestPause()
  return initial ? "/" : null
}
