// Typed JS surface of the local TvSpeechRecognizer Expo module (Android-only).
// On any other platform — or if the native module is missing from the build —
// every entry point degrades to unavailable/no-op, so callers can gate the mic
// affordance on isVoiceSearchAvailable() without platform forks of their own.

import { requireOptionalNativeModule } from "expo"
import { Platform } from "react-native"

/** Closed union mirroring the Kotlin codeFor() mapping — keep in lockstep. */
export type SpeechErrorCode =
  | "no_match"
  | "timeout"
  | "permission_denied"
  | "network"
  | "busy"
  | "audio"
  | "client"
  | "server"
  | "unavailable"
  | "no_context"
  | "unknown"

type SpeechEvents = {
  onSpeechPartial: (event: { transcript: string }) => void
  onSpeechFinal: (event: { transcript: string }) => void
  onSpeechError: (event: { code: SpeechErrorCode }) => void
  onSpeechEnd: () => void
}

// Structural type (not `NativeModule<SpeechEvents>`): the class generic's
// inherited addListener doesn't survive this workspace's type resolution, and
// the structural shape is what callers actually rely on.
type TvSpeechRecognizerNativeModule = {
  isAvailable(): boolean
  start(languageTag: string): Promise<void>
  cancel(): Promise<void>
  addListener<TName extends keyof SpeechEvents>(
    eventName: TName,
    listener: SpeechEvents[TName],
  ): { remove: () => void }
}

const nativeModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<TvSpeechRecognizerNativeModule>(
        "TvSpeechRecognizer",
      )
    : null

/** True only on Android with a live on-device speech recognizer service. */
export function isVoiceSearchAvailable(): boolean {
  try {
    return nativeModule?.isAvailable() === true
  } catch {
    return false
  }
}

/** Begin one listening session; transcripts arrive via the listeners below. */
export function startListening(languageTag: string): Promise<void> {
  return nativeModule?.start(languageTag) ?? Promise.resolve()
}

/** Tear down any in-flight session (safe when idle). */
export function cancelListening(): Promise<void> {
  return nativeModule?.cancel() ?? Promise.resolve()
}

export function addSpeechListener<TName extends keyof SpeechEvents>(
  eventName: TName,
  listener: SpeechEvents[TName],
): { remove: () => void } {
  if (nativeModule == null) return { remove: () => {} }
  return nativeModule.addListener(eventName, listener)
}
