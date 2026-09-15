/**
 * Open a Bible passage inside the app and return the viewer to the video.
 *
 * `bible.com` claims every path as a universal link for the YouVersion app, so
 * a plain `Linking.openURL` would hand the viewer to another app mid-video.
 * `expo-web-browser` presents it over this app instead — its native module is
 * already in the binary, so this ships over an update rather than a build.
 */

import { AppState, Platform } from "react-native"
import * as WebBrowser from "expo-web-browser"

import { beginPlaybackInterruption } from "./playbackInterruption"
import { validateActionUrl } from "./validateUrl"

/**
 * The resume signal is "the sheet is gone", and the two platforms say it in
 * genuinely different places — so this forks, deliberately.
 *
 * iOS presents `SFSafariViewController` INSIDE the app, and `openBrowserAsync`
 * resolves when it is dismissed. A foreground round trip is NOT a dismissal
 * there: a viewer who switches apps while the sheet is up and comes back
 * returns to the app WITH the sheet still presented, so resuming on `active`
 * would start the video behind the page they are reading — the exact harm this
 * module exists to prevent.
 *
 * Android launches the custom tab into its own task and `openBrowserAsync`
 * resolves the moment it OPENS (the vendor ships an AppState polyfill for the
 * auth flow and none for this one), so there the foreground return is the only
 * signal available.
 */
export async function openPassageSheet(url: string): Promise<void> {
  if (!validateActionUrl(url)) return

  const interruption = beginPlaybackInterruption()

  let leftForeground = false
  let finished = false

  const subscription =
    Platform.OS === "android"
      ? AppState.addEventListener("change", (state) => {
          if (state !== "active") {
            leftForeground = true
            return
          }
          if (leftForeground) finish()
        })
      : null

  function finish(): void {
    if (finished) return
    finished = true
    subscription?.remove()
    interruption.resume()
  }

  try {
    const result = await WebBrowser.openBrowserAsync(url)
    // `opened` is Android's "the tab is up" — wait for the foreground return.
    // Every other result means the browser is already gone.
    if (result.type !== "opened") finish()
  } catch {
    // Nothing was presented. Never strand the viewer on a video this paused.
    finish()
  }
}
