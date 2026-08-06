/**
 * Seed the local admin DB with two fully-populated, PUBLISHED Experiences that
 * exercise the full Experience block catalogue with real content + real videos.
 *
 *   1. "The Story of Jesus"  (slug: demo-story-of-jesus)  — a polished narrative
 *      landing page using the content + composition blocks.
 *   2. "Component Gallery"   (slug: demo-component-gallery) — one of (almost)
 *      every remaining block type, wired to real local videos.
 *
 * Idempotent: deletes any prior experiences carrying the seed slugs first.
 *
 * Usage (from repo root, against the LOCAL admin DB the dev stack uses):
 *   CI=true DATABASE_URL='postgresql://forge:forge@db:5432/forge_admin' \
 *     pnpm --filter @forge/admin exec tsx src/scripts/seed-experience.ts
 *
 * Safety: refuses production-like DATABASE_URL hosts.
 */

import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

import type { Principal } from "@/auth/principal"

// ── prod-URL guard (fail-closed) ─────────────────────────────────────────────
const PROD_DENY = new Set([
  "admin.jesusfilm.org",
  "www.jesusfilm.org",
  "jesusfilm.org",
  "manager.jesusfilm.org",
  "web.jesusfilm.org",
])
function assertNotProdUrl(raw: string | undefined): void {
  if (!raw) throw new Error("DATABASE_URL is required")
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    throw new Error("DATABASE_URL is not a parseable URL")
  }
  if (
    host.endsWith(".railway.app") ||
    host.endsWith(".jesusfilm.org") ||
    PROD_DENY.has(host)
  ) {
    throw new Error(`Refusing to run against production-like host: ${host}`)
  }
}

// ── real local videos (id + slug + Mux playback id) ─────────────────────────
const VIDEOS = {
  flow: {
    id: "cmq4st83r0zpho0rqbayxep0m",
    slug: "flow",
    playback: "MCwTSby007nIA1tUz5skWUfPC4g01AwPCLU9UlLOQtGjU",
  },
  blue: {
    id: "cmq4st6t40wg7o0rqfhaip80x",
    slug: "blue",
    playback: "JKcKTBbNYeJ2eDc3kPVAIYZErSYjsSodw3l01EnYJ1PA",
  },
  good: {
    id: "cmq4st89v10a7o0rqygipzy6p",
    slug: "good",
    playback: "Bi3HpgIxio7clIDHgc02ALyeFMV02revZqLN024R5m3LNQ",
  },
} as const
const stream = (p: string) => `https://stream.mux.com/${p}.m3u8`
const thumb = (p: string, time = 1) =>
  `https://image.mux.com/${p}/thumbnail.png?width=1200&time=${time}`

// ── the two experiences ──────────────────────────────────────────────────────
const STORY_BLOCKS = [
  {
    t: "videoHero",
    sectionKey: "hero",
    streamingUrl: stream(VIDEOS.flow.playback),
    heading: "The Story of Jesus",
    subheading:
      "Two thousand years ago, one life changed everything. Watch it unfold.",
    muted: true,
    showControls: true,
    ctaEnabled: true,
    ctaLabel: "Watch the film",
    ctaLink: `/watch/${VIDEOS.flow.slug}.html/english.html`,
  },
  {
    t: "text",
    sectionKey: "intro",
    heading: "Who is Jesus?",
    headingLevel: "h2",
    subtitle: "A carpenter from Nazareth who claimed to be the Son of God.",
    contentParagraphs: [
      "He was born in a stable and grew up in an ordinary town. Yet within three short years of public life, he drew crowds of thousands, confronted the powerful, healed the sick, and forgave the guilty.",
      "His followers said he rose from the dead. Two millennia later, his words are still translated into more languages, and read by more people, than any other in history.",
    ],
    variant: "lead",
  },
  {
    t: "infoBlocks",
    sectionKey: "why",
    heading: "Why his story still matters",
    description: "Three reasons the life of Jesus continues to move people.",
    blocks: [
      {
        icon: "📖",
        title: "Rooted in history",
        description:
          "His life is recorded by eyewitnesses and corroborated by sources outside the Bible.",
      },
      {
        icon: "❤️",
        title: "A message of grace",
        description:
          "He offered forgiveness and welcome to the very people his society pushed away.",
      },
      {
        icon: "🌍",
        title: "For every nation",
        description:
          "His invitation crosses every culture, language, and border on earth.",
      },
    ],
  },
  {
    t: "bibleQuotesCarousel",
    sectionKey: "scripture",
    heading: "Words of hope",
    quotes: [
      {
        reference: "John 3:16",
        text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
      },
      {
        reference: "John 14:6",
        text: "I am the way and the truth and the life. No one comes to the Father except through me.",
      },
      {
        reference: "Matthew 11:28",
        text: "Come to me, all you who are weary and burdened, and I will give you rest.",
      },
    ],
  },
  {
    t: "promoBanner",
    sectionKey: "promo",
    intro: "Featured film",
    heading: "Watch the Gospel of Luke",
    description:
      "An unabridged, word-for-word film of Luke's account — the most translated film in history.",
    ctaEnabled: true,
    ctaLabel: "Start watching",
    ctaLink: `/watch/${VIDEOS.good.slug}.html/english.html`,
  },
  {
    t: "section",
    sectionKey: "explore",
    backgroundColor: "#0b1220",
    content: [
      {
        t: "text",
        heading: "Explore the journey",
        headingLevel: "h2",
        contentParagraphs: [
          "From his birth to his resurrection, follow the moments that define the story.",
        ],
      },
      {
        t: "container",
        content: [
          { t: "containerSlot", spans: { xs: 12, md: 6 } },
          {
            t: "card",
            title: "His teachings",
            description:
              "Parables and sermons that turned the world's wisdom upside down.",
            variant: "featured",
          },
          { t: "containerSlot", spans: { xs: 12, md: 6 } },
          {
            t: "cta",
            heading: "Go deeper",
            body: "Reflect on the questions his life raises for yours.",
            buttonLabel: "Take the next step",
            buttonLink: `/watch/${VIDEOS.blue.slug}.html/english.html`,
            variant: "secondary",
          },
        ],
      },
      {
        t: "quizButton",
        buttonText: "What do you believe? Take the quiz",
        iframeSrc: "https://app.nextstep.is/journeys/demo",
      },
    ],
  },
  {
    t: "relatedQuestions",
    sectionKey: "faq",
    heading: "Common questions",
    questions: [
      {
        question: "Did Jesus really exist?",
        answer:
          "Yes. The existence of Jesus of Nazareth is affirmed by virtually all historians, including non-Christian Roman and Jewish sources from the first and second centuries.",
      },
      {
        question: "What did Jesus actually teach?",
        answer:
          "Love for God and neighbour, forgiveness of enemies, care for the poor, and the arrival of God's kingdom — often through memorable stories called parables.",
      },
      {
        question: "Why did he have to die?",
        answer:
          "Christians believe his death was a deliberate, self-giving act to reconcile people to God — and that his resurrection three days later confirmed who he claimed to be.",
      },
    ],
    ctaEnabled: true,
    ctaLabel: "Explore more questions",
    ctaLink: "#",
  },
  {
    t: "cta",
    sectionKey: "final-cta",
    heading: "Begin your journey today",
    body: "Watch the films that have introduced billions of people to Jesus.",
    buttonLabel: "Watch now",
    buttonLink: `/watch/${VIDEOS.flow.slug}.html/english.html`,
    variant: "primary",
    backgroundColor: "#1d4ed8",
  },
]

const GALLERY_BLOCKS = [
  {
    t: "text",
    sectionKey: "title",
    heading: "Component Gallery",
    headingLevel: "h1",
    subtitle: "Every Experience building block, in one place.",
    contentParagraphs: [
      "This page showcases the components available when composing an Experience, wired to real local videos.",
    ],
  },
  {
    t: "video",
    sectionKey: "video",
    streamingUrl: stream(VIDEOS.blue.playback),
    videoId: VIDEOS.blue.id,
    title: "Video block",
    subtitle: "An inline player with controls.",
    muted: true,
    showControls: true,
  },
  {
    t: "mediaCollection",
    sectionKey: "media",
    variant: "grid",
    title: "Media collection",
    subtitle: "A grid of related films",
    items: [
      {
        videoId: VIDEOS.blue.id,
        titleOverride: "Blue",
        subtitleOverride: "Sample film",
        imageOverrideUrl: thumb(VIDEOS.blue.playback, 2),
      },
      {
        videoId: VIDEOS.flow.id,
        titleOverride: "Flow",
        subtitleOverride: "Sample film",
        imageOverrideUrl: thumb(VIDEOS.flow.playback, 2),
      },
      {
        videoId: VIDEOS.good.id,
        titleOverride: "Good",
        subtitleOverride: "Sample film",
        imageOverrideUrl: thumb(VIDEOS.good.playback, 2),
      },
    ],
  },
  {
    t: "videoCarousel",
    sectionKey: "vcarousel",
    title: "Video carousel",
    subtitle: "Swipe through films",
    items: [
      {
        videoId: VIDEOS.flow.id,
        streamingUrl: stream(VIDEOS.flow.playback),
        imageUrl: thumb(VIDEOS.flow.playback, 3),
        titleOverride: "Flow",
      },
      {
        videoId: VIDEOS.good.id,
        streamingUrl: stream(VIDEOS.good.playback),
        imageUrl: thumb(VIDEOS.good.playback, 3),
        titleOverride: "Good",
      },
      {
        videoId: VIDEOS.blue.id,
        streamingUrl: stream(VIDEOS.blue.playback),
        imageUrl: thumb(VIDEOS.blue.playback, 3),
        titleOverride: "Blue",
      },
    ],
  },
  {
    t: "navigationCarousel",
    sectionKey: "nav",
    items: [
      {
        contentId: VIDEOS.flow.slug,
        title: "Watch: Flow",
        category: "Film",
        imageUrl: thumb(VIDEOS.flow.playback, 4),
      },
      {
        contentId: VIDEOS.good.slug,
        title: "Watch: Good",
        category: "Film",
        imageUrl: thumb(VIDEOS.good.playback, 4),
      },
      {
        contentId: VIDEOS.blue.slug,
        title: "Watch: Blue",
        category: "Film",
        imageUrl: thumb(VIDEOS.blue.playback, 4),
      },
    ],
  },
  {
    t: "adventCountdown",
    sectionKey: "advent",
    title: "Advent Countdown",
    scripture: "For to us a child is born, to us a son is given.",
    scriptureReference: "Isaiah 9:6",
    backgroundColor: "#0f172a",
  },
  {
    t: "easterDates",
    sectionKey: "easter",
    easterDatesTitle: "When is Easter?",
    westernEasterLabel: "Western Easter",
    orthodoxEasterLabel: "Orthodox Easter",
    passoverLabel: "Passover",
    westernEasterEnabled: true,
    orthodoxEasterEnabled: true,
    passoverEnabled: true,
  },
  {
    t: "card",
    sectionKey: "card",
    title: "Card block",
    description: "A simple titled card. (Web renderer still pending.)",
    variant: "default",
  },
  {
    t: "videoRecommendations",
    sectionKey: "recs",
    title: "You might also like",
    subtitle: "Recommended films",
    limit: 6,
    sourceVideoId: VIDEOS.good.id,
  },
]

// ── seeding ──────────────────────────────────────────────────────────────────
const SEED = [
  {
    slug: "demo-story-of-jesus",
    title: "The Story of Jesus",
    blocks: STORY_BLOCKS,
  },
  {
    slug: "demo-component-gallery",
    title: "Component Gallery",
    blocks: GALLERY_BLOCKS,
  },
]

async function main(): Promise<void> {
  assertNotProdUrl(process.env.DATABASE_URL)

  const { prisma } = await import("@/db/client")
  const { ExperienceService } = await import("@/services/experience.service")
  const admin: Principal = { id: null, role: "ADMIN" }
  const service = new ExperienceService(prisma)

  try {
    // idempotency: drop prior experiences carrying our seed slugs
    const slugs = SEED.map((s) => s.slug)
    const prior = await prisma.experienceLocale.findMany({
      where: { slug: { in: slugs } },
      select: { experienceId: true },
    })
    const priorIds = [...new Set(prior.map((p) => p.experienceId))]
    if (priorIds.length) {
      await prisma.experience.deleteMany({ where: { id: { in: priorIds } } })
      process.stdout.write(
        `Removed ${priorIds.length} prior seed experience(s)\n`,
      )
    }

    for (const item of SEED) {
      const created = await service.create({
        input: {
          locale: "en",
          slug: item.slug,
          title: item.title,
          blocks: item.blocks,
        },
        user: admin,
      })
      const localeId = created.locales[0]!.id
      const published = await service.publishLocale({
        input: { id: localeId },
        user: admin,
      })
      process.stdout.write(
        `✓ ${item.title}  slug=${item.slug}  blocks=${item.blocks.length}  status=${published.status}\n`,
      )
    }

    process.stdout.write("\nPreview URLs (after manifest regen):\n")
    for (const item of SEED) {
      process.stdout.write(`  http://localhost:3000/watch/${item.slug}.html\n`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

const isDirect =
  typeof process !== "undefined" &&
  !!process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isDirect) {
  main().catch((err) => {
    process.stderr.write(
      `[seed-experience] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    )
    process.exit(1)
  })
}
