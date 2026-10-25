package expo.modules.tvspeechrecognizer

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Thin SpeechRecognizer wrapper for Android TV voice search. Streams partial and
 * final transcripts as events; the JS side owns all query state. One recognizer
 * at a time — a new start() tears the previous one down. SpeechRecognizer is
 * main-thread-only, so every native call hops through mainHandler.
 *
 * Transcripts flow ONLY through the event payloads — never logged here (the
 * app's zero-PII telemetry rule extends to spoken queries).
 */
class TvSpeechRecognizerModule : Module() {
  private var recognizer: SpeechRecognizer? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("TvSpeechRecognizer")

    Events("onSpeechPartial", "onSpeechFinal", "onSpeechError", "onSpeechEnd")

    Function("isAvailable") {
      val context = appContext.reactContext ?: return@Function false
      SpeechRecognizer.isRecognitionAvailable(context)
    }

    AsyncFunction("start") { languageTag: String ->
      mainHandler.post { startListening(languageTag) }
    }

    AsyncFunction("cancel") {
      mainHandler.post { teardown() }
    }

    OnDestroy {
      mainHandler.post { teardown() }
    }
  }

  private fun startListening(languageTag: String) {
    val context = appContext.reactContext
    if (context == null) {
      sendEvent("onSpeechError", mapOf("code" to "no_context"))
      return
    }
    teardown()
    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
      sendEvent("onSpeechError", mapOf("code" to "unavailable"))
      return
    }
    val instance = SpeechRecognizer.createSpeechRecognizer(context)
    recognizer = instance
    instance.setRecognitionListener(
      object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}

        override fun onBeginningOfSpeech() {}

        override fun onRmsChanged(rmsdB: Float) {}

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {
          sendEvent("onSpeechEnd", emptyMap<String, Any>())
        }

        override fun onError(error: Int) {
          sendEvent("onSpeechError", mapOf("code" to codeFor(error)))
          teardown()
        }

        override fun onResults(results: Bundle?) {
          val transcript =
            results
              ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
              ?.firstOrNull()
              ?: ""
          sendEvent("onSpeechFinal", mapOf("transcript" to transcript))
          teardown()
        }

        override fun onPartialResults(partialResults: Bundle?) {
          val transcript =
            partialResults
              ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
              ?.firstOrNull()
          if (!transcript.isNullOrEmpty()) {
            sendEvent("onSpeechPartial", mapOf("transcript" to transcript))
          }
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
      },
    )
    val intent =
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(
          RecognizerIntent.EXTRA_LANGUAGE_MODEL,
          RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
        )
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
      }
    instance.startListening(intent)
  }

  // RecognitionListener callbacks arrive on the main thread, so callers here
  // (onError/onResults) never race the mainHandler.post paths.
  private fun teardown() {
    recognizer?.destroy()
    recognizer = null
  }

  private fun codeFor(error: Int): String =
    when (error) {
      SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
      SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "timeout"
      SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission_denied"
      SpeechRecognizer.ERROR_NETWORK -> "network"
      SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
      SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
      SpeechRecognizer.ERROR_AUDIO -> "audio"
      SpeechRecognizer.ERROR_CLIENT -> "client"
      SpeechRecognizer.ERROR_SERVER -> "server"
      else -> "unknown"
    }
}
