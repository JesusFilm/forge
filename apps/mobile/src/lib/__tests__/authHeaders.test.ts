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

// The bearer must ride ONLY on the gated Search operation: it buckets as
// consumer:<key> (one shared bucket for the whole fleet's baked-in key), so
// attaching it to public queries would collapse all traffic into that bucket.
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

  it("adds x-viewer-id on the Search op alongside the bearer", () => {
    expect(authHeadersForOperation("Search", "abc123", "device-1")).toEqual({
      Authorization: "Bearer abc123",
      "x-viewer-id": "device-1",
    })
  })

  it("sends x-viewer-id on Search even with no token (ready for provisioning)", () => {
    expect(authHeadersForOperation("Search", undefined, "device-1")).toEqual({
      "x-viewer-id": "device-1",
    })
  })

  it("never sends x-viewer-id on a public operation", () => {
    expect(
      authHeadersForOperation("GetVideoBySlug", "abc123", "device-1"),
    ).toEqual({})
  })
})
