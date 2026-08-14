import {
  admitsSession,
  isSameSession,
  normalizeSessionIdentity,
  sessionActionFor,
  sessionIdentityKey,
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

  it("treats an audio-language switch as the SAME session", () => {
    // INVERTED on purpose, and the inversion IS the fix — this asserted `false`.
    // languageSlug keys the progress RECORDER, which the adapter re-keys itself;
    // a new session here would recreate the player, the audible gap R1 forbids.
    expect(
      isSameSession(EPISODE, { ...EPISODE, languageSlug: "spanish" }),
    ).toBe(true)
  })

  it("still separates two videos that differ only by slug", () => {
    // Dropping language must not collapse the key onto videoId alone: offline
    // playback has no documentId, so the slug is the only thing telling two
    // downloaded episodes apart.
    expect(
      isSameSession(
        { videoSlug: "birth-of-jesus" },
        { videoSlug: "the-last-supper" },
      ),
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

describe("sessionIdentityKey", () => {
  it("is the single definition isSameSession compares", () => {
    // The host keys its player subtree on this. If the two ever disagreed, a
    // change one of them called "the same session" would tear down the player.
    const spanish = { ...EPISODE, languageSlug: "spanish" }
    expect(sessionIdentityKey(EPISODE)).toBe(sessionIdentityKey(spanish))
    expect(isSameSession(EPISODE, spanish)).toBe(true)
  })

  it("separates a different video", () => {
    expect(sessionIdentityKey(EPISODE)).not.toBe(
      sessionIdentityKey({ ...EPISODE, videoId: "video-2" }),
    )
  })

  it("does not collide an id-only identity with a slug-only one", () => {
    // A single-field key ("x") would make videoId "x" and videoSlug "x" equal.
    expect(sessionIdentityKey({ videoId: "x" })).not.toBe(
      sessionIdentityKey({ videoSlug: "x" }),
    )
  })
})

describe("sessionActionFor", () => {
  it("starts when there is no live session", () => {
    expect(sessionActionFor(null, EPISODE)).toBe("start")
  })

  it("updates in place when only the source changed", () => {
    // THE hazard this module exists for: one session's URL legitimately jumps to
    // file:// once the downloads manifest hydrates, and a seed URL resolves to
    // the canonical one. Re-starting emits a bogus "replaced" and a swap write.
    expect(sessionActionFor(EPISODE, { ...EPISODE })).toBe("update")
  })

  it("starts a new session for a different episode", () => {
    expect(sessionActionFor(EPISODE, { videoId: "video-2" })).toBe("start")
  })

  it("updates in place on an audio-language switch, never starts", () => {
    // "start" is what tears the player down. The adapter swaps the audio track
    // on the live player and re-keys only its recorder, so the publisher must
    // hand the same session forward.
    expect(
      sessionActionFor(EPISODE, { ...EPISODE, languageSlug: "spanish" }),
    ).toBe("update")
  })

  it("does nothing when there is no next identity", () => {
    // setVideo(null) fires mid-navigation while still inside the watch group.
    // Ending the session there would kill a live one; only the named end
    // reasons may do that.
    expect(sessionActionFor(EPISODE, null)).toBe("none")
    expect(sessionActionFor(null, null)).toBe("none")
  })
})
