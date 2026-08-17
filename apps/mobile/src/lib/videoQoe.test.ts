import {
  createVideoQoeSession,
  sanitizeVideoErrorMessage,
  shouldCountRebuffer,
} from "./videoQoe"

// Deterministic clock: `now` reads a mutable `t` so tests advance time between
// calls without touching the real Date.now (ttff must measure from mount).
function createClock(start = 0) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe("createVideoQoeSession", () => {
  it("computes ttff_ms once; a second onFirstPlaying is a no-op", () => {
    const clock = createClock(1000)
    const session = createVideoQoeSession({ contentId: "abc", now: clock.now })
    clock.advance(450)
    expect(session.onFirstPlaying()).toBe(450)
    // Advancing further must not re-measure — the second call is a no-op.
    clock.advance(1000)
    expect(session.onFirstPlaying()).toBeNull()
    expect(session.finalize("ended")?.ttff_ms).toBe(450)
  })

  it("counts rebuffers and errors, capping the stored message at 200 chars", () => {
    const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
    session.onRebuffer()
    session.onRebuffer()
    session.onError("first")
    session.onError("second")
    const long = "x".repeat(500)
    session.onError(long)
    const summary = session.finalize("ended")
    expect(summary?.rebuffer_count).toBe(2)
    expect(summary?.error_count).toBe(3)
    expect(summary?.last_error).toBe(long.slice(0, 200))
    expect(summary?.last_error).toHaveLength(200)
  })

  it("strips newlines from the stored error message", () => {
    const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
    session.onError("line1\nline2\r\nline3")
    const summary = session.finalize("ended")
    expect(summary?.last_error).not.toMatch(/[\r\n]/)
    expect(summary?.last_error).toBe("line1 line2 line3")
  })

  it("counts an error with no message but leaves last_error unset", () => {
    const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
    session.onError()
    session.onError("")
    const summary = session.finalize("ended")
    expect(summary?.error_count).toBe(2)
    expect(summary?.last_error).toBeUndefined()
  })

  it("threads watched_ms from the last accepted time update", () => {
    const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
    session.onTimeUpdate(12.5)
    session.onTimeUpdate(30.2)
    expect(session.finalize("ended")?.watched_ms).toBe(30200)
  })

  it("emits the summary once, then returns null on every later call", () => {
    const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
    expect(session.finalize("ended")).not.toBeNull()
    expect(session.finalize("abandoned")).toBeNull()
    expect(session.finalize("ended")).toBeNull()
  })

  it("reports ttff null + reason abandoned when finalized before any play", () => {
    const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
    expect(session.finalize("abandoned")).toEqual({
      content_id: "abc",
      ttff_ms: null,
      rebuffer_count: 0,
      error_count: 0,
      reason: "abandoned",
    })
  })

  it.each(["ended", "replaced", "dismissed", "failed", "abandoned"] as const)(
    "round-trips reason %s into the emitted summary",
    (reason) => {
      const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
      session.onTimeUpdate(10)
      expect(session.finalize(reason)?.reason).toBe(reason)
    },
  )

  // Falsification: stamping a dismissal or a replacement as the default
  // abandonment IS the reason-attribution defect R17 fixes. The exact shape
  // also pins that widening the reason added no new summary attribute.
  it.each(["replaced", "dismissed"] as const)(
    "reports %s as itself, not as an abandonment",
    (reason) => {
      const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
      session.onTimeUpdate(10)
      const summary = session.finalize(reason)
      expect(summary?.reason).not.toBe("abandoned")
      expect(summary).toEqual({
        content_id: "abc",
        ttff_ms: null,
        rebuffer_count: 0,
        error_count: 0,
        reason,
        watched_ms: 10_000,
      })
    },
  )

  // KTD13: the explicit end signal runs first and the existing cleanups stay
  // as safety nets, so first-reason-wins is what keeps a later cleanup from
  // relabelling an attributed session.
  it.each([
    ["dismissed", "abandoned"],
    ["replaced", "abandoned"],
    ["ended", "dismissed"],
  ] as const)(
    "keeps the explicit %s reason when a later cleanup finalizes with %s",
    (explicit, cleanup) => {
      const session = createVideoQoeSession({ contentId: "abc", now: () => 0 })
      session.onTimeUpdate(10)
      expect(session.finalize(explicit)?.reason).toBe(explicit)
      expect(session.finalize(cleanup)).toBeNull()
    },
  )

  it("defaults now to Date.now when the clock is not injected", () => {
    const session = createVideoQoeSession({ contentId: null })
    const ttff = session.onFirstPlaying()
    expect(typeof ttff).toBe("number")
    expect(ttff).toBeGreaterThanOrEqual(0)
    expect(session.finalize("ended")?.content_id).toBeNull()
  })
})

describe("shouldCountRebuffer", () => {
  it("counts a loading after playback started, not mid-swap", () => {
    expect(shouldCountRebuffer(true, false)).toBe(true)
  })
  it("does not count before playback has started", () => {
    expect(shouldCountRebuffer(false, false)).toBe(false)
  })
  it("does not count during a dub/source swap", () => {
    expect(shouldCountRebuffer(true, true)).toBe(false)
  })
})

describe("sanitizeVideoErrorMessage", () => {
  it("collapses newlines to spaces", () => {
    expect(sanitizeVideoErrorMessage("line1\nline2\r\nline3")).toBe(
      "line1 line2 line3",
    )
  })

  it("strips the query string from an embedded (signed) URL", () => {
    const msg =
      "load failed: https://stream.mux.com/abc123.m3u8?token=eyJ.SECRET.sig&x=1"
    const out = sanitizeVideoErrorMessage(msg)
    expect(out).not.toContain("token=")
    expect(out).not.toContain("SECRET")
    expect(out).toContain("https://stream.mux.com/abc123.m3u8?[redacted]")
  })

  it("caps the message length at 200", () => {
    expect(sanitizeVideoErrorMessage("x".repeat(500)).length).toBe(200)
  })
})
