import { requestOpenRouterChat, type OpenRouterUsage } from "./openrouter"
import type { Chunk, LanguageConfig } from "./types"

export type TranslateChunkOptions = {
  chunk: Chunk
  targetLanguage: string
  model: string
  apiKey?: string
  timeoutMs: number
  config?: LanguageConfig
  fetchImpl?: typeof fetch
}

export type TranslateChunkResult = {
  text: string
  usage: OpenRouterUsage
}

export async function translateChunk({
  chunk,
  targetLanguage,
  model,
  apiKey,
  timeoutMs,
  config,
  fetchImpl,
}: TranslateChunkOptions): Promise<TranslateChunkResult> {
  const result = await requestOpenRouterChat({
    apiKey,
    model,
    timeoutMs,
    fetchImpl,
    messages: [
      { role: "system", content: buildSystemPrompt(targetLanguage, config) },
      { role: "user", content: chunk.sourceText },
    ],
  })

  return {
    text: result.value.trim(),
    usage: result.usage,
  }
}

function buildSystemPrompt(
  targetLanguage: string,
  config?: LanguageConfig,
): string {
  const parts = [
    `Translate the following text to ${targetLanguage}.`,
    "Translate for meaning and natural fluency.",
    "Do not worry about line count, timing, or subtitle formatting.",
    "Return only the translated text, nothing else.",
  ]

  if (config?.glossary && Object.keys(config.glossary).length > 0) {
    const entries = Object.entries(config.glossary)
      .map(([source, target]) => `"${source}" -> "${target}"`)
      .join(", ")
    parts.push(
      `Use these exact translations for the following terms: ${entries}.`,
    )
  }

  if (config?.customPrompt) {
    parts.push(config.customPrompt)
  }

  return parts.join(" ")
}

export const _internals = {
  buildSystemPrompt,
}
