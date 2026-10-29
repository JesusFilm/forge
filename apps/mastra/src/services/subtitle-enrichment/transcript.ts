import { z } from "zod"

export const SubtitleSegmentSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().positive(),
    text: z.string().trim().min(1).max(100_000),
  })
  .strict()
  .refine((segment) => segment.end > segment.start, {
    message: "Subtitle segment must end after it starts",
  })

export const SubtitleSegmentsSchema = z
  .array(SubtitleSegmentSchema)
  .min(1)
  .max(100_000)

// Existing Manager transcript artifacts carry additional routing/correction data.
// Read that shape compatibly, but validate all timed source content before use.
export const SubtitleTranscriptArtifactSchema = z.object({
  language: z.string().min(1).optional(),
  segments: SubtitleSegmentsSchema,
})

export function parseTranscriptArtifact(bytes: Uint8Array) {
  return SubtitleTranscriptArtifactSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  )
}
