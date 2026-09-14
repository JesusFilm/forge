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
 * Moments for the video in the requested language, falling back to English,
 * `[]` when neither exists. Language fallback mirrors the card-content
 * convention (locale text falls back rather than erroring), and an empty
 * list — never a throw — is the "no transcript" signal, so the public video
 * query cannot be failed by a missing enrichment artifact.
 *
 * Source preference, per resolved language: when HUMAN-REVIEWED editorial
 * beats exist (`video_moment_editorial`), they are served EXCLUSIVELY — the
 * machine chunk projection is not consulted, so a reviewed film can never
 * show a mixed raw/reviewed panel. The full ladder is:
 *
 *   requested-language editorial → requested-language chunks
 *     → en editorial → en chunks → []
 *
 * (Each language resolves its own best source before falling back — a film
 * reviewed only in English still serves Spanish chunks to a Spanish request
 * when they exist, matching how transcripts already fall back.)
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

  const primaryEditorial = await findEditorialMoments(videoId, primary, take)
  if (primaryEditorial.length > 0) return primaryEditorial

  let transcript = await findTranscript(videoId, primary)
  if (transcript == null && primary !== "en") {
    const englishEditorial = await findEditorialMoments(videoId, "en", take)
    if (englishEditorial.length > 0) return englishEditorial
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

/** The human-reviewed beat set for (video, language), projected onto the same
 *  view as the chunk path. The loader's row constraints (non-empty summary,
 *  start >= 0) make per-row trimming unnecessary, but summary normalization
 *  stays identical to the chunk path so the wire contract has ONE shape. */
async function findEditorialMoments(
  videoId: string,
  languageSlug: string,
  take: number,
): Promise<VideoMomentView[]> {
  const beats = await prisma.videoMomentEditorial.findMany({
    where: { videoId, languageSlug },
    orderBy: { beatIndex: "asc" },
    take,
    select: {
      startSeconds: true,
      endSeconds: true,
      summary: true,
      bibleVerses: true,
    },
  })

  return beats.map((beat) => ({
    startSeconds: beat.startSeconds,
    endSeconds: beat.endSeconds,
    summary: beat.summary.trim() || null,
    bibleVerses: beat.bibleVerses ?? [],
  }))
}
