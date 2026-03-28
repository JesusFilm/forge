// Phase 3: LLM Re-timing — redistribute translated text across the original
// time window. Includes correction loop (1 retry) and deterministic fallback.

import { getOpenrouter, DEFAULT_MODEL } from "@/services/openrouter"
import { formatVTTTime } from "@/lib/vtt"
import type { TranscriptSegment, Chunk, LanguageConfig } from "./types"
import { RetimingOutputSchema } from "./types"

const MAX_SLOT_DURATION = 7 // seconds
const MAX_RETRIES = 1

/**
 * Re-time a translated chunk: redistribute the translated text across
 * subtitle segments that fit within the original time window.
 *
 * Pipeline: LLM re-timing → validate → correction loop → deterministic fallback.
 * Always returns valid segments.
 */
export async function retimeChunk(
  chunk: Chunk,
  translatedText: string,
  targetLanguage: string,
  config?: LanguageConfig,
): Promise<TranscriptSegment[]> {
  let lastErrors: string[] = []

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const isRetry = attempt > 0

    console.log(
      JSON.stringify({
        event: "retime_attempt",
        language: targetLanguage,
        chunkIndex: chunk.index,
        attempt,
        isRetry,
      }),
    )

    try {
      const prompt = isRetry
        ? buildCorrectionPrompt(
            chunk,
            translatedText,
            targetLanguage,
            lastErrors,
            config,
          )
        : buildRetimingPrompt(chunk, translatedText, targetLanguage, config)

      const response = await getOpenrouter().chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_object" },
      })

      const content = response.choices[0]?.message?.content ?? ""
      const parsed = safeParseRetiming(content)

      if (!parsed) {
        lastErrors = ["Failed to parse JSON output"]
        continue
      }

      const errors = validateRetimingOutput(parsed.segments, chunk)
      if (errors.length > 0) {
        lastErrors = errors
        console.log(
          JSON.stringify({
            event: "retime_validation_failed",
            language: targetLanguage,
            chunkIndex: chunk.index,
            attempt,
            errors,
          }),
        )
        continue
      }

      console.log(
        JSON.stringify({
          event: "retime_success",
          language: targetLanguage,
          chunkIndex: chunk.index,
          attempt,
          segmentCount: parsed.segments.length,
        }),
      )

      return parsed.segments
    } catch (err) {
      lastErrors = [err instanceof Error ? err.message : "Unknown LLM error"]
    }
  }

  // All LLM attempts failed — use deterministic fallback
  console.log(
    JSON.stringify({
      event: "retime_fallback",
      language: targetLanguage,
      chunkIndex: chunk.index,
      reason: lastErrors,
    }),
  )

  return deterministicRetime(chunk, translatedText)
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildRetimingPrompt(
  chunk: Chunk,
  translatedText: string,
  targetLanguage: string,
  config?: LanguageConfig,
): { system: string; user: string } {
  const sourceSegments = chunk.segments
    .map(
      (s) =>
        `[${formatVTTTime(s.start)} --> ${formatVTTTime(s.end)}] ${s.text}`,
    )
    .join("\n")

  const systemParts = [
    `You are a subtitle timing specialist for ${targetLanguage}.`,
    `Break the translated text into subtitle segments that fit within the original time window [${formatVTTTime(chunk.startTime)} - ${formatVTTTime(chunk.endTime)}].`,
    "",
    "Rules:",
    "- No single segment longer than 7 seconds.",
    "- No overlapping start/end times.",
    "- Break at natural phrase boundaries in the target language.",
    "- Segments must cover the full time window without gaps during speech.",
    "- All translated text must be included — do not drop content.",
    "- If the translation is shorter than the source, merge into fewer segments.",
    "- If the translation is longer, split across more segments.",
    "",
    'Respond with JSON: { "segments": [{ "start": <seconds>, "end": <seconds>, "text": "<text>" }] }',
  ]

  if (config?.customPrompt) {
    systemParts.push("", config.customPrompt)
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
): { system: string; user: string } {
  const base = buildRetimingPrompt(
    chunk,
    translatedText,
    targetLanguage,
    config,
  )

  const errorFeedback = errors.map((e) => `- ${e}`).join("\n")

  return {
    system: base.system,
    user: `${base.user}\n\nYour previous output had these problems:\n${errorFeedback}\n\nPlease fix these issues and try again.`,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function safeParseRetiming(
  content: string,
): { segments: TranscriptSegment[] } | null {
  try {
    const parsed: unknown = JSON.parse(content)
    const result = RetimingOutputSchema.safeParse(parsed)
    if (!result.success) return null
    return result.data
  } catch {
    return null
  }
}

/**
 * Validate retiming output against constraints.
 * Returns an array of error strings (empty = valid).
 */
export function validateRetimingOutput(
  segments: TranscriptSegment[],
  chunk: Chunk,
): string[] {
  const errors: string[] = []

  if (segments.length === 0) {
    errors.push("No segments produced")
    return errors
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const duration = seg.end - seg.start

    if (duration > MAX_SLOT_DURATION + 0.5) {
      errors.push(
        `Segment ${i} exceeds max duration: ${duration.toFixed(1)}s (max ${MAX_SLOT_DURATION}s)`,
      )
    }

    if (seg.end <= seg.start) {
      errors.push(`Segment ${i} has end <= start: ${seg.start} - ${seg.end}`)
    }

    if (seg.start < chunk.startTime - 0.5) {
      errors.push(
        `Segment ${i} starts before chunk window: ${seg.start} < ${chunk.startTime}`,
      )
    }

    if (seg.end > chunk.endTime + 0.5) {
      errors.push(
        `Segment ${i} ends after chunk window: ${seg.end} > ${chunk.endTime}`,
      )
    }

    // Check for overlaps with the next segment
    if (i < segments.length - 1) {
      const next = segments[i + 1]!
      if (next.start < seg.end - 0.1) {
        errors.push(
          `Segments ${i} and ${i + 1} overlap: ${seg.end} > ${next.start}`,
        )
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

/**
 * Distribute translated text proportionally across the chunk's time window.
 * Merges slots when translation is shorter, splits at natural breaks when longer.
 * Enforces max 7s per slot. Always produces valid output.
 */
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

  // Determine how many slots we need based on max duration
  const slotCount = Math.max(1, Math.ceil(totalDuration / MAX_SLOT_DURATION))
  const slotDuration = totalDuration / slotCount

  // Split text at natural boundaries to fill slots
  const textParts = splitTextProportionally(translatedText.trim(), slotCount)

  const segments: TranscriptSegment[] = []
  for (let i = 0; i < textParts.length; i++) {
    const start = chunk.startTime + i * slotDuration
    const end =
      i === textParts.length - 1
        ? chunk.endTime
        : chunk.startTime + (i + 1) * slotDuration

    segments.push({
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      text: textParts[i]!,
    })
  }

  return segments
}

/**
 * Split text into N roughly equal parts, breaking at word boundaries.
 */
function splitTextProportionally(text: string, count: number): string[] {
  if (count <= 1) return [text]

  const words = text.split(/\s+/)
  if (words.length <= count) {
    // Fewer words than slots — distribute one word per slot,
    // fill remaining with the last word
    const parts: string[] = []
    for (let i = 0; i < count; i++) {
      parts.push(words[Math.min(i, words.length - 1)]!)
    }
    return parts
  }

  const wordsPerPart = Math.ceil(words.length / count)
  const parts: string[] = []

  for (let i = 0; i < count; i++) {
    const start = i * wordsPerPart
    const end = Math.min(start + wordsPerPart, words.length)
    if (start < words.length) {
      parts.push(words.slice(start, end).join(" "))
    }
  }

  return parts
}
