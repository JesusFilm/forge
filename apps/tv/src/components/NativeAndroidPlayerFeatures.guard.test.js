/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

const KOTLIN_VIEW = path.resolve(
  __dirname,
  "../../modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerView.kt",
)
const KOTLIN_MODULE = path.resolve(
  __dirname,
  "../../modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativeAndroidPlayerModule.kt",
)
const KOTLIN_CHROME = path.resolve(
  __dirname,
  "../../modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/NativePlayerChrome.kt",
)
const GRADLE = path.resolve(
  __dirname,
  "../../modules/native-android-player/android/build.gradle",
)
const REACT_VIEW = path.resolve(__dirname, "./NativeAndroidPlayer.tsx")
const LAYOUT = path.resolve(__dirname, "../../app/_layout.tsx")

describe("native Android Media3 player", () => {
  const kotlin = fs.readFileSync(KOTLIN_VIEW, "utf8")
  const module = fs.readFileSync(KOTLIN_MODULE, "utf8")
  const chrome = fs.readFileSync(KOTLIN_CHROME, "utf8")
  const gradle = fs.readFileSync(GRADLE, "utf8")
  const react = fs.readFileSync(REACT_VIEW, "utf8")
  const layout = fs.readFileSync(LAYOUT, "utf8")

  it("uses the same native Media3 version as expo-video", () => {
    expect(gradle).toContain('androidxMedia3Version = "1.8.0"')
    expect(gradle).toContain("media3-exoplayer-hls")
    expect(gradle).toContain("media3-ui")
    expect(kotlin).toContain("ExoPlayer.Builder(context).build()")
    expect(kotlin).toContain("MediaSession.Builder(context, player).build()")
  })

  it("wires native chrome and explicit D-pad behavior", () => {
    expect(kotlin).toContain("playerView.useController = false")
    expect(kotlin).toContain("contentRoot.addView(playerView)")
    expect(kotlin).toContain("contentRoot.addView(\n      controllerOverlay")
    expect(kotlin).toContain("playerView.isFocusable = false")
    expect(kotlin).toContain("private fun updateFocusGraph()")
    expect(kotlin).toContain("playPauseButton.nextFocusUpId")
    expect(kotlin).toContain("playPauseButton.nextFocusDownId = progressBar.id")
    expect(kotlin).toContain("progressBar.nextFocusLeftId = progressBar.id")
    expect(kotlin).toContain("private fun hideControls()")
    expect(kotlin).toContain("showControls(progressBar)")
    expect(kotlin).toContain("!controllerVisible || isFocused")
    expect(kotlin).toContain(
      "showControls(if (!controllerVisible || isFocused) progressBar else null)",
    )
    expect(kotlin).toContain("OnGlobalFocusChangeListener")
    expect(kotlin).toContain("restoreNativeFocusIfNeeded()")
    expect(kotlin).toContain("isUsableFocus(activeFocus)")
    expect(kotlin).toContain("view.width > 0")
    expect(kotlin).toContain("Playback failed — press Back to exit.")
    expect(kotlin).toContain("showControls(backButton)")
    expect(kotlin).not.toContain("playerView.hasFocus()")
    expect(kotlin).toContain("override fun dispatchKeyEvent")
    expect(kotlin).toContain("KeyEvent.KEYCODE_BACK")
    expect(kotlin).toContain("onDismiss(Unit)")
    expect(kotlin).toContain("handler.postDelayed(hideControllerWork, 3_500)")
    expect(kotlin).toContain("revealKeyCode = event.keyCode")
    expect(kotlin).toContain("if (revealKeyCode == event.keyCode)")
    expect(kotlin).toContain("}, 5_000)")
    expect(kotlin).toContain("seekBy(-10_000)")
    expect(kotlin).toContain("seekBy(10_000)")
    expect(chrome).toContain("class NativeTransportButton")
    expect(chrome).toContain("class NativeMenuButton")
    expect(chrome).toContain("class NativePlayerTimeBar")
  })

  it("wires source and subtitle changes to the existing native player", () => {
    expect(react).toContain("sourceUrl={desiredSource}")
    expect(kotlin).toContain("val preservingPosition = loadedSourceUrl != null")
    expect(kotlin).toContain("if (preservingPosition) player.currentPosition")
    expect(kotlin).toContain(
      "player.setMediaItem(mediaItemBuilder.build(), restorePosition)",
    )
    expect(kotlin).toContain("player.playWhenReady = shouldPlay")
    expect(kotlin).not.toContain("MediaItem.SubtitleConfiguration.Builder")
    expect(kotlin).toContain("assets.subtitles(")
    expect(kotlin).toContain("NativeVttParser.active(")
  })

  it("keeps Audio, Subtitles, Explore, and Up Next in native UI", () => {
    expect(kotlin).toContain('NativeMenuIcon.LANGUAGE, "Language"')
    expect(kotlin).toContain('NativeMenuIcon.SUBTITLES, "Subtitles"')
    expect(kotlin).toContain('NativeMenuIcon.EXPLORE, "Explore"')
    expect(kotlin).toContain('exploreButton.setSubLabel("Scripture & scenes")')
    expect(kotlin).toContain("showNativeChoiceDialog(")
    expect(kotlin).toContain('labels = listOf("Play now", "Not now")')
    expect(kotlin).toContain("var remaining = 8")
    expect(kotlin).toContain("updateNativeChoiceDialogTitle(")
    expect(kotlin).toContain("onAudioChange(NativeSelectionEvent")
    expect(kotlin).toContain("onSubtitleChange(NativeSelectionEvent")
    expect(kotlin).toContain("onPlayNext(NativePlayNextEvent")
  })

  it("connects native events to session, resume, and meaningful playback", () => {
    expect(module).toContain('Name("NativeAndroidPlayer")')
    expect(module).toContain("OnViewDestroys")
    expect(react).toContain("session.setActiveVariantIndex(index)")
    expect(react).toContain("session.setActiveSubtitleSlug(id)")
    expect(react).toContain("onPlaybackPositionRef.current?.(normalized)")
    expect(react).toContain("evaluateMeaningfulPlayback(")
    expect(layout).toContain("shouldUseNativeAndroidPlayer")
    expect(layout).toContain("<NativeAndroidPlayer")
  })
})
