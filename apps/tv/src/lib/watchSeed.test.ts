import { decodeWatchSeed, encodeWatchSeed, type WatchSeed } from "./watchSeed"

const VALID_PLAYBACK_ID = "x3XKV1Yi01z-dyF_8ZLBM"

describe("encodeWatchSeed / decodeWatchSeed round-trip", () => {
  it("round-trips a fully populated seed", () => {
    const seed: WatchSeed = {
      slug: "birth-of-jesus",
      title: "The Birth of Jesus",
      imageUrl: "https://images.example.com/poster.jpg",
      playbackId: VALID_PLAYBACK_ID,
    }
    const decoded = decodeWatchSeed(encodeWatchSeed(seed))
    expect(decoded).toEqual(seed)
  })

  it("accepts the first element when given an array param", () => {
    const encoded = encodeWatchSeed({
      slug: "abc",
      title: null,
      imageUrl: null,
      playbackId: null,
    })
    expect(decodeWatchSeed([encoded, "ignored"])).toEqual({
      slug: "abc",
      title: null,
      imageUrl: null,
      playbackId: null,
    })
  })
})

describe("decodeWatchSeed — absent / malformed", () => {
  it("returns null for null / undefined / empty", () => {
    expect(decodeWatchSeed(null)).toBeNull()
    expect(decodeWatchSeed(undefined)).toBeNull()
    expect(decodeWatchSeed("")).toBeNull()
    expect(decodeWatchSeed([])).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    expect(decodeWatchSeed("not-json")).toBeNull()
    expect(decodeWatchSeed(encodeURIComponent("{ broken"))).toBeNull()
  })

  it("returns null for a non-object payload", () => {
    expect(
      decodeWatchSeed(encodeURIComponent(JSON.stringify("string"))),
    ).toBeNull()
    expect(decodeWatchSeed(encodeURIComponent(JSON.stringify(42)))).toBeNull()
    expect(decodeWatchSeed(encodeURIComponent(JSON.stringify(null)))).toBeNull()
  })

  it("returns null when slug is missing or not a string", () => {
    expect(
      decodeWatchSeed(encodeURIComponent(JSON.stringify({ title: "x" }))),
    ).toBeNull()
    expect(
      decodeWatchSeed(encodeURIComponent(JSON.stringify({ slug: 123 }))),
    ).toBeNull()
    expect(
      decodeWatchSeed(encodeURIComponent(JSON.stringify({ slug: "" }))),
    ).toBeNull()
  })
})

describe("decodeWatchSeed — field sanitization", () => {
  it("drops a javascript: image URL but keeps a valid slug", () => {
    const decoded = decodeWatchSeed(
      encodeURIComponent(
        JSON.stringify({
          slug: "abc",
          title: "T",
          imageUrl: "javascript:alert(1)",
          playbackId: VALID_PLAYBACK_ID,
        }),
      ),
    )
    expect(decoded).not.toBeNull()
    expect(decoded?.imageUrl).toBeNull()
    expect(decoded?.slug).toBe("abc")
    expect(decoded?.playbackId).toBe(VALID_PLAYBACK_ID)
  })

  it("drops a playbackId that does not produce a valid Mux stream URL", () => {
    const decoded = decodeWatchSeed(
      encodeURIComponent(
        JSON.stringify({
          slug: "abc",
          playbackId: "evil.com/x",
        }),
      ),
    )
    expect(decoded).not.toBeNull()
    expect(decoded?.playbackId).toBeNull()
  })

  it("drops a non-string playbackId / imageUrl", () => {
    const decoded = decodeWatchSeed(
      encodeURIComponent(
        JSON.stringify({ slug: "abc", playbackId: 7, imageUrl: 9 }),
      ),
    )
    expect(decoded?.playbackId).toBeNull()
    expect(decoded?.imageUrl).toBeNull()
  })
})
