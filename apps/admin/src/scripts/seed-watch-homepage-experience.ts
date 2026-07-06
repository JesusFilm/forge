#!/usr/bin/env tsx
/**
 * Seed the canonical Watch homepage Experience from synced Admin videos.
 *
 * The current Web-owned hero remains static and is represented by the
 * `watchHomeHero` placeholder block. Below-hero rows become explicit
 * `mediaCollection` blocks whose items reference Admin Video ids resolved
 * from the existing Core ids.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
 *   pnpm --filter @forge/admin seed-watch-homepage-experience
 */

import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import type { VideoLabel } from "@prisma/client"
import { BlocksSchema } from "@/domain/blocks"

type WatchHomeSeedSection = {
  id: string
  eyebrow: string
  title: string
  description?: string
  layout: "rail" | "grid"
  variant?: "carousel" | "grid" | "collection"
  showSequenceNumbers?: boolean
  coreIds: readonly string[]
}

type SeedVideo = {
  id: string
  coreId: string
  slug: string
  label: VideoLabel | null
  locales: {
    title: string | null
    description: string | null
    snippet: string | null
  }[]
  images: {
    mobileCinematicHigh: string | null
    mobileCinematicLow: string | null
    mobileCinematicVeryLow: string | null
    thumbnail: string | null
    videoStill: string | null
    url: string | null
  }[]
}

const PROD_HOST_DENY_SET = new Set<string>([
  "admin.jesusfilm.org",
  "www.jesusfilm.org",
  "jesusfilm.org",
  "manager.jesusfilm.org",
  "web.jesusfilm.org",
])

const WATCH_HOME_SEED_SECTIONS: readonly WatchHomeSeedSection[] = [
  {
    id: "home-video-gospels",
    layout: "rail",
    eyebrow: "Video Bible Collection",
    title: "Discover the full story",
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    coreIds: [
      "1_jf-0-0",
      "2_GOJ-0-0",
      "GOMattCollection",
      "GOMarkCollection",
      "GOLukeCollection",
      "GOJohnCollection",
    ],
  },
  {
    id: "home-collection-showcase-grid",
    layout: "grid",
    eyebrow: "Video Bible Collection",
    title: "Scripture Told Through Film",
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    showSequenceNumbers: true,
    coreIds: [
      "1_jf-0-0",
      "2_GOJ-0-0",
      "GOMattCollection",
      "GOMarkCollection",
      "GOLukeCollection",
      "GOJohnCollection",
    ],
  },
  {
    id: "home-collection-showcase-grid-christmas-advent",
    layout: "grid",
    eyebrow: "Christmas Advent",
    title: "Christmas Advent Countdown",
    description:
      "Join our Advent journey with a daily video that builds anticipation for Christmas, exploring the hope, joy, and promise of Jesus' arrival.",
    showSequenceNumbers: true,
    coreIds: [
      "2_0-ConsideringChristmas",
      "2_0-SupremeChristmas",
      "2_0-Noelevator",
      "2_0-TimeForChange",
      "2_0-Stunned",
      "1_wl604412-0-0",
      "9_0-TheSavior5505",
      "1_cl1301-0-0",
      "3_0-40DWJ_02-0-0",
      "1_jf6102-0-0",
      "1_riv_11-0-0",
      "1_wl604410-0-0",
      "6_GOLuke2601",
      "6_GOLuke2602",
      "6_GOMatt2501",
    ],
  },
  {
    id: "home-collection-bibleproject-advent",
    layout: "grid",
    variant: "collection",
    eyebrow: "Bible Project",
    title: "BibleProject Advent",
    coreIds: [
      "11_Advent0104",
      "11_Advent0204",
      "11_Advent0304",
      "11_Advent0404",
    ],
  },
  {
    id: "home-collection-nua",
    layout: "grid",
    eyebrow: "NUA Series",
    title: "NUA",
    coreIds: ["7_0-ncs01", "7_0-ncs02", "7_0-ncs03"],
  },
  {
    id: "home-collection-nua-origins-worth",
    layout: "grid",
    eyebrow: "Worth Series",
    title: "NUA Worth",
    coreIds: [
      "7_Origins2Worth0103",
      "7_Origins2Worth0203",
      "7_Origins2Worth0303",
    ],
  },
  {
    id: "home-collection-new-believer-course",
    layout: "grid",
    eyebrow: "Video Course",
    title: "Journey with Jesus",
    coreIds: [
      "8_NBC01",
      "8_NBC02",
      "8_NBC03",
      "8_NBC04",
      "8_NBC05",
      "8_NBC06",
      "8_NBC07",
      "8_NBC08",
      "8_NBC09",
      "8_NBC10",
    ],
  },
  {
    id: "home-collection-showcase-grid-vertical",
    layout: "grid",
    variant: "collection",
    eyebrow: "Every Gospel, Told on Video",
    title: "Scripture, Spoken Exactly as Written",
    description:
      "Explore our collection of videos and resources that bring the Bible to life through engaging stories and teachings.",
    coreIds: [
      "LUMOCollection",
      "GOMarkCollection",
      "GOLukeCollection",
      "GOJohnCollection",
    ],
  },
]

function assertNotProdUrl(rawUrl: string | undefined): void {
  if (!rawUrl) throw new Error("DATABASE_URL is required.")

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("Refusing to run: DATABASE_URL is not parseable.")
  }

  const host = parsed.hostname.toLowerCase()
  if (
    host.endsWith(".railway.app") ||
    host.endsWith(".jesusfilm.org") ||
    PROD_HOST_DENY_SET.has(host)
  ) {
    throw new Error(
      `[seed-watch-homepage-experience] Refusing to run against ${host}.`,
    )
  }
}

function pickVideoImage(video: SeedVideo): string | undefined {
  for (const image of video.images) {
    const url =
      image.mobileCinematicHigh ??
      image.mobileCinematicLow ??
      image.mobileCinematicVeryLow ??
      image.videoStill ??
      image.url ??
      image.thumbnail
    if (url) return url
  }

  return undefined
}

function humanizeLabel(label: string | null): string | undefined {
  if (!label) return undefined

  return label
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function truncateDescription(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined

  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= 180) return normalized

  return `${normalized.slice(0, 177).trimEnd()}...`
}

function compactMediaItem(item: {
  videoId: string
  videoSlug: string
  titleOverride?: string
  subtitleOverride?: string
  labelOverride?: string
  imageUrl?: string
}): {
  videoId: string
  videoSlug: string
  titleOverride?: string
  subtitleOverride?: string
  labelOverride?: string
  imageUrl?: string
} {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined),
  ) as typeof item
}

function buildMediaItem(video: SeedVideo) {
  const locale = video.locales[0]

  return compactMediaItem({
    videoId: video.id,
    videoSlug: video.slug,
    titleOverride: locale?.title ?? video.coreId ?? video.id,
    subtitleOverride: truncateDescription(
      locale?.snippet ?? locale?.description,
    ),
    labelOverride: humanizeLabel(video.label),
    imageUrl: pickVideoImage(video),
  })
}

async function main(): Promise<void> {
  assertNotProdUrl(process.env.DATABASE_URL)

  const { prisma } = await import("@/db/client")
  const allCoreIds = [
    ...new Set(WATCH_HOME_SEED_SECTIONS.flatMap((section) => section.coreIds)),
  ]

  try {
    const videos = await prisma.video.findMany({
      where: { coreId: { in: allCoreIds } },
      select: {
        id: true,
        coreId: true,
        slug: true,
        label: true,
        locales: {
          where: { locale: "en", status: "PUBLISHED", deletedAt: null },
          orderBy: { updatedAt: "desc" },
          select: { title: true, description: true, snippet: true },
          take: 1,
        },
        images: {
          where: { deletedAt: null },
          orderBy: { updatedAt: "desc" },
          select: {
            mobileCinematicHigh: true,
            mobileCinematicLow: true,
            mobileCinematicVeryLow: true,
            thumbnail: true,
            videoStill: true,
            url: true,
          },
        },
      },
    })
    const videoIdByCoreId = new Map(
      videos
        .filter((video) => video.coreId)
        .map((video) => [video.coreId as string, video.id]),
    )
    const videoById = new Map(videos.map((video) => [video.id, video]))
    const missingCoreIds = allCoreIds.filter(
      (coreId) => !videoIdByCoreId.has(coreId),
    )
    if (missingCoreIds.length > 0) {
      throw new Error(
        `[seed-watch-homepage-experience] Missing Core ids: ${missingCoreIds.join(", ")}`,
      )
    }

    const blocks = BlocksSchema.parse([
      { t: "watchHomeHero", sectionKey: "watch-home-hero" },
      ...WATCH_HOME_SEED_SECTIONS.map((section) => ({
        t: "mediaCollection",
        sectionKey: section.id,
        categoryLabel: section.eyebrow,
        variant:
          section.variant ?? (section.layout === "rail" ? "carousel" : "grid"),
        itemsSource: "manual",
        title: section.title,
        description: section.description,
        showItemNumbers: section.showSequenceNumbers ?? false,
        items: section.coreIds
          .map((coreId) => videoIdByCoreId.get(coreId))
          .filter((videoId): videoId is string => Boolean(videoId))
          .flatMap((videoId) => {
            const video = videoById.get(videoId)
            return video ? [buildMediaItem(video)] : []
          }),
      })),
    ])

    const existingLocales = await prisma.experienceLocale.findMany({
      where: { locale: "en", isHomepage: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, experienceId: true, slug: true },
    })
    const existingWatchHomeLocale =
      existingLocales.find((locale) => locale.slug === "watch-home") ?? null
    if (existingLocales.length > 1 && !existingWatchHomeLocale) {
      throw new Error(
        "[seed-watch-homepage-experience] Multiple homepage locales found; refusing to choose arbitrarily.",
      )
    }
    const existingLocale = existingWatchHomeLocale ?? existingLocales[0] ?? null

    await prisma.$transaction(async (tx) => {
      await tx.experienceLocale.updateMany({
        where: { locale: "en", isHomepage: true },
        data: { isHomepage: false },
      })

      if (existingLocale) {
        await tx.experience.update({
          where: { id: existingLocale.experienceId },
          data: { isTemplate: false, archivedAt: null },
        })
        await tx.experienceLocale.update({
          where: { id: existingLocale.id },
          data: {
            slug: "watch-home",
            pathSegment: null,
            isHomepage: true,
            title: "Watch",
            metaDescription:
              "Watch films, series, and video Bible resources from Jesus Film Project.",
            blocks,
            status: "PUBLISHED",
            publishedAt: new Date(),
          },
        })
        return
      }

      await tx.experience.create({
        data: {
          isTemplate: false,
          ownerId: null,
          locales: {
            create: {
              locale: "en",
              slug: "watch-home",
              isHomepage: true,
              title: "Watch",
              metaDescription:
                "Watch films, series, and video Bible resources from Jesus Film Project.",
              blocks,
              status: "PUBLISHED",
              publishedAt: new Date(),
            },
          },
        },
      })
    })

    process.stdout.write(
      JSON.stringify({
        event: "seed-watch-homepage-experience.complete",
        blocks: blocks.length,
        referencedCoreIds: allCoreIds.length,
        resolvedCoreIds: videoIdByCoreId.size,
        linkedVideoSlugs: videos.filter((video) => video.slug).length,
      }) + "\n",
    )
  } finally {
    await prisma.$disconnect()
  }
}

const isDirectInvoke =
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isDirectInvoke) {
  main().catch((error) => {
    process.stderr.write(
      `[seed-watch-homepage-experience] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exit(1)
  })
}
