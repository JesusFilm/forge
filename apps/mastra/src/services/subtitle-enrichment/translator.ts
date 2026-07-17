import { requestOpenRouterChat, type OpenRouterUsage } from "./openrouter"
import type { Chunk, LanguageConfig, SubtitleScriptureContext } from "./types"

export type TranslateChunkOptions = {
  chunk: Chunk
  targetLanguage: string
  model: string
  apiKey?: string
  timeoutMs: number
  config?: LanguageConfig
  scriptureContext?: SubtitleScriptureContext
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
  scriptureContext,
  fetchImpl,
}: TranslateChunkOptions): Promise<TranslateChunkResult> {
  const result = await requestOpenRouterChat({
    apiKey,
    model,
    timeoutMs,
    fetchImpl,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(targetLanguage, config, scriptureContext),
      },
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
  scriptureContext?: SubtitleScriptureContext,
): string {
  const parts = [
    `Translate the following text to ${targetLanguage}.`,
    "Forge often translates Christian gospel content. Preserve biblical, theological, and worship language carefully and reverently.",
    "Translate for meaning and natural fluency.",
    "Do not add verse references, commentary, doctrinal expansion, or details not present in the source.",
    "Do not worry about line count, timing, or subtitle formatting.",
    "Return only the translated text, nothing else.",
  ]

  if (
    scriptureContext?.contentDomain === "bible_story" &&
    (scriptureContext.confidence >= 0.5 ||
      scriptureContext.likelyBibleReferences.length > 0)
  ) {
    const references =
      scriptureContext.likelyBibleReferences.length > 0
        ? ` Likely Bible references: ${scriptureContext.likelyBibleReferences.join(", ")}.`
        : ""
    parts.push(
      `This appears to be a Bible-story video.${references} Prefer wording close to familiar Bible phrasing in ${targetLanguage} where natural, while translating the supplied source text rather than quoting an unrelated passage wholesale.`,
    )
  } else if (
    scriptureContext?.contentDomain === "gospel_teaching" ||
    scriptureContext?.contentDomain === "christian_general"
  ) {
    parts.push(
      `Use established Christian terminology in ${targetLanguage} and avoid secularizing theological terms.`,
    )
  }

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
