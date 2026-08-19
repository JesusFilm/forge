/**
 * Cast remote mode (U4, KTD4) wiring in VideoPlayer. SOURCE-SHAPE assertions
 * (the videoPlayerAutostart.test.ts pattern); behaviour lives in the pure
 * selector suite (playbackTarget.test.ts), the PlayerControls render suite,
 * and the useManagedVideoPlayer castActive suite.
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
const HOST = fs.readFileSync(
  path.join(__dirname, "..", "PlaybackHost.tsx"),
  "utf8",
)

/** indexOf that fails loudly instead of yielding -1 into a slice. */
function at(marker: string, from = 0): number {
  const i = SOURCE.indexOf(marker, from)
  expect({ marker, found: i !== -1 }).toEqual({ marker, found: true })
  return i
}

describe("cast remote mode (U4)", () => {
  it("threads castActive into the one adapter, in the host (KTD4)", () => {
    // Operands asserted independently — the host's options object also carries
    // ownsSession and onSourceApplied, so a literal would be format-fragile.
    const options = HOST.slice(
      HOST.indexOf("useManagedVideoPlayer("),
      HOST.indexOf("const openSheetCount"),
    )
    expect(options).toContain("castActive,")
    expect(HOST).toContain("const castActive = slotOwned && request.castActive")
    // The chrome must never build a second adapter (rootPlayerOwnership).
    expect(SOURCE).not.toContain("useManagedVideoPlayer")
    expect(SOURCE).not.toContain("progressFeedRef")
  })

  it("pauses the local player when a session starts", () => {
    const start = at("if (!castRemoteActive) return")
    const pause = at("player.pause()", start)
    const depClose = at("}, [castRemoteActive, player])", start)
    expect(pause).toBeGreaterThan(start)
    expect(depClose).toBeGreaterThan(pause)
  })

  it("captures the pre-session play state BEFORE the session pause", () => {
    // A connect that never goes active must know whether to resume: the
    // failure recovery carries resume=false (no remote media ever played),
    // and a dialog cancel has no recovery at all.
    const start = at("if (!castRemoteActive) return")
    const capture = at("wasPlaying = player.playing === true", start)
    const pause = at("player.pause()", capture)
    const store = at("wasPlayingBeforeCastRef.current = wasPlaying", capture)
    expect(pause).toBeGreaterThan(capture)
    expect(store).toBeGreaterThan(pause)
  })

  it("resumes local playback when a connect never goes active", () => {
    // Connecting -> failed (snackbar says playback continues) and
    // Connecting -> idle (dialog cancel) both hand back a paused player.
    const edge = at("const prevCastPhaseRef")
    const body = SOURCE.slice(
      edge,
      at("}, [castPhase, player, autostart])", edge),
    )
    expect(body).toContain('if (previous !== "connecting") return')
    expect(body).toContain("if (isRemoteCastPhase(castPhase)) return")
    expect(body).toContain("if (wasPlayingBeforeCastRef.current) {")
    expect(body).toContain("player.play()")
  })

  it("burns the pre-session capture once the session goes active", () => {
    // A later in-session reconnect (active -> connecting -> failed) must not
    // consume the ORIGINAL session's flag and resume at the pre-session
    // position; after the burn a dead reconnect leaves a paused player.
    const edge = at("const prevCastPhaseRef")
    const body = SOURCE.slice(
      edge,
      at('if (previous !== "connecting") return', edge),
    )
    expect(body).toContain('if (castPhase === "active")')
    expect(body).toContain("wasPlayingBeforeCastRef.current = false")
  })

  it("foreground-gates the connect-abort resume", () => {
    // Mirrors applyPlay: never start audio the viewer cannot see.
    const branch = at("if (wasPlayingBeforeCastRef.current) {")
    const body = SOURCE.slice(
      branch,
      at("}, [castPhase, player, autostart])", branch),
    )
    const gate = body.indexOf('if (AppState.currentState !== "active") return')
    const play = body.indexOf("player.play()")
    expect(gate).toBeGreaterThan(-1)
    expect(play).toBeGreaterThan(gate)
  })

  it("re-attempts a suppressed autostart when the connect aborts (veil cast)", () => {
    // The viewer cast before local playback ever started; without the retry
    // a cancelled/failed connect strands a paused player behind the poster.
    const branch = at("if (wasPlayingBeforeCastRef.current) {")
    const body = SOURCE.slice(
      branch,
      at("}, [castPhase, player, autostart])", branch),
    )
    expect(body).toContain("autostart &&")
    expect(body).toContain("!autoPlayedRef.current")
    expect(body).toContain("sourceLoadedRef.current")
    expect(body).toContain('AppState.currentState === "active"')
    expect(body).toContain("autoPlayedRef.current = true")
  })

  it("suppresses local autostart while a session owns playback", () => {
    // Without both guards a sourceLoad landing mid-session starts local
    // audio under the TV (the veil-window cast case).
    const seek = at("const applySeek = () =>")
    const seekGuard = at("if (castRemoteActiveRef.current) return", seek)
    const play = at("const applyPlay = () =>", seek)
    const playGuard = at("if (castRemoteActiveRef.current) return", play)
    expect(seekGuard).toBeGreaterThan(seek)
    expect(seekGuard).toBeLessThan(play)
    expect(playGuard).toBeGreaterThan(play)
  })

  it("selects ONE playback target for the chrome and the side seek (KTD4)", () => {
    expect(SOURCE).toContain("castTarget = selectPlaybackTarget({")
    // The chrome receives the same target the side seek routes through.
    const chromeStart = at("<PlayerControls")
    const chrome = SOURCE.slice(chromeStart, at("/>", chromeStart))
    expect(chrome).toContain("castTarget={castTarget}")
    expect(chrome).toContain("castUi={castUi}")
  })

  it("routes the double-tap side seek to the cast target", () => {
    const sideSeek = at("const doSideSeek = useCallback(")
    const seekEnd = at("[player, showSeekFlash, castTarget]", sideSeek)
    const body = SOURCE.slice(sideSeek, seekEnd)
    expect(body).toContain("if (castTarget != null) {")
    expect(body).toContain("if (castTarget.held) return")
    expect(body).toContain("castTarget.seekTo(target)")
  })

  it("keeps the poster on the phone while the TV plays (R7)", () => {
    expect(SOURCE).toContain(
      "{(!hasStarted || castRemoteActive) && resolvedPoster != null && (",
    )
  })

  it("names the route in the indicator, per route (R7/R16)", () => {
    const gate = at("{externalRouteActive && (")
    const indicator = SOURCE.slice(gate, at("Playing on AirPlay", gate))
    expect(indicator).toContain("castRemoteActive")
    expect(indicator).toContain("castIndicatorLabel(castPhase")
  })

  it("shows the distinct connecting state (R16)", () => {
    expect(SOURCE).toContain(
      '{castPhase === "connecting" && <PlayerLoadingVeil />}',
    )
  })

  it("releases the autostart veil to the session's own states", () => {
    // The chrome must mount during a session (held transport, Cast button);
    // the veil would trap the viewer with no controls.
    const gate = SOURCE.slice(
      at("const awaitingAutostart ="),
      at("// Backstop for a load that neither starts nor errors."),
    )
    expect(gate).toContain("!castRemoteActive")
    expect(gate).toContain("!castTouchedRef.current")
  })

  it("keeps the veil down after any cast session (castTouched latch)", () => {
    // Render-time latch (the castRemoteActiveRef idiom): once a session has
    // owned the player area, the chrome and route buttons are the recovery
    // surface — never a re-engaged 12s dead veil.
    expect(SOURCE).toContain(
      "if (castRemoteActive) castTouchedRef.current = true",
    )
  })

  it("keeps the route buttons reachable under the veil (R14)", () => {
    const veilRow = at("{awaitingAutostart && (")
    const row = SOURCE.slice(veilRow, at("</View>", veilRow))
    expect(row).toContain("<RouteButtons")
    expect(row).toContain("castUi={castUi}")
    expect(row).toContain('pointerEvents="box-none"')
  })

  it("adds no cast field to the visibility hook (chrome stays up structurally)", () => {
    // The session holds the local player paused, so the hide timer cannot
    // arm — a cast gate would be unreachable state.
    expect(SOURCE).toContain("useControlsVisibility(player)")
  })

  it("ends the session when AirPlay activates mid-cast (KTD9)", () => {
    const guard = at(
      "if (airPlayActive && castRemoteActiveRef.current) castEndRef.current?.()",
    )
    const depClose = at("}, [airPlayActive])", guard)
    expect(depClose).toBeGreaterThan(guard)
  })

  it("retries the media load when the SDK client arrives (connect window)", () => {
    // load() no-ops on a null client; keying the sync on the load identity
    // re-fires it once the client exists.
    const sync = at("const lastCastLoadRef")
    const body = SOURCE.slice(
      sync,
      at("[castRemoteActive, castLoad, resolveCastMediaAt", sync),
    )
    expect(body).toContain("previous.load === castLoad")
    expect(body).toContain("previous.url === media.contentUrl")
    expect(body).toContain("castLoad(media)")
  })

  it("loads mid-session reloads at the receiver position, first load local (R9/KTD5)", () => {
    expect(SOURCE).toContain(
      "castPositionRef.current ?? readCastStartPosition()",
    )
    // First-load fallback: the pending resume position when local playback
    // never started (KTD5), never the untouched 0:00.
    const read = at("const readCastStartPosition = useCallback(")
    const body = SOURCE.slice(read, at("}, [player])", read))
    expect(body).toContain("resumeAtRef.current")
    expect(body).toContain("player.currentTime")
  })

  it("applies end recovery through the resume-seek machinery", () => {
    // The seek must survive a pin-release swap: a still-loading source
    // applies on its sourceLoad via a persistent listener.
    const apply = at("const applyCastRecovery = useCallback(")
    const body = SOURCE.slice(apply, at("}, [player])", apply))
    expect(body).toContain("player.currentTime = pending.positionSeconds")
    // The seek is unconditional; only the resume play is foreground-gated.
    expect(body).toContain(
      'if (pending.resume && AppState.currentState === "active")',
    )
    expect(body).toContain("setSeekSignal(")
    expect(SOURCE).toContain(
      'player.addListener("sourceLoad", () => applyCastRecovery())',
    )
  })

  it("logs a failed recovery instead of swallowing it", () => {
    // Mirrors the adapter's swap/foreground video.resume_failed shape so one
    // monitor covers every local resume path.
    const apply = at("const applyCastRecovery = useCallback(")
    const body = SOURCE.slice(apply, at("}, [player])", apply))
    expect(body).toContain('datadogLog.warn("video.resume_failed", {')
    expect(body).toContain(
      "content_id: extractMuxPlaybackId(streamingUrlRef.current)",
    )
    expect(body).toContain('surface: "cast_recovery"')
  })

  it("burns the autostart latches when a recovery lands", () => {
    // Otherwise the autostart sourceLoad listener re-seeks to the stale
    // resume position and force-plays over the recovered state.
    const latch = at("lastCastRecoveryRef.current = castRecovery")
    const burnPlay = at("autoPlayedRef.current = true", latch)
    const burnSeek = at("resumeSeekedRef.current = true", latch)
    expect(burnPlay).toBeGreaterThan(latch)
    expect(burnSeek).toBeGreaterThan(latch)
  })
})
