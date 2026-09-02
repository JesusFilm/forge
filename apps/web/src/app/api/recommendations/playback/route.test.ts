import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  adminClaimSemanticRecommendationEpisodeOperation,
  adminOpenRecommendationPlaybackContextOperation,
  adminRecordSemanticRecommendationPlaybackOperation,
} from "@forge/admin-graphql/operations"

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_CANONICAL_ORIGIN: "https://watch.example" },
}))
vi.mock("@/lib/admin-client", () => ({ default: { mutate } }))

const { POST, dynamic, revalidate } = await import("./route")

const session = "a".repeat(43)

function request(body: string, headers: HeadersInit = {}) {
  return new Request(
    "https://watch.example/watch/api/recommendations/playback",
    {
      method: "POST",
      headers: {
        origin: "https://watch.example",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: `forge_recommendation_session=${session}`,
        ...headers,
      },
      body,
    },
  )
}

const playbackEvent = {
  eventId: "event-1",
  kind: "playback_progress",
  occurredAt: "2026-08-19T03:00:00.000Z",
  payload: {
    positionSeconds: 32,
    durationSeconds: 120,
    progress: 32 / 120,
    wallElapsedMilliseconds: 35_000,
  },
}

describe("POST /watch/api/recommendations/playback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("claims a matching handoff using only the digest and returns a private episode capability", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        claimSemanticRecommendationEpisode: {
          episodeId: "episode-1",
          capability: "episode-capability-secret",
          activeUntil: "2026-08-19T07:00:00.000Z",
          hardUntil: "2026-08-19T09:00:00.000Z",
        },
      },
    })

    const response = await POST(
      request(
        JSON.stringify({
          action: "claim",
          claimNonce: "claim-nonce-1234567890",
          mediaId: "media-1",
        }),
      ),
    )

    expect(dynamic).toBe("force-dynamic")
    expect(revalidate).toBe(0)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await response.json()).toEqual({
      episode: {
        episodeId: "episode-1",
        capability: "episode-capability-secret",
        activeUntil: "2026-08-19T07:00:00.000Z",
        hardUntil: "2026-08-19T09:00:00.000Z",
      },
    })
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminClaimSemanticRecommendationEpisodeOperation,
        variables: {
          sessionDigest: createHash("sha256").update(session).digest("hex"),
          claimNonce: "claim-nonce-1234567890",
          mediaId: "media-1",
        },
        fetchPolicy: "no-cache",
      }),
    )
  })

  it("opens a source-neutral direct context behind mutation admission", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        openRecommendationPlaybackContext: {
          contextId: "context-1",
          episodeId: "episode-1",
          capability: "episode-capability-secret",
          activeUntil: "2026-08-19T07:00:00.000Z",
          hardUntil: "2026-08-19T09:00:00.000Z",
          source: "direct",
        },
      },
    })

    const response = await POST(
      request(
        JSON.stringify({
          action: "context",
          contractVersion: "recommendation-playback-context-v1",
          idempotencyKey: "player-instance-1234567890",
          mediaId: "media-1",
          source: "direct",
        }),
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      episode: {
        contextId: "context-1",
        episodeId: "episode-1",
        capability: "episode-capability-secret",
        activeUntil: "2026-08-19T07:00:00.000Z",
        hardUntil: "2026-08-19T09:00:00.000Z",
      },
    })
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mutation: adminOpenRecommendationPlaybackContextOperation,
        variables: expect.objectContaining({
          contractVersion: "recommendation-playback-context-v1",
          sessionDigest: createHash("sha256").update(session).digest("hex"),
          idempotencyKey: "player-instance-1234567890",
          mediaId: "media-1",
          source: "direct",
        }),
      }),
    )
  })

  it("forwards bounded playback facts without accepting browser-owned lineage", async () => {
    mutate.mockResolvedValueOnce({
      data: {
        recordSemanticRecommendationPlayback: [
          { eventId: "event-1", status: "accepted", sequence: 3 },
        ],
      },
    })
    const response = await POST(
      request(
        JSON.stringify({
          action: "facts",
          contractVersion: "recommendation-evidence-v1",
          capability: "episode-capability-secret",
          episodeId: "episode-1",
          mediaId: "media-1",
          events: [playbackEvent],
        }),
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      receipts: [{ eventId: "event-1", status: "accepted", sequence: 3 }],
    })
    const variables = mutate.mock.calls[0]?.[0]?.variables
    expect(mutate.mock.calls[0]?.[0]?.mutation).toBe(
      adminRecordSemanticRecommendationPlaybackOperation,
    )
    expect(variables).toEqual(
      expect.objectContaining({
        contractVersion: "recommendation-evidence-v1",
        capability: "episode-capability-secret",
        episodeId: "episode-1",
        mediaId: "media-1",
        sessionDigest: createHash("sha256").update(session).digest("hex"),
        events: [playbackEvent],
      }),
    )
    expect(variables).not.toHaveProperty("requestId")
    expect(variables).not.toHaveProperty("itemId")
  })

  it("rejects missing sessions, foreign requests, duplicates, invalid fact payloads, and overflow before Admin", async () => {
    const missingSession = await POST(
      request(
        JSON.stringify({
          action: "claim",
          claimNonce: "claim-nonce-1234567890",
          mediaId: "media-1",
        }),
        { cookie: "unrelated=value" },
      ),
    )
    expect(missingSession.status).toBe(401)

    const foreign = await POST(
      request(JSON.stringify({ action: "claim" }), {
        origin: "https://evil.example",
      }),
    )
    expect(foreign.status).toBe(403)

    const duplicate = await POST(
      request(
        '{"action":"claim","claimNonce":"claim-nonce-1234567890","mediaId":"media-1","mediaId":"media-2"}',
      ),
    )
    expect(duplicate.status).toBe(400)

    const invalidPayload = await POST(
      request(
        JSON.stringify({
          action: "facts",
          contractVersion: "recommendation-evidence-v1",
          capability: "episode-capability-secret",
          episodeId: "episode-1",
          mediaId: "media-1",
          events: [
            {
              ...playbackEvent,
              payload: { ...playbackEvent.payload, progress: 4 },
            },
          ],
        }),
      ),
    )
    expect(invalidPayload.status).toBe(400)

    const overflow = await POST(
      request(JSON.stringify({ action: "claim", padding: "x".repeat(9_000) })),
    )
    expect(overflow.status).toBe(413)
    expect(mutate).not.toHaveBeenCalled()
  })

  it("never reflects Admin or capability secrets in failures", async () => {
    mutate.mockRejectedValueOnce(
      new Error("Bearer admin-secret episode-capability-secret"),
    )
    const response = await POST(
      request(
        JSON.stringify({
          action: "claim",
          claimNonce: "claim-nonce-1234567890",
          mediaId: "media-1",
        }),
      ),
    )

    expect(response.status).toBe(503)
    expect(await response.text()).not.toMatch(
      /Bearer|admin-secret|episode-capability-secret/,
    )
  })
})
