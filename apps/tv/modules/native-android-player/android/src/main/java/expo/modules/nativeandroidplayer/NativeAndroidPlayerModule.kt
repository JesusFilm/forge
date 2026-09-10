package expo.modules.nativeandroidplayer

import android.app.Dialog
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class NativePlayerOption : Record {
  @Field var id: String = ""
  @Field var label: String = ""
  @Field var detail: String = ""
  @Field var url: String = ""
  @Field var disabled: Boolean = false
  @Field var searchText: String = ""
}

class NativePlayerMoment : Record {
  @Field var id: String = ""
  @Field var label: String = ""
  @Field var detail: String = ""
  @Field var startSeconds: Double = 0.0
}

class NativeAndroidPlayerModule : Module() {
  private var resumeDialog: Dialog? = null
  private var resumeRequestId: String? = null
  private var loadingDialog: Dialog? = null
  private var loadingRequestId: String? = null

  override fun definition() = ModuleDefinition {
    Name("NativeAndroidPlayer")

    AsyncFunction("hideStartupLoading") {
      appContext.currentActivity?.let { StartupLoadingOverlay.hide(it) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("showLoadingDialog") { requestId: String, message: String, promise: Promise ->
      loadingDialog?.dismiss()
      val activity = requireNotNull(appContext.currentActivity) { "Activity unavailable" }
      loadingRequestId = requestId
      loadingDialog = showNativeChoiceDialog(
        context = activity,
        title = message,
        labels = listOf("Back"),
        selected = -1,
        showClose = false,
        loading = true,
        onChoice = {},
        onDismiss = {
          if (loadingRequestId == requestId) {
            loadingDialog = null
            loadingRequestId = null
          }
          promise.resolve(null)
        }
      )
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("dismissLoadingDialog") { requestId: String ->
      if (loadingRequestId == requestId) loadingDialog?.dismiss()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("showResumeChoice") { requestId: String, resumeLabel: String, promise: Promise ->
      resumeDialog?.dismiss()
      val activity = requireNotNull(appContext.currentActivity) { "Activity unavailable" }
      var choice = "cancel"
      resumeRequestId = requestId
      resumeDialog = showNativeChoiceDialog(
        context = activity,
        title = "Keep watching?",
        labels = listOf(resumeLabel, "Start over", "Cancel"),
        selected = 0,
        showClose = false,
        onChoice = { index -> choice = when (index) { 0 -> "resume"; 1 -> "start-over"; else -> "cancel" } },
        onDismiss = {
          if (resumeRequestId == requestId) {
            resumeDialog = null
            resumeRequestId = null
          }
          promise.resolve(choice)
        }
      )
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("dismissResumeChoice") { requestId: String ->
      if (resumeRequestId == requestId) resumeDialog?.dismiss()
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      Handler(Looper.getMainLooper()).post { resumeDialog?.dismiss(); resumeDialog = null; resumeRequestId = null }
      Handler(Looper.getMainLooper()).post { loadingDialog?.dismiss(); loadingDialog = null; loadingRequestId = null }
    }

    View(NativeAndroidPlayerView::class) {
      Events(
        "onDismiss",
        "onEnded",
        "onPlayNext",
        "onPlaybackPosition",
        "onError",
        "onAudioChange",
        "onSubtitleChange",
        "onMenuChange",
        "onFirstFrame",
        "onRebuffer"
      )

      Prop("sourceUrl") { view: NativeAndroidPlayerView, value: String? ->
        view.sourceUrl = value
      }
      Prop("storyboardUrl") { view: NativeAndroidPlayerView, value: String? -> view.storyboardUrl = value }
      Prop("title") { view: NativeAndroidPlayerView, value: String? ->
        view.videoTitle = value
      }
      Prop("startAtSeconds") { view: NativeAndroidPlayerView, value: Double? ->
        view.startAtSeconds = (value ?: 0.0).coerceAtLeast(0.0)
      }
      Prop("subtitle") { view: NativeAndroidPlayerView, value: String? -> view.videoSubtitle = value }
      Prop("screenReaderEnabled") { view: NativeAndroidPlayerView, value: Boolean? -> view.screenReaderEnabled = value ?: false }
      Prop("reduceMotion") { view: NativeAndroidPlayerView, value: Boolean? -> view.reduceMotion = value ?: false }
      Prop("foreground") { view: NativeAndroidPlayerView, value: Boolean? -> view.setForeground(value ?: true) }
      Prop("menuAvailable") { view: NativeAndroidPlayerView, value: Boolean? -> view.menuAvailable = value ?: false }
      Prop("subtitleStatus") { view: NativeAndroidPlayerView, value: String? -> view.subtitleStatus = value }
      Prop("exploreStatus") { view: NativeAndroidPlayerView, value: String? -> view.exploreStatus = value }
      Prop("currentMomentText") { view: NativeAndroidPlayerView, value: String? -> view.currentMomentText = value }
      Prop("summaries") { view: NativeAndroidPlayerView, value: List<String> -> view.summaries = value }
      Prop("audioOptions") { view: NativeAndroidPlayerView, value: List<NativePlayerOption> ->
        view.audioOptions = value
      }
      Prop("selectedAudioId") { view: NativeAndroidPlayerView, value: String? ->
        view.selectedAudioId = value
      }
      Prop("subtitleOptions") { view: NativeAndroidPlayerView, value: List<NativePlayerOption> ->
        view.subtitleOptions = value
      }
      Prop("selectedSubtitleId") { view: NativeAndroidPlayerView, value: String? ->
        view.selectedSubtitleId = value
      }
      Prop("selectedSubtitleUrl") { view: NativeAndroidPlayerView, value: String? ->
        view.selectedSubtitleUrl = value
      }
      Prop("moments") { view: NativeAndroidPlayerView, value: List<NativePlayerMoment> ->
        view.moments = value
      }
      Prop("questions") { view: NativeAndroidPlayerView, value: List<String> ->
        view.questions = value
      }
      Prop("upNextSlug") { view: NativeAndroidPlayerView, value: String? ->
        view.upNextSlug = value
      }
      Prop("upNextTitle") { view: NativeAndroidPlayerView, value: String? ->
        view.upNextTitle = value
      }

      OnViewDidUpdateProps { view ->
        view.commitProps()
      }
      OnViewDestroys { view ->
        view.release()
      }
    }
  }
}
