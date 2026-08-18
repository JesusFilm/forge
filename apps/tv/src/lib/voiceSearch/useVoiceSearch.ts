// Android TV voice search hook over the local TvSpeechRecognizer module.
// Owns ONLY session state (listening) and permission; transcripts are forwarded
// verbatim to onTranscript — the caller's write site (setSanitizedQuery) is the
// sanitize chokepoint, exactly as with typed keys. Transcripts are never logged
// (zero-PII rule extends to spoken queries; errors log the closed code only).

import { useCallback, useEffect, useRef, useState } from "react"
import { PermissionsAndroid, Platform } from "react-native"

import {
  addSpeechListener,
  cancelListening,
  isVoiceSearchAvailable,
  startListening,
} from "../../../modules/tv-speech-recognizer"
import { datadogLog } from "../datadog"

/** App locale is hardcoded en (repo convention) — recognizer tag to match. */
const RECOGNIZER_LANGUAGE_TAG = "en-US"

type UseVoiceSearchResult = {
  /** Render the mic affordance only when true (Android + live recognizer). */
  available: boolean
  /** A session is in flight — show the "Listening…" indicator. */
  listening: boolean
  /** Ask permission if needed, then begin one listening session. */
  start: () => void
}

export function useVoiceSearch(
  onTranscript: (transcript: string) => void,
): UseVoiceSearchResult {
  // Availability is device-stable; probe once per mount.
  const [available] = useState(() => isVoiceSearchAvailable())
  const [listening, setListening] = useState(false)

  // Ref-forward the callback so the mount-scoped subscriptions never go stale
  // without re-subscribing per render.
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  useEffect(() => {
    if (!available) return
    const subscriptions = [
      addSpeechListener("onSpeechPartial", ({ transcript }) => {
        onTranscriptRef.current(transcript)
      }),
      addSpeechListener("onSpeechFinal", ({ transcript }) => {
        // Final can be empty (recognizer gave up) — keep the last partial then.
        if (transcript.length > 0) onTranscriptRef.current(transcript)
        setListening(false)
      }),
      addSpeechListener("onSpeechError", ({ code }) => {
        // Closed union code only — never the transcript or a raw message.
        datadogLog.warn(`voice_search.error code=${code}`)
        setListening(false)
      }),
      // onSpeechEnd = mic closed; results may still be finalizing, so the
      // session stays "listening" until final/error settles it.
    ]
    return () => {
      for (const subscription of subscriptions) subscription.remove()
      // A session outliving the screen would keep the mic open — tear it down.
      // StrictMode-safe: setup re-subscribes and start() re-arms per press; no
      // hook-lifetime ref is mutated here.
      void cancelListening()
    }
  }, [available])

  const start = useCallback(() => {
    if (!available) return
    void (async () => {
      if (Platform.OS === "android") {
        const grant = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        )
        if (grant !== PermissionsAndroid.RESULTS.GRANTED) {
          datadogLog.warn("voice_search.permission_denied")
          return
        }
      }
      setListening(true)
      await startListening(RECOGNIZER_LANGUAGE_TAG)
    })().catch(() => {
      setListening(false)
    })
  }, [available])

  return { available, listening, start }
}
