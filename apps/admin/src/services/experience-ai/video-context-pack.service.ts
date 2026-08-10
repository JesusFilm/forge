/**
 * Video context pack — the grounding source for video-anchored experience
 * generation.
 *
 * Given a single anchor video + locale, assemble that video's real curated data
 * (study questions, Bible citations, optional scene/transcript enrichment, media)
 * into one typed object that the section generator composes from — turning the
 * model from an author into a composer over real source material.
 *
 * Discipline (mirrors `experience-ai.service.ts`):
 *  - dependency-injected `PrismaClient`; batched reads; no inline ABAC (the
 *    caller's session guard runs upstream);
 *  - every enrichment source is OPTIONAL — a per-source read failure (or empty
 *    result) degrades to that source being absent and is recorded in
 *    `provenance`; the function never throws on a missing source;
 *  - the anchor must pass `PLAYABLE_CANDIDATE_VIDEO_WHERE` (the same gate the
 *    candidate loader enforces) — a non-playable anchor yields `null`;
 *  - it NEVER reads or returns verse text. Citations carry the structured
 *    reference only (text is resolved at web render).
 */
import type { PrismaClient } from "@prisma/client"
import { resolveVideoDisplayTitle } from "@forge/content-display"

import { videoStudyQuestionsFilter } from "@/graphql/types/video"

import { formatCitationReference } from "./citation-reference"
import { PLAYABLE_CANDIDATE_VIDEO_WHERE } from "./experience-ai.service"
import {
  selectVideoDisplayLocaleCandidates,
  videoDisplayLocaleFilters,
} from "./video-display-title-candidates"

const DEFAULT_SCENE_LIMIT = 12
const DEFAULT_TRANSCRIPT_CHUNK_LIMIT = 24

/** The anchor video, shaped to mirror `VideoCandidate` so the action can build
 *  the `v01` candidate the normalizer resolves against. */
export type ContextPackVideo = {
  videoId: string
  slug: string
  title: string
  description: string | null
  previewImageUrl: string | null
  previewStreamUrl: string | null
  label: string | null
}

export type ContextPackStudyQuestion = {
  text: string
  order: number | null
}

export type ContextPackCitation = {
  /** Composed localized label, e.g. "John 20:19-29". Never verse text. */
  reference: string
  osisId: string | null
  chapterStart: number | null
  chapterEnd: number | null
  verseStart: number | null
  verseEnd: number | null
}

export type ContextPackScene = {
  description: string
  themes: string[]
  spiritualContext: string[]
}

export type VideoContextPackProvenance = {
  studyQuestions: boolean
  citations: boolean
  scene: boolean
  transcript: boolean
  /** Set when study questions fell back off the requested locale (e.g. "primary"). */
  localeFallback: string | null
}

export type VideoContextPack = {
  video: ContextPackVideo
  studyQuestions: ContextPackStudyQuestion[]
  citations: ContextPackCitation[]
  scene: ContextPackScene[] | null
  transcript: string | null
  provenance: VideoContextPackProvenance
}

function warn(message: string, error: unknown): void {
  // Bracketed-label prefix style, matching experience-ai.service.ts. Plain
  // string (never JSON.stringify) so Railway logsV2 does not silence it.
  console.warn(
    `[experience-ai] ${message}`,
    error instanceof Error ? error.message : String(error),
  )
}

/** Hydrate the anchor video into a `VideoCandidate`-shaped object. Returns null
 *  when the video is missing or not playable (mirrors the candidate loader). */
async function loadAnchorVideo(
  prisma: PrismaClient,
  videoId: string,
  locale: string,
): Promise<ContextPackVideo | null> {
  const video = await prisma.video.findFirst({
    where: { id: videoId, ...PLAYABLE_CANDIDATE_VIDEO_WHERE },
    select: { id: true, slug: true, label: true },
  })
  if (!video) return null

  const [locales, dubs, images] = await Promise.all([
    prisma.videoLocale.findMany({
      where: {
        videoId,
        status: "PUBLISHED",
        deletedAt: null,
        OR: videoDisplayLocaleFilters(locale),
      },
      select: {
        locale: true,
        languageSlug: true,
        title: true,
        description: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    }),
    prisma.videoDub.findMany({
      where: { videoId, deletedAt: null },
      select: {
        published: true,
        hls: true,
        dash: true,
        share: true,
        language: { select: { bcp47: true, iso3: true, slug: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.videoImage.findMany({
      where: { videoId },
      select: { url: true },
      orderBy: { createdAt: "asc" },
    }),
  ])

  const { preferredRow, requestedTitles, englishTitles } =
    selectVideoDisplayLocaleCandidates(locales, locale)
  const previewImageUrl = images.find((row) => row.url)?.url ?? null

  // Same dub-preference cascade as loadExperienceAiVideoCandidates: a playable
  // locale-matched dub, then any locale-matched stream, then any playable dub.
  const localeMatches = (row: (typeof dubs)[number]) =>
    row.language?.bcp47 === locale ||
    row.language?.iso3 === locale ||
    row.language?.slug === locale
  const preferredDub =
    dubs.find((row) => row.published && row.hls && localeMatches(row)) ??
    dubs.find(
      (row) => (row.hls || row.dash || row.share) && localeMatches(row),
    ) ??
    dubs.find((row) => row.published && row.hls) ??
    null

  return {
    videoId: video.id,
    slug: video.slug,
    title:
      resolveVideoDisplayTitle({
        requestedTitles,
        englishTitles,
        slug: video.slug,
      }) ?? "Video",
    description: preferredRow?.description?.trim() || null,
    previewImageUrl,
    previewStreamUrl:
      preferredDub?.hls ?? preferredDub?.dash ?? preferredDub?.share ?? null,
    label: video.label ? String(video.label) : null,
  }
}

async function loadStudyQuestions(
  prisma: PrismaClient,
  videoId: string,
  locale: string,
): Promise<{
  items: ContextPackStudyQuestion[]
  localeFallback: string | null
}> {
  const read = async (filterArgs: { locale?: string | null }) => {
    const { where, orderBy } = videoStudyQuestionsFilter(filterArgs)
    const rows = await prisma.videoStudyQuestion.findMany({
      where: { ...where, videoId, text: { not: "" } },
      orderBy,
      select: { text: true, order: true },
    })
    return rows.map((row) => ({ text: row.text, order: row.order }))
  }

  try {
    const localed = await read({ locale })
    if (localed.length > 0) return { items: localed, localeFallback: null }
    // Fall back to the video's primary-language study questions.
    const primary = await read({ locale: null })
    return {
      items: primary,
      localeFallback: primary.length > 0 ? "primary" : null,
    }
  } catch (error) {
    warn("context-pack study-question read failed", error)
    return { items: [], localeFallback: null }
  }
}

async function loadCitations(
  prisma: PrismaClient,
  videoId: string,
  locale: string,
): Promise<ContextPackCitation[]> {
  try {
    const rows = await prisma.bibleCitation.findMany({
      where: { videoId, deletedAt: null },
      orderBy: { order: "asc" },
      select: {
        osisId: true,
        chapterStart: true,
        chapterEnd: true,
        verseStart: true,
        verseEnd: true,
        bibleBook: { select: { name: true, osisId: true } },
      },
    })
    return rows.map((row) => ({
      reference: formatCitationReference(
        row.bibleBook?.name,
        row,
        locale,
        row.bibleBook?.osisId ?? row.osisId ?? "",
      ),
      osisId: row.osisId,
      chapterStart: row.chapterStart,
      chapterEnd: row.chapterEnd,
      verseStart: row.verseStart,
      verseEnd: row.verseEnd,
    }))
  } catch (error) {
    warn("context-pack citation read failed", error)
    return []
  }
}

async function loadScenes(
  prisma: PrismaClient,
  videoId: string,
  locale: string,
  limit: number,
): Promise<ContextPackScene[]> {
  try {
    const rows = await prisma.videoSceneLocale.findMany({
      where: { locale, videoScene: { videoId } },
      orderBy: { videoScene: { sceneIndex: "asc" } },
      take: limit,
      select: { description: true, themes: true, spiritualContext: true },
    })
    return rows.map((row) => ({
      description: row.description,
      themes: row.themes,
      spiritualContext: row.spiritualContext,
    }))
  } catch (error) {
    warn("context-pack scene read failed", error)
    return []
  }
}

async function loadTranscriptExcerpt(
  prisma: PrismaClient,
  videoId: string,
  locale: string,
  chunkLimit: number,
): Promise<string | null> {
  try {
    const chunks = await prisma.videoTranscriptChunk.findMany({
      where: { language: locale, transcript: { videoId } },
      orderBy: { chunkIndex: "asc" },
      take: chunkLimit,
      select: { text: true },
    })
    if (chunks.length === 0) return null
    return chunks
      .map((chunk) => chunk.text.trim())
      .filter(Boolean)
      .join(" ")
  } catch (error) {
    warn("context-pack transcript read failed", error)
    return null
  }
}

/**
 * Assemble the grounding pack for one anchor video. Returns `null` when the
 * anchor video is missing or not playable; otherwise a partial pack whose
 * `provenance` records which sources were present.
 */
export async function loadVideoContextPack(
  prisma: PrismaClient,
  {
    videoId,
    locale,
    sceneLimit = DEFAULT_SCENE_LIMIT,
    transcriptChunkLimit = DEFAULT_TRANSCRIPT_CHUNK_LIMIT,
  }: {
    videoId: string
    locale: string
    sceneLimit?: number
    transcriptChunkLimit?: number
  },
): Promise<VideoContextPack | null> {
  const video = await loadAnchorVideo(prisma, videoId, locale)
  if (!video) return null

  const [studyQuestions, citations, scenes, transcript] = await Promise.all([
    loadStudyQuestions(prisma, videoId, locale),
    loadCitations(prisma, videoId, locale),
    loadScenes(prisma, videoId, locale, sceneLimit),
    loadTranscriptExcerpt(prisma, videoId, locale, transcriptChunkLimit),
  ])

  return {
    video,
    studyQuestions: studyQuestions.items,
    citations,
    scene: scenes.length > 0 ? scenes : null,
    transcript,
    provenance: {
      studyQuestions: studyQuestions.items.length > 0,
      citations: citations.length > 0,
      scene: scenes.length > 0,
      transcript: transcript != null,
      localeFallback: studyQuestions.localeFallback,
    },
  }
}
