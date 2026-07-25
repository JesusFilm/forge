import { print } from "graphql"
import type { DocumentNode, OperationDefinitionNode } from "graphql"

import {
  SEARCH_OPERATION_NAME,
  authHeadersForOperation,
  buildAuthHeaders,
} from "../authHeaders"
import { WATCH_SEARCH } from "../queries"

// The consumer bearer must be attached whenever a token is configured, and the
// anonymous shape returned when it isn't, so the app still boots unprovisioned.
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

// The bearer must ride ONLY on the search operation. Every install ships the
// same baked-in key, so on other public ops it would collapse the whole fleet
// into one rate-limit bucket.
describe("authHeadersForOperation", () => {
  it("attaches the bearer for the WatchSearch operation", () => {
    expect(authHeadersForOperation("WatchSearch", "abc123")).toEqual({
      Authorization: "Bearer abc123",
    })
  })

  it("stays anonymous for public operations even with a token", () => {
    expect(authHeadersForOperation("GetVideoBySlug", "abc123")).toEqual({})
    expect(authHeadersForOperation("GetWatchSetting", "abc123")).toEqual({})
    expect(authHeadersForOperation(undefined, "abc123")).toEqual({})
  })

  it("stays anonymous for WatchSearch when no token is configured", () => {
    expect(authHeadersForOperation("WatchSearch", undefined)).toEqual({})
    expect(authHeadersForOperation("WatchSearch", "")).toEqual({})
  })

  it("adds x-viewer-id on the WatchSearch op alongside the bearer", () => {
    expect(
      authHeadersForOperation("WatchSearch", "abc123", "device-1"),
    ).toEqual({
      Authorization: "Bearer abc123",
      "x-viewer-id": "device-1",
    })
  })

  it("sends x-viewer-id on WatchSearch even with no token (ready for provisioning)", () => {
    expect(
      authHeadersForOperation("WatchSearch", undefined, "device-1"),
    ).toEqual({
      "x-viewer-id": "device-1",
    })
  })

  it("never sends x-viewer-id on a public operation", () => {
    expect(
      authHeadersForOperation("GetVideoBySlug", "abc123", "device-1"),
    ).toEqual({})
  })
})

// Regression guard for the #1622 class of bug: the bearer gate matches on the
// operation NAME, so renaming the search query without updating
// SEARCH_OPERATION_NAME silently drops mobile into the shared public:<ip>
// rate-limit bucket. Pin the two together.
describe("SEARCH_OPERATION_NAME ↔ WATCH_SEARCH", () => {
  it("matches the name of the operation actually sent", () => {
    const doc = WATCH_SEARCH as unknown as DocumentNode
    const operation = doc.definitions.find(
      (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
    )
    expect(operation?.name?.value).toBe(SEARCH_OPERATION_NAME)
  })

  it("queries watchSearch, never the retired Query.search", () => {
    const sdl = print(WATCH_SEARCH as unknown as DocumentNode)
    expect(sdl).toContain("watchSearch(input: $input)")
    expect(sdl).not.toMatch(/\bsearch\(q:/)
  })
})
