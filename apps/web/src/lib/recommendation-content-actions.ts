import {
  recommendationEventId,
  recommendationFetchWithRetry,
} from "@/lib/recommendation-browser"
import { RECOMMENDATION_CONTENT_ACTION_CONTRACT } from "@/lib/recommendation-contracts"
import { watchPath } from "@/lib/watch-paths"

const CONTENT_ACTION_ENDPOINT = watchPath(
  "/api/recommendations/content-actions",
)
const CONTENT_ACTION_DEADLINE_MS = 700

export type WatchShareActionDetail =
  | "link_copy"
  | "embed_copy"
  | "facebook_intent"
  | "x_intent"

export function recordWatchShareAction(
  mediaId: string,
  actionDetail: WatchShareActionDetail,
) {
  const body = JSON.stringify({
    contractVersion: RECOMMENDATION_CONTENT_ACTION_CONTRACT,
    eventId: recommendationEventId("share"),
    occurredAt: new Date().toISOString(),
    mediaId,
    actionKind: "share",
    actionDetail,
  })

  void recommendationFetchWithRetry(
    CONTENT_ACTION_ENDPOINT,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body,
    },
    CONTENT_ACTION_DEADLINE_MS,
  ).catch(() => {
    // Sharing is the viewer outcome. Telemetry remains best effort and must
    // never turn a successful copy/share intent into a Watch error.
  })
}
