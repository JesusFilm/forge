// Video enrichment workflow — orchestrates the full pipeline for a single video asset.
// Steps: ingest -> transcribe -> translate -> chapters -> metadata -> embeddings
//
// Uses workflow.dev for durable execution. Each step is idempotent.

export type VideoEnrichmentInput = {
  assetId: string
  muxPlaybackId: string
  audioUrl: string
  language?: string
}

export type VideoEnrichmentOutput = {
  assetId: string
  transcript: string
  language: string
  chapters: { title: string; startSeconds: number }[]
  tags: string[]
}

// Stub workflow definition — replace with workflow.dev SDK calls once
// @workflowdev/sdk types are confirmed against the actual package.
export async function runVideoEnrichment(
  input: VideoEnrichmentInput,
): Promise<VideoEnrichmentOutput> {
  const { transcribeAudio } = await import("@/services/transcription")

  const transcription = await transcribeAudio(
    input.audioUrl,
    input.language ?? "en",
  )

  // TODO: wire remaining steps (translation, chapters, metadata, embeddings)
  return {
    assetId: input.assetId,
    transcript: transcription.text,
    language: transcription.language,
    chapters: [],
    tags: [],
  }
}
