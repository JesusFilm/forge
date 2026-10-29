import { z } from "zod"

const JobArtifactEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("downloadable") }).strict(),
  z
    .object({
      kind: z.literal("metadata"),
      data: z.record(z.string(), z.unknown()),
    })
    .strict(),
])

export const ForgeVideoEnrichmentInputSchema = z
  .object({
    jobId: z.string().min(1).max(128),
    assetId: z.string().min(1).max(128),
    muxAssetId: z.string().min(1).max(128),
    playbackId: z.string().min(1).max(128).optional(),
    language: z.string().min(1).max(128).optional(),
    translateTo: z.array(z.string().min(1).max(32)).max(50).optional(),
    runSceneAnalysis: z.boolean().optional(),
    runAudioCleanup: z.boolean().optional(),
    videoTitle: z.string().max(500).optional(),
    videoLabel: z.string().max(500).optional(),
    bibleVerses: z.array(z.string().max(128)).max(50).optional(),
    initialArtifacts: z.record(z.string(), JobArtifactEntrySchema).optional(),
    videoDocumentId: z.string().optional(),
    requestedTranscriptionProvider: z
      .enum(["automatic", "elevenlabs", "mux"])
      .optional(),
  })
  .strict()

export const ForgeVideoEnrichmentOutputSchema = z
  .object({
    ok: z.literal(true),
    jobId: z.string(),
    runId: z.string(),
    acceptedAt: z.string(),
  })
  .strict()

export type ForgeVideoEnrichmentInput = z.infer<
  typeof ForgeVideoEnrichmentInputSchema
>
export type ForgeVideoEnrichmentOutput = z.infer<
  typeof ForgeVideoEnrichmentOutputSchema
>

/** Shared by start admission and the actual graph; explicit intent wins. */
export function enrichmentSourceReuse(
  input: ForgeVideoEnrichmentInput,
): "none" | "transcript" | "subtitles" {
  if (
    input.requestedTranscriptionProvider === "mux" ||
    input.requestedTranscriptionProvider === "elevenlabs"
  )
    return "none"
  if (input.initialArtifacts?.transcript?.kind === "downloadable")
    return "transcript"
  if (input.initialArtifacts?.subtitles?.kind === "downloadable")
    return "subtitles"
  return "none"
}
