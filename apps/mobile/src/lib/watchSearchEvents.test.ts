// Mock ./apolloClient before importing the module under test: it short-circuits
// the transitive native-SDK import chain (offlineFileSystem.test.ts pattern) and
// lets the send-path tests script both sync-throw and rejection failures.
jest.mock("./apolloClient", () => ({ getApolloClient: jest.fn() }))

import { getApolloClient } from "./apolloClient"
import { RECORD_WATCH_SEARCH_EVENT } from "./queries"
import {
  buildResultClickedVariables,
  buildResultsViewedVariables,
  recordResultClicked,
  recordResultsViewed,
} from "./watchSearchEvents"

const mockGetApolloClient = getApolloClient as jest.Mock

const VALID_REQUEST_ID = "req_12345678-abc"

const clickInput = {
  requestId: VALID_REQUEST_ID,
  resultId: "video-123",
  resultType: "video",
  position: 3,
  visibleResultIds: ["video-123", "video-456"],
}

const viewedInput = {
  requestId: VALID_REQUEST_ID,
  visibleResultIds: ["video-123", "exp-1"],
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("buildResultClickedVariables", () => {
  it("builds the full RESULT_CLICKED variable shape as client MOBILE", () => {
    expect(buildResultClickedVariables(clickInput)).toEqual({
      requestId: VALID_REQUEST_ID,
      eventType: "RESULT_CLICKED",
      client: "MOBILE",
      resultId: "video-123",
      resultType: "VIDEO",
      position: 3,
      visibleResultIds: ["video-123", "video-456"],
      routeLanguageSlug: null,
      searchLanguageSlug: "english",
    })
  })

  it("never carries an occurredAt key — admin stamps its own clock", () => {
    const variables = buildResultClickedVariables(clickInput)
    expect(variables).not.toHaveProperty("occurredAt")
  })

  it("maps mobile's uppercase EXPERIENCE wire value to EXPERIENCE", () => {
    // The production-reachable shape: SearchResult.type carries admin's
    // uppercase enum (watch.tsx compares result.type === "EXPERIENCE").
    expect(
      buildResultClickedVariables({ ...clickInput, resultType: "EXPERIENCE" }),
    ).toMatchObject({ resultType: "EXPERIENCE" })
  })

  it("maps web's lowercase experience spelling to EXPERIENCE too", () => {
    expect(
      buildResultClickedVariables({ ...clickInput, resultType: "experience" }),
    ).toMatchObject({ resultType: "EXPERIENCE" })
  })

  it("maps unknown result types to VIDEO", () => {
    expect(
      buildResultClickedVariables({ ...clickInput, resultType: "playlist" }),
    ).toMatchObject({ resultType: "VIDEO" })
  })

  it.each([
    ["too short", "short"],
    ["illegal characters", "bad id with spaces!"],
    ["null", null],
    ["undefined", undefined],
    ["over 80 chars", "a".repeat(81)],
  ])("returns null on a malformed request id (%s)", (_label, requestId) => {
    expect(buildResultClickedVariables({ ...clickInput, requestId })).toBeNull()
  })

  it("returns null when the result id fails the token shape", () => {
    // Admin throws "result_clicked events require resultId" on a missing id.
    expect(
      buildResultClickedVariables({ ...clickInput, resultId: "  " }),
    ).toBeNull()
  })

  it("caps 80 visible ids to admin's 50-id limit", () => {
    const ids = Array.from({ length: 80 }, (_, i) => `id-${i}`)
    const variables = buildResultClickedVariables({
      ...clickInput,
      visibleResultIds: ids,
    })
    expect(variables?.visibleResultIds).toHaveLength(50)
    expect(variables?.visibleResultIds).toEqual(ids.slice(0, 50))
  })

  it("drops malformed ids from visibleResultIds instead of failing the event", () => {
    const variables = buildResultClickedVariables({
      ...clickInput,
      visibleResultIds: ["ok-1", "bad id", "", "ok-2"],
    })
    expect(variables?.visibleResultIds).toEqual(["ok-1", "ok-2"])
  })

  it("nulls a non-positive position and floors a fractional one", () => {
    expect(
      buildResultClickedVariables({ ...clickInput, position: 0 }),
    ).toMatchObject({ position: null })
    expect(
      buildResultClickedVariables({ ...clickInput, position: 2.9 }),
    ).toMatchObject({ position: 2 })
  })
})

describe("buildResultsViewedVariables", () => {
  it("builds the full RESULTS_VIEWED variable shape as client MOBILE", () => {
    expect(buildResultsViewedVariables(viewedInput)).toEqual({
      requestId: VALID_REQUEST_ID,
      eventType: "RESULTS_VIEWED",
      client: "MOBILE",
      resultId: null,
      resultType: null,
      position: null,
      visibleResultIds: ["video-123", "exp-1"],
      routeLanguageSlug: null,
      searchLanguageSlug: "english",
    })
  })

  it("never carries an occurredAt key — admin stamps its own clock", () => {
    const variables = buildResultsViewedVariables(viewedInput)
    expect(variables).not.toHaveProperty("occurredAt")
  })

  it("returns null on a malformed request id", () => {
    expect(
      buildResultsViewedVariables({ ...viewedInput, requestId: "short" }),
    ).toBeNull()
  })

  it("returns null on zero viewed ids (empty rows inflate the CTR denominator)", () => {
    expect(
      buildResultsViewedVariables({ ...viewedInput, visibleResultIds: [] }),
    ).toBeNull()
  })

  it("returns null when every viewed id sanitizes away", () => {
    expect(
      buildResultsViewedVariables({
        ...viewedInput,
        visibleResultIds: ["", "  ", "bad id"],
      }),
    ).toBeNull()
  })

  it("caps 80 visible ids to admin's 50-id limit", () => {
    const ids = Array.from({ length: 80 }, (_, i) => `id-${i}`)
    const variables = buildResultsViewedVariables({
      ...viewedInput,
      visibleResultIds: ids,
    })
    expect(variables?.visibleResultIds).toHaveLength(50)
  })
})

describe("senders (fire-and-forget)", () => {
  it("posts RESULT_CLICKED via mutate with no-cache and resolves void", async () => {
    const mutate = jest.fn().mockResolvedValue({ data: {} })
    mockGetApolloClient.mockReturnValue({ mutate })
    await expect(recordResultClicked(clickInput)).resolves.toBeUndefined()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({
      mutation: RECORD_WATCH_SEARCH_EVENT,
      variables: buildResultClickedVariables(clickInput),
      fetchPolicy: "no-cache",
    })
  })

  it("posts RESULTS_VIEWED via mutate with no-cache and resolves void", async () => {
    const mutate = jest.fn().mockResolvedValue({ data: {} })
    mockGetApolloClient.mockReturnValue({ mutate })
    await expect(recordResultsViewed(viewedInput)).resolves.toBeUndefined()
    expect(mutate).toHaveBeenCalledWith({
      mutation: RECORD_WATCH_SEARCH_EVENT,
      variables: buildResultsViewedVariables(viewedInput),
      fetchPolicy: "no-cache",
    })
  })

  it("never touches the client for an unsendable payload", async () => {
    await expect(
      recordResultClicked({ ...clickInput, requestId: "short" }),
    ).resolves.toBeUndefined()
    await expect(
      recordResultsViewed({ ...viewedInput, visibleResultIds: [] }),
    ).resolves.toBeUndefined()
    expect(mockGetApolloClient).not.toHaveBeenCalled()
  })

  it.each([
    ["recordResultClicked", () => recordResultClicked(clickInput)],
    ["recordResultsViewed", () => recordResultsViewed(viewedInput)],
  ])("%s swallows a mutation rejection", async (_name, send) => {
    const mutate = jest.fn().mockRejectedValue(new Error("rate shed"))
    mockGetApolloClient.mockReturnValue({ mutate })
    await expect(send()).resolves.toBeUndefined()
  })

  it.each([
    ["recordResultClicked", () => recordResultClicked(clickInput)],
    ["recordResultsViewed", () => recordResultsViewed(viewedInput)],
  ])(
    "%s swallows a SYNCHRONOUS throw from the client getter",
    async (_name, send) => {
      mockGetApolloClient.mockImplementation(() => {
        throw new Error("missing env at construction")
      })
      await expect(send()).resolves.toBeUndefined()
    },
  )
})
