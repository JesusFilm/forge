package expo.modules.nativeandroidplayer

import android.app.Dialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

internal class NativeFeedbackQrDialog(
  context: Context,
  onRetry: () -> Unit,
  onClose: () -> Unit,
) : Dialog(context) {
  private val message = TextView(context)
  private val reference = TextView(context)
  private val image = ImageView(context)
  private val retry = Button(context)
  private val density = context.resources.displayMetrics.density
  private fun dp(value: Int) = (value * density).toInt()

  init {
    window?.setBackgroundDrawable(ColorDrawable(Color.rgb(8, 8, 10)))
    val body = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(65), dp(40), dp(65), dp(40))
      setBackgroundColor(Color.rgb(8, 8, 10))
    }
    val close = Button(context).apply {
      text = "‹ Back"
      textSize = 20f
      setOnClickListener { dismiss() }
    }
    body.addView(close, LinearLayout.LayoutParams(dp(150), dp(58)))
    val content = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val copy = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    val title = TextView(context).apply {
      text = "The beta testing"
      textSize = 34f
      setTextColor(Color.WHITE)
      setTypeface(Typeface.DEFAULT, Typeface.BOLD)
    }
    copy.addView(title)
    message.textSize = 19f
    message.setTextColor(Color.LTGRAY)
    copy.addView(message, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(130)))
    retry.text = "Try again"
    retry.setOnClickListener { onRetry() }
    copy.addView(retry, LinearLayout.LayoutParams(dp(180), dp(58)))
    content.addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    val qrColumn = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
    }
    image.scaleType = ImageView.ScaleType.FIT_CENTER
    qrColumn.addView(image, LinearLayout.LayoutParams(dp(290), dp(290)))
    reference.textSize = 17f
    reference.setTextColor(Color.LTGRAY)
    qrColumn.addView(reference)
    content.addView(qrColumn, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    body.addView(content)
    setContentView(body)
    setOnDismissListener { onClose() }
    setOnShowListener {
      window?.setLayout((context.resources.displayMetrics.widthPixels * 0.82).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
      close.requestFocus()
    }
    update(emptyList(), null, loading = true, error = false)
  }

  fun update(rows: List<String>, code: String?, loading: Boolean, error: Boolean) {
    image.setImageBitmap(qrBitmap(rows))
    reference.text = code?.let { "Reference $it" }.orEmpty()
    retry.visibility = if (error) View.VISIBLE else View.GONE
    message.text = when {
      error -> "Verified feedback is unavailable. Please try again."
      loading || image.drawable == null -> "Verifying this TV…"
      else -> "Scan with your phone to report an issue or share an idea."
    }
  }

  private fun qrBitmap(rows: List<String>): Bitmap? {
    val count = rows.size
    if (count !in 21..177 || rows.any { row -> row.length != count || row.any { it != '0' && it != '1' } }) return null
    val quiet = 4
    val pixels = count + quiet * 2
    val colors = IntArray(pixels * pixels) { Color.WHITE }
    rows.forEachIndexed { y, row ->
      row.forEachIndexed { x, bit ->
        if (bit == '1') colors[(y + quiet) * pixels + x + quiet] = Color.BLACK
      }
    }
    return Bitmap.createBitmap(colors, pixels, pixels, Bitmap.Config.ARGB_8888)
  }
}
