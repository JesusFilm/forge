/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const SWIFT_VIEW = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios/NativeSwiftPlayerView.swift",
)
const SWIFT_CHROME = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios/NativePlayerChromeView.swift",
)
const SWIFT_CONTROLLER = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios/NativePlayerViewController.swift",
)
const MODULE = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios/NativeSwiftPlayerModule.swift",
)
const SETTINGS = path.resolve(__dirname, "./settings/SettingsScreen.tsx")

describe("Native B UIKit player chrome", () => {
  const swift = fs.readFileSync(SWIFT_VIEW, "utf8")
  const chrome = fs.readFileSync(SWIFT_CHROME, "utf8")
  const controller = fs.readFileSync(SWIFT_CONTROLLER, "utf8")
  const module = fs.readFileSync(MODULE, "utf8")
  const settings = fs.readFileSync(SETTINGS, "utf8")

  it("keeps Native A and Native B as separate choices", () => {
    expect(settings).toContain("Native A — AVKit Controls")
    expect(settings).toContain("Native B — UIKit + Mux Preview")
    expect(module).toContain('Prop("playerVariant")')
    expect(swift).toContain('playerVariant == "native-b"')
    expect(swift).toContain("playerController.showsPlaybackControls = !custom")
  })

  it("moves candidate UI without changing committed progress", () => {
    expect(chrome).toContain("private var committedTime: Double = 0")
    expect(chrome).toContain("private(set) var candidateTime: Double?")
    expect(chrome).toContain(
      "let committedFraction = fraction(for: committedTime)",
    )
    expect(chrome).toContain(
      "let thumbFraction = fraction(for: candidateTime ?? committedTime)",
    )
    expect(chrome).toContain("updateCandidate(scrubOriginTime + delta)")
    expect(chrome).not.toContain("AVPlayer")
  })

  it("commits one seek on Select and cancels without seeking", () => {
    expect(chrome).toContain("onCommit?(candidateTime)")
    expect(chrome).toContain("onCancel?()")
    const commitStart = swift.indexOf("private func commitCustomScrub(at time:")
    const commitEnd = swift.indexOf(
      "private func dismissFromCustomChrome()",
      commitStart,
    )
    const commitBody = swift.slice(commitStart, commitEnd)
    expect(commitStart).toBeGreaterThan(-1)
    expect(commitBody.match(/player\.seek\(/g)).toHaveLength(1)
    const cancelStart = swift.indexOf("customChromeView.onScrubCancel")
    const cancelEnd = swift.indexOf(
      "customChromeView.onChromeVisibilityChanged",
      cancelStart,
    )
    expect(swift.slice(cancelStart, cancelEnd)).not.toContain("player.seek")
  })

  it("provides native controls, focus, auto-hide, and accessibility", () => {
    for (const label of [
      "Skip back 10 seconds",
      "Pause",
      "Skip forward 10 seconds",
      "Start Over",
      "Explore",
      "Audio language",
      "Subtitles",
    ]) {
      expect(chrome).toContain(label)
    }
    expect(chrome).toContain("didUpdateFocus")
    expect(chrome).toContain("UIFocusSystem.focusSystem")
    expect(chrome).toContain("Timer(timeInterval: 8")
    expect(chrome).toContain(".prominentGlass()")
    expect(chrome).toContain(".glass()")
    expect(chrome).toContain("NativeChromeShadeView")
    expect(chrome).toContain("UIFocusGuide()")
    expect(chrome).toContain("preferredFocusEnvironments = [timeline]")
    expect(chrome).toContain('accessibilityIdentifier = "NativeScrubTimeline"')
    expect(chrome).toContain("accessibilityIncrement")
    expect(chrome).toContain("accessibilityDecrement")
  })

  it("lets the owning AVPlayerViewController reveal and cancel Native B chrome", () => {
    expect(controller).toContain("nativeChromeEnabled")
    expect(controller).toContain("if !nativeChrome.controlsVisible")
    expect(controller).toContain(
      "nativeChrome.revealControls(preferredFocus: true)",
    )
    expect(controller).toContain("super.pressesBegan(presses, with: event)")
    expect(controller).toContain("nativeChrome.focusTimeline()")
    expect(controller).toContain("nativeChrome.focusPrimaryTransport()")
    expect(controller).toContain(
      "nativeChrome.adjustTimelineCandidate(by: -10)",
    )
    expect(controller).toContain("nativeChrome.adjustTimelineCandidate(by: 10)")
    expect(controller).toContain("nativeChrome.commitTimelineCandidate()")
    expect(controller).toContain("override func pressesEnded")
    expect(controller).toContain("consumedPressTypes")
    expect(chrome).toContain("timelineNavigationActive")
    expect(chrome).toContain("handleScrubPan")
    expect(chrome).toContain("var onMenu: (() -> Bool)?")
    expect(chrome).toContain("consumesMenuRelease")
    expect(chrome).toContain("allowedPressTypes")
    expect(chrome).toContain("handleMenuTap")
    expect(chrome).toContain("gestureRecognizerShouldBegin")
    expect(swift).toContain(
      "let cancelledScrub = usesCustomChrome && customChromeView.cancelScrubbing()",
    )
  })
})
