/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const SWIFT_VIEW = path.resolve(
  __dirname,
  "../../modules/native-swift-player/ios/NativeSwiftPlayerView.swift",
)

describe("native Swift player lifecycle", () => {
  const source = fs.readFileSync(SWIFT_VIEW, "utf8")

  it("does not tear AVKit down during the window transition caused by presentation", () => {
    const start = source.indexOf("public override func didMoveToWindow()")
    const end = source.indexOf("public override func removeFromSuperview()")
    const body = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(body).not.toContain("player.pause()")
    expect(body).not.toContain("playerController.dismiss(")
  })

  it("tears AVKit down when React actually removes the native view", () => {
    const start = source.indexOf("public override func removeFromSuperview()")
    const end = source.indexOf("private func presentPlayerController()")
    const body = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(body).toContain("player.pause()")
    expect(body).toContain("playerController.dismiss(animated: false)")
  })

  it("retries until a React host can present the full-screen controller", () => {
    const start = source.indexOf("private func presentPlayerController()")
    const end = source.indexOf("private func replaceSource(")
    const body = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(body).toContain("guard let host = reactViewController() else")
    expect(body).toContain("retryPlayerPresentation()")
    expect(body).toContain("topViewController(from: host)")
  })

  it("shows a recoverable playback error instead of leaving a black screen", () => {
    const start = source.indexOf("private func handlePlaybackFailure(")
    const end = source.indexOf("private func updateMetadata()")
    const body = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(body).toContain('title: "Playback failed"')
    expect(body).toContain('title: "Try Again"')
    expect(body).toContain('title: "Back"')
    expect(body).toContain("dismissAfterPlaybackFailure()")
  })

  it("dismisses the React overlay when the remote exits AVKit", () => {
    expect(source).toContain("playerViewControllerWillBeginDismissalTransition")
    expect(source).toContain("playerViewControllerShouldDismiss")
    expect(source).toContain("DispatchQueue.main.asyncAfter")
    expect(source).toContain("root.dismiss(animated: false)")
    expect(source).toContain("playerController.dismiss(animated: false)")
    expect(source).toContain("return false")
    expect(source).toContain("playerViewControllerDidEndDismissalTransition")
    expect(source).toContain("guard !programmaticDismissal else { return }")
    expect(source).toContain("self.startDismissalMonitor()")
    expect(source).toContain(
      "self.playerController.presentingViewController == nil",
    )
    expect(source).toContain("self.monitorDismissal(generation: generation)")
    expect(source).toContain("self.completeUserDismissal()")
    expect(source).toContain("guard !userDismissalHandled else { return }")
  })

  it("moves focus into each presented option list", () => {
    const start = source.indexOf("private final class NativeOptionsController")
    const end = source.indexOf("public final class NativeSwiftPlayerView")
    const body = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(body).toContain("initialFocusIndexPath")
    expect(body).toContain("indexPathForPreferredFocusedView")
    expect(body).toContain("focusSystem.requestFocusUpdate(to: cell)")
    expect(body).toContain("focusSystem.updateFocusIfNeeded()")
  })
})
