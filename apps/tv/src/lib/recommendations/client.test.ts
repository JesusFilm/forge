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
