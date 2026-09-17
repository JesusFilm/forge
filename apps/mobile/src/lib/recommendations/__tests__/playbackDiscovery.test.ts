import {
  DISCOVERY_MARK_TTL_MS,
  DISCOVERY_ROUTE_PARAM,
  DIRECT_DISCOVERY,
  createPlaybackDiscoveryStore,
  discoveryFor,
  discoverySourceFromParam,
} from "../playbackDiscovery"

describe("discoverySourceFromParam", () => {
  it("accepts only the search hand-off a series page can carry", () => {
    expect(DISCOVERY_ROUTE_PARAM).toBe("from")
    expect(discoverySourceFromParam("search")).toBe("search")
    for (const value of [
      undefined,
      "",
      "share",
      "direct",
      "SEARCH",
      ["search"],
      "search ",
    ]) {
      expect(discoverySourceFromParam(value)).toBeNull()
    }
  })
})

describe("discoveryFor", () => {
  it("pins Web's provenance literals per source", () => {
    expect(discoveryFor("direct")).toEqual({ source: "direct", provenance: {} })
    expect(discoveryFor("search")).toEqual({
      source: "search",
      provenance: { handoff: "search_result" },
    })
    expect(discoveryFor("share")).toEqual({
      source: "share",
      provenance: { handoff: "shared_link" },
    })
    expect(discoveryFor("editorial")).toEqual({
      source: "editorial",
      provenance: { handoff: "curated_link" },
    })
    expect(discoveryFor("acquisition")).toEqual({
      source: "acquisition",
      provenance: { handoff: "campaign_link" },
    })
  })
})

describe("createPlaybackDiscoveryStore", () => {
  it("answers direct when nothing was marked", () => {
    const store = createPlaybackDiscoveryStore(() => 1_000)
    expect(store.take(["jesus", "media-1"])).toBe(DIRECT_DISCOVERY)
  })

  it("matches any offered key and consumes the mark", () => {
    const store = createPlaybackDiscoveryStore(() => 1_000)
    store.mark("jesus", "search")
    expect(store.take(["media-1", null, "jesus"])).toEqual({
      source: "search",
      provenance: { handoff: "search_result" },
    })
    expect(store.take(["jesus"])).toBe(DIRECT_DISCOVERY)
  })

  it("leaves a mark for another video untouched and answers direct", () => {
    const store = createPlaybackDiscoveryStore(() => 1_000)
    store.mark("jesus", "share")
    expect(store.take(["magdalena"])).toBe(DIRECT_DISCOVERY)
    expect(store.take(["jesus"]).source).toBe("share")
  })

  it("expires a stale mark", () => {
    let now = 1_000
    const store = createPlaybackDiscoveryStore(() => now)
    store.mark("jesus", "search")
    now += DISCOVERY_MARK_TTL_MS
    expect(store.take(["jesus"])).toBe(DIRECT_DISCOVERY)
  })

  it("ignores an empty key", () => {
    const store = createPlaybackDiscoveryStore(() => 1_000)
    store.mark("", "search")
    expect(store.take([""])).toBe(DIRECT_DISCOVERY)
  })
})
