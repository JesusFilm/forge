// Transcription service — generates transcripts from video/audio via OpenRouter.

import OpenAI from "openai"
import { env } from "@/config/env"

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
})

export type TranscriptSegment = {
  start: number
  end: number
  text: string
}

export type TranscriptionResult = {
  text: string
  segments: TranscriptSegment[]
  language: string
}

export async function transcribeAudio(
  audioUrl: string,
  language = "en",
): Promise<TranscriptionResult> {
  // OpenRouter proxies Whisper-compatible transcription endpoints.
  // Replace model with a supported transcription model as needed.
  const response = await openrouter.chat.completions.create({
    model: "openai/whisper-large-v3",
    messages: [
      {
        role: "user",
        content: `Transcribe the audio at this URL with timestamps. Language: ${language}. URL: ${audioUrl}`,
      },
    ],
  })

  const content = response.choices[0]?.message?.content ?? ""

  // Stub: parse structured transcript from model response.
  // Replace with proper structured output once model supports it.
  return {
    text: content,
    segments: [],
    language,
  }
}
