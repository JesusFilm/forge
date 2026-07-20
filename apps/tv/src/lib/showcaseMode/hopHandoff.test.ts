import {
  ALIGNMENT_TOLERANCE_SECONDS,
  PRELOAD_BUFFER_GRACE_MS,
  PRELOAD_DEADLINE_MS,
  alignmentSeekTarget,
  preloadPollVerdict,
  resolveHopSwapMode,
  sameHopStream,
} from "./hopHandoff"

const hop = (hls: string, startSeconds: number) => ({
  hls,
  window: { startSeconds, endSeconds: startSeconds + 10 },
})

describe("sameHopStream — identity across the shell's object recreations", () => {
  it("matches on URL + window start, not object identity", () => {
    expect(
      sameHopStream(hop("https://a/x.m3u8", 40), hop("https://a/x.m3u8", 40)),
    ).toBe(true)
  })

  it("distinguishes two dubs of the same footage (different URLs, same window)", () => {
    expect(
      sameHopStream(hop("https://a/en.m3u8", 40), hop("https://a/fr.m3u8", 40)),
    ).toBe(false)
  })

  it("distinguishes the same dub across two windows (a replayed centerpiece)", () => {
    expect(
      sameHopStream(hop("https://a/x.m3u8", 40), hop("https://a/x.m3u8", 50)),
    ).toBe(false)
  })

  it("never matches a missing side", () => {
    expect(sameHopStream(null, hop("https://a/x.m3u8", 40))).toBe(false)
    expect(sameHopStream(hop("https://a/x.m3u8", 40), null)).toBe(false)
  })
})

describe("resolveHopSwapMode — who performs the boundary", () => {
  const target = hop("https://a/fr.m3u8", 50)

  it("flips when the standby finished preloading exactly this stream", () => {
    expect(
      resolveHopSwapMode({
        hopSwap: true,
        targetStream: target,
        standbyReadyStream: hop("https://a/fr.m3u8", 50),
      }),
    ).toBe("flip")
  })

  it("falls back to the masked swap when the standby holds a different stream", () => {
    expect(
      resolveHopSwapMode({
        hopSwap: true,
        targetStream: target,
        standbyReadyStream: hop("https://a/de.m3u8", 60),
      }),
    ).toBe("fallback")
  })

  it("falls back when nothing preloaded at all", () => {
    expect(
      resolveHopSwapMode({
        hopSwap: true,
        targetStream: target,
        standbyReadyStream: null,
      }),
    ).toBe("fallback")
  })

  it("is none for ordinary excerpt swaps — even with a stale reservation standing", () => {
    // The entry into the centerpiece and the exit past it are real content cuts; the
    // poster owns them regardless of what the standby happens to hold.
    expect(
      resolveHopSwapMode({
        hopSwap: false,
        targetStream: target,
        standbyReadyStream: target,
      }),
    ).toBe("none")
  })

  it("is none without a target stream", () => {
    expect(
      resolveHopSwapMode({
        hopSwap: true,
        targetStream: null,
        standbyReadyStream: target,
      }),
    ).toBe("none")
  })
})

describe("preloadPollVerdict — the standby's poll loop", () => {
  const landedAt = (t: number) => ({
    currentTime: t,
    startSeconds: 50,
    bufferedPosition: 55,
    elapsedMs: 1000,
  })

  it("is ready once the seek landed and media is buffered past the boundary", () => {
    expect(preloadPollVerdict(landedAt(50))).toBe("ready")
  })

  it("re-issues the seek when the position sits at 0 — the tvOS dropped seek", () => {
    expect(preloadPollVerdict({ ...landedAt(0) })).toBe("reseek")
  })

  it("waits while the native position read is unavailable", () => {
    expect(
      preloadPollVerdict({
        currentTime: null,
        startSeconds: 50,
        bufferedPosition: null,
        elapsedMs: 1000,
      }),
    ).toBe("wait")
    expect(preloadPollVerdict({ ...landedAt(Number.NaN) })).toBe("wait")
  })

  it("waits for buffer after the seek lands, then lets the grace period promote it", () => {
    const thinBuffer = { ...landedAt(50), bufferedPosition: 50.2 }
    expect(preloadPollVerdict(thinBuffer)).toBe("wait")
    expect(
      preloadPollVerdict({ ...thinBuffer, elapsedMs: PRELOAD_BUFFER_GRACE_MS }),
    ).toBe("ready")
  })

  it("treats an unreported buffered frontier as thin, not as ready", () => {
    expect(
      preloadPollVerdict({ ...landedAt(50), bufferedPosition: null }),
    ).toBe("wait")
  })

  it("fails at the deadline — the boundary then takes the poster fallback", () => {
    expect(
      preloadPollVerdict({ ...landedAt(0), elapsedMs: PRELOAD_DEADLINE_MS }),
    ).toBe("failed")
  })
})

describe("alignmentSeekTarget — no repeated footage at the flip", () => {
  const incomingWindow = { startSeconds: 50, endSeconds: 60 }

  it("aligns the incoming player to the outgoing clock when it drifted past the boundary", () => {
    expect(
      alignmentSeekTarget({
        outgoingTime: 50.8,
        incomingWindow,
        standbyTime: 50,
      }),
    ).toBe(50.8)
  })

  it("skips the seek when the standby already sits within tolerance", () => {
    expect(
      alignmentSeekTarget({
        outgoingTime: 50 + ALIGNMENT_TOLERANCE_SECONDS,
        incomingWindow,
        standbyTime: 50,
      }),
    ).toBe(null)
  })

  it("skips when the outgoing clock is unreadable — start from the preloaded boundary", () => {
    expect(
      alignmentSeekTarget({
        outgoingTime: null,
        incomingWindow,
        standbyTime: 50,
      }),
    ).toBe(null)
    expect(
      alignmentSeekTarget({
        outgoingTime: Number.NaN,
        incomingWindow,
        standbyTime: 50,
      }),
    ).toBe(null)
  })

  it("skips when the outgoing clock never reached the incoming window", () => {
    // A skipped/failed hop can flip from a position before the next window opens.
    expect(
      alignmentSeekTarget({
        outgoingTime: 43,
        incomingWindow,
        standbyTime: 50,
      }),
    ).toBe(null)
  })

  it("clamps clear of the incoming window's end so a deep drift cannot land on the next boundary", () => {
    expect(
      alignmentSeekTarget({
        outgoingTime: 79,
        incomingWindow,
        standbyTime: 50,
      }),
    ).toBe(59)
  })
})
