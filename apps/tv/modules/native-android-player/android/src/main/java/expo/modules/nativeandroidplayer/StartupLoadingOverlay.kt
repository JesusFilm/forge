package expo.modules.nativeandroidplayer

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
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
  private val loading = BrandedLoadingView(activity, "Starting app")
  private var observer: ViewTreeObserver? = null
  private val backCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() { activity.finish() }
  }
  private val focusGuard = ViewTreeObserver.OnGlobalFocusChangeListener { _, focused ->
    if (isShown && hasWindowFocus() && focused !== loading) loading.requestFocus()
  }

  init {
    isClickable = true
    addView(loading, LayoutParams(-1, -1))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    observer = viewTreeObserver.also { it.addOnGlobalFocusChangeListener(focusGuard) }
    if (activity is ComponentActivity) activity.onBackPressedDispatcher.addCallback(activity, backCallback)
    loading.requestFocus()
  }

  override fun onDetachedFromWindow() {
    observer?.takeIf { it.isAlive }?.removeOnGlobalFocusChangeListener(focusGuard)
    observer = null
    backCallback.remove()
    super.onDetachedFromWindow()
  }
}
