/**
 * Cast session lifecycle wiring in the watch screen (U4, KTD4/KTD5/KTD7).
 * SOURCE-SHAPE assertions over app/watch/[slug].tsx (the watchAmbient.test.ts
 * pattern); session behaviour lives in the useCastPlayback and reducer suites.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const ROUTE = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "app", "watch", "[slug].tsx"),
  "utf8",
)

/** indexOf that fails loudly instead of yielding -1 into a slice. */
function at(marker: string, from = 0): number {
  const i = ROUTE.indexOf(marker, from)
  expect({ marker, found: i !== -1 }).toEqual({ marker, found: true })
  return i
}

describe("watch screen cast wiring (U4)", () => {
  it("keys the session on the DECODED slug (KTD7)", () => {
    expect(ROUTE).toContain(
      "useCastPlayback({ videoSlug: decodedSlug || null })",
    )
  })

  it("pins the player source for the session's lifetime (KTD4 freeze)", () => {
    // Caller-side: the pin holds the pre-session URL; release routes a dub
    // chosen mid-session through the existing swap machinery.
    const pin = at("const pinnedCastSourceRef")
    const capture = at("pinnedCastSourceRef.current = playerSource", pin)
    const release = at("pinnedCastSourceRef.current = null", pin)
    expect(capture).toBeGreaterThan(pin)
    expect(release).toBeGreaterThan(capture)
    // The slot publishes the pinned source, not the live chain (U6: the one
    // player is the host's, so the screen hands it a request).
    const slotStart = at("<PlayerSlot")
    const slotProps = ROUTE.slice(slotStart, at("/>", slotStart))
    expect(slotProps).toContain("streamingUrl={effectivePlayerSource}")
    expect(slotProps).toContain("castActive={castRemoteActive}")
  })

  it("records the released pin so the recovery knows a swap is coming", () => {
    const release = at("releasedCastSourceRef.current =")
    const swapCheck = at("releaseTriggersSwap(", release)
    expect(swapCheck).toBeGreaterThan(release)
  })

  it("feeds the resolver the remote-only chain — never offlineSource (KTD5/AE3)", () => {
    const resolver = at("resolveCastMedia({")
    const call = ROUTE.slice(resolver, at("startPositionSeconds,", resolver))
    expect(call).toContain("activeVariant")
    expect(call).toContain("video")
    expect(call).toContain("seedStreamingUrl")
    expect(call).not.toContain("offlineSource")
  })

  it("supplies the session speed to the cast load, read at call time (R15/AE9)", () => {
    // Keyed on the host's videoKey for this route (decodedSlug), read via
    // getSnapshot() at call time — never a subscription — so a speed change
    // cannot re-render the route or retrigger the load effect.
    const resolver = at("const resolveCastMediaAt = useCallback(")
    const body = ROUTE.slice(resolver, at("return media", resolver))
    expect(body).toContain("playbackRate: effectivePlayerSettings(")
    expect(body).toContain("getPlayerSettingsStore().getSnapshot()")
    expect(body).toContain("decodedSlug")
    expect(body).toContain(").speed")
    expect(ROUTE).not.toContain("useSyncExternalStore")
  })

  it("opens the SDK dialog through the cast adapter (KTD3)", () => {
    expect(ROUTE).toContain('from "../../src/lib/cast/castAdapter"')
    expect(ROUTE).toContain("void showCastDialog().catch(() => {})")
  })

  it("derives recovery only for a userEnd; a video change gets no seek", () => {
    // The videoChanged/unmount trigger means the player already belongs to
    // another video — a seek would land on the wrong content (R15 vs R10).
    const recovery = at("const castRecovery = useMemo<CastRecovery | null>")
    const body = ROUTE.slice(
      recovery,
      at("}, [castSessionState, playerSource])"),
    )
    expect(body).toContain(
      'if (castSessionState.trigger !== "userEnd") return null',
    )
    expect(body).toContain("lastPositionSeconds")
  })

  it("recovers a failure at the last known position (R13)", () => {
    const recovery = at("const castRecovery = useMemo<CastRecovery | null>")
    const body = ROUTE.slice(
      recovery,
      at("}, [castSessionState, playerSource])"),
    )
    const failed = body.indexOf('phase === "failed"')
    expect(failed).toBeGreaterThan(-1)
    expect(body.indexOf("lastCastPositionRef.current", failed)).toBeGreaterThan(
      failed,
    )
  })

  it("shows the standard snackbar on failure, then resets to Idle (R13)", () => {
    const failed = at('if (castSessionState.phase === "failed") {')
    const snackbar = at("setSnackbarMessage(", failed)
    const reset = at("castReset()", failed)
    expect(snackbar).toBeGreaterThan(failed)
    expect(reset).toBeGreaterThan(snackbar)
    // Ended resets too — the next session must start from Idle.
    expect(ROUTE).toContain('} else if (castSessionState.phase === "ended") {')
  })

  it("clears the last-session trackers when a new connect starts", () => {
    // A stale previous-session position must not become the next failure's
    // recovery point.
    const clear = at('if (castSessionState.phase === "connecting") {')
    const body = ROUTE.slice(clear, at("}, [castSessionState.phase])", clear))
    expect(body).toContain("lastCastPositionRef.current = null")
    expect(body).toContain("lastRemotePlayingRef.current = false")
  })
})
