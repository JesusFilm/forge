import { decodeWatchSeed, encodeWatchSeed, type WatchSeed } from "../watchSeed"

describe("watchSeed", () => {
  const fullSeed: WatchSeed = {
    slug: "one.jesusfilm.ourlovingpursuer",
    title: "Our Loving Pursuer",
    imageUrl: "https://images.example.com/poster.jpg",
    playbackId: "x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw",
  }

  it("round-trips a full search seed through encode -> decode", () => {
    const decoded = decodeWatchSeed(encodeWatchSeed(fullSeed))
    expect(decoded).toEqual(fullSeed)
  })

  it("accepts a metadata-only seed (Up Next, no playbackId)", () => {
    const seed: WatchSeed = {
      slug: "easter-explained",
      title: "Easter Explained",
      imageUrl: "https://images.example.com/easter.jpg",
      playbackId: null,
    }
    const decoded = decodeWatchSeed(encodeWatchSeed(seed))
    expect(decoded).toEqual(seed)
    expect(decoded?.playbackId).toBeNull()
  })

  it("decodes a video seed with a null playbackId (nullable at source)", () => {
    const decoded = decodeWatchSeed(
      encodeWatchSeed({ ...fullSeed, playbackId: null }),
    )
    expect(decoded?.slug).toBe(fullSeed.slug)
    expect(decoded?.playbackId).toBeNull()
  })

  it("drops a playbackId that is not a clean Mux token", () => {
    const decoded = decodeWatchSeed(
      encodeWatchSeed({ ...fullSeed, playbackId: "evil.com/inject" }),
    )
    expect(decoded?.slug).toBe(fullSeed.slug)
    expect(decoded?.playbackId).toBeNull()
  })

  it("drops an image URL with a dangerous scheme", () => {
    const decoded = decodeWatchSeed(
      encodeWatchSeed({
        ...fullSeed,

        imageUrl: "javascript:alert(1)",
      }),
    )
    expect(decoded?.slug).toBe(fullSeed.slug)
    expect(decoded?.imageUrl).toBeNull()
  })

  it("returns null for a malformed (non-JSON) param", () => {
    expect(decodeWatchSeed("not%20json%20at%20all")).toBeNull()
  })

  it("returns null for broken percent-encoding", () => {
    expect(decodeWatchSeed("%ZZ")).toBeNull()
  })

  it("returns null when slug is missing", () => {
    const raw = encodeURIComponent(JSON.stringify({ title: "No slug" }))
    expect(decodeWatchSeed(raw)).toBeNull()
  })

  it("returns null for null / undefined / empty input", () => {
    expect(decodeWatchSeed(null)).toBeNull()
    expect(decodeWatchSeed(undefined)).toBeNull()
    expect(decodeWatchSeed("")).toBeNull()
  })

  it("uses the first value when the router passes an array", () => {
    const encoded = encodeWatchSeed(fullSeed)
    expect(decodeWatchSeed([encoded, "ignored"])).toEqual(fullSeed)
  })

  it("preserves a slug containing slashes through the round-trip", () => {
    const seed: WatchSeed = {
      slug: "series/episode-1",
      title: "Episode 1",
      imageUrl: null,
      playbackId: null,
    }
    expect(decodeWatchSeed(encodeWatchSeed(seed))).toEqual(seed)
  })
})
