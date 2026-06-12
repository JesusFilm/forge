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
