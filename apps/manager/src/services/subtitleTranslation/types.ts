// Shared types and Zod schemas for the subtitle translation pipeline.

import { z } from "zod"
import type { TranscriptSegment } from "@/lib/vtt"

export type { TranscriptSegment }

export type Chunk = {
  index: number
  segments: TranscriptSegment[]
  startTime: number
  endTime: number
  sourceText: string // joined segment text
}

export const RetimingOutputSchema = z.object({
  segments: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      text: z.string().min(1),
    }),
  ),
})

export type RetimingOutput = z.infer<typeof RetimingOutputSchema>

export type LanguageConfig = {
  customPrompt?: string
  glossary?: Record<string, string> // source term → target translation
}

export type LanguageResult = {
  lang: string
  status: "completed" | "failed"
  error?: string
  artifactKeys?: { vtt: string; json: string }
}
