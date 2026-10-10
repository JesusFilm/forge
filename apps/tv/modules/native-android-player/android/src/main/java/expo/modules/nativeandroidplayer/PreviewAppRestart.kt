package expo.modules.nativeandroidplayer

import android.app.Activity
import com.facebook.react.ReactApplication

object PreviewAppRestart {
  private var restartingActivity: Activity? = null

  fun restart(activity: Activity) {
    restartingActivity = activity
    activity.recreate()
  }

  @JvmStatic fun onActivityDestroyed(activity: Activity) {
    if (restartingActivity !== activity) return
    restartingActivity = null
    // ReactActivity must detach the old root before its host is invalidated.
    (activity.application as ReactApplication).reactNativeHost.clear()
  }
}
