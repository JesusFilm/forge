// Flushing the anonymous watch-event queue into admin, once a viewer signs in
// (feat-322 U4.6).
//
// Mirrors apps/web's `RecordWatchEvent` in `apps/web/src/lib/watch-event-actions.ts`
// — same operation name, same argument set — so both surfaces write the same
// shape into the same mutation.
//
// The operation NAME is load-bearing: `USER_TOKEN_OPERATIONS` allowlists the
// signed-in bearer by name, so a rename here detaches the credential and every
// write silently lands as anonymous. `recordWatchEvent.test.ts` pins the
// document's own name against the constant rather than trusting the two to stay
// in step by hand — the #1622 rename trap, one credential over.

import { getApolloClient } from "../apolloClient"
import { RECORD_WATCH_EVENT } from "./recordWatchEventDocument"
import { getValidAccessToken } from "../auth/session"
import type { QueuedWatchEvent } from "./watchEvents"

/**
 * Submit one queued event. Returns false to RETAIN it — `flushWatchEventQueue`
 * keeps anything that does not return true, so a failure here costs a retry
 * rather than the event.
 *
 * Signed out is a normal outcome, not an error: without a bearer the write
 * would land anonymous, so the event is retained for a later sign-in instead.
 */
export async function submitQueuedWatchEvent(
  event: QueuedWatchEvent,
): Promise<boolean> {
  try {
    const userAccessToken = await getValidAccessToken()
    if (userAccessToken == null) return false

    const result = await getApolloClient().mutate({
      mutation: RECORD_WATCH_EVENT,
      variables: {
        videoId: event.videoId,
        videoDubId: event.videoDubId,
        // The queue holds ONLY events that crossed the meaningful-playback
        // threshold (`queueMeaningfulWatchEvent`), so the type is fixed rather
        // than carried per event. Admin's enum is lowercase — the generated
        // schema rejects any other spelling, which is what caught the first
        // guess here.
        eventType: "meaningful_playback",
        positionSeconds: event.positionSeconds,
        durationSeconds: event.durationSeconds,
        progress: event.progress,
        requestSessionId: event.requestSessionId,
        occurredAt: event.queuedAt,
      },
      // Supplied through context because obtaining it can require an async
      // refresh; the link's allowlist still decides whether it attaches.
      context: { userAccessToken },
      errorPolicy: "all",
    })

    return result.data?.recordWatchEvent != null
  } catch {
    // Retained, never dropped. A flush must not be able to lose history.
    return false
  }
}
