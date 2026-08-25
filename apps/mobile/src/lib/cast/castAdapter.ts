// The imperative side of the cast layer (KTD3): every direct SDK call the
// hook needs, so useCastPlayback stays a thin event/state shell.
import {
  CastContext,
  MediaStreamType,
  type MediaLoadRequest,
} from "react-native-google-cast"

import { capErrorMessage, datadogLog } from "../datadog"
import {
  CAST_MAX_PLAYBACK_RATE,
  CAST_MIN_PLAYBACK_RATE,
  type CastMedia,
} from "./castMediaResolver"

export function toMediaLoadRequest(media: CastMedia): MediaLoadRequest {
  return {
    autoplay: true,
    startTime: media.startPositionSeconds,
    // Carried even at 1 (pinned): an explicit normal rate over an implicit one.
    playbackRate: media.playbackRate,
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

/**
 * R10: applies a speed pick to the receiver. No current session resolves as a
 * no-op — the session may have just ended, which is not an error. The clamp is
 * belt only: the settings store already restricts speeds to the SDK's band.
 */
export async function setCastPlaybackRate(rate: number): Promise<void> {
  if (!Number.isFinite(rate)) return
  const session = await CastContext.getSessionManager().getCurrentCastSession()
  if (session == null) return
  await session.client.setPlaybackRate(
    Math.min(CAST_MAX_PLAYBACK_RATE, Math.max(CAST_MIN_PLAYBACK_RATE, rate)),
  )
}

/** Fire-and-forget shape for UI callers (mirrors endCastSessionLogged): a
 *  rejection logs cast.command_failed and never reaches the sheet. */
export function setCastPlaybackRateLogged(rate: number): void {
  void setCastPlaybackRate(rate).catch((error: unknown) => {
    datadogLog.warn("cast.command_failed", {
      cast_command: "set_playback_rate",
      error_message: capErrorMessage(String(error)),
    })
  })
}

export function showCastDialog(): Promise<boolean> {
  return CastContext.showCastDialog()
}
