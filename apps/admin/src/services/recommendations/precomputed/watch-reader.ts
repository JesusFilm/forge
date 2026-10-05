import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { resolveRecommendationLocaleIdentity } from "../locale-identity"

const SavedChoice = z.object({
  targetVideoId: z.string().min(1).max(191),
  kind: z.enum(["direct", "alternative"]),
  rank: z.number().int().positive(),
  relationship: z.string(),
  reasonEnglish: z.string(),
  evidence: z.unknown(),
})

type Choice = z.infer<typeof SavedChoice>

type PlayableVideo = {
  id: string
  slug: string
  deletedAt: Date | null
  restrictViewPlatforms: string[]
  locales: Array<{
    locale: string | null
    title: string | null
    description?: string | null
    status: string
  }>
  dubs: Array<{
    published: boolean
    language: { slug: string | null } | null
    muxVideo: { playbackId: string | null; deletedAt: Date | null } | null
    duration: number | null
    lengthInMilliseconds: bigint | null
  }>
  images: Array<{
    mobileCinematicHigh?: string | null
    videoStill?: string | null
    thumbnail?: string | null
    url?: string | null
  }>
}

export type PlayableSavedChoice = Choice & {
  videoId: string
  videoSlug: string
  videoTitle: string
  description: string
  imageUrl: string
  playbackId: string
  durationSeconds: number | null
}

/** Unknown source eligibility is a denial, not permission to recover elsewhere. */
export class PrecomputedSourceEligibilityUnavailableError extends Error {
  constructor() {
    super("source_eligibility_unavailable")
    this.name = "PrecomputedSourceEligibilityUnavailableError"
  }
}

export function videoPlayableForWatch(
  video: PlayableVideo | undefined,
  locale: string,
  audioLanguageSlug: string,
):
  | "watch_unavailable"
  | "presentation_unavailable"
  | "audio_unavailable"
  | null {
  if (
    !video ||
    video.deletedAt ||
    video.restrictViewPlatforms.includes("watch")
  )
    return "watch_unavailable"
  if (
    !video.locales.some(
      (item) =>
        item.locale === locale &&
        item.status === "PUBLISHED" &&
        item.title?.trim(),
    )
  )
    return "presentation_unavailable"
  if (
    !video.dubs.some(
      (dub) =>
        dub.published &&
        dub.language?.slug === audioLanguageSlug &&
        !dub.muxVideo?.deletedAt &&
        dub.muxVideo?.playbackId?.trim(),
    )
  )
    return "audio_unavailable"
  return null
}

export function selectPlayablePrecomputedChoices(input: {
  choices: readonly Choice[]
  videos: readonly PlayableVideo[]
  sourceVideoId: string
  locale: string
  audioLanguageSlug: string
}) {
  const byId = new Map(input.videos.map((video) => [video.id, video]))
  const ordered = [...input.choices].sort(
    (left, right) =>
      (left.kind === right.kind ? 0 : left.kind === "direct" ? -1 : 1) ||
      left.rank - right.rank ||
      left.targetVideoId.localeCompare(right.targetVideoId),
  )
  const gaps: Array<{ targetVideoId: string; reason: string }> = []
  const items: PlayableSavedChoice[] = []
  for (const choice of ordered) {
    const video = byId.get(choice.targetVideoId)
    const reason =
      choice.targetVideoId === input.sourceVideoId
        ? "self_target"
        : videoPlayableForWatch(video, input.locale, input.audioLanguageSlug)
    if (reason) {
      gaps.push({ targetVideoId: choice.targetVideoId, reason })
      continue
    }
    if (items.length >= 6) continue
    const eligibleVideo = video!
    const locale = eligibleVideo.locales.find(
      (value) =>
        value.locale === input.locale &&
        value.status === "PUBLISHED" &&
        value.title?.trim(),
    )!
    const dub = eligibleVideo.dubs.find(
      (value) =>
        value.published &&
        value.language?.slug === input.audioLanguageSlug &&
        !value.muxVideo?.deletedAt &&
        value.muxVideo?.playbackId?.trim(),
    )!
    const playbackId = dub.muxVideo!.playbackId!
    const image = eligibleVideo.images[0]
    const durationSeconds =
      dub.lengthInMilliseconds != null
        ? Number(dub.lengthInMilliseconds) / 1_000
        : dub.duration
    items.push({
      ...choice,
      videoId: eligibleVideo.id,
      videoSlug: eligibleVideo.slug,
      videoTitle: locale.title!.slice(0, 512),
      description: (locale.description?.trim() || "").slice(0, 4_096),
      imageUrl:
        image?.mobileCinematicHigh ||
        image?.videoStill ||
        image?.thumbnail ||
        image?.url ||
        `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?time=0`,
      playbackId,
      durationSeconds:
        durationSeconds != null &&
        Number.isFinite(durationSeconds) &&
        durationSeconds >= 0 &&
        durationSeconds <= 86_400
          ? durationSeconds
          : null,
    })
  }
  return {
    items,
    gaps,
    coverageGap:
      ordered.length === 0
        ? ("no_connections" as const)
        : items.length === 0
          ? ("no_playable_connections" as const)
          : null,
  }
}

/** Shared guard for both saved delivery and its private incumbent recovery. */
export async function verifyPrecomputedSourceEligibility(
  prisma: Pick<Prisma.TransactionClient, "video">,
  input: { seedMediaId: string; locale: string; audioLanguageSlug: string },
): Promise<boolean> {
  const locale = resolveRecommendationLocaleIdentity(
    input.locale,
    input.audioLanguageSlug,
  ).presentationLocale
  let sourceVideo: {
    deletedAt: Date | null
    restrictViewPlatforms: string[]
    locales: Array<{ title: string | null }>
    dubs: Array<{ muxVideo: { playbackId: string | null } | null }>
  } | null
  try {
    sourceVideo = await prisma.video.findUnique({
      where: { id: input.seedMediaId },
      select: {
        deletedAt: true,
        restrictViewPlatforms: true,
        locales: {
          where: { locale, status: "PUBLISHED", deletedAt: null },
          select: { title: true },
          take: 1,
        },
        dubs: {
          where: {
            deletedAt: null,
            published: true,
            language: { slug: input.audioLanguageSlug },
            muxVideo: { deletedAt: null, playbackId: { not: null } },
          },
          select: { muxVideo: { select: { playbackId: true } } },
          take: 1,
        },
      },
    })
  } catch {
    throw new PrecomputedSourceEligibilityUnavailableError()
  }
  return !(
    !sourceVideo ||
    sourceVideo.deletedAt ||
    sourceVideo.restrictViewPlatforms.includes("watch") ||
    !sourceVideo.locales.some((value) => value.title?.trim()) ||
    !sourceVideo.dubs.some((value) => value.muxVideo?.playbackId?.trim())
  )
}

/** Read one completed immutable generation and recheck mutable Watch availability. */
export async function readPrecomputedWatchChoices(
  prisma: Pick<
    Prisma.TransactionClient,
    | "recommendationPrecomputedGeneration"
    | "recommendationPrecomputedSource"
    | "video"
  >,
  input: { seedMediaId: string; locale: string; audioLanguageSlug: string },
) {
  if (!(await verifyPrecomputedSourceEligibility(prisma, input)))
    return { state: "source_unavailable" as const, generationId: null }
  const locale = resolveRecommendationLocaleIdentity(
    input.locale,
    input.audioLanguageSlug,
  ).presentationLocale
  const generation = await prisma.recommendationPrecomputedGeneration.findFirst(
    {
      where: { status: "complete" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        modelId: true,
        promptVersion: true,
        completedAt: true,
      },
    },
  )
  if (!generation)
    return { state: "generation_unavailable" as const, generationId: null }
  const source = await prisma.recommendationPrecomputedSource.findUnique({
    where: {
      generationId_sourceVideoId: {
        generationId: generation.id,
        sourceVideoId: input.seedMediaId,
      },
    },
    select: { payload: true, status: true },
  })
  if (!source)
    return { state: "not_in_generation" as const, generationId: generation.id }
  if (source.status !== "complete")
    return { state: "source_incomplete" as const, generationId: generation.id }
  const choices = z.array(SavedChoice).parse(source.payload)
  const videos = await prisma.video.findMany({
    where: { id: { in: choices.map((item) => item.targetVideoId) } },
    select: {
      id: true,
      slug: true,
      deletedAt: true,
      restrictViewPlatforms: true,
      locales: {
        where: { locale, status: "PUBLISHED", deletedAt: null },
        select: { locale: true, title: true, description: true, status: true },
        take: 1,
      },
      dubs: {
        where: {
          deletedAt: null,
          published: true,
          language: { slug: input.audioLanguageSlug },
          muxVideo: { deletedAt: null, playbackId: { not: null } },
        },
        select: {
          published: true,
          language: { select: { slug: true } },
          muxVideo: { select: { playbackId: true, deletedAt: true } },
          duration: true,
          lengthInMilliseconds: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 1,
      },
      images: {
        where: { deletedAt: null },
        select: {
          mobileCinematicHigh: true,
          videoStill: true,
          thumbnail: true,
          url: true,
        },
        take: 1,
      },
    },
  })
  const selected = selectPlayablePrecomputedChoices({
    choices,
    videos,
    sourceVideoId: input.seedMediaId,
    locale,
    audioLanguageSlug: input.audioLanguageSlug,
  })
  return {
    state: "ready" as const,
    generationId: generation.id,
    ...selected,
  }
}
