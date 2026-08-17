// The imperative side of the cast layer (KTD3): every direct SDK call the
// hook needs, so useCastPlayback stays a thin event/state shell.
import {
  CastContext,
  MediaStreamType,
  type MediaLoadRequest,
} from "react-native-google-cast"

import type { CastMedia } from "./castMediaResolver"

export function toMediaLoadRequest(media: CastMedia): MediaLoadRequest {
  return {
    autoplay: true,
    startTime: media.startPositionSeconds,
    mediaInfo: {
      contentUrl: media.contentUrl,
      contentType: media.contentType,
      streamType: MediaStreamType.BUFFERED,
      metadata: {
        type: "movie",
        ...(media.title != null ? { title: media.title } : {}),
        ...(media.posterUrl != null
          ? { images: [{ url: media.posterUrl }] }
          : {}),
      },
    },
  }
}

export type CastSessionCallbacks = {
  onStarting: (deviceName: string | null) => void
  onStarted: (deviceName: string | null) => void
  onStartFailed: (errorMessage: string) => void
  onEnded: (errorMessage: string | null) => void
}

// The SDK's useCastSession discards the error strings these events carry;
// R13's failure classification (device drop vs graceful end) needs them.
export function subscribeToCastSessionEvents(
  callbacks: CastSessionCallbacks,
): () => void {
  const manager = CastContext.getSessionManager()
  const subscriptions = [
    manager.onSessionStarting(() => callbacks.onStarting(null)),
    manager.onSessionStarted(() => callbacks.onStarted(null)),
    manager.onSessionStartFailed((_session, error) =>
      callbacks.onStartFailed(error ?? "session start failed"),
    ),
    manager.onSessionEnded((_session, error) =>
      callbacks.onEnded(error ?? null),
    ),
  ]
  return () => {
    for (const subscription of subscriptions) subscription.remove()
  }
}

/** Ends the session and, by default, stops the receiver's playback too. */
export async function endCastSession(stopCasting = true): Promise<void> {
  await CastContext.getSessionManager().endCurrentSession(stopCasting)
}

export function showCastDialog(): Promise<boolean> {
  return CastContext.showCastDialog()
}
