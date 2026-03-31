// TTS adapter types — shared by all voiceover providers.
// Domain-noun-first naming (Voiceover*, not TTS*) matches TranscriptionResult, ChaptersResult, etc.

import { z } from "zod"

// ---------------------------------------------------------------------------
// Branded BCP 47 language tag
// ---------------------------------------------------------------------------

declare const BCP47Brand: unique symbol
export type BCP47 = string & { readonly [BCP47Brand]: typeof BCP47Brand }

const BCP47_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/

export function parseBCP47(raw: string): BCP47 {
  if (!BCP47_PATTERN.test(raw)) {
    throw new VoiceoverError(
      "INVALID_LANGUAGE",
      "voiceover",
      `Invalid BCP 47: ${raw}`,
    )
  }
  return raw as BCP47
}

// ---------------------------------------------------------------------------
// Audio format — discriminated union prevents contentType/ext mismatch
// ---------------------------------------------------------------------------

export type VoiceoverAudioFormat =
  | { contentType: "audio/mpeg"; ext: "mp3" }
  | { contentType: "audio/wav"; ext: "wav" }
  | { contentType: "audio/opus"; ext: "opus" }

// ---------------------------------------------------------------------------
// Provider names
// ---------------------------------------------------------------------------

export type VoiceoverProviderName = "elevenlabs" | "google-tts" | "amazon-polly"

// ---------------------------------------------------------------------------
// Synthesize input — Zod schema is the single source of truth
// ---------------------------------------------------------------------------

export const voiceoverSynthesizeInputSchema = z.object({
  text: z.string().min(1),
  language: z.string().regex(BCP47_PATTERN),
  voiceId: z.string().optional(),
  previousText: z.string().optional(),
  nextText: z.string().optional(),
})

export type VoiceoverSynthesizeInput = z.infer<
  typeof voiceoverSynthesizeInputSchema
>

// ---------------------------------------------------------------------------
// Synthesize result
// ---------------------------------------------------------------------------

export type VoiceoverSynthesisMetadata = {
  provider: VoiceoverProviderName
  model: string
  voiceId: string
  voiceName: string
  durationMs?: number
  requestId?: string
}

export type VoiceoverSynthesizeResult = VoiceoverAudioFormat & {
  audio: Uint8Array
  metadata: VoiceoverSynthesisMetadata
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export type VoiceoverErrorCode =
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "INVALID_VOICE"
  | "INVALID_LANGUAGE"
  | "SYNTHESIS_FAILED"
  | "PROVIDER_UNAVAILABLE"

export class VoiceoverError extends Error {
  override readonly name = "VoiceoverError"

  constructor(
    readonly code: VoiceoverErrorCode,
    readonly provider: string,
    message: string,
    readonly retryable: boolean = false,
    readonly retryAfterMs?: number,
  ) {
    const sanitized = message
      .replace(/Bearer [^\s]+/g, "Bearer [REDACTED]")
      .replace(/key=[^\s&]+/g, "key=[REDACTED]")
    super(`[${provider}] ${sanitized}`)
  }
}

// ---------------------------------------------------------------------------
// Adapter contract — flat type, not interface (project convention)
// ---------------------------------------------------------------------------

export type TTSAdapter = {
  readonly name: VoiceoverProviderName
  synthesize(
    input: VoiceoverSynthesizeInput,
  ): Promise<VoiceoverSynthesizeResult>
}
