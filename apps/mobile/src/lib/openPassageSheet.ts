/**
 * Open a Bible passage inside the app and return the viewer to the video.
 *
 * `bible.com` claims every path as a universal link for the YouVersion app, so
 * a plain `Linking.openURL` would hand the viewer to another app mid-video.
 * `expo-web-browser` presents it over this app instead — its native module is
 * already in the binary, so this ships over an update rather than a build.
 */

import { AppState } from "react-native"
import * as WebBrowser from "expo-web-browser"

import { beginPlaybackInterruption } from "./playbackInterruption"
import { validateActionUrl } from "./validateUrl"

/**
 * The resume signal is "the viewer is back", and each platform says it
 * differently — but the EXPRESSION is shared, so the behaviour does not fork.
 *
 * `openBrowserAsync` resolves on dismissal on iOS (`cancel` / `dismiss`) and
 * immediately on Android (`opened`), where the vendor ships a separate AppState
 * polyfill for the auth flow and none for this one. So `opened` means "still
 * open, wait for the foreground"; anything else means the browser is gone.
 */
export async function openPassageSheet(url: string): Promise<void> {
  if (!validateActionUrl(url)) return

  const interruption = beginPlaybackInterruption()

  let leftForeground = false
  let finished = false
  const subscription = AppState.addEventListener("change", (state) => {
    if (state !== "active") {
      leftForeground = true
      return
    }
    // Only a return counts. iOS reports `inactive` while the sheet is up and
    // `active` again on dismissal; Android backgrounds and foregrounds.
    if (leftForeground) finish()
  })

  function finish(): void {
    if (finished) return
    finished = true
    subscription.remove()
    interruption.resume()
  }

  try {
    const result = await WebBrowser.openBrowserAsync(url)
    if (result.type !== "opened") finish()
  } catch {
    // Nothing was presented. Never strand the viewer on a video this paused.
    finish()
  }
}
