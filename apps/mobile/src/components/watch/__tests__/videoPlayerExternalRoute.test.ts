/**
 * External-playback (AirPlay, U1) wiring in VideoPlayer. SOURCE-SHAPE
 * assertions (the videoPlayerAutostart.test.ts pattern — VideoPlayer has no
 * component-render harness); behaviour lives in the pure predicate suite
 * (externalRoute.test.ts) and the PlayerControls render suite.
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

describe("external playback (AirPlay, U1)", () => {
  it("subscribes to isExternalPlaybackActiveChange once per player", () => {
    const listener = at('"isExternalPlaybackActiveChange"')
    // The subscription effect re-runs on player identity only, so a source
    // swap on the same player cannot tear the listener down mid-route.
    const depClose = at("}, [player])", listener)
    expect(depClose).toBeGreaterThan(listener)
  })

  it("applies the payload boolean directly, so BOTH directions land", () => {
    // active -> indicator + hidden captions; inactive -> both restored.
    expect(SOURCE).toContain("setAirPlayActive(isExternalPlaybackActive)")
  })

  it("seeds from the live player, not only from the event", () => {
    // A player handed over already routing never re-fires the change event.
    expect(SOURCE).toContain("player.isExternalPlaybackActive")
  })

  it("derives the route through the shared predicate (U4 extends it)", () => {
    expect(SOURCE).toContain('from "../../lib/externalRoute"')
    expect(SOURCE).toContain("isExternalRouteActive({ airPlayActive })")
  })

  it("hides the subtitle overlay while an external route is active (KTD9)", () => {
    const overlayStart = at("<SubtitleOverlay")
    const overlay = SOURCE.slice(overlayStart, at("/>", overlayStart))
    // Operands asserted independently (reorder-safe): the existing
    // hasStarted gate must survive, the external-route gate must exist.
    expect(overlay).toContain("hasStarted")
    expect(overlay).toContain("!externalRouteActive")
    expect(overlay).toContain("subtitleVttSrc : null")
  })

  it("shows an external-playback indicator that never blocks the controls (R5)", () => {
    const gate = at("{externalRouteActive && (")
    const indicator = SOURCE.slice(gate, at("Playing on AirPlay", gate))
    expect(indicator).toContain('pointerEvents="none"')
  })

  it("does not statically set allowsExternalPlayback (defaults true; U4 toggles it)", () => {
    expect(SOURCE).not.toContain("allowsExternalPlayback")
  })

  it("threads the route state into the chrome with no source-kind gate (AE4)", () => {
    const chromeStart = at("<PlayerControls")
    const chrome = SOURCE.slice(chromeStart, at("/>", chromeStart))
    expect(chrome).toContain("externalPlaybackActive={airPlayActive}")
    // A local file:// source must keep the button: no streamingUrl condition.
    expect(chrome).not.toContain("streamingUrl")
  })
})
