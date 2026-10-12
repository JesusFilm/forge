package org.jesusfilm.layoutdirection

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import android.text.TextUtils
import android.view.View
import android.view.ViewTreeObserver
import java.lang.ref.WeakReference
import java.util.Locale
import java.util.WeakHashMap

internal const val MODE_RTL = "rtl"
internal const val MODE_LTR = "ltr"
internal const val MODE_NONE = "none"

/** The durable direction record. Every write uses commit, so a process kill after a save keeps it. */
internal object LayoutDirectionStore {
  private const val PREFS = "org.jesusfilm.layoutdirection"
  private const val KEY_NATIVE_MODE = "nativeMode"
  private const val KEY_RELOAD_COUNT = "reloadCount"
  private const val KEY_RELOAD_KIND = "reloadKind"
  private const val KEY_RELOAD_BUNDLE = "reloadBundle"
  private const val KEY_REPORTED_FAULT = "reportedFault"

  // React Native's own I18nUtil file and keys (0.86.3, I18nUtil.kt). I18nUtil writes them with
  // apply, so this store writes the same keys with commit before a reload.
  private const val RN_PREFS = "com.facebook.react.modules.i18nmanager.I18nUtil"
  private const val RN_KEY_ALLOW_RTL = "RCTI18nUtil_allowRTL"
  private const val RN_KEY_FORCE_RTL = "RCTI18nUtil_forceRTL"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun nativeMode(context: Context): String? = prefs(context).getString(KEY_NATIVE_MODE, null)

  fun state(context: Context): Map<String, Any?> {
    val p = prefs(context)
    return mapOf(
      "nativeMode" to p.getString(KEY_NATIVE_MODE, null),
      "reloadCount" to p.getInt(KEY_RELOAD_COUNT, 0),
      "reloadKind" to p.getString(KEY_RELOAD_KIND, null),
      "reloadBundle" to p.getString(KEY_RELOAD_BUNDLE, null),
      "reportedFault" to p.getString(KEY_REPORTED_FAULT, null),
    )
  }

  fun saveDirection(
    context: Context,
    isRTL: Boolean,
    nativeMode: String,
    reloadCount: Int,
    reloadKind: String?,
    reloadBundle: String?,
  ): Boolean {
    val reactSaved = context.getSharedPreferences(RN_PREFS, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(RN_KEY_ALLOW_RTL, false)
      .putBoolean(RN_KEY_FORCE_RTL, isRTL)
      .commit()
    val ownSaved = prefs(context)
      .edit()
      .putString(KEY_NATIVE_MODE, nativeMode)
      .putInt(KEY_RELOAD_COUNT, reloadCount)
      .putString(KEY_RELOAD_KIND, reloadKind)
      .putString(KEY_RELOAD_BUNDLE, reloadBundle)
      .commit()
    return reactSaved && ownSaved
  }

  fun saveNativeMode(context: Context, nativeMode: String): Boolean =
    prefs(context).edit().putString(KEY_NATIVE_MODE, nativeMode).commit()

  fun saveReportedFault(context: Context, fault: String): Boolean =
    prefs(context).edit().putString(KEY_REPORTED_FAULT, fault).commit()

  fun clearReloadRecord(context: Context): Boolean =
    prefs(context)
      .edit()
      .putInt(KEY_RELOAD_COUNT, 0)
      .remove(KEY_RELOAD_KIND)
      .remove(KEY_RELOAD_BUNDLE)
      .remove(KEY_REPORTED_FAULT)
      .commit()
}

// Gives the Activity window, the configuration that dialogs read, and the default locale one
// direction. Android replaces the activity resources at launch, resume, and configuration
// changes, sometimes with no callback, so a guard checks before each frame.
internal object NativeDirection {
  // Every call runs on the main thread: module functions, the launch listener, and the guard.
  private var appliedMode: String? = null
  private var checkedDefault: Locale? = null
  private var defaultBeforeOverride: Locale? = null
  private var defaultOverride: Locale? = null

  fun apply(activity: Activity, mode: String) {
    appliedMode = mode
    applyNow(activity, mode)
    DirectionGuard.attach(activity)
  }

  /** The guard's check. It only reads, unless Android has replaced a value. */
  fun reassert(activity: Activity) {
    val mode = appliedMode
    if (mode != MODE_RTL && mode != MODE_LTR) return
    val wanted = if (mode == MODE_RTL) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
    val decor = activity.window?.decorView ?: return
    val inPlace = activity.resources.configuration.layoutDirection == wanted &&
      decor.layoutDirection == wanted &&
      Locale.getDefault() === checkedDefault
    if (!inPlace) applyNow(activity, mode)
  }

  private fun applyNow(activity: Activity, mode: String) {
    val decor = activity.window?.decorView ?: return
    val resources = activity.resources
    val config = Configuration(resources.configuration)
    // `none` restores the platform default: the direction of the configuration's own locale.
    val locale = when (mode) {
      MODE_RTL -> RTL_LOCALE
      MODE_LTR -> Locale.ENGLISH
      else -> config.locales[0] ?: Locale.getDefault()
    }
    config.setLayoutDirection(locale)
    if (config.layoutDirection != resources.configuration.layoutDirection) {
      @Suppress("DEPRECATION")
      resources.updateConfiguration(config, resources.displayMetrics)
    }
    decor.layoutDirection = config.layoutDirection
    if (mode == MODE_RTL || mode == MODE_LTR) {
      alignDefaultLocale(config.layoutDirection)
    } else {
      restoreDefaultLocale()
    }
    checkedDefault = Locale.getDefault()
  }

  // AppCompat dialog button bars use `layoutDirection="locale"`, which reads the default locale.
  // Android sets it to the best match among the app's resources (en-US for ps).
  private fun alignDefaultLocale(direction: Int) {
    val current = Locale.getDefault()
    if (TextUtils.getLayoutDirectionFromLocale(current) == direction) return
    // Only the first device locale keeps LocaleList.getDefault() unchanged. Another value
    // moves to its front, and that list sets the default audio language (KTD12).
    val first = LocaleList.getDefault()[0]
    if (TextUtils.getLayoutDirectionFromLocale(first) != direction) return
    defaultBeforeOverride = current
    defaultOverride = first
    Locale.setDefault(first)
  }

  private fun restoreDefaultLocale() {
    val before = defaultBeforeOverride ?: return
    if (Locale.getDefault() == defaultOverride) Locale.setDefault(before)
    defaultBeforeOverride = null
    defaultOverride = null
  }

  private val RTL_LOCALE: Locale = Locale.forLanguageTag("ar")
}

private class DirectionGuard(activity: Activity) : ViewTreeObserver.OnPreDrawListener {
  private val activity = WeakReference(activity)

  // Always draws: a corrected direction requests its own layout for the next frame.
  override fun onPreDraw(): Boolean {
    activity.get()?.let { NativeDirection.reassert(it) }
    return true
  }

  companion object {
    private val guarded = WeakHashMap<Activity, Boolean>()

    fun attach(activity: Activity) {
      if (guarded.containsKey(activity)) return
      val decor = activity.window?.decorView ?: return
      decor.viewTreeObserver.addOnPreDrawListener(DirectionGuard(activity))
      guarded[activity] = true
    }
  }
}
