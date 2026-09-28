/**
 * KTD17: a full play from Explore lasts as long as its playback session, and
 * the window keeps that session after the watch page closes. So the stores,
 * not the page's life, report its play time and its end.
 */

import { getPlaybackRequestStore } from "../miniPlayer/playbackRequest"
import { getMiniPlayerStore } from "../miniPlayer/store"
import type { VideoQoeReason } from "../videoQoe"
import { getExploreTelemetry, type ExploreFullPlayIntent } from "./telemetry"

let stopTracking: (() => void) | null = null

/** Call at the page's first frame. A repeat of one intent does nothing. */
export function trackExploreFullPlay(intent: ExploreFullPlayIntent): void {
  const telemetry = getExploreTelemetry()
  const requests = getPlaybackRequestStore()
  const sessions = getMiniPlayerStore()
  const isThisVideo = (videoSlug: string | undefined) =>
    videoSlug === intent.videoSlug
  // Once the video floats, only the end event names the reason: the session
  // store's `end()` drops the request before it reports why.
  let floated = isThisVideo(sessions.getSnapshot().session?.videoSlug)
  if (!telemetry.fullPlayStart(intent)) return
  stopTracking?.()

  const offEnd = sessions.onEnd((event) => {
    if (isThisVideo(event.session.videoSlug)) finish(event.reason)
  })
  const offRequests = requests.subscribe(() => {
    const snapshot = requests.getSnapshot()
    telemetry.fullPlayPlaying(snapshot.playing)
    if (isThisVideo(sessions.getSnapshot().session?.videoSlug)) floated = true
    if (floated || isThisVideo(snapshot.request?.session?.videoSlug)) return
    finish(snapshot.request == null ? "abandoned" : "replaced")
  })
  const stop = () => {
    offEnd()
    offRequests()
    if (stopTracking === stop) stopTracking = null
  }
  const finish = (reason: VideoQoeReason) => {
    stop()
    telemetry.fullPlayEnd(reason)
  }
  stopTracking = stop
}
