package expo.modules.nativeandroidplayer

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

object StartupLoadingOverlay {
  private const val TAG = "forge-startup-loading"

  @JvmStatic fun show(activity: Activity) {
    val root = activity.window.decorView as ViewGroup
    if (root.findViewWithTag<View>(TAG) != null) return
    root.addView(StartupLoadingView(activity).apply { tag = TAG }, ViewGroup.LayoutParams(-1, -1))
  }

  @JvmStatic fun hide(activity: Activity) {
    val root = activity.window.decorView as ViewGroup
    root.findViewWithTag<View>(TAG)?.let { root.removeView(it) }
    activity.findViewById<View>(android.R.id.content)?.requestFocus()
  }
}

private class StartupLoadingView(private val activity: Activity) : FrameLayout(activity) {
  private val back = TextView(activity)
  private var observer: ViewTreeObserver? = null
  private val backCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() { activity.finish() }
  }
  private val focusGuard = ViewTreeObserver.OnGlobalFocusChangeListener { _, focused ->
    if (isShown && hasWindowFocus() && focused !== back) back.requestFocus()
  }

  init {
    setBackgroundColor(NATIVE_PLAYER_INK)
    isClickable = true
    val column = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
    }
    column.addView(ProgressBar(activity).apply {
      indeterminateTintList = ColorStateList.valueOf(NATIVE_PLAYER_ACCENT)
      contentDescription = "Starting app"
    }, LinearLayout.LayoutParams(dp(36), dp(36)))
    column.addView(TextView(activity).apply {
      text = "Starting app…"
      nativeTextSize(16f)
      setTypeface(Typeface.DEFAULT, Typeface.BOLD)
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
    }, LinearLayout.LayoutParams(-1, dp(40)).apply { topMargin = dp(12) })
    back.apply {
      id = View.generateViewId()
      text = "Back"
      contentDescription = "Back"
      nativeTextSize(13f)
      gravity = Gravity.CENTER
      setTextColor(NATIVE_PLAYER_INK)
      background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(8).toFloat() }
      isFocusable = true
      isFocusableInTouchMode = true
      isClickable = true
      nextFocusUpId = id
      nextFocusDownId = id
      nextFocusLeftId = id
      nextFocusRightId = id
      setOnClickListener { activity.finish() }
    }
    column.addView(back, LinearLayout.LayoutParams(dp(160), dp(36)).apply { topMargin = dp(18) })
    addView(column, LayoutParams(dp(350), -2, Gravity.CENTER))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    observer = viewTreeObserver.also { it.addOnGlobalFocusChangeListener(focusGuard) }
    if (activity is ComponentActivity) activity.onBackPressedDispatcher.addCallback(activity, backCallback)
    back.requestFocus()
  }

  override fun onDetachedFromWindow() {
    observer?.takeIf { it.isAlive }?.removeOnGlobalFocusChangeListener(focusGuard)
    observer = null
    backCallback.remove()
    super.onDetachedFromWindow()
  }

  private fun dp(value: Int): Int = (value * nativePlayerDensity(activity)).toInt()
}
