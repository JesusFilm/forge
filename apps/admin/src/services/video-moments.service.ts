// A video's transcript-derived "moments" — the lean read behind
// `Video.moments` (TV's in-player companion panel, the ministry cousin of
// Prime Video's X-Ray).
//
// One projection per transcript chunk: timing (when the chunker was
// segment-aware), the enriched content summary, and the Bible references the
// enrichment attached to that span. Deliberately NOT the whole chunk — `text`,
// `rawSourceText` and the embedding are search internals, and the embedding
// must never leave the backend (schema.test.ts pins that).
//
// Timing semantics stay CLIENT-OWNED: rows are returned in chunk order with
// `startSeconds` as stored (null = the chunker had no timecodes), and no
// COALESCE-to-0 here — `sceneRecommendations` coalesces for its own contract,
// and that default is exactly what a moment-follower must be able to tell
// apart from "genuinely starts at 0:00".

import { prisma } from "@/db/client"

export type VideoMomentView = {
  startSeconds: number | null
  endSeconds: number | null
  summary: string | null
  bibleVerses: string[]
}

/** Server-side ceiling. A two-hour feature at ~30–60s chunks is roughly
 *  120–240 rows; 300 covers that with headroom while keeping the payload on
 *  the PUBLIC video query bounded. */
export const MAX_VIDEO_MOMENTS = 300
export const DEFAULT_VIDEO_MOMENTS = 150

/**
 * Chunks for the video's transcript in the requested language, falling back
 * to English, `[]` when neither exists. Language fallback mirrors the
 * card-content convention (locale text falls back rather than erroring), and
 * an empty list — never a throw — is the "no transcript" signal, so the
 * public video query cannot be failed by a missing enrichment artifact.
 */
export async function listVideoMoments({
  videoId,
  languageSlug,
  limit,
}: {
  videoId: string
  languageSlug?: string | null
  limit?: number | null
}): Promise<VideoMomentView[]> {
  const take = Math.min(
    Math.max(1, Math.floor(limit ?? DEFAULT_VIDEO_MOMENTS)),
    MAX_VIDEO_MOMENTS,
  )

  const primary = languageSlug?.trim() || "en"
  let transcript = await findTranscript(videoId, primary)
  if (transcript == null && primary !== "en") {
    transcript = await findTranscript(videoId, "en")
  }
  if (transcript == null) return []

  const chunks = await prisma.videoTranscriptChunk.findMany({
    where: { transcriptId: transcript.id },
    orderBy: { chunkIndex: "asc" },
    take,
    select: {
      startSeconds: true,
      endSeconds: true,
      contentSummary: true,
      bibleVerses: true,
    },
  })

  return chunks.map((chunk) => ({
    startSeconds: chunk.startSeconds,
    endSeconds: chunk.endSeconds,
    summary: chunk.contentSummary?.trim() || null,
    bibleVerses: chunk.bibleVerses ?? [],
  }))
}

/** Newest transcript for (video, language) — re-ingests replace rather than
 *  version, but generatedAt ordering keeps this deterministic if two editions
 *  both carry one. */
function findTranscript(videoId: string, language: string) {
  return prisma.videoTranscript.findFirst({
    where: { videoId, language },
    orderBy: { generatedAt: "desc" },
    select: { id: true },
  })
}
