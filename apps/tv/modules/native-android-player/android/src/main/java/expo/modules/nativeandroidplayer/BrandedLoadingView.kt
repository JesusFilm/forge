package expo.modules.nativeandroidplayer

import android.animation.ValueAnimator
import android.app.Dialog
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.view.KeyEvent
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import kotlin.math.cos

internal class BrandedLoadingView(
  context: Context,
  label: String,
  private val transparent: Boolean = false,
) : View(context) {
  private val logo by lazy { BitmapFactory.decodeResource(resources, R.drawable.watch_loading_logo) }
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private var phase = 0f
  private val pulse = ValueAnimator.ofFloat(0f, 1f).apply {
    duration = 1800
    repeatCount = ValueAnimator.INFINITE
    interpolator = LinearInterpolator()
    addUpdateListener { phase = it.animatedValue as Float; invalidate() }
  }

  init {
    setBackgroundColor(if (transparent) Color.TRANSPARENT else Color.rgb(22, 19, 17))
    contentDescription = label
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    isFocusable = true
    isFocusableInTouchMode = true
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (transparent) return
    val unit = width / 1920f
    val size = 320f * unit
    val left = (width - size) / 2f
    val top = (height - 358f * unit) / 2f
    paint.alpha = 255
    canvas.drawBitmap(logo, null, RectF(left, top, left + size, top + size), paint)
    paint.color = Color.rgb(241, 44, 62)
    for (index in 0..2) {
      val wave = (1f - cos((phase - index / 9f) * 2f * Math.PI).toFloat()) / 2f
      paint.alpha = if (animationsEnabled()) (76 + 179 * wave).toInt() else 255
      canvas.drawCircle(width / 2f + (index - 1) * 30f * unit, top + size + 31f * unit, 7f * unit, paint)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!transparent && isShown && animationsEnabled()) pulse.start()
  }

  override fun onVisibilityAggregated(isVisible: Boolean) {
    super.onVisibilityAggregated(isVisible)
    if (!isAttachedToWindow) return
    if (!transparent && isVisible && animationsEnabled()) {
      if (!pulse.isStarted) pulse.start()
    } else pulse.cancel()
  }

  private fun animationsEnabled(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled()

  override fun onDetachedFromWindow() {
    pulse.cancel()
    super.onDetachedFromWindow()
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    if (event.keyCode in listOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
        KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN,
        KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT)) true
    else super.dispatchKeyEvent(event)
}

internal fun showBrandedLoadingDialog(
  context: Context,
  label: String,
  onDismiss: () -> Unit,
  transparent: Boolean = false,
): Dialog {
  val dialog = Dialog(context)
  dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
  val content = BrandedLoadingView(context, label, transparent = transparent)
  dialog.setContentView(content)
  dialog.setCancelable(true)
  dialog.setCanceledOnTouchOutside(false)
  dialog.setOnDismissListener { onDismiss() }
  dialog.window?.apply {
    setBackgroundDrawable(ColorDrawable(if (transparent) Color.TRANSPARENT else Color.rgb(22, 19, 17)))
    if (transparent) clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
  }
  dialog.show()
  dialog.window?.setLayout(-1, -1)
  content.requestFocus()
  return dialog
}

internal object PlaybackLoadingCover {
  private var dialog: Dialog? = null

  fun show(context: Context, onCancel: () -> Unit) {
    hide()
    val next = showBrandedLoadingDialog(context, "Preparing playback", {})
    dialog = next
    next.setOnCancelListener { onCancel() }
    next.setOnDismissListener { if (dialog === next) dialog = null }
  }

  fun hide() {
    dialog?.dismiss()
    dialog = null
  }
}
