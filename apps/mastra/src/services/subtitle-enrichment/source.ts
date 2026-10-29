import { z } from "zod"

import { parseVtt } from "../../evals/subtitle-translation/vtt"
import { readMuxSubtitleSource } from "./source-mux"
import { SubtitleSourceError, subtitleLanguageRoot } from "./source-errors"
import {
  isSubtitleArtifactStorageProductionReady,
  readSubtitleArtifact,
  subtitleArtifactKey,
  writeSubtitleArtifact,
} from "./storage"
import { parseTranscriptArtifact, SubtitleSegmentsSchema } from "./transcript"
import type { TranscriptSegment } from "./types"
import { segmentsToVtt } from "./vtt"

export { SubtitleSourceError } from "./source-errors"

export const SubtitleSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transcript_artifact") }).strict(),
  z.object({ kind: z.literal("subtitle_artifact") }).strict(),
  z
    .object({
      kind: z.literal("mux"),
      muxAssetId: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/),
    })
    .strict(),
])

export const SubtitleSourceInputSchema = z
  .object({
    assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,255}$/),
    sourceLanguage: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/)
      .refine((value) => value.toLowerCase() !== "auto"),
    source: SubtitleSourceSchema,
  })
  .strict()

export const SubtitleSourceSummarySchema = z
  .object({
    kind: z.enum(["transcript_artifact", "subtitle_artifact", "mux"]),
    language: z.string().min(1),
    segmentCount: z.number().int().positive(),
    artifactKeys: z
      .object({ transcript: z.string().min(1), subtitles: z.string().min(1) })
      .strict(),
  })
  .strict()

export type SubtitleSourceInput = z.infer<typeof SubtitleSourceInputSchema>
export type SubtitleSourceSummary = z.infer<typeof SubtitleSourceSummarySchema>
export type SubtitleSourceResult = {
  text: string
  segments: TranscriptSegment[]
  language: string
  summary: SubtitleSourceSummary
}
export type RunSubtitleSourceDeps = {
  readArtifact?: typeof readSubtitleArtifact
  writeArtifact?: typeof writeSubtitleArtifact
  readMuxSource?: typeof readMuxSubtitleSource
}

function parseSourceContent<T>(parse: () => T): T {
  try {
    return parse()
  } catch {
    throw new SubtitleSourceError(
      "source_invalid",
      false,
      "Subtitle source content is invalid.",
    )
  }
}

export async function runSubtitleSource(
  rawInput: SubtitleSourceInput,
  deps: RunSubtitleSourceDeps = {},
): Promise<SubtitleSourceResult> {
  const parsed = SubtitleSourceInputSchema.safeParse(rawInput)
  if (!parsed.success)
    throw new SubtitleSourceError(
      "source_invalid",
      false,
      "Subtitle source input is invalid.",
    )
  const input = parsed.data
  if (!isSubtitleArtifactStorageProductionReady()) {
    throw new SubtitleSourceError(
      "source_config_missing",
      false,
      "Production subtitle source execution requires shared artifact storage.",
    )
  }
  const readArtifact = deps.readArtifact ?? readSubtitleArtifact
  const writeArtifact = deps.writeArtifact ?? writeSubtitleArtifact
  let segments: TranscriptSegment[]
  let language = input.sourceLanguage
  try {
    if (input.source.kind === "mux") {
      const source = await (deps.readMuxSource ?? readMuxSubtitleSource)({
        muxAssetId: input.source.muxAssetId,
        sourceLanguage: input.sourceLanguage,
      })
      segments = source.segments
      language = source.language
    } else if (input.source.kind === "subtitle_artifact") {
      const bytes = await readArtifact(input.assetId, "subtitles", "vtt")
      if (bytes.length > 5 * 1024 * 1024)
        throw new SubtitleSourceError(
          "source_invalid",
          false,
          "Source subtitles exceed the size limit.",
        )
      segments = parseSourceContent(() =>
        parseVtt(new TextDecoder().decode(bytes), { emptyCue: "reject" }),
      )
    } else {
      const bytes = await readArtifact(input.assetId, "transcript", "json")
      const transcript = parseSourceContent(() =>
        parseTranscriptArtifact(bytes),
      )
      segments = transcript.segments
      language = transcript.language ?? language
    }
    if (
      subtitleLanguageRoot(language) !==
      subtitleLanguageRoot(input.sourceLanguage)
    ) {
      throw new SubtitleSourceError(
        "source_invalid",
        false,
        "Subtitle source language does not match the requested language.",
      )
    }
    segments = parseSourceContent(() => SubtitleSegmentsSchema.parse(segments))
  } catch (error) {
    if (error instanceof SubtitleSourceError) throw error
    throw new SubtitleSourceError(
      "source_failed",
      true,
      "Subtitle source could not be read or validated.",
    )
  }

  const text = segments.map((segment) => segment.text).join(" ")
  // Preserve the original approved transcript and its routing/correction provenance.
  // Reuse never falls through to a provider when an approved artifact is invalid.
  const artifactKeys = {
    transcript: subtitleArtifactKey(input.assetId, "transcript", "json"),
    subtitles: subtitleArtifactKey(input.assetId, "subtitles", "vtt"),
  }
  try {
    if (input.source.kind !== "transcript_artifact") {
      await writeArtifact({
        assetId: input.assetId,
        artifactType: "transcript",
        ext: "json",
        body: JSON.stringify({
          text,
          segments,
          language,
          source: input.source.kind,
        }),
        contentType: "application/json",
      })
    }
    if (input.source.kind !== "subtitle_artifact") {
      await writeArtifact({
        assetId: input.assetId,
        artifactType: "subtitles",
        ext: "vtt",
        body: segmentsToVtt(segments, { language, assetId: input.assetId }),
        contentType: "text/vtt",
      })
    }
  } catch {
    throw new SubtitleSourceError(
      "source_failed",
      true,
      "Subtitle source artifacts could not be stored.",
    )
  }
  return {
    text,
    segments,
    language,
    summary: {
      kind: input.source.kind,
      language,
      segmentCount: segments.length,
      artifactKeys,
    },
  }
}
