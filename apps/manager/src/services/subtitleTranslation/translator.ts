// Phase 2: Creative Translation — translate each chunk purely for meaning.
// No structural constraints. The LLM is free to handle verb brackets,
// reorder syntax, and compress filler naturally.

import { getOpenrouter, DEFAULT_MODEL } from "@/services/openrouter"
import type { Chunk, LanguageConfig } from "./types"

/**
 * Translate a chunk's source text to the target language.
 * Returns the translated text as a single string — no timing, no line count.
 */
export async function translateChunk(
  chunk: Chunk,
  targetLanguage: string,
  config?: LanguageConfig,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(targetLanguage, config)

  console.log(
    JSON.stringify({
      event: "translate_chunk_start",
      language: targetLanguage,
      chunkIndex: chunk.index,
      sourceLength: chunk.sourceText.length,
    }),
  )

  const response = await getOpenrouter().chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: chunk.sourceText },
    ],
  })

  const translatedText = response.choices[0]?.message?.content ?? ""

  console.log(
    JSON.stringify({
      event: "translate_chunk_complete",
      language: targetLanguage,
      chunkIndex: chunk.index,
      outputLength: translatedText.length,
    }),
  )

  return translatedText
}

function buildSystemPrompt(
  targetLanguage: string,
  config?: LanguageConfig,
): string {
  const parts: string[] = [
    `Translate the following text to ${targetLanguage}.`,
    "Translate for meaning and natural fluency.",
    "Do not worry about line count, timing, or subtitle formatting.",
    "Return only the translated text, nothing else.",
  ]

  if (config?.glossary && Object.keys(config.glossary).length > 0) {
    const entries = Object.entries(config.glossary)
      .map(([source, target]) => `"${source}" → "${target}"`)
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
