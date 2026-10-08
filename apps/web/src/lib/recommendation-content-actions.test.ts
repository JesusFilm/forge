import { beforeEach, describe, expect, it, vi } from "vitest"

const { recommendationFetchWithRetry, recommendationEventId } = vi.hoisted(
  () => ({
    recommendationFetchWithRetry: vi.fn(),
    recommendationEventId: vi.fn(() => "share-event-1"),
  }),
)

vi.mock("@/lib/recommendation-browser", () => ({
  recommendationFetchWithRetry,
  recommendationEventId,
}))

import { recordWatchShareAction } from "./recommendation-content-actions"
import {
  RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
  RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS,
} from "./recommendation-timeouts"

describe("recordWatchShareAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recommendationFetchWithRetry.mockResolvedValue(new Response(null))
  })

  it("submits one bounded idempotent share fact outside the player path", () => {
    recordWatchShareAction("media-1", "link_copy")

    expect(recommendationFetchWithRetry).toHaveBeenCalledWith(
      "/watch/api/recommendations/content-actions",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        keepalive: true,
      }),
      RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
    )
    expect(
      JSON.parse(recommendationFetchWithRetry.mock.calls[0]?.[1]?.body),
    ).toEqual({
      contractVersion: "recommendation-content-action-v1",
      eventId: "share-event-1",
      occurredAt: expect.any(String),
      mediaId: "media-1",
      actionKind: "share",
      actionDetail: "link_copy",
    })
  })

  it("keeps the Admin request timeout below the browser deadline", () => {
    expect(RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS).toBe(500)
    expect(RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS).toBe(700)
    expect(RECOMMENDATION_CONTENT_ACTION_UPSTREAM_TIMEOUT_MS).toBeLessThan(
      RECOMMENDATION_CONTENT_ACTION_BROWSER_DEADLINE_MS,
    )
  })

  it("does not surface telemetry failure to the completed share action", async () => {
    recommendationFetchWithRetry.mockRejectedValueOnce(
      new Error("telemetry unavailable"),
    )

    expect(() => recordWatchShareAction("media-1", "x_intent")).not.toThrow()
    await Promise.resolve()
  })
})
