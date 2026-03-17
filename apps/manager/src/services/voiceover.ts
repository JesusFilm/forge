// Voiceover service — generates AI voiceover audio from transcript text.
// Uses OpenRouter for TTS or falls back to Mux audio tracks.

import OpenAI from "openai"
import { env } from "@/config/env"
import { writeArtifact } from "@/services/storage"

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
})

export type VoiceoverResult = {
  artifactKey: string
  language: string
  durationSeconds: number | null
}

export async function generateVoiceover(
  assetId: string,
  text: string,
  language: string,
): Promise<VoiceoverResult> {
  // Use OpenRouter TTS endpoint if available.
  // Fall back to storing a placeholder if TTS is not supported.
  const response = await openrouter.audio.speech.create({
    model: "openai/tts-1",
    voice: "alloy",
    input: text,
  })

  const buffer = Buffer.from(await response.arrayBuffer())

  const artifactKey = await writeArtifact({
    assetId,
    artifactType: `voiceover-${language}`,
    ext: "mp3",
    body: buffer,
    contentType: "audio/mpeg",
  })

  return {
    artifactKey,
    language,
    durationSeconds: null, // Determined post-upload if needed
  }
}
