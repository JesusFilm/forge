/**
 * The recommendation viewer handle both push write paths send (KTD7). One
 * reader, shared by the registration host and the open-report host, so the two
 * cannot disagree about what "no handle to send" means. They also share one
 * re-check, for the handle Admin refuses.
 */

import { withTimeout } from "../withTimeout"
import { getRecommendationViewerStore } from "../recommendations/viewerIdentityClient"
import { PUSH_IDENTITY_READ_DEADLINE_MS } from "./constants"
import type { PushViewerHandle } from "./payload"

/**
 * The handle when that client is on and has one. The store answers `disabled`
 * on its own when the client is off, and every other kind means "no handle to
 * send" — which is a registration, or an open report, without one.
 */
export async function readPushViewerHandle(): Promise<PushViewerHandle | null> {
  try {
    const result = await withTimeout(
      getRecommendationViewerStore().get(),
      PUSH_IDENTITY_READ_DEADLINE_MS,
    )
    if (result.kind !== "ready") return null
    return {
      viewerToken: result.identity.viewerToken,
      sessionToken: result.identity.sessionToken,
    }
  } catch {
    // A registration without a handle still reaches the audience, and an open
    // without one still binds to the delivery's own registration (KTD14).
    return null
  }
}

/**
 * Admin refused the handle a push write sent. The store keeps it but marks it
 * suspect, so its next read re-checks it and replaces it when Admin agrees it
 * is dead. Never throws: a failed re-check only means the next read is normal.
 */
export async function recheckPushViewerHandle(
  refusedViewerToken: string,
): Promise<void> {
  try {
    await getRecommendationViewerStore().invalidate(refusedViewerToken)
  } catch {
    // Nothing to undo: the push write already goes on without the handle.
  }
}
