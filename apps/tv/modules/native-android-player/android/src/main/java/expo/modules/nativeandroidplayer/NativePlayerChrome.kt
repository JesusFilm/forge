package expo.modules.nativeandroidplayer

import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.text.TextPaint
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.view.Window
import android.view.WindowManager
import android.widget.BaseAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.ScrollView
import android.widget.ProgressBar
import android.provider.Settings
import kotlin.math.max
import kotlin.math.min

internal const val NATIVE_PLAYER_ACCENT = 0xFFE1241E.toInt()
internal const val NATIVE_PLAYER_INK = 0xFF0A0A0B.toInt()
internal fun nativePlayerDensity(context: Context): Float = context.resources.displayMetrics.widthPixels / 960f
internal fun TextView.nativeTextSize(size: Float) {
  setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, nativePlayerDensity(context) * size * resources.configuration.fontScale)
}
private const val NATIVE_CHOICE_HEADING_TAG = "native-choice-heading"
private const val NATIVE_CHOICE_LIST_TAG = "native-choice-list"
private const val NATIVE_CHOICE_STATUS_TAG = "native-choice-status"

private fun focusDuration(context: Context): Long =
  if (Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f) 0L else 180L

internal enum class NativeTransportKind {
  REWIND,
  PLAY_PAUSE,
  FORWARD
}

internal class NativeTransportButton(
  context: Context,
  private val kind: NativeTransportKind
) : View(context) {
  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.className = "android.widget.Button"
  }
  private val density = nativePlayerDensity(context)
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    textAlign = Paint.Align.CENTER
  }
  private val iconPath = Path()
  private var playing = true
  private val seekIcon = NativePlayerIcon(context,
    if (kind == NativeTransportKind.FORWARD) R.drawable.native_player_forward_10 else R.drawable.native_player_replay_10)

  init {
    id = generateViewId()
    isFocusable = true
    isFocusableInTouchMode = true
    isClickable = true
    stateListAnimator = null
    contentDescription = when (kind) {
      NativeTransportKind.REWIND -> "Rewind 10 seconds"
      NativeTransportKind.PLAY_PAUSE -> "Pause"
      NativeTransportKind.FORWARD -> "Forward 10 seconds"
    }
  }

  fun setPlaying(value: Boolean) {
    if (playing == value) return
    playing = value
    if (kind == NativeTransportKind.PLAY_PAUSE) {
      contentDescription = if (value) "Pause" else "Play"
      invalidate()
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val size = dp(if (kind == NativeTransportKind.PLAY_PAUSE) 49f else 42f).toInt()
    setMeasuredDimension(size, size)
  }

  override fun onFocusChanged(
    gainFocus: Boolean,
    direction: Int,
    previouslyFocusedRect: android.graphics.Rect?
  ) {
    super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    animate()
      .scaleX(if (gainFocus) 1.07f else 1f)
      .scaleY(if (gainFocus) 1.07f else 1f)
      .setDuration(focusDuration(context))
      .start()
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val cx = width / 2f
    val cy = height / 2f
    val radius = min(width, height) / 2f
    val isPlay = kind == NativeTransportKind.PLAY_PAUSE

    fillPaint.style = Paint.Style.FILL
    fillPaint.color = when {
      isPlay -> NATIVE_PLAYER_ACCENT
      isFocused -> Color.WHITE
      else -> Color.argb(31, 255, 255, 255)
    }
    canvas.drawCircle(cx, cy, radius, fillPaint)

    if (isPlay && isFocused) {
      fillPaint.style = Paint.Style.STROKE
      fillPaint.strokeWidth = dp(2f)
      fillPaint.color = Color.argb(217, 255, 255, 255)
      canvas.drawCircle(cx, cy, radius - dp(1f), fillPaint)
    }

    iconPaint.color = if (!isPlay && isFocused) NATIVE_PLAYER_INK else Color.WHITE
    if (isPlay) {
      drawPlayPause(canvas, cx, cy)
    } else {
      seekIcon.draw(canvas, cx, cy, dp(19f), iconPaint.color)
    }
  }

  private fun drawPlayPause(canvas: Canvas, cx: Float, cy: Float) {
    if (playing) {
      iconPaint.style = Paint.Style.FILL
      val barWidth = dp(5f)
      val barHeight = dp(15f)
      val gap = dp(2f)
      canvas.drawRoundRect(
        cx - gap - barWidth,
        cy - barHeight / 2f,
        cx - gap,
        cy + barHeight / 2f,
        dp(1f),
        dp(1f),
        iconPaint
      )
      canvas.drawRoundRect(
        cx + gap,
        cy - barHeight / 2f,
        cx + gap + barWidth,
        cy + barHeight / 2f,
        dp(1f),
        dp(1f),
        iconPaint
      )
      return
    }

    iconPath.reset()
    iconPath.moveTo(cx - dp(4f), cy - dp(7f))
    iconPath.lineTo(cx + dp(7f), cy)
    iconPath.lineTo(cx - dp(4f), cy + dp(7f))
    iconPath.close()
    iconPaint.style = Paint.Style.FILL
    canvas.drawPath(iconPath, iconPaint)
  }

  private fun dp(value: Float): Float = value * density
}

internal enum class NativeMenuIcon {
  EXPLORE,
  LANGUAGE,
  SUBTITLES,
  START_OVER
}

internal class NativeMenuButton(
  context: Context,
  private val icon: NativeMenuIcon,
  private val label: String
) : View(context) {
  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.className = "android.widget.Button"
  }
  private val density = nativePlayerDensity(context)
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val menuIcon = NativePlayerIcon(context, when (icon) {
    NativeMenuIcon.EXPLORE -> R.drawable.native_player_book
    NativeMenuIcon.LANGUAGE -> R.drawable.native_player_globe
    NativeMenuIcon.SUBTITLES -> R.drawable.native_player_text
    NativeMenuIcon.START_OVER -> R.drawable.native_player_start_over
  })
  private val labelPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    textSize = dp(10f)
  }
  private val subPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    textSize = dp(7f)
  }
  private var subLabel: String? = null

  init {
    id = generateViewId()
    isFocusable = true
    isFocusableInTouchMode = true
    isClickable = true
    stateListAnimator = null
    updateAccessibilityLabel()
  }

  fun setSubLabel(value: String?) {
    if (subLabel == value) return
    subLabel = value
    updateAccessibilityLabel()
    requestLayout()
    invalidate()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val subWidth = subLabel?.let { subPaint.measureText(it) } ?: 0f
    val textWidth = max(labelPaint.measureText(label), subWidth)
    val desiredWidth = kotlin.math.ceil(min(dp(155f), textWidth + dp(42f)).toDouble()).toInt() + 1
    setMeasuredDimension(resolveSize(desiredWidth, widthMeasureSpec), dp(32f).toInt())
  }

  override fun onFocusChanged(
    gainFocus: Boolean,
    direction: Int,
    previouslyFocusedRect: android.graphics.Rect?
  ) {
    super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    animate()
      .scaleX(if (gainFocus) 1.07f else 1f)
      .scaleY(if (gainFocus) 1.07f else 1f)
      .setDuration(focusDuration(context))
      .start()
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    fillPaint.style = Paint.Style.FILL
    fillPaint.color = if (isFocused) Color.WHITE else Color.argb(31, 255, 255, 255)
    canvas.drawRoundRect(
      0f,
      0f,
      width.toFloat(),
      height.toFloat(),
      dp(8f),
      dp(8f),
      fillPaint
    )

    val ink = if (isFocused) NATIVE_PLAYER_INK else Color.WHITE
    labelPaint.color = ink
    subPaint.color = if (isFocused) Color.argb(128, 0, 0, 0) else Color.argb(158, 255, 255, 255)
    menuIcon.draw(canvas, dp(17.5f), height / 2f, dp(13f), ink)

    val textX = dp(31f)
    val availableWidth = width - textX - dp(11f)
    val fittedLabel = android.text.TextUtils.ellipsize(
      label,
      labelPaint,
      availableWidth,
      android.text.TextUtils.TruncateAt.END
    ).toString()
    val sub = subLabel
    if (sub == null) {
      canvas.drawText(fittedLabel, textX, height / 2f + dp(3.5f), labelPaint)
    } else {
      val fittedSub = android.text.TextUtils.ellipsize(
        sub,
        subPaint,
        availableWidth,
        android.text.TextUtils.TruncateAt.END
      ).toString()
      canvas.drawText(fittedLabel, textX, height / 2f - dp(1f), labelPaint)
      canvas.drawText(fittedSub, textX, height / 2f + dp(8.5f), subPaint)
    }
  }

  private fun updateAccessibilityLabel() {
    contentDescription = subLabel?.let { "$label, $it" } ?: label
  }

  private fun dp(value: Float): Float = value * density
}

internal class NativePlayerTimeBar(context: Context) : View(context) {
  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.className = "android.widget.SeekBar"
    info.rangeInfo = AccessibilityNodeInfo.RangeInfo.obtain(
      AccessibilityNodeInfo.RangeInfo.RANGE_TYPE_FLOAT, 0f, durationMs.toFloat(), positionMs.coerceAtMost(durationMs).toFloat())
    info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD)
    info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD)
  }

  override fun performAccessibilityAction(action: Int, arguments: android.os.Bundle?): Boolean {
    if (!isEnabled) return false
    when (action) {
      AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD -> onSeekBackward?.invoke()
      AccessibilityNodeInfo.ACTION_SCROLL_FORWARD -> onSeekForward?.invoke()
      else -> return super.performAccessibilityAction(action, arguments)
    }
    return true
  }
  private val density = nativePlayerDensity(context)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    textAlign = Paint.Align.CENTER
    textSize = dp(9.5f)
  }
  private var positionMs = 0L
  private var durationMs = 0L
  private var bufferedMs = 0L
  var candidateMs: Long? = null
    set(value) { field = value; invalidate() }

  var onSeekBackward: (() -> Unit)? = null
  var onSeekForward: (() -> Unit)? = null
  var onTogglePlayback: (() -> Unit)? = null

  init {
    id = generateViewId()
    isFocusable = true
    isFocusableInTouchMode = true
    contentDescription = "Seek bar, 0:00"
    setOnClickListener { onTogglePlayback?.invoke() }
  }

  fun setPlayback(position: Long, duration: Long, buffered: Long) {
    positionMs = position.coerceAtLeast(0L)
    durationMs = duration.coerceAtLeast(0L)
    bufferedMs = buffered.coerceAtLeast(0L)
    contentDescription = "Seek bar, ${formatTime(positionMs)}"
    invalidate()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), dp(18f).toInt())
  }

  override fun onFocusChanged(
    gainFocus: Boolean,
    direction: Int,
    previouslyFocusedRect: android.graphics.Rect?
  ) {
    super.onFocusChanged(gainFocus, direction, previouslyFocusedRect)
    invalidate()
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    return when (keyCode) {
      KeyEvent.KEYCODE_DPAD_LEFT -> {
        onSeekBackward?.invoke()
        true
      }
      KeyEvent.KEYCODE_DPAD_RIGHT -> {
        onSeekForward?.invoke()
        true
      }
      KeyEvent.KEYCODE_DPAD_CENTER,
      KeyEvent.KEYCODE_ENTER,
      KeyEvent.KEYCODE_NUMPAD_ENTER -> {
        if (event.repeatCount == 0) onTogglePlayback?.invoke()
        true
      }
      else -> super.onKeyDown(keyCode, event)
    }
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean = when (keyCode) {
    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
    KeyEvent.KEYCODE_NUMPAD_ENTER -> true
    else -> super.onKeyUp(keyCode, event)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val fraction = fraction(positionMs)
    val bufferedFraction = fraction(bufferedMs)
    val trackHeight = dp(if (isFocused) 6.5f else 4f)
    val trackY = height / 2f
    val radius = trackHeight / 2f

    paint.style = Paint.Style.FILL
    paint.color = Color.argb(46, 255, 255, 255)
    canvas.drawRoundRect(0f, trackY - radius, width.toFloat(), trackY + radius, radius, radius, paint)

    paint.color = Color.argb(36, 255, 255, 255)
    canvas.drawRoundRect(0f, trackY - radius, width * bufferedFraction, trackY + radius, radius, radius, paint)

    paint.color = NATIVE_PLAYER_ACCENT
    canvas.drawRoundRect(0f, trackY - radius, width * fraction, trackY + radius, radius, radius, paint)

    if (!isFocused) return

    val thumbX = width * fraction(candidateMs ?: positionMs)
    paint.color = Color.WHITE
    canvas.drawCircle(thumbX, trackY, dp(5.5f), paint)
    if (candidateMs != null) return

    val bubbleWidth = dp(55f)
    val bubbleHeight = dp(22f)
    val bubbleCenter = thumbX.coerceIn(bubbleWidth / 2f, width - bubbleWidth / 2f)
    val bubbleBottom = trackY - dp(11f)
    val bubble = RectF(
      bubbleCenter - bubbleWidth / 2f,
      bubbleBottom - bubbleHeight,
      bubbleCenter + bubbleWidth / 2f,
      bubbleBottom
    )
    paint.color = Color.argb(235, 28, 28, 30)
    canvas.drawRoundRect(bubble, dp(5.5f), dp(5.5f), paint)
    val baseline = bubble.centerY() - (textPaint.ascent() + textPaint.descent()) / 2f
    canvas.drawText(formatTime(positionMs), bubble.centerX(), baseline, textPaint)
  }

  private fun fraction(value: Long): Float {
    if (durationMs <= 0) return 0f
    return (value.coerceIn(0L, durationMs).toDouble() / durationMs).toFloat()
  }

  private fun formatTime(timeMs: Long): String {
    val totalSeconds = (timeMs.coerceAtLeast(0L) / 1000).toInt()
    val hours = totalSeconds / 3600
    val minutes = totalSeconds / 60 % 60
    val seconds = totalSeconds % 60
    return (if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}" else "$minutes") +
      ":${seconds.toString().padStart(2, '0')}"
  }

  private fun dp(value: Float): Float = value * density
}

internal fun showNativeChoiceDialog(
  context: Context,
  title: String,
  labels: List<String>,
  selected: Int,
  onChoice: (Int) -> Unit,
  onDismiss: () -> Unit,
  status: String? = null,
  disabledIndices: Set<Int> = emptySet(),
  showClose: Boolean = true,
  loading: Boolean = false
): Dialog {
  val density = nativePlayerDensity(context)
  fun dp(value: Int): Int = (value * density).toInt()

  val dialog = Dialog(context)
  dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)

  val root = FrameLayout(context).apply {
    setBackgroundColor(Color.argb(204, 0, 0, 0))
  }
  val panel = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(7), dp(7), dp(7), dp(7))
    background = GradientDrawable().apply {
      setColor(Color.argb(if (loading) 255 else 245, 28, 28, 30))
      cornerRadius = dp(12).toFloat()
      setStroke(max(1, dp(1) / 2), Color.argb(26, 255, 255, 255))
    }
    elevation = dp(22).toFloat()
  }

  val heading = TextView(context).apply {
    tag = NATIVE_CHOICE_HEADING_TAG
    nativeTextSize(13f)
    setTypeface(Typeface.DEFAULT, Typeface.BOLD)
    setTextColor(Color.WHITE)
    gravity = Gravity.CENTER_VERTICAL
    setPadding(dp(10), 0, dp(10), 0)
    maxLines = if (title.contains('\n')) 2 else 1
    ellipsize = android.text.TextUtils.TruncateAt.END
  }
  setNativeChoiceHeading(heading, title)
  panel.addView(
    heading,
    LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      dp(if (title.contains('\n')) 52 else 32)
    )
  )

  val list = ListView(context).apply {
    tag = NATIVE_CHOICE_LIST_TAG
    id = View.generateViewId()
    divider = null
    selector = ColorDrawable(Color.TRANSPARENT)
    choiceMode = ListView.CHOICE_MODE_SINGLE
    adapter = NativeChoiceAdapter(context, labels, selected, disabledIndices,
      if (title == "Audio Language") R.drawable.native_player_globe else if (title == "Subtitles") R.drawable.native_player_text else null)
    isFocusable = true
    isFocusableInTouchMode = true
    contentDescription = title
  }
  if (loading) {
    panel.addView(ProgressBar(context).apply {
      indeterminateTintList = ColorStateList.valueOf(NATIVE_PLAYER_ACCENT)
      contentDescription = title
    }, LinearLayout.LayoutParams(dp(28), dp(28)).apply {
      gravity = Gravity.CENTER_HORIZONTAL
      topMargin = dp(12)
      bottomMargin = dp(16)
    })
  }
  val statusView = TextView(context).apply {
    tag = NATIVE_CHOICE_STATUS_TAG
    text = status.orEmpty()
    visibility = if (status.isNullOrEmpty()) View.GONE else View.VISIBLE
    setTextColor(Color.LTGRAY)
    nativeTextSize(11f)
    setPadding(dp(10), dp(8), dp(10), dp(8))
  }
  panel.addView(statusView, LinearLayout.LayoutParams(-1, -2))
  val visibleRows = min(9, max(1, labels.size))
  panel.addView(
    list,
    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, visibleRows * dp(32))
  )

  val close = TextView(context).apply {
    id = View.generateViewId()
    text = "✕  Close"
    nativeTextSize(12f)
    setTypeface(Typeface.DEFAULT, Typeface.NORMAL)
    gravity = Gravity.CENTER_VERTICAL
    setPadding(dp(10), 0, dp(10), 0)
    isFocusable = true
    isFocusableInTouchMode = true
    isClickable = true
    contentDescription = "Close menu"
    setTextColor(focusTextColors())
    background = focusBackground(dp(7).toFloat())
    setOnClickListener { dialog.dismiss() }
    visibility = if (showClose) View.VISIBLE else View.GONE
  }
  panel.addView(
    close,
    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(32)).apply {
      topMargin = dp(3)
    }
  )

  root.addView(
    panel,
    FrameLayout.LayoutParams(dp(300), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      gravity = Gravity.CENTER
    }
  )
  dialog.setContentView(root)
  dialog.setOnDismissListener { onDismiss() }
  list.setOnItemClickListener { _, _, position, _ ->
    onChoice(position)
    dialog.dismiss()
  }
  list.nextFocusDownId = close.id
  close.nextFocusUpId = list.id

  dialog.show()
  dialog.window?.apply {
    setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
    clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
  }
  list.post {
    val position = selected.takeIf { it in labels.indices && it !in disabledIndices }
      ?: labels.indices.firstOrNull { it !in disabledIndices }
    if (position == null) {
      close.requestFocus()
      return@post
    }
    list.requestFocus()
    list.setSelection(position)
    list.setItemChecked(position, true)
  }
  return dialog
}

internal fun updateNativeChoiceDialogTitle(dialog: Dialog?, title: String) {
  val heading = dialog?.window?.decorView?.findViewWithTag<TextView>(NATIVE_CHOICE_HEADING_TAG)
    ?: return
  setNativeChoiceHeading(heading, title)
}

private fun setNativeChoiceHeading(heading: TextView, title: String) {
  val newline = title.indexOf('\n')
  if (newline < 0) {
    heading.text = title
    return
  }
  val text = SpannableString(title)
  text.setSpan(RelativeSizeSpan(0.55f), 0, newline, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  text.setSpan(
    ForegroundColorSpan(Color.argb(166, 255, 255, 255)),
    0,
    newline,
    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
  )
  heading.text = text
}

internal class NativeChoiceAdapter(
  private val context: Context,
  private var labels: List<String>,
  private var activeIndex: Int,
  private val disabledIndices: Set<Int> = emptySet(),
  private val iconResource: Int? = null
) : BaseAdapter() {
  private val density = nativePlayerDensity(context)

  override fun getCount(): Int = labels.size
  override fun getItem(position: Int): String = labels[position]
  override fun getItemId(position: Int): Long = position.toLong()
  override fun areAllItemsEnabled(): Boolean = disabledIndices.isEmpty()
  override fun isEnabled(position: Int): Boolean = position !in disabledIndices

  override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
    val row = (convertView as? LinearLayout) ?: createRow()
    val label = row.getChildAt(0) as TextView
    val check = row.getChildAt(1) as TextView
    label.text = labels[position]
    check.text = if (position == activeIndex) "✓" else ""
    row.contentDescription = labels[position]
    row.alpha = if (isEnabled(position)) 1f else 0.35f
    return row
  }

  private fun createRow(): LinearLayout {
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(10), 0, dp(10), 0)
      background = focusBackground(dp(7).toFloat())
      layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(32))
    }
    val label = TextView(context).apply {
      isDuplicateParentStateEnabled = true
      gravity = Gravity.CENTER_VERTICAL
      iconResource?.let { resource ->
        compoundDrawablePadding = dp(6)
        setCompoundDrawables(requireNotNull(context.getDrawable(resource)).mutate().apply {
          setBounds(0, 0, dp(12), dp(12))
          setTintList(focusTextColors())
        }, null, null, null)
      }
      nativeTextSize(12f)
      setTypeface(Typeface.DEFAULT, Typeface.NORMAL)
      setTextColor(focusTextColors())
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    row.addView(label, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
    val check = TextView(context).apply {
      isDuplicateParentStateEnabled = true
      nativeTextSize(13f)
      setTypeface(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
      setTextColor(
        ColorStateList(
          arrayOf(intArrayOf(android.R.attr.state_selected), intArrayOf()),
          intArrayOf(NATIVE_PLAYER_ACCENT, NATIVE_PLAYER_ACCENT)
        )
      )
    }
    row.addView(check, LinearLayout.LayoutParams(dp(24), LinearLayout.LayoutParams.MATCH_PARENT))
    return row
  }

  private fun dp(value: Int): Int = (value * density).toInt()
}

internal class NativeExploreDialog(
  context: Context,
  private val getPosition: () -> Double,
  private val onSeek: (Double) -> Unit,
  onDismiss: () -> Unit
) : Dialog(context) {
  private val density = nativePlayerDensity(context)
  private val currentMoment = textView(9f)
  private val statusView = textView(10f)
  private val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
  private var contentKey: String? = null
  private var sceneChecks = emptyList<Pair<Double, TextView>>()
  private var focusFirstScene = true

  init {
    requestWindowFeature(Window.FEATURE_NO_TITLE)
    val root = FrameLayout(context).apply { setBackgroundColor(Color.argb(204, 0, 0, 0)) }
    val panel = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(7), dp(7), dp(7), dp(7))
      background = GradientDrawable().apply {
        setColor(Color.argb(245, 28, 28, 30))
        cornerRadius = dp(12).toFloat()
      }
    }
    panel.addView(textView(13f).apply {
      text = "Explore"
      setTypeface(Typeface.DEFAULT, Typeface.BOLD)
    })
    val content = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      addView(statusView)
      addView(currentMoment)
      addView(body)
    }
    val scroll = ScrollView(context).apply {
      id = View.generateViewId()
      isFocusable = true
      addView(content)
    }
    panel.addView(scroll, LinearLayout.LayoutParams(-1, dp(285)))
    val close = textView(12f).apply {
      id = View.generateViewId()
      text = "✕  Close"
      contentDescription = "Close menu"
      isFocusable = true
      isClickable = true
      setTextColor(focusTextColors())
      background = focusBackground(dp(7).toFloat())
      setOnClickListener { dismiss() }
    }
    panel.addView(close)
    scroll.nextFocusDownId = close.id
    close.nextFocusUpId = scroll.id
    root.addView(panel, FrameLayout.LayoutParams(dp(300), -2, Gravity.CENTER))
    setContentView(root)
    setOnDismissListener { onDismiss() }
    setOnShowListener {
      window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      window?.setLayout(-1, -1)
      window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
      close.requestFocus()
    }
  }

  fun updateContent(
    currentText: String?,
    moments: List<NativePlayerMoment>,
    summaries: List<String>,
    questions: List<String>,
    status: String?
  ) {
    val current = SpannableString(currentText.orEmpty())
    val firstLine = currentText?.indexOf('\n') ?: -1
    if (firstLine > 0) {
      current.setSpan(RelativeSizeSpan(0.75f), 0, firstLine, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      current.setSpan(ForegroundColorSpan(Color.LTGRAY), 0, firstLine, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    currentMoment.text = current
    currentMoment.visibility = if (currentText.isNullOrBlank()) View.GONE else View.VISIBLE
    statusView.text = status.orEmpty()
    statusView.visibility = if (status.isNullOrBlank()) View.GONE else View.VISIBLE
    val key = moments.joinToString { "${it.id}:${it.label}" } + summaries.joinToString() + questions.joinToString()
    if (key != contentKey) {
      contentKey = key
      body.removeAllViews()
      val checks = mutableListOf<Pair<Double, TextView>>()
      if (moments.isNotEmpty()) body.addView(section("Scenes"))
      moments.forEach { moment ->
        val row = LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          isFocusable = true
          isClickable = true
          contentDescription = "Jump to ${moment.detail}"
          background = focusBackground(dp(7).toFloat())
          setOnClickListener { onSeek(moment.startSeconds) }
        }
        val caption = LinearLayout(context).apply {
          orientation = LinearLayout.VERTICAL
          isDuplicateParentStateEnabled = true
        }
        caption.addView(textView(12f).apply {
          text = moment.label
          maxLines = 2
          ellipsize = android.text.TextUtils.TruncateAt.END
          isDuplicateParentStateEnabled = true
          setTextColor(focusTextColors())
        })
        caption.addView(textView(8f).apply {
          text = moment.detail
          setTextColor(Color.GRAY)
          setPadding(dp(10), 0, dp(10), dp(7))
        })
        row.addView(caption, LinearLayout.LayoutParams(0, -2, 1f))
        val check = textView(13f).apply { setTextColor(NATIVE_PLAYER_ACCENT) }
        row.addView(check, LinearLayout.LayoutParams(dp(28), -2))
        checks.add(moment.startSeconds to check)
        body.addView(row)
      }
      sceneChecks = checks
      if (summaries.isNotEmpty()) body.addView(section("Explore this story"))
      summaries.forEach { summary -> body.addView(textView(8f).apply { text = summary }) }
      if (questions.isNotEmpty()) body.addView(section("Questions to consider"))
      questions.forEach { question -> body.addView(textView(8f).apply { text = question }) }
      if (focusFirstScene && moments.isNotEmpty()) {
        focusFirstScene = false
        body.post { body.getChildAt(1)?.requestFocus() }
      }
    }
    val active = sceneChecks.indexOfLast { it.first <= getPosition() }
    sceneChecks.forEachIndexed { index, (_, check) -> check.text = if (index == active) "✓" else "" }
  }

  private fun section(value: String): TextView = textView(7f).apply {
    text = value.uppercase()
    setTextColor(Color.LTGRAY)
  }

  private fun textView(size: Float): TextView = TextView(context).apply {
    textSize = size
    setTextColor(Color.WHITE)
    setPadding(dp(10), dp(7), dp(10), dp(7))
  }

  private fun dp(value: Int): Int = (value * density).toInt()
}

private fun focusTextColors(): ColorStateList {
  return ColorStateList(
    arrayOf(
      intArrayOf(android.R.attr.state_focused),
      intArrayOf(android.R.attr.state_selected),
      intArrayOf()
    ),
    intArrayOf(NATIVE_PLAYER_INK, NATIVE_PLAYER_INK, Color.WHITE)
  )
}

private fun focusBackground(radius: Float): StateListDrawable {
  return StateListDrawable().apply {
    addState(
      intArrayOf(android.R.attr.state_focused),
      GradientDrawable().apply {
        setColor(Color.WHITE)
        cornerRadius = radius
      }
    )
    addState(
      intArrayOf(android.R.attr.state_selected),
      GradientDrawable().apply {
        setColor(Color.WHITE)
        cornerRadius = radius
      }
    )
    addState(
      intArrayOf(),
      GradientDrawable().apply {
        setColor(Color.TRANSPARENT)
        cornerRadius = radius
      }
    )
  }
}
