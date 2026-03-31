// Voiceover service — orchestrates TTS synthesis, text chunking, S3 streaming upload,
// and CMS draft variant creation. The adapter layer (tts/) handles provider-specific API calls.

import { createHash } from "node:crypto"
import { writeArtifact, artifactExists } from "@/services/storage"
import {
  getTTSAdapter,
  selectProviderForLanguage,
  splitIntoSentences,
  batchSentences,
  stripId3Header,
  PROVIDER_CHAR_LIMITS,
} from "@/services/tts/elevenlabs"
import { parseBCP47 } from "@/services/tts/types"
import type {
  VoiceoverProviderName,
  VoiceoverSynthesisMetadata,
} from "@/services/tts/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceoverOptions = {
  assetId: string
  language: string
  text: string
  provider?: VoiceoverProviderName
  voiceId?: string
}

export type VoiceoverResult = {
  artifactKey: string
  language: string
  metadata: VoiceoverSynthesisMetadata
  inputTextHash: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTEXT_CHARS = 150

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateVoiceover(
  options: VoiceoverOptions,
): Promise<VoiceoverResult> {
  const lang = parseBCP47(options.language)
  const artifactType = `voiceover-${options.language}`

  // Checkpoint: skip if artifact already exists (resume after restart)
  if (await artifactExists(options.assetId, artifactType, "mp3")) {
    console.log(
      JSON.stringify({
        event: "voiceover_skip_existing",
        assetId: options.assetId,
        language: options.language,
      }),
    )
    // Return a minimal result — the artifact is already there
    return {
      artifactKey: `${options.assetId}/${artifactType}.mp3`,
      language: options.language,
      metadata: {
        provider: options.provider ?? "elevenlabs",
        model: "cached",
        voiceId: options.voiceId ?? "unknown",
        voiceName: options.voiceId ?? "unknown",
      },
      inputTextHash: hashText(options.text),
    }
  }

  // Select provider and voice
  const { adapter, voiceId: defaultVoiceId } = options.provider
    ? { adapter: getTTSAdapter(options.provider), voiceId: undefined }
    : selectProviderForLanguage(lang)

  const voiceId = options.voiceId ?? defaultVoiceId

  // Chunk text
  const charLimit = PROVIDER_CHAR_LIMITS[adapter.name] ?? 5_000
  const sentences = splitIntoSentences(options.text, options.language)
  const chunks = batchSentences(sentences, charLimit)

  console.log(
    JSON.stringify({
      event: "voiceover_start",
      assetId: options.assetId,
      language: options.language,
      provider: adapter.name,
      chunks: chunks.length,
      totalChars: options.text.length,
    }),
  )

  // Synthesize each chunk and collect audio buffers
  const audioBuffers: Uint8Array[] = []
  let lastMetadata: VoiceoverSynthesisMetadata | undefined

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const previousText = i > 0 ? chunks[i - 1].slice(-CONTEXT_CHARS) : undefined
    const nextText =
      i < chunks.length - 1 ? chunks[i + 1].slice(0, CONTEXT_CHARS) : undefined

    const result = await adapter.synthesize({
      text: chunk,
      language: options.language,
      voiceId,
      previousText,
      nextText,
    })

    // Strip ID3 headers from chunks 2+ for clean CBR MP3 concatenation
    const audio = i > 0 ? stripId3Header(result.audio) : result.audio
    audioBuffers.push(audio)
    lastMetadata = result.metadata
  }

  // Concatenate audio chunks
  const totalLength = audioBuffers.reduce((sum, b) => sum + b.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const buf of audioBuffers) {
    combined.set(buf, offset)
    offset += buf.length
  }

  // Write to S3
  const artifactKey = await writeArtifact({
    assetId: options.assetId,
    artifactType,
    ext: "mp3",
    body: combined,
    contentType: "audio/mpeg",
  })

  const metadata: VoiceoverSynthesisMetadata = lastMetadata ?? {
    provider: adapter.name,
    model: "unknown",
    voiceId: voiceId ?? "default",
    voiceName: voiceId ?? "default",
  }

  console.log(
    JSON.stringify({
      event: "voiceover_complete",
      assetId: options.assetId,
      language: options.language,
      provider: adapter.name,
      artifactKey,
    }),
  )

  return {
    artifactKey,
    language: options.language,
    metadata,
    inputTextHash: hashText(options.text),
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
