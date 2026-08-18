/**
 * Auto-resume + autostart replaced the Resume / Start over chips. These are
 * SOURCE-SHAPE assertions (apps/mobile has no component-render harness,
 * KTD11), so they pin structure, not runtime behaviour — a rename-preserving
 * refactor that reorders things at runtime would still pass. The behavioural
 * gap is recorded in the review's testing gaps, not papered over here.
 *
 * Every slice marker is asserted found before use: an unchecked indexOf
 * returning -1 silently widens the slice to most of the file, and the
 * assertions then pass against unintended surface with no failure signal.
 *
 * Node globals are declared locally rather than via @types/node — KTD11
 * forbids new test deps.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "VideoPlayer.tsx"),
  "utf8",
)

/** indexOf that fails loudly instead of yielding -1 into a slice. */
function at(marker: string, from = 0): number {
  const i = SOURCE.indexOf(marker, from)
  expect({ marker, found: i !== -1 }).toEqual({ marker, found: true })
  return i
}

const EFFECT = SOURCE.slice(
  at("const autoPlayedRef"),
  at("}, [player, resumeAtSeconds, streamingUrl, autostart])"),
)

describe("autostart / auto-resume", () => {
  it("ships no Resume or Start over control", () => {
    expect(SOURCE).not.toMatch(/Start over/)
    expect(SOURCE).not.toMatch(/resumeRow|startOverButton/)
  })

  it("seeks to the saved position rather than offering a button", () => {
    // Paired with the no-Start-over assertion above: this substring alone also
    // existed in the removed Resume handler, so it carries no signal by itself.
    expect(EFFECT).toContain("player.currentTime = resumeAtSeconds")
  })

  it("starts playback without a tap", () => {
    expect(EFFECT).toContain("player.play()")
  })

  it("is opt-in per call site, and both players opt in deliberately", () => {
    // A default-on autostart silently reaches the series trailer dock. Keep
    // the prop explicit at every call site so adding a player is a decision.
    expect(SOURCE).toContain("autostart = false")
    expect(EFFECT).toContain("if (!autostart) return")
  })

  it("latches play and seek separately", () => {
    // The whole point: resumeAtSeconds hydrates asynchronously and can land
    // AFTER sourceLoad. One shared latch forfeited the seek permanently and
    // let playback from 0 overwrite the stored position.
    expect(EFFECT).toContain("if (autoPlayedRef.current) return")
    expect(EFFECT).toContain(
      "if (resumeSeekedRef.current || resumeAtSeconds == null) return",
    )
    expect(SOURCE).toMatch(/autoPlayedRef\.current = false/)
    expect(SOURCE).toMatch(/resumeSeekedRef\.current = false/)
  })

  it("still seeks when the resume position arrives after the source loaded", () => {
    // Without this the late-hydration case is exactly the bug above.
    expect(EFFECT).toContain("if (autoPlayedRef.current) applySeek()")
  })

  it("never starts playback while backgrounded", () => {
    const play = at('if (AppState.currentState !== "active") return')
    const guardEnd = at("player.play()", play)
    expect(guardEnd).toBeGreaterThan(play) // guard precedes the play it guards
    expect(SOURCE).toContain("  AppState,") // and is actually imported
  })

  it("does not autostart against a previous, still-loaded source", () => {
    // The old `if (player.duration > 0) apply()` probe ran synchronously in
    // the same commit that kicked off the adapter's async replaceAsync, so it
    // read the OUTGOING item and burned the latch on the wrong asset.
    expect(EFFECT).not.toContain("player.duration > 0")
  })

  it("suppresses chrome only while an AUTOSTART player waits for its first frame", () => {
    // Operands asserted independently, not as one verbatim expression: pinning
    // the whole string fails on a safe reorder, and "paste the new line in" is
    // then a green-again fix that re-verifies nothing.
    const gate = SOURCE.slice(
      at("const awaitingAutostart ="),
      at("const controls = useControlsVisibility"),
    )
    // `autostart &&` is the operand that keeps a NON-autostart caller's play
    // button. Both shipped call sites pass autostart today, so this conjunct is
    // forward-looking rather than currently load-bearing.
    expect(gate).toContain("autostart")
    expect(gate).toContain("!hasStarted")
    expect(gate).toContain("streamingUrl != null")
    expect(gate).toContain("!loadFailed")
    expect(gate).toContain("!loadTimedOut")
  })

  it("releases the veil when a load wedges without erroring", () => {
    // Neither release valve fires for a load that never starts and never
    // errors; without a backstop the viewer keeps a spinner and no controls.
    expect(SOURCE).toContain("AUTOSTART_VEIL_TIMEOUT_MS")
    expect(SOURCE).toContain("setLoadTimedOut(true)")
  })

  it("retries the autostart latch when the app returns to the foreground", () => {
    // applyPlay bails without latching while backgrounded, sourceLoad fires
    // once, and the adapter only replays a video that was ALREADY playing — so
    // nothing else recovers this.
    const effect = SOURCE.slice(at("const onSourceLoad = () =>"))
    const listener = effect.indexOf('AppState.addEventListener("change"')
    expect(listener).toBeGreaterThan(-1)
    // Gated on the source having loaded, or the retry plays an unready item.
    expect(effect).toContain("sourceLoadedRef.current")
  })

  it("does not consume the chrome reveal when tapped during the veil", () => {
    // The tap target is deliberately NOT gated (it still drives double-tap
    // seek), so the deferred hide is what must skip.
    expect(SOURCE).toContain("if (awaitingAutostart) return")
  })

  it("gates BOTH chrome layers, not just one", () => {
    // Both layers now share ONE veil-gated expression (`chromeMounted`, also
    // reported to the route for the back-swipe hold). Gating one layer but not
    // the other paints chrome over the loading veil — count both gates.
    expect(SOURCE).toContain(
      "const chromeMounted = controls.mounted && !awaitingAutostart",
    )
    const gated = SOURCE.match(/\{chromeMounted && \(/g) ?? []
    expect(gated).toHaveLength(2)
    // And no ungated `controls.mounted &&` block survives.
    expect(SOURCE).not.toMatch(/controls\.mounted && \(/)
  })

  it("shows the shared loading veil while it waits", () => {
    expect(SOURCE).toContain("{awaitingAutostart && <PlayerLoadingVeil />}")
    expect(SOURCE).toContain('from "./PlayerLoadingVeil"') // actually imported
  })

  it("shares one veil with the pre-stream poster", () => {
    // Two loading states run back to back on this screen (poster while the
    // stream resolves, then poster while autostart spins up). Two separately
    // styled veils would make one navigation look like two screens.
    const veil = fs.readFileSync(
      path.join(__dirname, "..", "PlayerLoadingVeil.tsx"),
      "utf8",
    )
    expect(veil).toContain("<CircularSpinner />")
    const poster = fs.readFileSync(
      path.join(__dirname, "..", "PlayerPoster.tsx"),
      "utf8",
    )
    expect(poster).toContain("{loading && <PlayerLoadingVeil />}")
    // The poster must NOT spin whenever its source is null — that state also
    // means "resolved, nothing playable", where a spinner never resolves.
    expect(poster).toContain("loading = false")
  })

  it("releases the suppression when the source errors", () => {
    // Playback never starts on an error, so without this the viewer is stuck
    // on a spinner with no controls and no way to retry.
    expect(SOURCE).toContain('setLoadFailed(status === "error")')
  })

  it("reports the adoption metric only once playback actually started", () => {
    // Reporting before/independently of play() lets a released player count
    // as a successful autostart and quietly inflates the metric.
    const latched = at("autoPlayedRef.current = true")
    const report = at('reportDatadogAction("autostart_applied"', latched)
    expect(report).toBeGreaterThan(latched)
  })
})
