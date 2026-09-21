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

  it("carries per-mark provenance beside the source's own literals (KTD8)", () => {
    // A campaign hand-off adds the delivery nonce to the acquisition source, so
    // admin can join the playback context back to the campaign.
    const store = createPlaybackDiscoveryStore(() => 1_000)

    store.mark("jesus", "acquisition", { campaign: "nonce-abc" })

    expect(store.take(["jesus"])).toEqual({
      source: "acquisition",
      provenance: { handoff: "campaign_link", campaign: "nonce-abc" },
    })
  })

  it("keeps the source's own literals when a mark adds nothing", () => {
    const store = createPlaybackDiscoveryStore(() => 1_000)

    store.mark("jesus", "acquisition", {})

    expect(store.take(["jesus"])).toEqual({
      source: "acquisition",
      provenance: { handoff: "campaign_link" },
    })
  })

  it("admits only the key shape admin's provenance schema accepts", () => {
    // Admin validates every key against /^[a-z][a-z0-9_]{0,31}$/ and answers
    // BAD_USER_INPUT otherwise, which loses the whole playback context.
    const store = createPlaybackDiscoveryStore(() => 1_000)

    store.mark("jesus", "acquisition", {
      Campaign: "rejected",
      "9lives": "rejected",
      "": "rejected",
      campaign_id: "kept",
    })

    expect(store.take(["jesus"]).provenance).toEqual({
      handoff: "campaign_link",
      campaign_id: "kept",
    })
  })

  it("drops a provenance value longer than admin's column", () => {
    const store = createPlaybackDiscoveryStore(() => 1_000)

    store.mark("jesus", "acquisition", { campaign: "a".repeat(192) })

    expect(store.take(["jesus"]).provenance).toEqual({
      handoff: "campaign_link",
    })
  })

  it("never lets a mark overwrite the source's own handoff literal", () => {
    const store = createPlaybackDiscoveryStore(() => 1_000)

    store.mark("jesus", "acquisition", { handoff: "spoofed" })

    expect(store.take(["jesus"]).provenance).toEqual({
      handoff: "campaign_link",
    })
  })
})
