package expo.modules.nativeandroidplayer

import android.os.SystemClock
import android.util.Log

internal object NativePlaybackTrace {
  var enabled = false
  fun mark(stage: String) {
    if (enabled) Log.i("WatchTvPerf", "$stage ${SystemClock.uptimeMillis()}")
  }
}
