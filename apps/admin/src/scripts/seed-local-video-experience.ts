/**
 * LOCAL DEV ONLY. Seeds one published Experience carrying a playable VideoBlock,
 * so apps/mobile's two SDUI player routes (`/video/[sectionKey]` and, via a
 * carousel, `/collection/[sectionKey]`) are reachable against local admin.
 *
 * Neither existing seed can produce this: `seed-web-fixtures` writes no
 * VideoDub rows at all, and `seed-watch-homepage-experience` needs ~45
 * production coreIds and sets no `languageId` on its items, so admin resolves
 * `videoDub: null` for every one.
 *
 * Refuses to run against anything that looks like a deployed database.
 */
import { BlocksSchema } from "@/domain/blocks"

/** Same posture as seed-watch-homepage-experience: never touch a deployed DB. */
function assertNotProdUrl(raw: string | undefined): void {
  if (!raw) throw new Error("DATABASE_URL is not set")
  let host: string
  try {
    host = new URL(raw).hostname
  } catch {
    throw new Error("DATABASE_URL is not a parseable URL; refusing to run")
  }
  const blocked = [".railway.app", ".jesusfilm.org"]
  if (blocked.some((b) => host.endsWith(b))) {
    throw new Error(`Refusing to seed against a deployed host: ${host}`)
  }
}

// A real, public Mux asset — both the HLS manifest and the poster return 200.
const PLAYBACK_ID = "x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw"
const HLS = `https://stream.mux.com/${PLAYBACK_ID}.m3u8`
const SLUG = "seed-video-demo"
const VIDEO_SECTION_KEY = "seed-video-one"
const CAROUSEL_SECTION_KEY = "seed-carousel-one"

async function main(): Promise<void> {
  assertNotProdUrl(process.env.DATABASE_URL)
  const { prisma } = await import("@/db/client")

  try {
    const language = await prisma.language.upsert({
      where: { coreId: "529" },
      update: {},
      create: {
        coreId: "529",
        name: { en: "English" },
        bcp47: "en",
        slug: "english",
      },
    })

    const video = await prisma.video.upsert({
      where: { coreId: "seed-demo-video" },
      update: { deletedAt: null },
      create: {
        coreId: "seed-demo-video",
        slug: "seed-demo-video",
        label: "SHORT_FILM",
        publishedAt: new Date(),
        primaryLanguageId: language.id,
      },
    })

    await prisma.videoLocale.upsert({
      where: {
        videoId_languageId: { videoId: video.id, languageId: language.id },
      },
      update: { status: "PUBLISHED" },
      create: {
        videoId: video.id,
        languageId: language.id,
        locale: "en",
        title: "Seed Demo Video",
        description: "Local seed for SDUI player verification.",
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    })

    const mux = await prisma.muxVideo.upsert({
      where: { coreId: "seed-demo-mux" },
      update: { playbackId: PLAYBACK_ID },
      create: { coreId: "seed-demo-mux", playbackId: PLAYBACK_ID },
    })

    const edition = await prisma.videoEdition.upsert({
      where: { coreId: "seed-demo-edition" },
      update: {},
      create: { coreId: "seed-demo-edition", name: "base" },
    })

    // The gate: admin only resolves videoDub when published is true, hls is
    // non-null, and the block's languageId matches this row exactly.
    await prisma.videoDub.upsert({
      where: { coreId: "seed-demo-dub" },
      update: { hls: HLS, published: true, deletedAt: null },
      create: {
        coreId: "seed-demo-dub",
        videoId: video.id,
        languageId: language.id,
        videoEditionId: edition.id,
        muxVideoId: mux.id,
        hls: HLS,
        published: true,
        duration: 120,
      },
    })

    const blocks = BlocksSchema.parse([
      {
        t: "video",
        sectionKey: VIDEO_SECTION_KEY,
        useRouteVideo: false,
        videoId: video.id,
        languageId: language.id,
        title: "Seed Demo Video",
        subtitle: "Tap to open the SDUI video route",
        autoplay: true,
        muted: false,
        showControls: true,
      },
      {
        t: "videoCarousel",
        sectionKey: CAROUSEL_SECTION_KEY,
        title: "Seed Demo Carousel",
        itemsSource: "manual",
        items: [
          {
            videoId: video.id,
            languageId: language.id,
            titleOverride: "Seed Demo Episode",
          },
        ],
      },
    ])

    const existing = await prisma.experienceLocale.findFirst({
      where: { locale: "en", slug: SLUG },
      select: { id: true, experienceId: true },
    })

    if (existing) {
      await prisma.experience.update({
        where: { id: existing.experienceId },
        data: { isTemplate: false, archivedAt: null },
      })
      await prisma.experienceLocale.update({
        where: { id: existing.id },
        data: {
          blocks,
          title: "Seed Video Demo",
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      })
      console.log(`[seed] updated experience ${SLUG}`)
    } else {
      await prisma.experience.create({
        data: {
          isTemplate: false,
          ownerId: null,
          locales: {
            create: {
              locale: "en",
              slug: SLUG,
              isHomepage: false,
              title: "Seed Video Demo",
              blocks,
              status: "PUBLISHED",
              publishedAt: new Date(),
            },
          },
        },
      })
      console.log(`[seed] created experience ${SLUG}`)
    }

    console.log(`[seed] video sectionKey    = ${VIDEO_SECTION_KEY}`)
    console.log(`[seed] carousel sectionKey = ${CAROUSEL_SECTION_KEY}`)
    console.log(`[seed] hls                 = ${HLS}`)
  } finally {
    await prisma.$disconnect()
  }
}

void main()
