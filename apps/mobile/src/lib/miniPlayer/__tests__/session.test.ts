import {
  admitsSession,
  isSameSession,
  normalizeSessionIdentity,
  sessionActionFor,
} from "../session"

const EPISODE = { videoId: "video-1", languageSlug: "english" }

describe("admitsSession", () => {
  it("admits only once playback has started", () => {
    expect(admitsSession(true)).toBe(true)
    expect(admitsSession(false)).toBe(false)
  })
})

describe("normalizeSessionIdentity", () => {
  it("keeps a video-id identity", () => {
    expect(normalizeSessionIdentity(EPISODE)).toEqual({
      videoId: "video-1",
      videoSlug: undefined,
      languageSlug: "english",
    })
  })

  it("keeps a slug-only identity for offline playback", () => {
    // Downloaded playback has no documentId on device; the slug is the only key.
    expect(normalizeSessionIdentity({ videoSlug: "birth-of-jesus" })).toEqual({
      videoId: undefined,
      videoSlug: "birth-of-jesus",
      languageSlug: null,
    })
  })

  it("rejects an empty-string videoId rather than passing it through", () => {
    // The record builder falls back to `documentId: raw.documentId ?? ""`, and
    // the store only checks presence — so an empty id would render as a valid
    // session while defeating every identity compare.
    expect(normalizeSessionIdentity({ videoId: "" })).toBeNull()
    expect(normalizeSessionIdentity({ videoId: "   " })).toBeNull()
  })

  it("falls back to the slug when the videoId is empty", () => {
    expect(
      normalizeSessionIdentity({ videoId: "", videoSlug: "birth-of-jesus" }),
    ).toMatchObject({ videoId: undefined, videoSlug: "birth-of-jesus" })
  })

  it("rejects an identity with no key at all", () => {
    expect(normalizeSessionIdentity(null)).toBeNull()
    expect(normalizeSessionIdentity(undefined)).toBeNull()
    expect(normalizeSessionIdentity({})).toBeNull()
    expect(normalizeSessionIdentity({ languageSlug: "english" })).toBeNull()
  })

  it("normalizes a missing language to null so compares are stable", () => {
    expect(normalizeSessionIdentity({ videoId: "v" })?.languageSlug).toBeNull()
  })
})

describe("isSameSession", () => {
  it("matches the same video and language", () => {
    expect(isSameSession(EPISODE, { ...EPISODE })).toBe(true)
  })

  it("treats a different video as a different session", () => {
    expect(isSameSession(EPISODE, { ...EPISODE, videoId: "video-2" })).toBe(
      false,
    )
  })

  it("treats an audio-language switch as a different session", () => {
    // languageSlug keys the progress recorder: sharing one session across a
    // switch stamps the departing position with a language never watched.
    expect(
      isSameSession(EPISODE, { ...EPISODE, languageSlug: "spanish" }),
    ).toBe(false)
  })

  it("treats undefined and null language as the same", () => {
    expect(
      isSameSession({ videoId: "v" }, { videoId: "v", languageSlug: null }),
    ).toBe(true)
  })

  it("never matches a null side", () => {
    expect(isSameSession(null, EPISODE)).toBe(false)
    expect(isSameSession(EPISODE, null)).toBe(false)
    expect(isSameSession(null, null)).toBe(false)
  })
})

describe("sessionActionFor", () => {
  it("starts when there is no live session", () => {
    expect(sessionActionFor(null, EPISODE)).toBe("start")
  })

  it("updates in place when only the source changed", () => {
    // THE hazard this module exists for. The downloads manifest hydrates after
    // cold launch, so one session's URL legitimately jumps from the network
    // stream to file://, and a seed URL later resolves to the canonical one.
    // Re-starting on either jump emits a bogus "replaced" telemetry record and
    // a swap-triggered progress write. The identity is unchanged, so is the
    // session.
    expect(sessionActionFor(EPISODE, { ...EPISODE })).toBe("update")
  })

  it("starts a new session for a different episode", () => {
    expect(sessionActionFor(EPISODE, { videoId: "video-2" })).toBe("start")
  })

  it("starts a new session on an audio-language switch", () => {
    expect(
      sessionActionFor(EPISODE, { ...EPISODE, languageSlug: "spanish" }),
    ).toBe("start")
  })

  it("does nothing when there is no next identity", () => {
    // setVideo(null) fires mid-navigation while still inside the watch group.
    // Ending the session there would kill a live one; only the named end
    // reasons may do that.
    expect(sessionActionFor(EPISODE, null)).toBe("none")
    expect(sessionActionFor(null, null)).toBe("none")
  })
})
