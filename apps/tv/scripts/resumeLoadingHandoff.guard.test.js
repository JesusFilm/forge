/* global require, describe, it, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs")
const path = require("path")
const base = path.resolve(
  __dirname,
  "../modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer",
)
const read = (name) => fs.readFileSync(path.join(base, name), "utf8")

describe("native resume loading handoff", () => {
  it("returns menu focus to the opener instead of the seek timeline", () => {
    const source = read("NativeAndroidPlayerView.kt")
    const close = source
      .split("private fun closeMenu()")[1]
      .split("private fun handleEnded")[0]
    expect(close).toContain('"language" -> audioButton')
    expect(close).toContain('"subtitles" -> subtitleButton')
    expect(close).toContain('"moments" -> exploreButton')
    expect(close).toContain("showControls(returnFocus)")
    expect(close).not.toContain("showControls(progressBar)")
  })
  it("covers the chooser before resolving the selection to React", () => {
    const source = read("NativeAndroidPlayerModule.kt")
    const resume = source
      .split('AsyncFunction("showResumeChoice")')[1]
      .split('AsyncFunction("dismissResumeChoice")')[0]
    expect(resume).toContain("PlaybackLoadingCover.show(activity)")
    expect(resume.indexOf("PlaybackLoadingCover.show(activity)")).toBeLessThan(
      resume.indexOf("promise.resolve(choice)"),
    )
    expect(resume).toContain('if (choice != "cancel")')
    expect(resume).toContain('sendEvent("onPlaybackLoadingCancelled")')
  })

  it("only reveals startup controls after a rendered frame or an error", () => {
    const source = read("NativeAndroidPlayerView.kt")
    expect(source).toContain(
      'BrandedLoadingView(context, "Preparing playback")',
    )
    const show = source
      .split("private fun showControls(")[1]
      .split("private fun scheduleHideControls")[0]
    expect(show).toContain("if (!hasRenderedFrame && !hasPlaybackError)")
    expect(show).toContain("controllerOverlay.visibility = View.GONE")
    const firstFrame = source
      .split("override fun onRenderedFirstFrame()")[1]
      .split("override fun onEvents")[0]
    expect(firstFrame).toContain("loadingView.visibility = View.GONE")
    expect(firstFrame).toContain("PlaybackLoadingCover.hide()")
    expect(firstFrame).toContain("showControls(playPauseButton)")
    const error = source
      .split("override fun onPlayerError(")[1]
      .split("override fun onRenderedFirstFrame")[0]
    expect(error).toContain("loadingView.visibility = View.GONE")
    expect(error).toContain("showControls(backButton)")
    expect(error).toContain("PlaybackLoadingCover.hide()")
  })

  it("stops dot animation when the player hides the loader", () => {
    const source = read("BrandedLoadingView.kt")
    expect(source).toContain("override fun onVisibilityAggregated")
    expect(source).toContain("else pulse.cancel()")
    expect(source).toContain("next.setOnCancelListener { onCancel() }")
    expect(source).toContain("dialog?.dismiss()")
  })

  it("does not consume dedicated media actions just to reveal hidden controls", () => {
    const source = read("NativeAndroidPlayerView.kt")
    const reveal = source
      .split("if (!controllerVisible || isFocused) {")[1]
      .split("if (event.keyCode in listOf(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE")[0]
    expect(reveal).not.toContain("KeyEvent.KEYCODE_MEDIA_PAUSE")
    expect(reveal).not.toContain("KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE")
    expect(reveal).not.toContain("KeyEvent.KEYCODE_MEDIA_REWIND")
    expect(source).toContain("KeyEvent.KEYCODE_MEDIA_PAUSE -> player.pause()")
  })
})
