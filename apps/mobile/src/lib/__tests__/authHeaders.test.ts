import { authHeadersForOperation, buildAuthHeaders } from "../authHeaders"

// Admin's Query.search rejects anonymous callers once SEARCH_AUTH_REQUIRED is
// active (UNAUTHENTICATED), so the Apollo client must attach the consumer
// bearer whenever a token is configured — and stay anonymous when it isn't.
describe("buildAuthHeaders", () => {
  it("returns an Authorization bearer header when a token is set", () => {
    expect(buildAuthHeaders("abc123")).toEqual({
      Authorization: "Bearer abc123",
    })
  })

  it("returns no headers when the token is undefined", () => {
    expect(buildAuthHeaders(undefined)).toEqual({})
  })

  it("returns no headers when the token is empty", () => {
    expect(buildAuthHeaders("")).toEqual({})
  })
})

// The bearer must ride ONLY on the gated Search operation. A bearer'd request
// rate-limit-buckets as consumer:<key> on admin — one shared bucket for every
// install carrying the same baked-in key — while anonymous requests bucket
// per device IP. Attaching the header to public queries would collapse the
// whole fleet's Home/watch/experience traffic into that single bucket.
describe("authHeadersForOperation", () => {
  it("attaches the bearer for the Search operation", () => {
    expect(authHeadersForOperation("Search", "abc123")).toEqual({
      Authorization: "Bearer abc123",
    })
  })

  it("stays anonymous for public operations even with a token", () => {
    expect(authHeadersForOperation("GetVideoBySlug", "abc123")).toEqual({})
    expect(authHeadersForOperation("GetWatchSetting", "abc123")).toEqual({})
    expect(authHeadersForOperation(undefined, "abc123")).toEqual({})
  })

  it("stays anonymous for Search when no token is configured", () => {
    expect(authHeadersForOperation("Search", undefined)).toEqual({})
    expect(authHeadersForOperation("Search", "")).toEqual({})
  })
})
