import { z } from "zod"

export type TranscriptSegment = {
  start: number
  end: number
  text: string
}

export type Chunk = {
  index: number
  segments: TranscriptSegment[]
  startTime: number
  endTime: number
  sourceText: string
}

export type LanguageConfig = {
  customPrompt?: string
  glossary?: Record<string, string>
}

export const SubtitleTranslationContextSchema = z
  .object({
    videoTitle: z.string().min(1).optional(),
    videoLabel: z.string().min(1).optional(),
    bibleReferences: z.array(z.string().min(1).max(80)).max(20).optional(),
  })
  .strict()

export type SubtitleTranslationContext = z.infer<
  typeof SubtitleTranslationContextSchema
>

export const SubtitleContentDomainSchema = z.enum([
  "bible_story",
  "gospel_teaching",
  "christian_general",
  "other",
])

export type SubtitleContentDomain = z.infer<typeof SubtitleContentDomainSchema>

export const SubtitleScriptureContextSchema = z
  .object({
    contentDomain: SubtitleContentDomainSchema,
    likelyBibleReferences: z.array(z.string().min(1).max(80)).max(10),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(240).optional(),
  })
  .strict()

export type SubtitleScriptureContext = z.infer<
  typeof SubtitleScriptureContextSchema
>

export const SubtitleScriptureContextJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    contentDomain: {
      type: "string",
      enum: ["bible_story", "gospel_teaching", "christian_general", "other"],
    },
    likelyBibleReferences: {
      type: "array",
      items: { type: "string", maxLength: 80 },
      maxItems: 10,
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string", maxLength: 240 },
  },
  required: ["contentDomain", "likelyBibleReferences", "confidence"],
} as const

export const RetimingOutputSchema = z
  .object({
    segments: z.array(
      z
        .object({
          start: z.number(),
          end: z.number(),
          text: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()

export type RetimingOutput = z.infer<typeof RetimingOutputSchema>

export const RetimingOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: { type: "number" },
          end: { type: "number" },
          text: { type: "string" },
        },
        required: ["start", "end", "text"],
      },
    },
  },
  required: ["segments"],
} as const

export const SubtitleLanguageResultSchema = z
  .object({
    lang: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    error: z.string().optional(),
    artifactKeys: z
      .object({
        vtt: z.string().min(1),
        json: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()

export type SubtitleLanguageResult = z.infer<
  typeof SubtitleLanguageResultSchema
>

export class SubtitleProviderError extends Error {
  constructor(
    readonly reason:
      | "provider_config_missing"
      | "provider_auth_failed"
      | "provider_failed"
      | "provider_invalid_output",
    readonly retryable: boolean,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "SubtitleProviderError"
  }
}
