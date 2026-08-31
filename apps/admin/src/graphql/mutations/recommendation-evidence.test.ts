import { beforeEach, describe, expect, it, vi } from "vitest"

const recordMock = vi.fn()
const selectMock = vi.fn()
const claimMock = vi.fn()
const playbackMock = vi.fn()
const contentActionMock = vi.fn()

vi.mock("@/services/recommendations/evidence.service", () => ({
  createRecommendationEvidenceService: vi.fn(() => ({ record: recordMock })),
}))
vi.mock("@/services/recommendations/episode.service", () => ({
  createRecommendationEpisodeService: vi.fn(() => ({
    select: selectMock,
    claim: claimMock,
  })),
}))
vi.mock("@/services/recommendations/playback.service", () => ({
  createRecommendationPlaybackService: vi.fn(() => ({
    record: playbackMock,
  })),
}))
vi.mock("@/services/recommendations/content-action.service", () => ({
  createRecommendationContentActionService: vi.fn(() => ({
    record: contentActionMock,
  })),
}))
vi.mock("@/db/client", () => ({ prisma: {} }))

import { schema } from "@/graphql/schema"
import {
  RecommendationBindingError,
  RecommendationConflictError,
  RecommendationInputError,
} from "@/services/recommendations/errors"

const caller = {
  id: null,
  role: "CONSUMER_BEARER",
  fleet: false,
  rateLimitBucketKey: "test-web-consumer-key",
}

function mutation(name: string) {
  return schema.getMutationType()!.getFields()[name]!.resolve!
}

beforeEach(() => {
  vi.clearAllMocks()
  recordMock.mockResolvedValue([{ eventId: "render-1", status: "accepted" }])
  selectMock.mockResolvedValue({
    status: "accepted",
    claimNonce: "fresh-claim",
    canonicalHref: "/watch/target.html",
    targetMediaId: "target",
  })
  claimMock.mockResolvedValue({
    episodeId: "episode-1",
    capability: "episode-token",
    activeUntil: "2026-08-19T07:00:00.000Z",
    hardUntil: "2026-08-19T09:00:00.000Z",
  })
  playbackMock.mockResolvedValue([
    { eventId: "start-1", status: "accepted", sequence: 1 },
  ])
  contentActionMock.mockResolvedValue({
    actionId: "action-1",
    eventId: "share-1",
    status: "accepted",
    matched: true,
    late: false,
  })
})

describe("semantic recommendation evidence resolvers", () => {
  it("forwards a Watch action with server-owned class and purpose", async () => {
    const args = {
      contractVersion: "recommendation-content-action-v1",
      sessionDigest: "a".repeat(64),
      eventId: "share-1",
      occurredAt: "2026-08-19T03:00:00.000Z",
      mediaId: "media-1",
      actionKind: "share",
      actionDetail: "link_copy",
    }

    await mutation("recordRecommendationContentAction")(
      null,
      args,
      { user: caller },
      {} as never,
    )

    expect(contentActionMock).toHaveBeenCalledWith({
      ...args,
      caller,
      actionClass: "human_action",
      actorClass: "human_anonymous",
      purpose: "watch",
      destination: null,
    })
  })

  it("forwards evidence to the independently authenticated service", async () => {
    const args = {
      contractVersion: "recommendation-evidence-v1",
      capability: "opaque-token",
      requestId: "request-1",
      itemId: "item-1",
      sessionDigest: "a".repeat(64),
      events: [
        {
          eventId: "render-1",
          kind: "render",
          occurredAt: "2026-08-19T03:00:00.000Z",
          payload: { mounted: true },
        },
      ],
    }

    await mutation("recordSemanticRecommendationEvidence")(
      null,
      args,
      { user: caller },
      {} as never,
    )

    expect(recordMock).toHaveBeenCalledWith({ ...args, caller })
  })

  it("rejects scalar, array, and null evidence payloads instead of coercing them", async () => {
    for (const payload of ["scalar", ["array"], null]) {
      await expect(
        mutation("recordSemanticRecommendationEvidence")(
          null,
          {
            contractVersion: "recommendation-evidence-v1",
            capability: "opaque-token",
            requestId: "request-1",
            itemId: "item-1",
            sessionDigest: "a".repeat(64),
            events: [
              {
                eventId: "render-1",
                kind: "render",
                occurredAt: "2026-08-19T03:00:00.000Z",
                payload,
              },
            ],
          },
          { user: caller },
          {} as never,
        ),
      ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } })
    }
    expect(recordMock).not.toHaveBeenCalled()
  })

  it("maps typed service failures to a public-safe GraphQL code", async () => {
    recordMock.mockRejectedValueOnce(
      new RecommendationInputError("Recommendation evidence is invalid"),
    )

    await expect(
      mutation("recordSemanticRecommendationEvidence")(
        null,
        {
          contractVersion: "recommendation-evidence-v1",
          capability: "opaque-token",
          requestId: "request-1",
          itemId: "item-1",
          sessionDigest: "a".repeat(64),
          events: [
            {
              eventId: "render-1",
              kind: "render",
              occurredAt: "2026-08-19T03:00:00.000Z",
              payload: {},
            },
          ],
        },
        { user: caller },
        {} as never,
      ),
    ).rejects.toMatchObject({
      message: "Recommendation evidence is invalid",
      extensions: { code: "BAD_USER_INPUT" },
    })
  })

  it("forwards selection without accepting a client target", async () => {
    const args = {
      contractVersion: "recommendation-evidence-v1",
      capability: "opaque-token",
      requestId: "request-1",
      itemId: "item-1",
      sessionDigest: "a".repeat(64),
      eventId: "selection-1",
      occurredAt: "2026-08-19T03:00:00.000Z",
      tabDigest: "b".repeat(64),
    }

    await mutation("selectSemanticRecommendation")(
      null,
      args,
      { user: caller },
      {} as never,
    )

    expect(selectMock).toHaveBeenCalledWith({ ...args, caller })
    expect(JSON.stringify(selectMock.mock.calls[0])).not.toContain(
      "canonicalHref",
    )
  })

  it("claims the pending handoff using only server-bound identity", async () => {
    const args = {
      sessionDigest: "a".repeat(64),
      claimNonce: "fresh-claim-nonce",
      mediaId: "target",
    }

    await mutation("claimSemanticRecommendationEpisode")(
      null,
      args,
      { user: caller },
      {} as never,
    )

    expect(claimMock).toHaveBeenCalledWith({ ...args, caller })
  })

  it("records playback from episode-derived request and item bindings", async () => {
    const args = {
      contractVersion: "recommendation-evidence-v1",
      capability: "episode-capability",
      episodeId: "episode-1",
      sessionDigest: "a".repeat(64),
      mediaId: "target",
      events: [
        {
          eventId: "start-1",
          kind: "playback_start",
          occurredAt: "2026-08-19T03:00:00.000Z",
          payload: { positionSeconds: 0 },
        },
      ],
    }

    await mutation("recordSemanticRecommendationPlayback")(
      null,
      args,
      { user: caller },
      {} as never,
    )

    expect(playbackMock).toHaveBeenCalledWith({ ...args, caller })
    expect(JSON.stringify(playbackMock.mock.calls[0])).not.toMatch(
      /requestId|itemId/,
    )
  })

  it("maps playback binding and concurrency failures to stable GraphQL codes", async () => {
    const args = {
      contractVersion: "recommendation-evidence-v1",
      capability: "episode-capability",
      episodeId: "episode-1",
      sessionDigest: "a".repeat(64),
      mediaId: "target",
      events: [
        {
          eventId: "start-1",
          kind: "playback_start",
          occurredAt: "2026-08-19T03:00:00.000Z",
          payload: { positionSeconds: 0 },
        },
      ],
    }
    playbackMock.mockRejectedValueOnce(
      new RecommendationBindingError("Recommendation playback expired"),
    )
    await expect(
      mutation("recordSemanticRecommendationPlayback")(
        null,
        args,
        { user: caller },
        {} as never,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    })

    playbackMock.mockRejectedValueOnce(
      new RecommendationConflictError("Recommendation playback conflicted"),
    )
    await expect(
      mutation("recordSemanticRecommendationPlayback")(
        null,
        args,
        { user: caller },
        {} as never,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "CONFLICT" },
    })
  })
})
