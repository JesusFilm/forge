package expo.modules.nativeandroidplayer

import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ProgressBar
import android.widget.ImageView
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

data class PlaybackPositionEvent(
  @Field val positionSeconds: Double,
  @Field val durationSeconds: Double
) : Record

data class NativeSelectionEvent(@Field val id: String?) : Record
data class NativeMenuEvent(@Field val section: String?) : Record
data class NativeErrorEvent(@Field val message: String) : Record
data class NativePlayNextEvent(@Field val slug: String) : Record

@UnstableApi
class NativeAndroidPlayerView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext), Player.Listener {
  override val shouldUseAndroidLayout = true
  internal val onDismiss by EventDispatcher<Unit>()
  internal val onEnded by EventDispatcher<Unit>()
  internal val onPlayNext by EventDispatcher<NativePlayNextEvent>()
  internal val onPlaybackPosition by EventDispatcher<PlaybackPositionEvent>()
  internal val onError by EventDispatcher<NativeErrorEvent>()
  internal val onAudioChange by EventDispatcher<NativeSelectionEvent>()
  internal val onSubtitleChange by EventDispatcher<NativeSelectionEvent>()
  internal val onMenuChange by EventDispatcher<NativeMenuEvent>()
  internal val onFirstFrame by EventDispatcher<Unit>()
  internal val onRebuffer by EventDispatcher<Unit>()

  var sourceUrl: String? = null
  var storyboardUrl: String? = null
  var videoTitle: String? = null
  var startAtSeconds: Double = 0.0
  var videoSubtitle: String? = null
  var screenReaderEnabled = false
  var reduceMotion = false
  var menuAvailable = false
  var subtitleStatus: String? = null
  var exploreStatus: String? = null
  var currentMomentText: String? = null
  var summaries: List<String> = emptyList()
  var audioOptions: List<NativePlayerOption> = emptyList()
  var selectedAudioId: String? = null
  var subtitleOptions: List<NativePlayerOption> = emptyList()
  var selectedSubtitleId: String? = null
  var selectedSubtitleUrl: String? = null
  var moments: List<NativePlayerMoment> = emptyList()
  var questions: List<String> = emptyList()
  var upNextSlug: String? = null
  var upNextTitle: String? = null

  private val handler = Handler(Looper.getMainLooper())
  private val assets = NativePlayerAssets()
  private val scrub = NativeScrubState()
  private var subtitleCues: List<NativeSubtitleCue> = emptyList()
  private var subtitleLoadError: String? = null
  private var loadedStoryboardUrl: String? = null
  private val player = ExoPlayer.Builder(context).build()
  private val mediaSession = MediaSession.Builder(context, player).build()
  private val contentRoot = FrameLayout(context)
  private val playerView = LayoutInflater.from(context)
    .inflate(R.layout.native_player_surface, contentRoot, false) as PlayerView
  private val controllerOverlay = FrameLayout(context)
  private val topScrim = View(context)
  private val bottomScrim = View(context)
  private val topBar = LinearLayout(context)
  private val bottomPanel = LinearLayout(context)
  private val infoRow = LinearLayout(context)
  private val titleColumn = LinearLayout(context)
  private val actionBar = LinearLayout(context)
  private val transportBar = LinearLayout(context)
  private val progressPanel = LinearLayout(context)
  private val backButton = createBackButton()
  private val titleView = TextView(context)
  private val eyebrowView = TextView(context)
  private val loadingView = LinearLayout(context)
  private val captionView = TextView(context)
  private val previewPanel = LinearLayout(context)
  private val previewImage = ImageView(context)
  private val previewTime = TextView(context)
  private val startOverButton = NativeMenuButton(context, NativeMenuIcon.START_OVER, "Start Over")
  private val exploreButton = NativeMenuButton(context, NativeMenuIcon.EXPLORE, "Explore")
  private val audioButton = NativeMenuButton(context, NativeMenuIcon.LANGUAGE, "Language")
  private val subtitleButton = NativeMenuButton(context, NativeMenuIcon.SUBTITLES, "Subtitles")
  private val rewindButton = NativeTransportButton(context, NativeTransportKind.REWIND)
  private val playPauseButton = NativeTransportButton(context, NativeTransportKind.PLAY_PAUSE)
  private val forwardButton = NativeTransportButton(context, NativeTransportKind.FORWARD)
  private val progressBar = NativePlayerTimeBar(context)
  private val positionView = TextView(context)
  private val durationView = TextView(context)
  private var loadedSourceUrl: String? = null
  private var loadedSubtitleUrl: String? = null
  private var sourceStartPositionMs: Long? = null
  private var seeking = false
  private var hasRenderedFrame = false
  private var foreground = true
  private var resumeAfterBackground = false
  private var menuSection: String? = null
  private var dialogSubtitleOptions: List<NativePlayerOption> = emptyList()
  private var currentDialog: Dialog? = null
  private var controllerVisible = true
  private var hasPlaybackError = false
  private var lastFocusedControl: View? = null
  private var released = false
  private var endHandled = false
  private var ignoreSelectUntil = 0L
  private var revealKeyCode: Int? = null
  private var focusObserver: ViewTreeObserver? = null

  private val hideControllerWork = Runnable { hideControls() }
  private val captionWork = object : Runnable {
    override fun run() {
      if (released) return
      updateCaption()
      handler.postDelayed(this, if (foreground && player.isPlaying) 100 else 500)
    }
  }
  private val focusGuard = ViewTreeObserver.OnGlobalFocusChangeListener { _, newFocus ->
    if (!ownsFocus(newFocus)) post { restoreNativeFocusIfNeeded() }
  }

  private val progressWork = object : Runnable {
    override fun run() {
      if (released) return
      val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0L
      val reportedPosition = player.currentPosition
      onPlaybackPosition(
        PlaybackPositionEvent(
          reportedPosition / 1000.0,
          duration / 1000.0
        )
      )
      updateProgressChrome(reportedPosition, duration)
      handler.postDelayed(this, 1000)
    }
  }

  init {
    isFocusable = true
    isFocusableInTouchMode = true
    descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
    keepScreenOn = true

    player.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
        .build(),
      true
    )
    player.setHandleAudioBecomingNoisy(true)
    player.addListener(this)

    contentRoot.layoutParams = LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.MATCH_PARENT
    )
    listOf(contentRoot, controllerOverlay, topBar, bottomPanel, infoRow,
      titleColumn, actionBar, transportBar, progressPanel).forEach { group ->
      group.clipChildren = false
      group.clipToPadding = false
    }
    addView(contentRoot)

    playerView.player = player
    playerView.useController = false
    playerView.resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
    playerView.setKeepContentOnPlayerReset(true)
    playerView.isFocusable = false
    playerView.isFocusableInTouchMode = false
    playerView.layoutParams = LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.MATCH_PARENT
    )
    contentRoot.addView(playerView)

    loadingView.orientation = LinearLayout.VERTICAL
    loadingView.gravity = Gravity.CENTER
    loadingView.setBackgroundColor(Color.argb(150, 0, 0, 0))
    loadingView.addView(ProgressBar(context).apply {
      indeterminateTintList = ColorStateList.valueOf(NATIVE_PLAYER_ACCENT)
    }, LinearLayout.LayoutParams(dp(42), dp(42)))
    loadingView.addView(TextView(context).apply {
      text = "Starting playback…"
      nativeTextSize(11f)
      setTextColor(Color.LTGRAY)
      setPadding(0, dp(14), 0, 0)
    })
    contentRoot.addView(loadingView, FrameLayout.LayoutParams(-1, -1))
    playerView.subtitleView?.visibility = View.GONE
    captionView.apply {
      nativeTextSize(16f)
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      setPadding(dp(10), dp(5), dp(10), dp(5))
      background = roundedDrawable(Color.argb(179, 0, 0, 0), dp(4).toFloat())
      setShadowLayer(dp(1).toFloat(), 0f, 1f, Color.BLACK)
      visibility = View.GONE
    }
    contentRoot.addView(captionView, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
      bottomMargin = dp(32)
      marginStart = dp(40)
      marginEnd = dp(40)
    })

    contentRoot.addView(
      controllerOverlay,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
    )

    topScrim.background = GradientDrawable(
      GradientDrawable.Orientation.TOP_BOTTOM,
      intArrayOf(Color.argb(199, 7, 7, 8), Color.TRANSPARENT)
    )
    controllerOverlay.addView(
      topScrim,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        dp(140)
      ).apply { gravity = Gravity.TOP }
    )

    bottomScrim.background = GradientDrawable(
      GradientDrawable.Orientation.BOTTOM_TOP,
      intArrayOf(Color.argb(240, 10, 10, 11), Color.argb(140, 10, 10, 11), Color.TRANSPARENT)
    )
    controllerOverlay.addView(
      bottomScrim,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        dp(260)
      ).apply { gravity = Gravity.BOTTOM }
    )

    topBar.orientation = LinearLayout.HORIZONTAL
    topBar.gravity = Gravity.CENTER_VERTICAL
    topBar.addView(backButton)
    controllerOverlay.addView(
      topBar,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        gravity = Gravity.TOP
        topMargin = dp(27)
        marginStart = dp(40)
        marginEnd = dp(40)
      }
    )

    titleView.setTextColor(Color.WHITE)
    titleView.nativeTextSize(21f)
    titleView.setTypeface(Typeface.DEFAULT, Typeface.BOLD)
    titleView.setShadowLayer(dp(11).toFloat(), 0f, dp(1).toFloat(), Color.argb(140, 0, 0, 0))
    titleView.maxLines = 1
    titleView.ellipsize = android.text.TextUtils.TruncateAt.END
    titleView.gravity = Gravity.CENTER_VERTICAL

    titleColumn.orientation = LinearLayout.VERTICAL
    titleColumn.gravity = Gravity.CENTER_VERTICAL
    eyebrowView.nativeTextSize(9f)
    eyebrowView.setTextColor(NATIVE_PLAYER_ACCENT)
    eyebrowView.maxLines = 1
    titleColumn.addView(eyebrowView)
    titleColumn.addView(
      titleView,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    )

    actionBar.orientation = LinearLayout.HORIZONTAL
    actionBar.gravity = Gravity.CENTER_VERTICAL or Gravity.END
    listOf(startOverButton, exploreButton, audioButton, subtitleButton).forEach { button ->
      actionBar.addView(
        button,
        LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
          marginStart = dp(7)
        }
      )
    }

    transportBar.orientation = LinearLayout.HORIZONTAL
    transportBar.gravity = Gravity.CENTER
    listOf(rewindButton, playPauseButton, forwardButton).forEach { button ->
      transportBar.addView(
        button,
        LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.WRAP_CONTENT,
          LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
          marginStart = dp(5)
          marginEnd = dp(5)
        }
      )
    }

    infoRow.orientation = LinearLayout.HORIZONTAL
    infoRow.gravity = Gravity.CENTER_VERTICAL
    infoRow.addView(
      titleColumn,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginEnd = dp(12)
      }
    )
    infoRow.addView(
      transportBar,
      LinearLayout.LayoutParams(
        FrameLayout.LayoutParams.WRAP_CONTENT,
        FrameLayout.LayoutParams.WRAP_CONTENT
      )
    )
    infoRow.addView(
      actionBar,
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
        marginStart = dp(12)
      }
    )

    progressPanel.orientation = LinearLayout.VERTICAL
    progressPanel.gravity = Gravity.CENTER_VERTICAL
    progressPanel.clipChildren = false
    progressPanel.clipToPadding = false
    progressPanel.addView(
      progressBar,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(18)
      )
    )

    val timeRow = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    configureTimeView(positionView, Gravity.START)
    positionView.setTextColor(Color.WHITE)
    configureTimeView(durationView, Gravity.END)
    timeRow.addView(
      positionView,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    timeRow.addView(
      durationView,
      LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    )
    progressPanel.addView(
      timeRow,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply { topMargin = dp(5) }
    )

    bottomPanel.orientation = LinearLayout.VERTICAL
    bottomPanel.clipChildren = false
    bottomPanel.clipToPadding = false
    bottomPanel.addView(
      infoRow,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply { bottomMargin = dp(15) }
    )
    bottomPanel.addView(
      progressPanel,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      )
    )
    controllerOverlay.addView(
      bottomPanel,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        gravity = Gravity.BOTTOM
        bottomMargin = dp(23)
        marginStart = dp(40)
        marginEnd = dp(40)
      }
    )

    previewPanel.orientation = LinearLayout.VERTICAL
    previewPanel.background = roundedDrawable(NATIVE_PLAYER_INK, dp(7).toFloat())
    previewPanel.clipToOutline = true
    previewPanel.visibility = View.GONE
    previewPanel.isFocusable = false
    previewImage.scaleType = ImageView.ScaleType.FIT_CENTER
    previewPanel.addView(previewImage, LinearLayout.LayoutParams(dp(160), dp(90)))
    previewTime.gravity = Gravity.CENTER
    previewTime.setTextColor(Color.WHITE)
    previewTime.nativeTextSize(11f)
    previewPanel.addView(previewTime, LinearLayout.LayoutParams(-1, dp(20)))
    controllerOverlay.addView(previewPanel, FrameLayout.LayoutParams(dp(160), dp(110)))

    backButton.setOnClickListener { cancelPreview(); onDismiss(Unit) }
    startOverButton.setOnClickListener { cancelPreview(); seekTo(0); player.play(); showControls(startOverButton) }
    exploreButton.setOnClickListener { showExploreDialog() }
    audioButton.setOnClickListener { showAudioDialog() }
    subtitleButton.setOnClickListener { showSubtitleDialog() }
    rewindButton.setOnClickListener { seekBy(-10_000) }
    playPauseButton.setOnClickListener { togglePlayback() }
    forwardButton.setOnClickListener { seekBy(10_000) }
    progressBar.onSeekBackward = { adjustPreview(-10_000) }
    progressBar.onSeekForward = { adjustPreview(10_000) }
    progressBar.onTogglePlayback = { if (!commitPreview()) togglePlayback(progressBar) }

    listOf<View>(
      backButton,
      exploreButton,
      audioButton,
      subtitleButton,
      rewindButton,
      playPauseButton,
      forwardButton,
      startOverButton,
      progressBar
    ).forEach(::trackFocus)
    progressBar.setOnFocusChangeListener { view, focused ->
      if (focused) {
        lastFocusedControl = view
        showControls()
      } else {
        cancelPreview()
      }
      view.invalidate()
    }
    updateFocusGraph()
    handler.post(progressWork)
    handler.post(captionWork)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    registerFocusGuard()
    ignoreSelectUntil = SystemClock.uptimeMillis() + 750
    showControls(progressBar)
  }

  override fun onDetachedFromWindow() {
    unregisterFocusGuard()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    captionView.maxWidth = maxOf(0, w - dp(80))
    post { positionPreview(); positionCaption() }
  }

  private fun updateStoryboard() {
    if (!hasRenderedFrame || loadedStoryboardUrl == storyboardUrl) return
    loadedStoryboardUrl = storyboardUrl
    previewImage.setImageDrawable(null)
    assets.storyboard(storyboardUrl) { updatePreviewImage() }
  }

  private fun adjustPreview(delta: Long) {
    val starting = scrub.candidateMs == null
    val candidate = scrub.adjust(delta, player.currentPosition, player.duration, player.playWhenReady) ?: return
    if (starting) player.pause()
    progressBar.candidateMs = candidate
    previewPanel.visibility = View.VISIBLE
    previewTime.text = "${formatTime(candidate)} · Select to seek"
    previewPanel.contentDescription = "Preview ${formatTime(candidate)}. Select to seek, Back to cancel."
    updatePreviewImage()
    positionPreview()
    positionCaption()
    updateProgressChrome(scrub.originMs, player.duration)
    handler.removeCallbacks(hideControllerWork)
  }

  private fun updatePreviewImage() {
    val candidate = scrub.candidateMs ?: return
    val bitmap = assets.frame(candidate / 1000.0)
    previewImage.setImageBitmap(bitmap)
    previewImage.visibility = if (bitmap == null) View.GONE else View.VISIBLE
    previewPanel.layoutParams.height = dp(if (bitmap == null) 20 else 110)
    previewPanel.requestLayout()
    positionPreview()
    positionCaption()
  }

  private fun positionPreview() {
    if (scrub.candidateMs == null || width <= 0 || bottomPanel.top <= 0) return
    val fraction = scrub.candidateMs!!.toDouble() / player.duration.coerceAtLeast(1)
    val cardWidth = dp(160)
    previewPanel.layoutParams = (previewPanel.layoutParams as FrameLayout.LayoutParams).apply {
      leftMargin = (dp(40) + progressBar.width * fraction - cardWidth / 2).toInt()
        .coerceIn(dp(40), maxOf(dp(40), this@NativeAndroidPlayerView.width - dp(40) - cardWidth))
      topMargin = maxOf(dp(64), bottomPanel.top - height - dp(12))
    }
  }

  private fun positionCaption() {
    val lift = when {
      !controllerVisible -> 0f
      scrub.candidateMs != null && bottomPanel.top > 0 -> {
        val previewTop = (previewPanel.layoutParams as FrameLayout.LayoutParams).topMargin
        (height - previewTop - dp(32) + dp(8)).toFloat()
      }
      bottomPanel.top > 0 -> (height - bottomPanel.top - dp(32) + dp(8)).toFloat()
      else -> dp(104).toFloat()
    }
    captionView.animate().translationY(-lift).setDuration(if (reduceMotion) 0 else 200).start()
  }

  private fun clearPreviewUi() {
    progressBar.candidateMs = null
    previewPanel.visibility = View.GONE
    previewImage.setImageDrawable(null)
    positionCaption()
  }

  private fun commitPreview(): Boolean {
    val result = scrub.commit() ?: return false
    clearPreviewUi()
    seekTo(result.positionMs)
    player.playWhenReady = result.resume && foreground
    scheduleHideControls()
    return true
  }

  private fun cancelPreview(resume: Boolean = true): Boolean {
    val result = scrub.cancel() ?: return false
    clearPreviewUi()
    if (resume && foreground && !hasPlaybackError) player.playWhenReady = result.resume
    updateProgressChrome(player.currentPosition, player.duration.coerceAtLeast(0))
    scheduleHideControls()
    return true
  }

  private fun updateCaption() {
    val text = NativeVttParser.active(subtitleCues, player.currentPosition / 1000.0)
    if (captionView.text.toString() == text) return
    captionView.text = text
    captionView.visibility = if (text.isBlank()) View.GONE else View.VISIBLE
    captionView.alpha = 0f
    captionView.animate().alpha(1f).setDuration(if (reduceMotion) 0 else 120).start()
  }

  fun setForeground(value: Boolean) {
    if (foreground == value || released) return
    cancelPreview()
    foreground = value
    if (!value) {
      resumeAfterBackground = player.playWhenReady
      player.pause()
      handler.removeCallbacks(hideControllerWork)
    } else {
      if (resumeAfterBackground) player.play()
      showControls(if (hasPlaybackError) backButton else progressBar)
    }
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val isSelect = event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
      event.keyCode == KeyEvent.KEYCODE_ENTER ||
      event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
    if (SystemClock.uptimeMillis() < ignoreSelectUntil && isSelect) {
      return true
    }

    if (revealKeyCode == event.keyCode) {
      if (event.action == KeyEvent.ACTION_UP) revealKeyCode = null
      return true
    }

    if (!controllerVisible || isFocused) {
      when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_CENTER,
        KeyEvent.KEYCODE_ENTER,
        KeyEvent.KEYCODE_NUMPAD_ENTER,
        KeyEvent.KEYCODE_DPAD_LEFT,
        KeyEvent.KEYCODE_DPAD_RIGHT,
        KeyEvent.KEYCODE_DPAD_UP,
        KeyEvent.KEYCODE_DPAD_DOWN,
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_MEDIA_REWIND,
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
        KeyEvent.KEYCODE_BACK -> {
          if (event.action == KeyEvent.ACTION_DOWN) {
            revealKeyCode = event.keyCode
            val revealedBy = event.keyCode
            handler.postDelayed({
              if (revealKeyCode == revealedBy) revealKeyCode = null
            }, 5_000)
            showControls(progressBar)
          }
          return true
        }
      }
    }

    if (event.keyCode in listOf(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD)) {
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 && !hasPlaybackError) {
        cancelPreview()
        when (event.keyCode) {
          KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> togglePlayback(progressBar)
          KeyEvent.KEYCODE_MEDIA_PLAY -> player.play()
          KeyEvent.KEYCODE_MEDIA_PAUSE -> player.pause()
          KeyEvent.KEYCODE_MEDIA_REWIND -> seekBy(-10_000)
          KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> seekBy(10_000)
        }
      }
      return true
    }

    if (event.keyCode == KeyEvent.KEYCODE_BACK && scrub.candidateMs != null) {
      if (event.action == KeyEvent.ACTION_DOWN) {
        cancelPreview()
        revealKeyCode = event.keyCode
      }
      return true
    }
    if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
      onDismiss(Unit)
      return true
    }

    if (event.action == KeyEvent.ACTION_DOWN) showControls()
    return super.dispatchKeyEvent(event)
  }

  fun commitProps() {
    titleView.text = if (hasPlaybackError) {
      "Playback failed — press Back to exit."
    } else {
      videoTitle.orEmpty()
    }
    titleView.visibility =
      if ((!hasPlaybackError && videoTitle.isNullOrBlank()) || !controllerVisible) View.GONE else View.VISIBLE
    eyebrowView.text = videoSubtitle.orEmpty()
    eyebrowView.visibility = if (videoSubtitle.isNullOrBlank() || hasPlaybackError) View.GONE else View.VISIBLE
    val menuActive = menuAvailable
    exploreButton.visibility = if (menuActive) View.VISIBLE else View.GONE
    audioButton.visibility = if (menuActive) View.VISIBLE else View.GONE
    subtitleButton.visibility = if (menuActive) View.VISIBLE else View.GONE
    exploreButton.setSubLabel("Scripture & scenes")
    audioButton.setSubLabel(
      audioOptions.firstOrNull { it.id == selectedAudioId }?.label ?: "—"
    )
    subtitleButton.setSubLabel(
      subtitleOptions.firstOrNull { it.id == selectedSubtitleId }?.label ?: "Off"
    )
    actionBar.visibility = View.VISIBLE
    applyPlaybackErrorState()
    updateFocusGraph()
    post { restoreNativeFocusIfNeeded() }
    (currentDialog as? NativeExploreDialog)?.updateContent(currentMomentText, moments, summaries, questions, exploreStatus)
    if (menuSection == "subtitles") updateSubtitleDialog()
    if (screenReaderEnabled && !controllerVisible) showControls(progressBar)
    scheduleHideControls()

    if (selectedSubtitleUrl != loadedSubtitleUrl) {
      loadedSubtitleUrl = selectedSubtitleUrl
      subtitleLoadError = null
      subtitleCues = emptyList()
      updateCaption()
      assets.subtitles(selectedSubtitleUrl?.takeIf(::isAllowedHttpsUrl)) { cues, failed ->
        subtitleCues = cues
        subtitleLoadError = if (failed) "Couldn’t load selected subtitles" else null
        updateCaption()
        if (menuSection == "subtitles") updateSubtitleDialog()
      }
    }
    updateStoryboard()
    val nextSource = sourceUrl
    if (nextSource == loadedSourceUrl) return
    if (!isAllowedHttpsUrl(nextSource)) return

    cancelPreview()
    val preservingPosition = loadedSourceUrl != null
    val position = if (preservingPosition) player.currentPosition else (startAtSeconds * 1000).toLong()
    val restorePosition = position.coerceAtLeast(0L)
    val shouldPlay = if (preservingPosition) player.playWhenReady else foreground
    val mediaItemBuilder = MediaItem.Builder()
      .setUri(Uri.parse(nextSource))
      .setMediaMetadata(MediaMetadata.Builder().setTitle(videoTitle).build())

    loadedSourceUrl = nextSource
    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
      .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
      .build()
    hasPlaybackError = false
    applyPlaybackErrorState()
    endHandled = false
    sourceStartPositionMs = restorePosition
    player.setMediaItem(mediaItemBuilder.build(), restorePosition)
    player.prepare()
    player.playWhenReady = shouldPlay
    updateProgressChrome(
      restorePosition,
      player.duration.takeIf { it != C.TIME_UNSET && it > 0L } ?: 0L
    )
    showControls(if (controllerVisible) null else progressBar)
  }

  override fun onPlaybackStateChanged(playbackState: Int) {
    if (playbackState == Player.STATE_READY) {
      sourceStartPositionMs?.let { target ->
        sourceStartPositionMs = null
        val duration = player.duration
        if (duration > 0L && target >= duration) player.seekTo(maxOf(0L, duration - 5_000L))
      }
      seeking = false
    }
    if (playbackState == Player.STATE_ENDED) handleEnded()
  }

  override fun onPlayerError(error: PlaybackException) {
    cancelPreview(resume = false)
    sourceStartPositionMs = null
    loadingView.visibility = View.GONE
    hasPlaybackError = true
    currentDialog?.dismiss()
    applyPlaybackErrorState()
    showControls(backButton)
    onError(NativeErrorEvent(error.errorCodeName))
  }

  override fun onRenderedFirstFrame() {
    loadingView.visibility = View.GONE
    if (!hasRenderedFrame) {
      hasRenderedFrame = true
      onFirstFrame(Unit)
    }
    updateStoryboard()
  }

  override fun onEvents(player: Player, events: Player.Events) {
    if (
      events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED) ||
      events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED) ||
      events.contains(Player.EVENT_IS_PLAYING_CHANGED)
    ) {
      keepScreenOn = player.isPlaying
      updatePlayPauseButton()
      if (!player.playWhenReady) {
        showControls(if (!controllerVisible || isFocused) progressBar else null)
      } else if (player.isPlaying) {
        scheduleHideControls()
      } else {
        handler.removeCallbacks(hideControllerWork)
        if (player.playbackState == Player.STATE_BUFFERING && hasRenderedFrame &&
          sourceStartPositionMs == null && !seeking && foreground) {
          onRebuffer(Unit)
          if (!controllerVisible) showControls(progressBar)
        }
      }
    }
  }

  fun release() {
    if (released) return
    cancelPreview(resume = false)
    released = true
    assets.close()
    onPlaybackPosition(PlaybackPositionEvent(player.currentPosition / 1000.0,
      player.duration.takeIf { it > 0L }?.div(1000.0) ?: 0.0))
    handler.removeCallbacksAndMessages(null)
    unregisterFocusGuard()
    currentDialog?.dismiss()
    currentDialog = null
    player.removeListener(this)
    playerView.player = null
    mediaSession.release()
    player.release()
  }

  private fun showAudioDialog() {
    if (currentDialog != null) return
    val options = audioOptions.sortedWith(
      compareBy<NativePlayerOption> { it.label.lowercase() }
        .thenBy { it.detail.lowercase() }
        .thenBy { it.id }
    )
    handler.removeCallbacks(hideControllerWork)
    menuSection = "language"
    val dialog = NativeSearchDialog(context, "Audio Language",
      onChoice = { id -> onAudioChange(NativeSelectionEvent(id)) }, onClosed = { closeMenu() })
    currentDialog = dialog
    dialog.update(options.map { NativeChoiceRow(it.id, it.label, it.detail, it.disabled, searchText = it.searchText) },
      selectedAudioId, if (options.isEmpty()) "No audio languages available" else null)
    dialog.show()
    onMenuChange(NativeMenuEvent("language"))
  }

  private fun showSubtitleDialog() {
    if (currentDialog != null) return
    handler.removeCallbacks(hideControllerWork)
    menuSection = "subtitles"
    val dialog = NativeSearchDialog(context, "Subtitles",
      onChoice = { id -> onSubtitleChange(NativeSelectionEvent(id.takeUnless { it == "__off__" })) },
      onClosed = { closeMenu() })
    currentDialog = dialog
    updateSubtitleDialog()
    dialog.show()
    onMenuChange(NativeMenuEvent("subtitles"))
  }

  private fun updateSubtitleDialog() {
    dialogSubtitleOptions = subtitleOptions.sortedWith(
      compareBy<NativePlayerOption> { it.label.lowercase() }.thenBy { it.detail.lowercase() }.thenBy { it.id }
    )
    (currentDialog as? NativeSearchDialog)?.update(
      listOf(NativeChoiceRow("__off__", "Subtitles Off", pinned = true)) +
        dialogSubtitleOptions.map { NativeChoiceRow(it.id, it.label, it.detail, searchText = it.searchText) },
      selectedSubtitleId ?: "__off__", subtitleLoadError ?: subtitleStatus)
  }

  private fun showExploreDialog() {
    if (currentDialog != null) return
    handler.removeCallbacks(hideControllerWork)
    menuSection = "moments"
    val dialog = NativeExploreDialog(context,
      getPosition = { player.currentPosition / 1000.0 },
      onSeek = { seconds ->
        if (seconds.isFinite()) seekTo((seconds * 1000).toLong())
        currentDialog?.dismiss()
      },
      onDismiss = { closeMenu() })
    currentDialog = dialog
    dialog.updateContent(currentMomentText, moments, summaries, questions, exploreStatus)
    dialog.show()
    onMenuChange(NativeMenuEvent("moments"))
  }

  private fun closeMenu() {
    currentDialog = null
    menuSection = null
    if (released) return
    onMenuChange(NativeMenuEvent(null))
    showControls(progressBar)
  }


  private fun handleEnded() {
    if (endHandled) return
    endHandled = true
    currentDialog?.dismiss()
    val slug = upNextSlug
    if (slug.isNullOrBlank()) {
      onEnded(Unit)
      return
    }
    handler.removeCallbacks(hideControllerWork)
    var handled = false
    var dialog: Dialog? = null
    var remaining = 8
    lateinit var countdown: Runnable
    countdown = Runnable {
      if (dialog?.isShowing == true) {
        remaining -= 1
        if (remaining <= 0) {
          handled = true
          dialog?.dismiss()
          onPlayNext(NativePlayNextEvent(slug))
        } else {
          updateNativeChoiceDialogTitle(
            dialog,
            "UP NEXT IN $remaining…\n${upNextTitle ?: "Play the next video?"}"
          )
          handler.postDelayed(countdown, 1_000)
        }
      }
    }
    dialog = showNativeChoiceDialog(
      context = context,
      title = "UP NEXT IN $remaining…\n${upNextTitle ?: "Play the next video?"}",
      labels = listOf("Play now", "Not now"),
      selected = 0,
      onChoice = { index ->
        handled = true
        if (index == 0) {
          onPlayNext(NativePlayNextEvent(slug))
        } else {
          onEnded(Unit)
        }
      },
      onDismiss = {
        handler.removeCallbacks(countdown)
        currentDialog = null
        if (!handled && !released) onEnded(Unit)
      },
      showClose = false
    )
    currentDialog = dialog
    handler.postDelayed(countdown, 1_000)
  }

  private fun createBackButton(): TextView {
    return TextView(context).apply {
      id = View.generateViewId()
      text = "Back"
      nativeTextSize(10.5f)
      setTypeface(Typeface.DEFAULT, Typeface.NORMAL)
      gravity = Gravity.CENTER
      isFocusable = true
      isFocusableInTouchMode = true
      isClickable = true
      contentDescription = "Back"
      setPadding(dp(8), 0, dp(12), 0)
      compoundDrawablePadding = dp(4)
      setCompoundDrawables(requireNotNull(context.getDrawable(R.drawable.native_player_back)).apply {
        setBounds(0, 0, dp(12), dp(12))
        setTintList(ColorStateList(arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf()),
          intArrayOf(NATIVE_PLAYER_INK, Color.WHITE)))
      }, null, null, null)
      setTextColor(
        ColorStateList(
          arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf()),
          intArrayOf(NATIVE_PLAYER_INK, Color.WHITE)
        )
      )
      background = StateListDrawable().apply {
        addState(
          intArrayOf(android.R.attr.state_focused),
          roundedDrawable(Color.WHITE, dp(8).toFloat())
        )
        addState(
          intArrayOf(),
          roundedDrawable(Color.argb(31, 255, 255, 255), dp(8).toFloat())
        )
      }
      layoutParams = LinearLayout.LayoutParams(dp(61), dp(29))
    }
  }

  private fun trackFocus(view: View) {
    view.setOnFocusChangeListener { target, focused ->
      if (target === backButton) {
        target.animate()
          .scaleX(if (focused) 1.07f else 1f)
          .scaleY(if (focused) 1.07f else 1f)
          .setDuration(if (reduceMotion) 0 else 180)
          .start()
      }
      if (focused) {
        lastFocusedControl = target
        showControls()
      }
      target.invalidate()
    }
  }

  private fun configureTimeView(view: TextView, alignment: Int) {
    view.setTextColor(Color.argb(140, 255, 255, 255))
    view.nativeTextSize(10f)
    view.setTypeface(Typeface.DEFAULT, Typeface.NORMAL)
    view.gravity = alignment
  }

  private fun registerFocusGuard() {
    if (focusObserver != null) return
    val observer = viewTreeObserver
    if (!observer.isAlive) return
    observer.addOnGlobalFocusChangeListener(focusGuard)
    focusObserver = observer
  }

  private fun unregisterFocusGuard() {
    focusObserver?.takeIf { it.isAlive }?.removeOnGlobalFocusChangeListener(focusGuard)
    focusObserver = null
  }

  private fun ownsFocus(view: View?): Boolean {
    var current = view
    while (current != null) {
      if (current === this) return true
      current = current.parent as? View
    }
    return false
  }

  private fun restoreNativeFocusIfNeeded() {
    if (
      released ||
      !isAttachedToWindow ||
      !hasWindowFocus() ||
      currentDialog != null
    ) {
      return
    }

    val activeFocus = findFocus()
    if (isUsableFocus(activeFocus)) return

    if (!controllerVisible) {
      requestFocus()
      return
    }

    val target = lastFocusedControl?.takeIf { isUsableFocus(it) } ?: progressBar
    target.requestFocus()
  }

  private fun isUsableFocus(view: View?): Boolean {
    return ownsFocus(view) &&
      view?.isShown == true &&
      view.isFocusable &&
      view.isEnabled &&
      view.width > 0 &&
      view.height > 0
  }

  private fun applyPlaybackErrorState() {
    val controls = listOf<View>(
      rewindButton,
      playPauseButton,
      forwardButton,
      startOverButton,
      exploreButton,
      audioButton,
      subtitleButton,
      progressBar
    )
    controls.forEach { control ->
      control.isEnabled = !hasPlaybackError
      control.isFocusable = !hasPlaybackError
      control.alpha = if (hasPlaybackError) 0.3f else 1f
    }
    titleView.maxLines = if (hasPlaybackError) 2 else 1
    titleView.text = if (hasPlaybackError) {
      "Playback failed — press Back to exit."
    } else {
      videoTitle.orEmpty()
    }
    updateFocusGraph()
  }

  private fun updateFocusGraph() {
    if (hasPlaybackError) {
      backButton.nextFocusLeftId = backButton.id
      backButton.nextFocusRightId = backButton.id
      backButton.nextFocusUpId = backButton.id
      backButton.nextFocusDownId = backButton.id
      return
    }
    val menuButtons = listOf(startOverButton, exploreButton, audioButton, subtitleButton)
      .filter { it.visibility == View.VISIBLE }

    backButton.nextFocusLeftId = backButton.id
    backButton.nextFocusRightId = backButton.id
    backButton.nextFocusUpId = backButton.id
    backButton.nextFocusDownId = playPauseButton.id

    menuButtons.forEachIndexed { index, button ->
      button.nextFocusLeftId = menuButtons.getOrNull(index - 1)?.id ?: forwardButton.id
      button.nextFocusRightId = menuButtons.getOrNull(index + 1)?.id ?: button.id
      button.nextFocusUpId = backButton.id
      button.nextFocusDownId = progressBar.id
    }

    rewindButton.nextFocusLeftId = rewindButton.id
    rewindButton.nextFocusRightId = playPauseButton.id
    rewindButton.nextFocusUpId = backButton.id
    rewindButton.nextFocusDownId = progressBar.id

    playPauseButton.nextFocusLeftId = rewindButton.id
    playPauseButton.nextFocusRightId = forwardButton.id
    playPauseButton.nextFocusUpId = backButton.id
    playPauseButton.nextFocusDownId = progressBar.id

    forwardButton.nextFocusLeftId = playPauseButton.id
    forwardButton.nextFocusRightId = menuButtons.firstOrNull()?.id ?: forwardButton.id
    forwardButton.nextFocusUpId = backButton.id
    forwardButton.nextFocusDownId = progressBar.id

    progressBar.nextFocusLeftId = progressBar.id
    progressBar.nextFocusRightId = progressBar.id
    progressBar.nextFocusUpId = playPauseButton.id
    progressBar.nextFocusDownId = progressBar.id
  }

  private fun showControls(preferredFocus: View? = null) {
    if (released) return
    val wasHidden = !controllerVisible
    controllerVisible = true
    descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
    controllerOverlay.animate().cancel()
    controllerOverlay.visibility = View.VISIBLE
    controllerOverlay.bringToFront()
    captionView.bringToFront()
    if (wasHidden) {
      controllerOverlay.alpha = 0f
      controllerOverlay.animate().alpha(1f).setDuration(if (reduceMotion) 0 else 100).start()
    } else {
      controllerOverlay.alpha = 1f
    }
    titleView.visibility =
      if (!hasPlaybackError && videoTitle.isNullOrBlank()) View.GONE else View.VISIBLE
    positionCaption()
    updatePlayPauseButton()
    updateProgressChrome(
      player.currentPosition,
      player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0L
    )
    scheduleHideControls()

    if (wasHidden || preferredFocus != null) {
      val target = if (hasPlaybackError) backButton else preferredFocus ?: progressBar
      post {
        if (!released && isAttachedToWindow && controllerVisible && currentDialog == null && foreground) target.requestFocus()
      }
    }
  }

  private fun scheduleHideControls() {
    handler.removeCallbacks(hideControllerWork)
    if (foreground && player.isPlaying && currentDialog == null && scrub.candidateMs == null && !screenReaderEnabled && !hasPlaybackError) {
      handler.postDelayed(hideControllerWork, 3_500)
    }
  }

  private fun hideControls() {
    if (!controllerVisible || !player.isPlaying || currentDialog != null || scrub.candidateMs != null || screenReaderEnabled) return
    lastFocusedControl = findFocus()?.takeIf { it !== playerView && it !== this }
    controllerVisible = false
    descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
    captionView.animate().translationY(0f).setDuration(if (reduceMotion) 0 else 200).start()
    controllerOverlay.animate()
      .alpha(0f)
      .setDuration(if (reduceMotion) 0 else 150)
      .withEndAction {
        if (!controllerVisible) controllerOverlay.visibility = View.GONE
      }
      .start()
    requestFocus()
  }

  private fun togglePlayback(preferredFocus: View = playPauseButton) {
    cancelPreview()
    if (player.playWhenReady) {
      player.pause()
    } else {
      if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
      player.play()
    }
    updatePlayPauseButton()
    showControls(preferredFocus)
  }

  private fun seekBy(offsetMs: Long) {
    cancelPreview()
    if (offsetMs > 0 && (player.duration == C.TIME_UNSET || player.duration <= 0)) return
    seekTo(player.currentPosition + offsetMs)
  }

  private fun seekTo(positionMs: Long) {
    val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }
    val requested = positionMs.coerceAtLeast(0L)
    val ceiling = duration?.let { maxOf(0L, it - 500L) }
    val target = ceiling?.let { requested.coerceAtMost(it) } ?: requested
    sourceStartPositionMs = null
    seeking = true
    player.seekTo(target)
    updateCaption()
    updateProgressChrome(target, duration ?: 0L)
    scheduleHideControls()
  }

  private fun updatePlayPauseButton() {
    val playing = player.playWhenReady
    playPauseButton.setPlaying(playing)
  }

  private fun updateProgressChrome(position: Long, duration: Long) {
    val displayed = scrub.candidateMs ?: position
    positionView.text = formatTime(displayed)
    durationView.text = if (duration > 0) {
      "−${formatTime((duration - displayed).coerceAtLeast(0L))}"
    } else {
      "--:--"
    }
    progressBar.setPlayback(if (scrub.candidateMs != null) scrub.originMs else position, duration, player.bufferedPosition)
  }

  private fun formatTime(timeMs: Long): String {
    val totalSeconds = (timeMs.coerceAtLeast(0L) / 1000).toInt()
    val hours = totalSeconds / 3600
    val minutes = totalSeconds / 60 % 60
    val seconds = totalSeconds % 60
    return (if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}" else "$minutes") +
      ":${seconds.toString().padStart(2, '0')}"
  }

  private fun isAllowedHttpsUrl(value: String?): Boolean {
    if (value.isNullOrBlank()) return false
    return runCatching { Uri.parse(value).scheme.equals("https", true) }.getOrDefault(false)
  }

  private fun roundedDrawable(color: Int, radius: Float): GradientDrawable {
    return GradientDrawable().apply {
      setColor(color)
      cornerRadius = radius
    }
  }

  private fun dp(value: Int): Int {
    return (value * nativePlayerDensity(context)).toInt()
  }
}
