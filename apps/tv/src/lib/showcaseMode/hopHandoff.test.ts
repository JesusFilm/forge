import {
  ALIGNMENT_TOLERANCE_SECONDS,
  HANDOFF_START_LEAD_SECONDS,
  PRELOAD_BUFFER_GRACE_MS,
  PRELOAD_DEADLINE_MS,
  alignmentSeekTarget,
  preloadPollVerdict,
  resolveHopSwapMode,
  resolvePreloadAction,
  sameHopStream,
  standbyMountEngaged,
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

describe("resolvePreloadAction — what the standby may do right now", () => {
  const target = hop("https://a/fr.m3u8", 50)
  const next = hop("https://a/de.m3u8", 60)

  it("holds while a reservation for the current boundary stands — even with a fresh preload target waiting", () => {
    expect(
      resolvePreloadAction({
        targetStream: target,
        preloadStream: next,
        reservedStream: target,
        loadingStream: null,
      }),
    ).toBe("hold")
  })

  it("holds the LAST hop's reservation past its own null preload target — confirmation releases it, not this decision", () => {
    expect(
      resolvePreloadAction({
        targetStream: target,
        preloadStream: null,
        reservedStream: target,
        loadingStream: null,
      }),
    ).toBe("hold")
  })

  it("releases when nothing should be preloaded and no matching reservation stands", () => {
    expect(
      resolvePreloadAction({
        targetStream: target,
        preloadStream: null,
        reservedStream: null,
        loadingStream: null,
      }),
    ).toBe("release")
    // A stale reservation for a DIFFERENT stream does not block the release.
    expect(
      resolvePreloadAction({
        targetStream: target,
        preloadStream: null,
        reservedStream: hop("https://a/old.m3u8", 30),
        loadingStream: null,
      }),
    ).toBe("release")
  })

  it("keeps an in-flight or finished load of the wanted stream", () => {
    expect(
      resolvePreloadAction({
        targetStream: target,
        preloadStream: next,
        reservedStream: null,
        loadingStream: next,
      }),
    ).toBe("keep")
  })

  it("loads fresh over a mismatched or failed entry", () => {
    expect(
      resolvePreloadAction({
        targetStream: target,
        preloadStream: next,
        reservedStream: null,
        loadingStream: hop("https://a/stale.m3u8", 40),
      }),
    ).toBe("load")
    // Failed entries are passed as null loadingStream — they never block a retry.
    expect(
      resolvePreloadAction({
        targetStream: target,
        preloadStream: next,
        reservedStream: null,
        loadingStream: null,
      }),
    ).toBe("load")
  })
})

describe("standbyMountEngaged — the second decode slot's mount gate", () => {
  const stream = hop("https://a/de.m3u8", 60)

  it("engages on each input independently", () => {
    expect(
      standbyMountEngaged({
        preloadStream: stream,
        hopSwap: false,
        reservedStream: null,
      }),
    ).toBe(true)
    expect(
      standbyMountEngaged({
        preloadStream: null,
        hopSwap: true,
        reservedStream: null,
      }),
    ).toBe(true)
    expect(
      standbyMountEngaged({
        preloadStream: null,
        hopSwap: false,
        reservedStream: stream,
      }),
    ).toBe(true)
  })

  it("disengages — freeing the slot — only when nothing needs the standby's surface", () => {
    expect(
      standbyMountEngaged({
        preloadStream: null,
        hopSwap: false,
        reservedStream: null,
      }),
    ).toBe(false)
  })
})

describe("preloadPollVerdict — the standby's poll loop", () => {
  const landedAt = (t: number) => ({
    currentTime: t,
    startSeconds: 50,
    bufferedPosition: 55,
    statusReady: true,
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
        statusReady: false,
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

  it("re-issues the seek even when the item is not yet readyToPlay — the heal must win over the readiness wait", () => {
    // If a refactor reorders the landed/statusReady checks, a dropped seek on a
    // still-loading item would return "wait" and the tvOS heal stops re-issuing.
    expect(preloadPollVerdict({ ...landedAt(0), statusReady: false })).toBe(
      "reseek",
    )
  })

  it("never arms on an item that has not reported readyToPlay — position and buffer alone can read plausibly off a wedged load", () => {
    expect(preloadPollVerdict({ ...landedAt(50), statusReady: false })).toBe(
      "wait",
    )
    expect(
      preloadPollVerdict({
        ...landedAt(50),
        statusReady: false,
        elapsedMs: PRELOAD_BUFFER_GRACE_MS,
      }),
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

  it("aims ahead of the live outgoing clock by the start lead", () => {
    expect(
      alignmentSeekTarget({
        outgoingTime: 50.8,
        incomingWindow,
        standbyTime: 50,
        leadSeconds: 0.5,
      }),
    ).toBe(51.3)
  })

  it("skips the seek for the TYPICAL flip under the real production constants", () => {
    // The production contract: outgoing barely past the boundary, standby parked at
    // it — the lead/tolerance pair must skip the critical-path decoder flush.
    expect(
      alignmentSeekTarget({
        outgoingTime: incomingWindow.startSeconds + 0.01,
        incomingWindow,
        standbyTime: incomingWindow.startSeconds,
        leadSeconds: HANDOFF_START_LEAD_SECONDS,
      }),
    ).toBe(null)
  })

  it("skips the seek when the standby already sits within tolerance of the aim", () => {
    expect(
      alignmentSeekTarget({
        outgoingTime: 50 + ALIGNMENT_TOLERANCE_SECONDS,
        incomingWindow,
        standbyTime: 50.25,
        leadSeconds: 0.25,
      }),
    ).toBe(null)
  })

  it("skips when the outgoing clock is unreadable — start from the preloaded boundary", () => {
    expect(
      alignmentSeekTarget({
        outgoingTime: null,
        incomingWindow,
        standbyTime: 50,
        leadSeconds: 0.5,
      }),
    ).toBe(null)
    expect(
      alignmentSeekTarget({
        outgoingTime: Number.NaN,
        incomingWindow,
        standbyTime: 50,
        leadSeconds: 0.5,
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
        leadSeconds: 0.5,
      }),
    ).toBe(null)
  })

  it("clamps clear of the incoming window's end so a deep drift cannot land on the next boundary", () => {
    expect(
      alignmentSeekTarget({
        outgoingTime: 79,
        incomingWindow,
        standbyTime: 50,
        leadSeconds: 0.5,
      }),
    ).toBe(59)
  })
})
