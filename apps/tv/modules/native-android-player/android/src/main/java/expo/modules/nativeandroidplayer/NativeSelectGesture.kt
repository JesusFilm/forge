package expo.modules.nativeandroidplayer

internal enum class NativeSelectAction { PASS, CONSUME, TOGGLE, REVEAL }

/** Own the whole intercepted Select gesture even after focus moves into chrome. */
internal class NativeSelectGesture {
  private var capturedKey: Int? = null

  fun handle(keyCode: Int, down: Boolean, repeatCount: Int, intercept: Boolean,
    playbackError: Boolean): NativeSelectAction {
    if (down && repeatCount == 0) {
      // A fresh press recovers from a missing UP without retaining stale ownership.
      capturedKey = if (intercept) keyCode else null
      return if (!intercept) NativeSelectAction.PASS
        else if (playbackError) NativeSelectAction.REVEAL else NativeSelectAction.TOGGLE
    }
    if (capturedKey == keyCode) {
      if (!down) capturedKey = null
      return NativeSelectAction.CONSUME
    }
    // An inherited repeat or orphan UP must never activate hidden/root controls.
    return if (intercept) NativeSelectAction.CONSUME else NativeSelectAction.PASS
  }
}
