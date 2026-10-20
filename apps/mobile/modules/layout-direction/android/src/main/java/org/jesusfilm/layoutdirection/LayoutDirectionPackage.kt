package org.jesusfilm.layoutdirection

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

class LayoutDirectionPackage : Package {
  override fun createReactActivityLifecycleListeners(
    activityContext: Context,
  ): List<ReactActivityLifecycleListener> = listOf(LaunchListener)
}

/** Applies the saved native mode before any native dialog or sheet exists. */
private object LaunchListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    val mode = LayoutDirectionStore.nativeMode(activity)
    if (mode == null || mode == MODE_NONE) return
    NativeDirection.apply(activity, mode)
  }
}
