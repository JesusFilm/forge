import { parse } from "graphql"

const mockStorage = new Map<string, string>()
let mockEventId = 0
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mockStorage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockStorage.set(key, value)
  },
  deleteItemAsync: async (key: string) => {
    mockStorage.delete(key)
  },
}))
jest.mock("expo-crypto", () => ({
  randomUUID: () => `test-event-0123456789-${++mockEventId}`,
  getRandomBytes: () => new Uint8Array(32),
}))
jest.mock("../config", () => ({
  getApiToken: () => "tv-own-fleet",
  getGraphQLUrl: () => "https://admin.example.test/api/graphql",
}))
jest.mock("@forge/admin-graphql/operations", () => {
  const { parse } = jest.requireActual<typeof import("graphql")>("graphql")
  return Object.fromEntries(
    [
      [
        "adminCreateRecommendationViewerOperation",
        "CreateRecommendationViewer",
      ],
      [
        "adminUpdateRecommendationViewerOperation",
        "UpdateRecommendationViewer",
      ],
      ["adminUserRecommendationsOperation", "UserRecommendations"],
      [
        "adminSelectSemanticRecommendationOperation",
        "SelectSemanticRecommendation",
      ],
      [
        "adminClaimSemanticRecommendationEpisodeOperation",
        "ClaimSemanticRecommendationEpisode",
      ],
      ["adminIssueWatchPlaybackContextOperation", "IssueWatchPlaybackContext"],
      [
        "adminRecordSemanticRecommendationEvidenceOperation",
        "RecordSemanticRecommendationEvidence",
      ],
      [
        "adminRecordSemanticRecommendationPlaybackOperation",
        "RecordSemanticRecommendationPlayback",
      ],
    ].map(([key, name]) => [key, parse(`mutation ${name} { __typename }`)]),
  )
})

const viewer = {
  viewerToken: "v".repeat(43),
  sessionToken: "s".repeat(43),
  expiresAt: "2027-01-01T00:00:00.000Z",
  personalization: true,
}
type RequestBody = {
  operationName: string
  variables: Record<string, unknown>
  query: string
}
let requests: RequestBody[]
let handler: (request: RequestBody) => Record<string, unknown>

beforeEach(() => {
  jest.resetModules()
  mockStorage.clear()
  requests = []
  mockEventId = 0
  handler = ({ operationName, variables }) => {
    if (operationName === "CreateRecommendationViewer")
      return { data: { createRecommendationViewer: viewer } }
    if (operationName === "UpdateRecommendationViewer")
      return {
        data: {
          updateRecommendationViewer: {
            state: "active",
            personalization: variables.action !== "withdraw",
          },
        },
      }
    if (operationName === "UserRecommendations")
      return {
        data: {
          userRecommendations: {
            result: "unavailable",
            reason: "coverage_unavailable",
            items: [],
          },
        },
      }
    return { data: {} }
  }
  globalThis.fetch = jest.fn(
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RequestBody
      requests.push(request)
      expect(init?.method).toBe("POST")
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer tv-own-fleet",
      })
      expect(parse(request.query)).toBeTruthy()
      return {
        ok: true,
        status: 200,
        json: async () => handler(request),
      } as Response
    },
  )
})

it("requests exactly six cards in English UI metadata and the chosen audio, without account authority", async () => {
  const client = jest.requireActual<typeof import("./client")>("./client")
  await client.fetchForYou("thai")
  const request = requests.find(
    (r) => r.operationName === "UserRecommendations",
  )
  expect(request?.variables).toEqual({
    viewerToken: viewer.viewerToken,
    sessionToken: viewer.sessionToken,
    locale: "en",
    audioLanguageSlug: "thai",
    count: 6,
  })
  expect(request?.variables).not.toHaveProperty("sessionDigest")
  expect(mockStorage.get("tv.recommendations.identity.v1")).toContain(
    viewer.viewerToken,
  )
})
it("preserves an unavailable language result, without requesting a fallback dub", async () => {
  const client = jest.requireActual<typeof import("./client")>("./client")
  expect(await client.fetchForYou("not-supported")).toMatchObject({
    result: "unavailable",
    reason: "coverage_unavailable",
  })
  expect(
    requests.filter((r) => r.operationName === "UserRecommendations"),
  ).toHaveLength(1)
})
it("withdraws before exposing a renewed installation with an off preference", async () => {
  mockStorage.set("tv.recommendations.choice.v1", "false")
  const client = jest.requireActual<typeof import("./client")>("./client")
  await client.fetchForYou("english")
  expect(requests.map((r) => r.operationName)).toEqual([
    "CreateRecommendationViewer",
    "UpdateRecommendationViewer",
    "UserRecommendations",
  ])
  expect(requests[1].variables.action).toBe("withdraw")
})
it("resets while preserving an off preference and never touches My List or Continue Watching", async () => {
  mockStorage.set("tv.recommendations.choice.v1", "false")
  mockStorage.set("tv.myList", "keep")
  mockStorage.set("tv.continueWatching", "keep")
  const client = jest.requireActual<typeof import("./client")>("./client")
  await client.fetchForYou("english")
  requests.length = 0
  expect(await client.changePersonalization("reset")).toBe(false)
  expect(requests.map((r) => r.variables.action)).toEqual(["reset", "withdraw"])
  expect(mockStorage.get("tv.recommendations.choice.v1")).toBe("false")
  expect(mockStorage.get("tv.myList")).toBe("keep")
  expect(mockStorage.get("tv.continueWatching")).toBe("keep")
})
it("uses context then claim for search playback, never a raw account or profile digest", async () => {
  const prior = handler
  handler = (request) => {
    if (request.operationName === "IssueWatchPlaybackContext")
      return {
        data: {
          issueWatchPlaybackContext: {
            claimNonce: "native-nonce-0123456789",
            contextVersion: "playback-context-v1",
          },
        },
      }
    if (request.operationName === "ClaimSemanticRecommendationEpisode")
      return {
        data: {
          claimSemanticRecommendationEpisode: {
            episodeId: "episode",
            capability: "memory-only",
            activeUntil: "2026-10-03T00:00:00Z",
            hardUntil: "2026-10-03T00:00:00Z",
          },
        },
      }
    return prior(request)
  }
  const client = jest.requireActual<typeof import("./client")>("./client")
  const episode = await client.claimPlayback("video-1", "search")
  expect(episode.mediaId).toBe("video-1")
  const issuance = requests.find(
    (r) => r.operationName === "IssueWatchPlaybackContext",
  )
  expect(issuance?.variables).toMatchObject({
    mediaId: "video-1",
    discoverySource: "search",
    provenance: { client: "tv" },
  })
  expect(issuance?.variables).not.toHaveProperty("profileTokenDigest")
  expect(requests.at(-1)?.operationName).toBe(
    "ClaimSemanticRecommendationEpisode",
  )
})
it("retains a failed withdrawal as pending and blocks delivery until it succeeds", async () => {
  const client = jest.requireActual<typeof import("./client")>("./client")
  await client.fetchForYou("english")
  const prior = handler
  handler = (request) =>
    request.variables.action === "withdraw"
      ? { errors: [{ extensions: { code: "SERVICE_UNAVAILABLE" } }] }
      : prior(request)
  await expect(client.changePersonalization("withdraw")).rejects.toThrow(
    "unavailable",
  )
  expect(await client.readPersonalizationChoice()).toBe(false)
  requests.length = 0
  await expect(client.fetchForYou("english")).rejects.toThrow("unavailable")
  expect(requests.some((r) => r.operationName === "UserRecommendations")).toBe(
    false,
  )
  handler = prior
  await client.fetchForYou("english")
  expect(mockStorage.has("tv.recommendations.withdraw-pending.v1")).toBe(false)
})
it("grants and withdraws explicitly, preserving the installation handle", async () => {
  const client = jest.requireActual<typeof import("./client")>("./client")
  await client.fetchForYou("english")
  expect(await client.changePersonalization("withdraw")).toBe(false)
  expect(await client.changePersonalization("grant")).toBe(true)
  expect(await client.readPersonalizationChoice()).toBe(true)
  expect(
    requests.filter((r) => r.operationName === "CreateRecommendationViewer"),
  ).toHaveLength(1)
})
it("recovers a missing server handle once, while retaining the off choice", async () => {
  mockStorage.set("tv.recommendations.choice.v1", "false")
  mockStorage.set(
    "tv.recommendations.identity.v1",
    JSON.stringify({
      ...viewer,
      viewerToken: "o".repeat(43),
      lastActivity: Date.now(),
    }),
  )
  const prior = handler
  handler = (request) =>
    request.operationName === "UserRecommendations" &&
    request.variables.viewerToken === "o".repeat(43)
      ? { errors: [{ extensions: { code: "UNAUTHENTICATED" } }] }
      : prior(request)
  const client = jest.requireActual<typeof import("./client")>("./client")
  await client.fetchForYou("english")
  expect(
    requests.filter((r) => r.operationName === "CreateRecommendationViewer"),
  ).toHaveLength(1)
  expect(requests.some((r) => r.variables.action === "withdraw")).toBe(true)
  expect(
    requests.filter((r) => r.operationName === "UserRecommendations"),
  ).toHaveLength(2)
})
it("times out acknowledgement-body consumption, not just response headers", async () => {
  jest.useFakeTimers()
  try {
    const client = jest.requireActual<typeof import("./client")>("./client")
    await client.recommendationIdentity.get()
    let signal: AbortSignal | null | undefined
    globalThis.fetch = jest.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal
        return {
          ok: true,
          status: 200,
          json: () => new Promise(() => {}),
        } as Response
      },
    )
    const pending = client.fetchForYou("english")
    const rejection = expect(pending).rejects.toMatchObject({
      code: "transport",
      retryable: true,
    })
    for (let i = 0; i < 20; i++) await Promise.resolve()
    jest.advanceTimersByTime(2200)
    await rejection
    expect(signal?.aborted).toBe(true)
  } finally {
    jest.useRealTimers()
  }
})
function attribution(
  client: typeof import("./client"),
): import("./client").Attribution {
  const item = {
    id: "item",
    position: 0,
    targetMediaId: "video-1",
    canonicalHref: "/watch/jesus.html/english.html",
    capability: "item-memory-capability",
    videoSlug: "jesus",
    videoTitle: "JESUS",
    imageUrl: null,
    description: "JESUS feature film",
    durationSeconds: 120,
    generator: "curated",
    poolVersion: "starter",
    poolKey: "start",
  }
  const delivery = {
    contractVersion: "user-recommendation-v1",
    surfaceVersion: "watch-for-you-v1",
    requestId: "request",
    result: "served",
    reason: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    requestedCount: 6,
    profileCount: 0,
    curatedCount: 6,
    cohort: "cold_start",
    poolVersion: "starter",
    items: [item],
  }
  return {
    item,
    delivery,
    audioLanguageSlug: "english",
    privacyGeneration: client.getRecommendationGeneration(),
  }
}
it("retains selection only in memory and creates a fresh episode for replay", async () => {
  const prior = handler
  handler = (request) => {
    if (request.operationName === "SelectSemanticRecommendation")
      return {
        data: {
          selectSemanticRecommendation: {
            status: "accepted",
            claimNonce: request.variables.claimNonce,
            canonicalHref: "/watch/jesus.html/english.html",
            targetMediaId: "video-1",
          },
        },
      }
    if (request.operationName === "ClaimSemanticRecommendationEpisode")
      return {
        data: {
          claimSemanticRecommendationEpisode: {
            episodeId: request.variables.claimNonce,
            capability: "episode-memory-capability",
            activeUntil: "2027-01-01T00:00:00Z",
            hardUntil: "2027-01-01T00:00:00Z",
          },
        },
      }
    return prior(request)
  }
  const client = jest.requireActual<typeof import("./client")>("./client")
  expect(await client.selectRecommendation(attribution(client))).toBe("jesus")
  const selected = client.takeRecommendationSelection("jesus")
  expect(selected).toBeDefined()
  expect(client.takeRecommendationSelection("jesus")).toBeUndefined()
  const first = await client.claimPlayback("video-1", "direct", selected)
  const second = await client.claimPlayback("video-1", "direct", selected)
  expect(first.episodeId).not.toBe(second.episodeId)
  expect(
    requests.filter((r) => r.operationName === "IssueWatchPlaybackContext"),
  ).toHaveLength(0)
  expect(
    requests.filter((r) => r.operationName === "SelectSemanticRecommendation"),
  ).toHaveLength(2)
  expect([...mockStorage.values()].join()).not.toContain("capability")
})
it("batches the qualified render and impression with distinct immutable IDs", async () => {
  const prior = handler
  handler = (request) =>
    request.operationName === "RecordSemanticRecommendationEvidence"
      ? {
          data: {
            recordSemanticRecommendationEvidence: (
              request.variables.events as { eventId: string }[]
            ).map((event) => ({ eventId: event.eventId, status: "accepted" })),
          },
        }
      : prior(request)
  const client = jest.requireActual<typeof import("./client")>("./client")
  await client.sendCardEvidence(attribution(client))
  const events = requests.find(
    (r) => r.operationName === "RecordSemanticRecommendationEvidence",
  )?.variables.events as { eventId: string; kind: string; payload: unknown }[]
  expect(events.map((event) => event.kind)).toEqual(["render", "impression"])
  expect(new Set(events.map((event) => event.eventId)).size).toBe(2)
  expect(events[0].payload).toEqual({ surfacePolicy: "watch-for-you-v1" })
  expect(events[1].payload).toEqual({ visibilityPolicy: "watch-for-you-v1" })
})
it("rejects stale attribution after reset before any selection request", async () => {
  const client = jest.requireActual<typeof import("./client")>("./client")
  const old = attribution(client)
  client.clearRecommendationContext()
  await expect(client.selectRecommendation(old)).rejects.toThrow("unavailable")
  expect(requests).toHaveLength(0)
})
