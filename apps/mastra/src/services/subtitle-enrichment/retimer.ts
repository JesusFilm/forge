import {
  requestOpenRouterChat,
  type OpenRouterProviderCall,
  type OpenRouterUsage,
} from "./openrouter"
import {
  RetimingOutputJsonSchema,
  RetimingOutputSchema,
  type Chunk,
  type LanguageConfig,
  type SubtitleScriptureContext,
  type TranscriptSegment,
} from "./types"
import { formatVttTime } from "./vtt"

const MAX_SLOT_DURATION = 7
const MAX_RETRIES = 1

export type RetimeChunkOptions = {
  chunk: Chunk
  translatedText: string
  targetLanguage: string
  model: string
  apiKey?: string
  timeoutMs: number
  deadlineAtMs?: number
  config?: LanguageConfig
  scriptureContext?: SubtitleScriptureContext
  fetchImpl?: typeof fetch
  onUsage?: (usage: OpenRouterUsage) => void
  onUsageUnavailable?: () => void
  onProviderCall?: (
    call: OpenRouterProviderCall & { operationAttempt: number },
  ) => void
}

export type RetimeChunkResult = {
  segments: TranscriptSegment[]
  usage: OpenRouterUsage
  fallbackUsed: boolean
}

export async function retimeChunk({
  chunk,
  translatedText,
  targetLanguage,
  model,
  apiKey,
  timeoutMs,
  deadlineAtMs,
  config,
  scriptureContext,
  fetchImpl,
  onUsage,
  onUsageUnavailable,
  onProviderCall,
}: RetimeChunkOptions): Promise<RetimeChunkResult> {
  let lastErrors: string[] = []
  let totalUsage: OpenRouterUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt =
      attempt > 0
        ? buildCorrectionPrompt(
            chunk,
            translatedText,
            targetLanguage,
            lastErrors,
            config,
            scriptureContext,
          )
        : buildRetimingPrompt(
            chunk,
            translatedText,
            targetLanguage,
            config,
            scriptureContext,
          )

    try {
      const result = await requestOpenRouterChat({
        apiKey,
        model,
        timeoutMs,
        deadlineAtMs,
        fetchImpl,
        onUsage,
        onUsageUnavailable,
        onProviderCall: (call) =>
          onProviderCall?.({ ...call, operationAttempt: attempt }),
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        responseFormat: {
          name: "subtitle_retiming",
          schema: RetimingOutputJsonSchema,
          validator: RetimingOutputSchema,
        },
      })
      totalUsage = addUsage(totalUsage, result.usage)

      const errors = validateRetimingOutput(result.value.segments, chunk)
      if (errors.length > 0) {
        lastErrors = errors
        continue
      }

      return {
        segments: result.value.segments,
        usage: totalUsage,
        fallbackUsed: false,
      }
    } catch (error) {
      lastErrors = [
        error instanceof Error ? error.message : "Unknown LLM error",
      ]
    }
  }

  return {
    segments: deterministicRetime(chunk, translatedText),
    usage: totalUsage,
    fallbackUsed: true,
  }
}

function addUsage(
  left: OpenRouterUsage,
  right: OpenRouterUsage,
): OpenRouterUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  }
}

function buildRetimingPrompt(
  chunk: Chunk,
  translatedText: string,
  targetLanguage: string,
  config?: LanguageConfig,
  scriptureContext?: SubtitleScriptureContext,
): { system: string; user: string } {
  const sourceSegments = chunk.segments
    .map(
      (segment) =>
        `[${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}] ${segment.text}`,
    )
    .join("\n")

  const systemParts = [
    `You are a subtitle timing specialist for ${targetLanguage}.`,
    `Break the translated text into subtitle segments that fit within the original time window [${formatVttTime(chunk.startTime)} - ${formatVttTime(chunk.endTime)}].`,
    "",
    "Rules:",
    "- No single segment longer than 7 seconds.",
    "- No overlapping start/end times.",
    "- Break at natural phrase boundaries in the target language.",
    "- Segments must cover the full time window without gaps during speech.",
    "- All translated text must be included. Do not drop content.",
    "- Use the translated text exactly as supplied; do not retranslate, paraphrase, harmonize with scripture, or add/remove words.",
    "- If the translation is shorter than the source, merge into fewer segments.",
    "- If the translation is longer, split across more segments.",
    "",
    'Respond with JSON: { "segments": [{ "start": <seconds>, "end": <seconds>, "text": "<text>" }] }',
  ]

  if (config?.customPrompt) {
    systemParts.push("", config.customPrompt)
  }

  if (scriptureContext?.contentDomain === "bible_story") {
    systemParts.push(
      "",
      "Scripture-sensitive wording has already been handled during translation. Retiming must preserve that wording.",
    )
  }

  return {
    system: systemParts.join("\n"),
    user: `Original segments:\n${sourceSegments}\n\nTranslated text:\n${translatedText}`,
  }
}

function buildCorrectionPrompt(
  chunk: Chunk,
  translatedText: string,
  targetLanguage: string,
  errors: string[],
  config?: LanguageConfig,
  scriptureContext?: SubtitleScriptureContext,
): { system: string; user: string } {
  const base = buildRetimingPrompt(
    chunk,
    translatedText,
    targetLanguage,
    config,
    scriptureContext,
  )
  const errorFeedback = errors.map((error) => `- ${error}`).join("\n")

  return {
    system: base.system,
    user: `${base.user}\n\nYour previous output had these problems:\n${errorFeedback}\n\nPlease fix these issues and try again.`,
  }
}

export function validateRetimingOutput(
  segments: TranscriptSegment[],
  chunk: Chunk,
): string[] {
  const errors: string[] = []

  if (segments.length === 0) {
    errors.push("No segments produced")
    return errors
  }

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!
    const duration = segment.end - segment.start

    if (duration > MAX_SLOT_DURATION + 0.5) {
      errors.push(
        `Segment ${index} exceeds max duration: ${duration.toFixed(1)}s (max ${MAX_SLOT_DURATION}s)`,
      )
    }

    if (segment.end <= segment.start) {
      errors.push(
        `Segment ${index} has end <= start: ${segment.start} - ${segment.end}`,
      )
    }

    if (segment.start < chunk.startTime - 0.5) {
      errors.push(
        `Segment ${index} starts before chunk window: ${segment.start} < ${chunk.startTime}`,
      )
    }

    if (segment.end > chunk.endTime + 0.5) {
      errors.push(
        `Segment ${index} ends after chunk window: ${segment.end} > ${chunk.endTime}`,
      )
    }

    if (index < segments.length - 1) {
      const next = segments[index + 1]!
      if (next.start < segment.end - 0.1) {
        errors.push(
          `Segments ${index} and ${index + 1} overlap: ${segment.end} > ${next.start}`,
        )
      }
    }
  }

  return errors
}

export function deterministicRetime(
  chunk: Chunk,
  translatedText: string,
): TranscriptSegment[] {
  const totalDuration = chunk.endTime - chunk.startTime
  if (totalDuration <= 0 || translatedText.trim().length === 0) {
    return [
      {
        start: chunk.startTime,
        end: chunk.endTime,
        text: translatedText.trim() || "...",
      },
    ]
  }

  const slotCount = Math.max(1, Math.ceil(totalDuration / MAX_SLOT_DURATION))
  const slotDuration = totalDuration / slotCount
  const phrases = splitIntoPhrases(translatedText, slotCount)

  return Array.from({ length: slotCount }, (_, index) => ({
    start: roundTime(chunk.startTime + index * slotDuration),
    end: roundTime(
      index === slotCount - 1
        ? chunk.endTime
        : chunk.startTime + (index + 1) * slotDuration,
    ),
    text: phrases[index] ?? "",
  })).filter((segment) => segment.text.trim().length > 0)
}

function splitIntoPhrases(text: string, targetCount: number): string[] {
  const normalized = text.trim()
  if (targetCount <= 1) return [normalized]

  const words = normalized.split(/\s+/)
  if (words.length <= targetCount) return words

  const wordsPerSlot = Math.ceil(words.length / targetCount)
  const phrases: string[] = []
  for (let index = 0; index < words.length; index += wordsPerSlot) {
    phrases.push(words.slice(index, index + wordsPerSlot).join(" "))
  }
  return phrases
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000
}

export const _internals = {
  buildRetimingPrompt,
  buildCorrectionPrompt,
  splitIntoPhrases,
}
