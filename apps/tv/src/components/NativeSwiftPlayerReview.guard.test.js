/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("node:fs")
const path = require("node:path")

const nativeRoot = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios",
)
const view = fs.readFileSync(
  path.join(nativeRoot, "NativeSwiftPlayerView.swift"),
  "utf8",
)
const moduleSource = fs.readFileSync(
  path.join(nativeRoot, "NativeSwiftPlayerModule.swift"),
  "utf8",
)
const chrome = fs.readFileSync(
  path.join(nativeRoot, "NativePlayerChromeView.swift"),
  "utf8",
)
const bridge = fs.readFileSync(
  path.join(__dirname, "NativeSwiftPlayer.tsx"),
  "utf8",
)
const settings = fs.readFileSync(
  path.join(__dirname, "settings/SettingsScreen.tsx"),
  "utf8",
)

function section(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from).toBeGreaterThanOrEqual(0)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe("native Swift review regression wiring", () => {
  it("loads sources only after the full prop batch includes the resume position", () => {
    expect(section(view, "var sourceUrl:", "var storyboardUrl:")).not.toContain(
      "replaceSource",
    )
    expect(moduleSource).toContain("OnViewDidUpdateProps")
    expect(moduleSource).toContain("view.commitProps()")
    expect(
      section(view, "func commitProps()", "public required init"),
    ).toContain("sourceUrl != loadedSourceUrl")
  })

  it("ignores old items at status delivery and seek completion", () => {
    const status = section(
      view,
      "private func handleItemStatus",
      "private func handlePlaybackFailure",
    )
    expect(status).toContain("guard player.currentItem === item")
    expect(status).toContain("guard let self, self.player.currentItem === item")
    expect(status).toContain(
      "!self.userDismissalHandled, !self.programmaticDismissal",
    )
    const removal = section(
      view,
      "public override func removeFromSuperview()",
      "private func presentPlayerController",
    )
    expect(removal).toContain("itemStatusObservation?.invalidate()")
    expect(removal).toContain("player.replaceCurrentItem(with: nil)")
  })

  it("rejects subtitle callbacks queued before Off or another selection", () => {
    const subtitles = view.slice(view.indexOf("private func loadSubtitles()"))
    expect(subtitles).toContain("subtitleGeneration += 1")
    expect(subtitles).toContain("self.subtitleGeneration == generation")
    expect(subtitles).toContain(
      "self.selectedSubtitleUrl == selectedSubtitleUrl",
    )
    expect(
      subtitles.indexOf("self.subtitleGeneration == generation"),
    ).toBeLessThan(subtitles.indexOf("self.subtitleCues = cues"))
  })

  it("does not overwrite saved progress while restoring a source", () => {
    const replacement = section(
      view,
      "private func replaceSource(",
      "private func handleItemStatus",
    )
    expect(replacement).toContain(
      "else if !sourceSeekPending, current.isFinite",
    )
    expect(replacement.indexOf("sourceSeekPending = true")).toBeLessThan(
      replacement.indexOf("player.replaceCurrentItem"),
    )
    expect(
      section(
        view,
        "private func handleTimeUpdate",
        "public func playerViewControllerWillBeginDismissalTransition",
      ),
    ).toContain("!sourceSeekPending")
    expect(
      section(
        view,
        "private func handleItemStatus",
        "private func handlePlaybackFailure",
      ),
    ).toContain("self.sourceSeekPending = false")
  })

  it("starts every swipe at the current candidate and cancels on transport focus", () => {
    const pan = section(
      chrome,
      "func handlePan(",
      "@objc private func handleMenuTap",
    )
    expect(pan).toMatch(
      /if gesture\.state == \.began \{\s+beginCandidate\(\)\s+scrubOriginTime = candidateTime \?\? committedTime/,
    )
    expect(pan).toContain(
      "gesture.state == .cancelled || gesture.state == .failed",
    )
    expect(
      section(
        chrome,
        "func focusPrimaryTransport()",
        "func adjustTimelineCandidate",
      ),
    ).toContain("timeline.cancelScrubbing()")
  })

  it("anchors dub watch credit to the last reported playback position", () => {
    expect(bridge).toContain("lastPositionRef.current = normalized")
    expect(bridge).toContain(
      "lastPositionRef.current?.positionSeconds ?? startAtSeconds ?? 0",
    )
  })

  it("does not show Apple-only choices on Android", () => {
    const start = settings.indexOf('{Platform.OS === "ios" ? (')
    expect(start).toBeGreaterThan(-1)
    expect(settings.slice(start)).toContain("Native A — AVKit Controls")
    expect(settings.slice(start)).toContain("Native B — UIKit + Mux Preview")
  })
})
