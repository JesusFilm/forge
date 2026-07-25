import {
  authHeadersForOperation,
  buildAuthHeaders,
  SEARCH_OPERATION_NAME,
} from "./authHeaders"

describe("buildAuthHeaders", () => {
  it("returns the anonymous shape with no token", () => {
    expect(buildAuthHeaders(undefined)).toEqual({})
  })

  it("returns a Bearer header with a token", () => {
    expect(buildAuthHeaders("k")).toEqual({ Authorization: "Bearer k" })
  })
})

describe("authHeadersForOperation (fleet-protection contract)", () => {
  it("attaches the bearer to the WatchSearch operation", () => {
    expect(authHeadersForOperation(SEARCH_OPERATION_NAME, "k")).toEqual({
      Authorization: "Bearer k",
    })
  })

  // The contract that protects the fleet's shared rate-limit bucket: a token must
  // never ride on a public operation, or the whole fleet funnels into one
  // consumer:<key> 60/min bucket on admin.
  it("sends NO header on public operations even when a token is set", () => {
    expect(authHeadersForOperation("GetWatchHomeVideos", "k")).toEqual({})
    // The home Experience query (R13/AE12) is public — a bearer here would pool
    // the whole fleet into admin's shared consumer:<key> rate-limit bucket.
    expect(authHeadersForOperation("GetWatchSetting", "k")).toEqual({})
    expect(authHeadersForOperation("GetSeriesBySlug", "k")).toEqual({})
    expect(authHeadersForOperation("GetVideoBySlug", "k")).toEqual({})
    expect(authHeadersForOperation(undefined, "k")).toEqual({})
  })

  it("sends no header on search when no token is provisioned (embargo default)", () => {
    expect(authHeadersForOperation(SEARCH_OPERATION_NAME, undefined)).toEqual(
      {},
    )
  })

  it("scopes to the current operation name, not the retired ones", () => {
    expect(SEARCH_OPERATION_NAME).toBe("WatchSearch")
    // The #1622 rename trap: the bearer kept riding "SemanticSearch" after the
    // query became WatchSearch, so it attached to nothing and every device fell
    // back to admin's coarse per-IP bucket.
    expect(authHeadersForOperation("SemanticSearch", "k")).toEqual({})
    expect(authHeadersForOperation("Search", "k")).toEqual({})
  })

  it("adds x-viewer-id on the search op alongside the bearer", () => {
    expect(
      authHeadersForOperation(SEARCH_OPERATION_NAME, "k", "device-1"),
    ).toEqual({ Authorization: "Bearer k", "x-viewer-id": "device-1" })
  })

  it("sends x-viewer-id on search even with no token (ready for provisioning)", () => {
    expect(
      authHeadersForOperation(SEARCH_OPERATION_NAME, undefined, "device-1"),
    ).toEqual({ "x-viewer-id": "device-1" })
  })

  it("never sends x-viewer-id on a public operation", () => {
    expect(
      authHeadersForOperation("GetWatchHomeVideos", "k", "device-1"),
    ).toEqual({})
  })
})
