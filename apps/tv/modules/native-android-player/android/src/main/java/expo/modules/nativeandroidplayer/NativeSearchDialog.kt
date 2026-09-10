package expo.modules.nativeandroidplayer

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.text.Editable
import android.text.TextWatcher
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView

internal class NativeSearchDialog(
  context: Context,
  title: String,
  private val onChoice: (String) -> Unit,
  onClosed: () -> Unit
) : Dialog(context) {
  private val list = ListView(context)
  private val search = EditText(context)
  private val statusView = TextView(context)
  private val close = TextView(context)
  private var rows = emptyList<NativeChoiceRow>()
  private var visibleRows = emptyList<NativeChoiceRow>()
  private var activeId: String? = null
  private var status: String? = null
  private val icon = if (title == "Subtitles") R.drawable.native_player_text else R.drawable.native_player_globe

  init {
    requestWindowFeature(Window.FEATURE_NO_TITLE)
    val root = FrameLayout(context).apply { setBackgroundColor(Color.argb(185, 0, 0, 0)) }
    val panel = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(18), dp(16), dp(18), dp(12))
      background = GradientDrawable().apply { setColor(NATIVE_PLAYER_INK); cornerRadius = dp(12).toFloat() }
    }
    panel.addView(TextView(context).apply {
      text = title
      nativeTextSize(17f)
      setTypeface(Typeface.DEFAULT, Typeface.BOLD)
      setTextColor(Color.WHITE)
    }, LinearLayout.LayoutParams(-1, dp(34)))
    search.apply {
      id = View.generateViewId()
      hint = if (title == "Subtitles") "Search subtitle languages" else "Search audio languages"
      contentDescription = hint
      nativeTextSize(12f)
      isSingleLine = true
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
      imeOptions = EditorInfo.IME_ACTION_SEARCH or EditorInfo.IME_FLAG_NO_EXTRACT_UI
      setTextColor(Color.WHITE)
      setHintTextColor(Color.LTGRAY)
      setPadding(dp(10), 0, dp(10), 0)
      background = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), GradientDrawable().apply {
          setColor(Color.rgb(55, 55, 60)); cornerRadius = dp(6).toFloat(); setStroke(dp(1), Color.WHITE)
        })
        addState(intArrayOf(), ColorDrawable(Color.rgb(28, 28, 31)))
      }
      setOnClickListener {
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
          .showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
      }
      setOnEditorActionListener { _, action, _ ->
        if (action != EditorInfo.IME_ACTION_SEARCH) false else {
          (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
            .hideSoftInputFromWindow(windowToken, 0)
          if (visibleRows.any { !it.disabled }) list.requestFocus() else close.requestFocus()
          true
        }
      }
      addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { render() }
        override fun afterTextChanged(s: Editable?) = Unit
      })
    }
    panel.addView(search, LinearLayout.LayoutParams(-1, dp(36)))
    panel.addView(TextView(context).apply {
      text = "← Search     → Close"
      nativeTextSize(9f)
      setTextColor(Color.LTGRAY)
      gravity = Gravity.CENTER_VERTICAL
    }, LinearLayout.LayoutParams(-1, dp(22)))
    statusView.apply { nativeTextSize(11f); setTextColor(Color.LTGRAY); setPadding(0, dp(6), 0, dp(6)) }
    panel.addView(statusView, LinearLayout.LayoutParams(-1, -2))
    list.apply {
      id = View.generateViewId()
      divider = null
      selector = ColorDrawable(Color.TRANSPARENT)
      choiceMode = ListView.CHOICE_MODE_SINGLE
      isFocusable = true
      isFocusableInTouchMode = true
      setOnItemClickListener { _, _, index, _ ->
        val row = visibleRows.getOrNull(index)
        if (row != null && !row.disabled) { onChoice(row.id); dismiss() }
      }
      setOnKeyListener { _, code, event ->
        when {
          event.action != KeyEvent.ACTION_DOWN -> false
          code == KeyEvent.KEYCODE_DPAD_LEFT || (code == KeyEvent.KEYCODE_DPAD_UP && selectedItemPosition <= 0) -> {
            search.requestFocus(); true
          }
          code == KeyEvent.KEYCODE_DPAD_RIGHT -> { close.requestFocus(); true }
          else -> false
        }
      }
    }
    panel.addView(list, LinearLayout.LayoutParams(-1, 0, 1f))
    close.apply {
      id = View.generateViewId()
      text = "Close"
      contentDescription = "Close menu"
      nativeTextSize(12f)
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(10), 0, dp(10), 0)
      isFocusable = true
      isClickable = true
      setTextColor(Color.WHITE)
      background = StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), ColorDrawable(Color.WHITE))
        addState(intArrayOf(), ColorDrawable(Color.TRANSPARENT))
      }
      setOnFocusChangeListener { _, focused -> setTextColor(if (focused) NATIVE_PLAYER_INK else Color.WHITE) }
      setOnClickListener { dismiss() }
    }
    panel.addView(close, LinearLayout.LayoutParams(-1, dp(34)))
    root.addView(panel, FrameLayout.LayoutParams(dp(380), (context.resources.displayMetrics.heightPixels * 0.8).toInt(), Gravity.CENTER))
    root.addOnLayoutChangeListener { _, _, top, _, bottom, _, _, _, _ ->
      val available = minOf((context.resources.displayMetrics.heightPixels * 0.8).toInt(), bottom - top - dp(20))
      if (available > 0 && panel.layoutParams.height != available) {
        panel.layoutParams = panel.layoutParams.apply { height = available }
      }
    }
    setContentView(root)
    setOnDismissListener { onClosed() }
    search.nextFocusUpId = search.id
    search.nextFocusDownId = list.id
    list.nextFocusUpId = search.id
    list.nextFocusDownId = close.id
    close.nextFocusUpId = list.id
    close.nextFocusDownId = close.id
    close.nextFocusLeftId = list.id
  }

  fun update(options: List<NativeChoiceRow>, selectedId: String?, message: String?) {
    rows = options
    activeId = selectedId
    status = message
    render()
  }

  override fun show() {
    super.show()
    window?.apply {
      setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
      setLayout(-1, -1)
      clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
      setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
    }
    list.post {
      val selected = visibleRows.indexOfFirst { it.id == activeId && !it.disabled }
        .takeIf { it >= 0 } ?: visibleRows.indexOfFirst { !it.disabled }
      if (selected < 0) search.requestFocus() else { list.requestFocus(); list.setSelection(selected) }
    }
  }

  private fun render() {
    val focusedId = visibleRows.getOrNull(list.selectedItemPosition)?.id
    visibleRows = filterNativeChoices(rows, search.text.toString())
    val selected = visibleRows.indexOfFirst { it.id == activeId }
    list.adapter = NativeChoiceAdapter(context,
      visibleRows.map { if (it.detail.isBlank() || it.detail.equals(it.label, true)) it.label else "${it.label} · ${it.detail}" },
      selected, visibleRows.indices.filter { visibleRows[it].disabled }.toSet(), icon)
    val restore = visibleRows.indexOfFirst { it.id == focusedId }.takeIf { it >= 0 }
      ?: selected.takeIf { it >= 0 } ?: visibleRows.indexOfFirst { !it.disabled }
    if (restore >= 0) list.setSelection(restore)
    val message = status ?: if (visibleRows.none { !it.pinned } && search.text.isNotBlank()) "No matching languages" else null
    statusView.text = message.orEmpty()
    statusView.visibility = if (message == null) View.GONE else View.VISIBLE
    search.nextFocusDownId = if (visibleRows.any { !it.disabled }) list.id else close.id
    close.nextFocusUpId = if (visibleRows.any { !it.disabled }) list.id else search.id
  }

  private fun dp(value: Int): Int = (value * nativePlayerDensity(context)).toInt()
}
