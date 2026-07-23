#!/usr/bin/env tsx
/**
 * Seed the Easter experience into admin's Postgres.
 *
 * Mirrors `apps/cms/src/bootstrap/seed-easter.ts` block-for-block,
 * translated to admin's Block schema (`apps/admin/src/domain/blocks.ts`).
 * Used for local-dev parity with Strapi's Easter, and as a fixture for
 * UI/E2E work without depending on Strapi.
 *
 * Translation notes (the cms-side block shapes this script transforms
 * from are documented inline below; the previously-shipped
 * `cms-block-transforms.ts` was deleted with R3 — see
 * docs/plans/2026-05-17-001-refactor-decouple-experience-embeds-from-cms-plan.md):
 *   - Strapi `__component: "sections.X"` → admin `t: "camelCaseX"`
 *   - Strapi `container.slots: [{gridSpan, content}]` flattens to admin
 *     `container.content: [{t:"containerSlot", gridSpan}, ...content]`
 *   - Strapi numeric `video: <id>` → admin `videoId: <cuid>` resolved by
 *     slug against admin's `video` table; missing slugs degrade to
 *     `videoId: undefined` + `titleOverride`
 *   - Local `/images/thumbnails/*` paths are accepted by admin's BlockSchema.
 *
 * Usage:
 *   DATABASE_URL='postgresql://forge:forge@localhost:5433/forge_admin' \
 *   pnpm --filter @forge/admin tsx src/scripts/seed-easter.ts
 *
 *   # Re-run is destructive: deletes any existing experience with slug=easter
 *   # before creating the new one.
 */

import type { z } from "zod"
import type {
  BlockSchema,
  ContainerBlockSchema,
  ContainerContentBlockSchema,
  SectionBlockSchema,
  SectionContentBlockSchema,
} from "@/domain/blocks"

// Use z.input — Zod's .default() makes some fields output-required but
// input-optional, so seed-side construction shouldn't be forced to spell
// out every defaulted field. Final shape is validated by BlocksSchema.parse.
type Block = z.input<typeof BlockSchema>
type SectionBlock = z.input<typeof SectionBlockSchema>
type SectionContentBlock = z.input<typeof SectionContentBlockSchema>
type ContainerBlock = z.input<typeof ContainerBlockSchema>
type ContainerContentBlock = z.input<typeof ContainerContentBlockSchema>

const EASTER_EXPERIENCE_SLUG = "easter"

// ── Image CDN helpers ───────────────────────────────────────────────────────
const IMG = "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA"
const imgCinematic = (id: string) =>
  `${IMG}/${id}.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95`

const UNSPLASH = "https://images.unsplash.com"
const unsplash = (id: string, w = 900) =>
  `${UNSPLASH}/${id}?w=${w}&auto=format&fit=crop&q=60`

const COLLECTION_POSTERS = {
  jesus: "/images/thumbnails/1_jf-0-0-vertical.png",
  lifeOfJesus: "/images/thumbnails/2_GOJ-0-0-vertical.png",
  gospelOfMatthew: "/images/thumbnails/GOMattCollection-vertical.png",
  gospelOfMark: "/images/thumbnails/GOMarkCollection-vertical.png",
  gospelOfLuke: "/images/thumbnails/GOLukeCollection-vertical.png",
  gospelOfJohn: "/images/thumbnails/GOJohnCollection-vertical.png",
} as const

const BSF_CTA = "https://join.bsfinternational.org/?utm_source=jesusfilm-watch"
const ISSUES_CTA = "https://issuesiface.com/talk?utm_source=jesusfilm-watch"

// ── Video slug lookups: admin's video.slug → cuid ───────────────────────────

const REQUIRED_VIDEO_SLUGS = [
  // top-level videos
  "easter-explained",
  "my-last-day",
  "why-did-jesus-have-to-die",
  "talk-with-nicodemus",
  "did-jesus-come-back-from-the-dead",
  "the-story-short-film",
  "chosen-witness",
  "invitation-to-know-jesus-personally",
  "31-how-did-jesus-die",
  "32-what-happened-next",
  // bible collection
  "jesus",
  "life-of-jesus-gospel-of-john",
  "lumo-the-gospel-of-matthew",
  "lumo-the-gospel-of-mark",
  "lumo-the-gospel-of-luke",
  "lumo-the-gospel-of-john",
] as const

// Slugs that exist in Strapi via findOrCreatePublishedVideo placeholders but
// not in admin's Core-sourced video catalogue. We omit videoId for these; they
// will not resolve playable media until Core indexes them.
const KNOWN_MISSING_FROM_ADMIN = new Set<string>([
  "easter-hero",
  "33-why-is-easter-celebrated-with-bunnies",
  // Jesus Film chapter videos — Strapi seed creates placeholders; admin's
  // Core catalogue uses different slugs for the chapter cuts.
  "jf-upper-room-teaching",
  "jf-jesus-is-betrayed-and-arrested",
  "jf-peter-disowns-jesus",
  "jf-jesus-is-mocked-and-questioned",
  "jf-jesus-is-brought-to-pilate",
  "jf-jesus-is-brought-to-herod",
  "jf-jesus-is-sentenced",
  "jf-death-of-jesus",
  "jf-burial-of-jesus",
  "jf-angels-at-the-tomb",
  "jf-the-tomb-is-empty",
  "jf-resurrected-jesus-appears",
  "jf-the-great-commission-and-ascension",
  "jf-invitation-to-know-jesus-personally",
  // New Believer Course — same situation as the chapters.
  "nbc-the-simple-gospel",
  "nbc-the-blood-of-jesus",
  "nbc-life-after-death",
  "nbc-gods-forgiveness",
  "nbc-savior-lord-and-friend",
  "nbc-being-made-new",
  "nbc-living-for-god",
  "nbc-the-bible",
  "nbc-prayer",
  "nbc-church",
])

const JESUS_CHAPTERS = [
  { slug: "jf-upper-room-teaching", title: "Upper Room Teaching" },
  {
    slug: "jf-jesus-is-betrayed-and-arrested",
    title: "Jesus is Betrayed and Arrested",
  },
  { slug: "jf-peter-disowns-jesus", title: "Peter Disowns Jesus" },
  {
    slug: "jf-jesus-is-mocked-and-questioned",
    title: "Jesus is Mocked and Questioned",
  },
  {
    slug: "jf-jesus-is-brought-to-pilate",
    title: "Jesus is Brought To Pilate",
  },
  { slug: "jf-jesus-is-brought-to-herod", title: "Jesus is Brought to Herod" },
  { slug: "jf-jesus-is-sentenced", title: "Jesus is Sentenced" },
  { slug: "jf-death-of-jesus", title: "Death of Jesus" },
  { slug: "jf-burial-of-jesus", title: "Burial of Jesus" },
  { slug: "jf-angels-at-the-tomb", title: "Angels at the Tomb" },
  { slug: "jf-the-tomb-is-empty", title: "The Tomb is Empty" },
  {
    slug: "jf-resurrected-jesus-appears",
    title: "Resurrected Jesus Appears",
  },
  {
    slug: "jf-the-great-commission-and-ascension",
    title: "The Great Commission and Ascension",
  },
  {
    slug: "jf-invitation-to-know-jesus-personally",
    title: "Invitation to Know Jesus Personally",
  },
] as const

const CHAPTER_IMG_IDS = [
  "1_jf6143-0-0",
  "1_jf6144-0-0",
  "1_jf6145-0-0",
  "1_jf6146-0-0",
  "1_jf6147-0-0",
  "1_jf6148-0-0",
  "1_jf6149-0-0",
  "1_jf6155-0-0",
  "1_jf6156-0-0",
  "1_jf6157-0-0",
  "1_jf6158-0-0",
  "1_jf6159-0-0",
  "1_jf6160-0-0",
  "1_jf6161-0-0",
]

const NBC = [
  {
    slug: "nbc-the-simple-gospel",
    title: "The Simple Gospel",
    img: "8_NBC01",
    url: "https://stream.mux.com/279mJsIfidib02HlmY2Px01yCfAQ5urCkfimsCcJ36rBA.m3u8",
  },
  {
    slug: "nbc-the-blood-of-jesus",
    title: "The Blood of Jesus",
    img: "8_NBC02",
    url: "https://stream.mux.com/8qf4FwfwVe8LbH651SRJ2vLuQkks3Zz015y2b7Cnfg1A.m3u8",
  },
  {
    slug: "nbc-life-after-death",
    title: "Life After Death",
    img: "8_NBC03",
    url: "https://stream.mux.com/C3TuBfyhZlXLQu6YGYPq1Ny6zzb9h802MDerNO9opED4.m3u8",
  },
  {
    slug: "nbc-gods-forgiveness",
    title: "God's Forgiveness",
    img: "8_NBC04",
    url: "https://stream.mux.com/279mJsIfidib02HlmY2Px01yCfAQ5urCkfimsCcJ36rBA.m3u8",
  },
  {
    slug: "nbc-savior-lord-and-friend",
    title: "Savior, Lord, and Friend",
    img: "8_NBC05",
    url: "https://stream.mux.com/EDzAZinsWhcEY1fbU2NpDw5XMjscjq01GVAARzmqcoy8.m3u8",
  },
  {
    slug: "nbc-being-made-new",
    title: "Being Made New",
    img: "8_NBC06",
    url: "https://stream.mux.com/BQiPugpj0001dK3sI00I01ij7Nd1cyaucQKb6iSn3YMThWI.m3u8",
  },
  {
    slug: "nbc-living-for-god",
    title: "Living for God",
    img: "8_NBC07",
    url: "https://stream.mux.com/OGBK61ML9PXXQCCsUYJ7Q023X4s3j3FXC2tGEtkq8Nmg.m3u8",
  },
  {
    slug: "nbc-the-bible",
    title: "The Bible",
    img: "8_NBC08",
    url: "https://stream.mux.com/S00MMmNY1Ho3fhcndh7ZkRQCKlEMQHtPXZnbkjXZXyu8.m3u8",
  },
  {
    slug: "nbc-prayer",
    title: "Prayer",
    img: "8_NBC09",
    url: "https://stream.mux.com/kzDfGLuPcBkAlrbIaSjEe3Q00eoK023CFU02MwUnzzuU8g.m3u8",
  },
  {
    slug: "nbc-church",
    title: "Church",
    img: "8_NBC10",
    url: "https://stream.mux.com/mFdtM2c02RSUcACqXv700etuF702JUpA02vRZzxMCr2Y5ic.m3u8",
  },
] as const

// ── Block builder helpers ────────────────────────────────────────────────────

type Lookup = (slug: string) => string | undefined

function buildVideoSectionContent(
  lookup: Lookup,
  opts: {
    sectionKey: string
    videoSlug: string
    title: string
    subtitle: string
    description: string[]
    questions: { question: string; answer: string }[]
    bibleQuotes: {
      reference: string
      attribution?: string
      text: string
      imageUrl: string
      backgroundColor: string
      ctaLabel?: string
      ctaLink?: string
    }[]
    textHeading?: string
    textSubtitle?: string
    skipQuiz?: boolean
  },
): SectionContentBlock[] {
  const videoBlock: SectionContentBlock = {
    t: "video",
    sectionKey: opts.sectionKey,
    useRouteVideo: false,
    videoId: lookup(opts.videoSlug),
    title: opts.title,
    subtitle: opts.subtitle,
  }

  const textBlock: ContainerContentBlock = {
    t: "text",
    contentParagraphs: opts.description,
    ...(opts.textHeading ? { heading: opts.textHeading } : {}),
    ...(opts.textSubtitle ? { subtitle: opts.textSubtitle } : {}),
  }

  const relatedBlock: ContainerContentBlock = {
    t: "relatedQuestions",
    heading: "Related questions",
    ctaLabel: "Ask yours",
    ctaLink: ISSUES_CTA,
    questions: opts.questions,
  }

  const container: ContainerBlock = {
    t: "container",
    content: [
      { t: "containerSlot", gridSpan: 7 },
      textBlock,
      { t: "containerSlot", gridSpan: 5 },
      relatedBlock,
    ],
  }

  const quotes: SectionContentBlock = {
    t: "bibleQuotesCarousel",
    sectionKey: `${opts.sectionKey}-bible-quotes`,
    heading: "Bible quotes",
    quotes: opts.bibleQuotes.map((q) => ({
      reference: q.reference,
      text: q.text,
      ...(q.attribution ? { attribution: q.attribution } : {}),
      imageUrl: q.imageUrl,
      backgroundColor: q.backgroundColor,
      ...(q.ctaLabel ? { ctaLabel: q.ctaLabel } : {}),
      ...(q.ctaLink ? { ctaLink: q.ctaLink } : {}),
    })),
  }

  const quizButton: SectionContentBlock = {
    t: "quizButton",
    buttonText: "What's your next step of faith?",
    iframeSrc: "https://your.nextstep.is/embed/easter2025?expand=false",
  }

  if (opts.skipQuiz) return [videoBlock, container, quotes]
  return [videoBlock, container, quotes, quizButton]
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("[seed-easter] DATABASE_URL is required\n")
    process.exit(2)
  }

  const { prisma } = await import("@/db/client")
  const { BlocksSchema } = await import("@/domain/blocks")
  const { backfillExperienceVideoLanguageIds } =
    await import("@/services/experience-video-language-backfill")

  // Resolve all slug → cuid mappings up front.
  const allSlugs = [
    ...REQUIRED_VIDEO_SLUGS,
    ...JESUS_CHAPTERS.map((c) => c.slug),
    ...NBC.map((n) => n.slug),
  ]
  const videoRows = await prisma.video.findMany({
    where: { slug: { in: allSlugs }, deletedAt: null },
    select: { id: true, slug: true },
  })
  const videoMap = new Map(videoRows.map((v) => [v.slug, v.id]))
  const lookup: Lookup = (slug: string) => videoMap.get(slug)

  const missing = allSlugs.filter(
    (s) => !videoMap.has(s) && !KNOWN_MISSING_FROM_ADMIN.has(s),
  )
  process.stdout.write(
    JSON.stringify({
      event: "seed-easter.video-resolution",
      requested: allSlugs.length,
      resolved: videoMap.size,
      knownMissing: KNOWN_MISSING_FROM_ADMIN.size,
      unexpectedMissing: missing,
    }) + "\n",
  )

  const CURRENT_YEAR = new Date().getFullYear()

  // ── 1. Hero ───────────────────────────────────────────────────────────
  const heroBlock: Block = {
    t: "videoHero",
    useRouteVideo: false,
    videoId: lookup("easter-hero"),
    heading: "Easter",
    subheading: `Easter ${CURRENT_YEAR} - videos & resources about Lent, Holy Week, Resurrection`,
    ctaLabel: "Watch now",
  }

  // ── 2. Main (nav + intro + Easter Explained + quiz) ───────────────────
  const navigation: SectionContentBlock = {
    t: "navigationCarousel",
    sectionKey: "easter-navigation",
    items: [
      {
        contentId: "easter-explained/english",
        title: "The True Meaning of Easter",
        category: "Short Video",
        imageUrl: unsplash("photo-1521106581851-da5b6457f674"),
        backgroundColor: "#1A1815",
      },
      {
        contentId: "my-last-day/english",
        title: "Last hour of Jesus' life from criminal's point of view",
        category: "Short Video",
        imageUrl: unsplash("photo-1522442676585-c751dab71864"),
        backgroundColor: "#A88E78",
      },
      {
        contentId: "why-did-jesus-have-to-die/english",
        title: "The Purpose of Jesus' Sacrifice",
        category: "Short Video",
        imageUrl: unsplash("photo-1591561582301-7ce6588cc286"),
        backgroundColor: "#62884C",
      },
      {
        contentId: "did-jesus-come-back-from-the-dead/english",
        title: "The Truth About Jesus' Resurrection",
        category: "Short Video",
        imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
        backgroundColor: "#5F4C5E",
      },
      {
        contentId: "the-story-short-film/english",
        title: "The Story: How It All Began and How It Will Never End",
        category: "Short Video",
        imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
        backgroundColor: "#72593A",
      },
      {
        contentId: "chosen-witness/english",
        title: "Mary Magdalene: A Life Transformed by Jesus",
        category: "Short Video",
        imageUrl: unsplash("photo-1606876538216-0c70a143dd77"),
        backgroundColor: "#1C160B",
      },
    ],
  }

  const intro: SectionContentBlock = {
    t: "container",
    content: [
      { t: "containerSlot", gridSpan: 6 },
      {
        t: "text",
        heading: "The Real Easter story",
        subtitle: "Questioning? Searching? Discover the true power of Easter.",
        contentParagraphs: [
          "Beyond eggs and bunnies lies the story of Jesus’s life, death and resurrection. The true power of Easter goes beyond church services and rituals — and into the very reason why humans need a Savior.",
          "The Gospels are shockingly honest about the emotions Jesus experienced — His deep anguish over one of His closest friends denying he even knew Him, and the other disciples’ disbelief in His resurrection — raw emotions that mirror our own struggles.",
          "Explore our collection of videos and interactive resources that invite you into the authentic story — one that changed history and continues to transform lives today. Because the greatest celebration in human history is about far more than traditions — it’s about resurrection power.",
        ],
      },
      { t: "containerSlot", gridSpan: 6 },
      {
        t: "easterDates",
        easterDatesTitle: "When is Easter celebrated in {year}?",
        westernEasterLabel: "Western Easter (Catholic/Protestant)",
        orthodoxEasterLabel: "Orthodox",
        passoverLabel: "Jewish Passover",
        locale: "en-US",
      },
    ],
  }

  const mainSection: SectionBlock = {
    t: "section",
    sectionKey: "easter-meaning",
    backgroundColor: "dark",
    staticOverlay: false,
    content: [
      navigation,
      intro,
      ...buildVideoSectionContent(lookup, {
        sectionKey: "easter-explained/english",
        videoSlug: "easter-explained",
        title: "Easter Explained",
        subtitle:
          "Is Easter about more than bunnies and eggs? Followers of Jesus celebrate His power of life over death on Easter Sunday. Are they right? Was He really raised from the dead?",
        textHeading: "The True Meaning of Easter",
        textSubtitle: "Jesus' Victory Over Sin and Death",
        description: [
          "Easter celebrates Jesus’s death on the cross for our sins and His resurrection, demonstrating power over sin and death. His sacrifice offers forgiveness and eternal life. Easter is a time to celebrate this great hope and God’s incredible gift to us.",
        ],
        questions: [
          {
            question:
              "How can I trust in God's sovereignty when the world feels so chaotic?",
            answer:
              "Even in chaos, God remains sovereign. His purposes are higher than our understanding, and He promises to work all things for good for those who love Him.",
          },
          {
            question: "Why is Easter the most important Christian holiday?",
            answer:
              "Easter marks Jesus’ resurrection, proving His victory over death and fulfilling prophecies about the Messiah. It provides hope for eternal life.",
          },
          {
            question:
              "What happened during the three days between Jesus' death and resurrection?",
            answer:
              "Jesus’ body was placed in a tomb guarded by Roman soldiers. His followers mourned in uncertainty. On the third day, He rose victorious over death.",
          },
        ],
        bibleQuotes: [
          {
            reference: "1 Corinthians 15:55-57",
            attribution: "Apostle Paul",
            text: '"Where, O death, is your victory? Where, O death, is your sting?" The sting of death is sin, and the power of sin is the law. But thanks be to God! He gives us the victory through our Lord Jesus Christ.',
            imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
            backgroundColor: "#201617",
          },
          {
            reference: "1 Corinthians 15:55-57",
            attribution: "Apostle Paul",
            text: '"Where, O death, is your victory? Where, O death, is your sting?" The sting of death is sin, and the power of sin is the law. But thanks be to God! He gives us the victory through our Lord Jesus Christ.',
            imageUrl: unsplash("photo-1522442676585-c751dab71864"),
            backgroundColor: "#A88E78",
          },
          {
            reference: "1 Corinthians 15:55-57",
            attribution: "Apostle Paul",
            text: '"Where, O death, is your victory? Where, O death, is your sting?" The sting of death is sin, and the power of sin is the law. But thanks be to God! He gives us the victory through our Lord Jesus Christ.',
            imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
            backgroundColor: "#72593A",
          },
          {
            reference: "Free Resources",
            text: "Want to grow deep in your understanding of the Bible?",
            ctaLabel: "Join Our Bible Study",
            ctaLink: BSF_CTA,
            imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
            backgroundColor: "#5F4C5E",
          },
        ],
      }),
    ],
  }

  // ── 3. Bible Collection ───────────────────────────────────────────────
  const collectionSection: SectionBlock = {
    t: "section",
    sectionKey: "video-bible-collection-section",
    backgroundColor: "purple",
    dynamicBackgroundImage: true,
    staticOverlay: true,
    content: [
      {
        t: "mediaCollection",
        sectionKey: "video-bible-collection",
        categoryLabel: "Video Bible Collection",
        variant: "carousel",
        thumbnailOrientation: "vertical",
        title: "The Easter story is a key part of a bigger picture",
        ctaLink: "https://www.jesusfilm.org/watch?utm_source=jesusfilm-watch",
        ctaLabel: "Watch",
        footerText:
          "Our mission is to introduce people to the Bible through films and videos that faithfully bring the Gospels to life. By visually telling the story of Jesus and God’s love for humanity, we make Scripture more accessible, engaging, and easy to understand.",
        items: [
          {
            videoId: lookup("jesus"),
            labelOverride: "Feature Film",
            collectionSize: "61 chapters",
            imageUrl: COLLECTION_POSTERS.jesus,
            subtitleOverride:
              "Jesus constantly surprises and confounds people, from His miraculous birth to His rise from the grave.",
          },
          {
            videoId: lookup("life-of-jesus-gospel-of-john"),
            labelOverride: "Feature Film",
            collectionSize: "49 chapters",
            imageUrl: COLLECTION_POSTERS.lifeOfJesus,
            subtitleOverride:
              "And truly Jesus did many other signs in the presence of His disciples, which are not written in this book.",
          },
          {
            videoId: lookup("lumo-the-gospel-of-matthew"),
            labelOverride: "Collection",
            collectionSize: "25 items",
            imageUrl: COLLECTION_POSTERS.gospelOfMatthew,
            subtitleOverride:
              "The Gospel of Matthew is a word-for-word portrayal of the biblical text.",
          },
          {
            videoId: lookup("lumo-the-gospel-of-mark"),
            labelOverride: "Collection",
            collectionSize: "15 items",
            imageUrl: COLLECTION_POSTERS.gospelOfMark,
            subtitleOverride:
              "According to the Gospel of Mark, Jesus is a heroic man of action, healer, and miracle worker.",
          },
          {
            videoId: lookup("lumo-the-gospel-of-luke"),
            labelOverride: "Collection",
            collectionSize: "26 items",
            imageUrl: COLLECTION_POSTERS.gospelOfLuke,
            subtitleOverride:
              "Luke acts as a narrator of events, painting a picture of Jesus as a very human character.",
          },
          {
            videoId: lookup("lumo-the-gospel-of-john"),
            labelOverride: "Collection",
            collectionSize: "22 items",
            imageUrl: COLLECTION_POSTERS.gospelOfJohn,
            subtitleOverride:
              "The Gospel of John is a word-for-word portrayal of the biblical text.",
          },
        ],
      },
    ],
  }

  // ── 4. My Last Day ────────────────────────────────────────────────────
  const myLastDaySection: SectionBlock = {
    t: "section",
    sectionKey: "my-last-day-section",
    backgroundColor: "dark",
    staticOverlay: false,
    content: buildVideoSectionContent(lookup, {
      sectionKey: "my-last-day/english",
      videoSlug: "my-last-day",
      title: "My Last Day",
      subtitle: "Last hour of Jesus' life from criminal's point of view",
      textSubtitle: "My Last Day",
      textHeading: "Last hour of Jesus' life from criminal's point of view",
      description: [
        'A condemned thief witnesses Jesus’s brutal flogging, memories of his own crimes flooding his mind. Why would they punish an innocent man? Forced to carry their crosses to Golgotha, he stumbles beside Jesus. As nails pierce flesh and the sky darkens, he makes a desperate plea—could this truly be the Messiah? In his final moments, Jesus gives him an unexpected promise: "Today, you will be with me in paradise."',
      ],
      questions: [
        {
          question: "Why would Jesus forgive a criminal so easily?",
          answer:
            "Jesus’ forgiveness demonstrates that God’s grace is not earned through good deeds. It is a free gift available to anyone who sincerely asks, regardless of their past.",
        },
        {
          question:
            "If Jesus was innocent, why didn't he save himself instead of accepting death?",
          answer:
            "Jesus chose to accept death because His sacrifice was the means by which humanity could be reconciled to God. His death was voluntary and purposeful.",
        },
        {
          question: "What does it really mean to be 'in paradise' with Jesus?",
          answer:
            "Paradise refers to being in God’s presence after death. Jesus’ promise to the thief means eternal life and restored relationship with God.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Luke 23:43",
          attribution: "Jesus",
          text: "Truly I tell you, today you will be with me in paradise.",
          imageUrl: unsplash("photo-1542272201-b1ca555f8505", 1400),
          backgroundColor: "#201617",
        },
        {
          reference: "Luke 23:34",
          attribution: "Jesus",
          text: "Father, forgive them, for they do not know what they are doing.",
          imageUrl: unsplash("photo-1709471875678-0b3627a3c099", 1400),
          backgroundColor: "#A88E78",
        },
        {
          reference: "Isaiah 53:5",
          text: "But he was pierced for our transgressions, he was crushed for our iniquities; the punishment that brought us peace was on him, and by his wounds we are healed.",
          imageUrl: unsplash("photo-1595119591974-a9bd1532c1b0", 1400),
          backgroundColor: "#72593A",
        },
        {
          reference: "Free Resources",
          text: "Want to understand more about Jesus' sacrifice?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 5. Documentary Series ─────────────────────────────────────────────
  const documentarySection: SectionBlock = {
    t: "section",
    sectionKey: "easter-documentary-series",
    backgroundColor: "cosmic",
    dynamicBackgroundImage: false,
    staticOverlay: true,
    content: [
      {
        t: "videoCarousel",
        sectionKey: "easter-documentary-carousel",
        subtitle: "Easter Documentary Series",
        title: "Did Jesus Defeat Death?",
        description:
          "Go on this adventure to time travel to the 1st century and check out other theories for Jesus’s empty tomb.",
        items: [
          {
            videoId: lookup("31-how-did-jesus-die"),
            imageUrl: imgCinematic("7_0-nfs0301"),
            backgroundColor: "#161817",
            titleOverride: "How Did Jesus Die?",
          },
          {
            videoId: lookup("32-what-happened-next"),
            imageUrl: imgCinematic("7_0-nfs0302"),
            backgroundColor: "#000906",
            titleOverride: "What Happened Next?",
          },
          {
            videoId: lookup("33-why-is-easter-celebrated-with-bunnies"),
            imageUrl: imgCinematic("7_0-nfs0303"),
            backgroundColor: "#2B2018",
            titleOverride: "Why is Easter celebrated with bunnies?",
          },
        ],
      },
    ],
  }

  // ── 6. Why Did Jesus Have to Die ──────────────────────────────────────
  const whyDieSection: SectionBlock = {
    t: "section",
    sectionKey: "why-did-jesus-die-section",
    backgroundColor: "dark",
    staticOverlay: false,
    content: buildVideoSectionContent(lookup, {
      sectionKey: "why-did-jesus-have-to-die/english",
      videoSlug: "why-did-jesus-have-to-die",
      title: "Why Did Jesus Have to Die?",
      subtitle: "The Purpose of Jesus' Sacrifice",
      textSubtitle: "Why Did Jesus Have to Die?",
      textHeading: "The Purpose of Jesus' Sacrifice",
      description: [
        "God created humans to be spiritually and relationally connected with Him, but how can we keep God's commands? How can we live without shame? We can’t restore ourselves to honor. It would seem we’re doomed, except God doesn’t want His creation to die. He is merciful and loving, and wants us to be restored, living with Him in full life.",
      ],
      questions: [
        {
          question: "Why was Jesus' death necessary?",
          answer:
            "Humanity’s sin created a separation from God that we could not bridge on our own. Jesus’ death satisfied God’s justice while demonstrating His love.",
        },
        {
          question:
            "If God is loving, why didn't He just forgive sin without Jesus' sacrifice?",
          answer:
            "God is perfectly just and cannot simply ignore sin. Jesus’ death satisfies God’s justice while providing a way for forgiveness without compromising His holy character.",
        },
        {
          question: "How does Jesus' death affect our relationship with God?",
          answer:
            "Through Jesus’ sacrifice, the barrier of sin between humanity and God is removed. We can now have a direct, personal relationship with God through faith in Jesus.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Romans 5:8",
          text: "But God demonstrates his own love for us in this: While we were still sinners, Christ died for us.",
          imageUrl: unsplash("photo-1482424917728-d82d29662023", 1400),
          backgroundColor: "#62884C",
        },
        {
          reference: "John 3:16",
          text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
          imageUrl: unsplash("photo-1658512341640-2db6ae31906b", 1400),
          backgroundColor: "#201617",
        },
        {
          reference: "1 Peter 2:24",
          text: "He himself bore our sins in his body on the cross, so that we might die to sins and live for righteousness; by his wounds you have been healed.",
          imageUrl: unsplash("photo-1586490110711-7e174d0d043f", 1400),
          backgroundColor: "#72593A",
        },
        {
          reference: "Free Resources",
          text: "Want to understand more about Jesus' sacrifice?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 7. Talk with Nicodemus ────────────────────────────────────────────
  const nicodemusSection: SectionBlock = {
    t: "section",
    sectionKey: "talk-with-nicodemus-section",
    backgroundColor: "dark",
    staticOverlay: false,
    content: buildVideoSectionContent(lookup, {
      sectionKey: "talk-with-nicodemus/english",
      videoSlug: "talk-with-nicodemus",
      title: "From Religion to Relationship",
      subtitle: "The Gospel in One Conversation",
      textSubtitle: "From Religion to Relationship",
      textHeading: "The Gospel in One Conversation",
      description: [
        "In a private conversation at night, Nicodemus, a respected Jewish teacher, came to Jesus seeking truth. Jesus told him that no one can see the kingdom of God unless they are born again. This deep conversation reveals the heart of Jesus' mission—to bring spiritual rebirth through the Holy Spirit. Discover what it means to be born again and why it's essential for eternal life.",
      ],
      questions: [
        {
          question: "What does it mean to be born again?",
          answer:
            "Being born again is a spiritual transformation—a new birth through the Holy Spirit that gives us new life and a relationship with God.",
        },
        {
          question: "Why did Jesus tell Nicodemus he must be born again?",
          answer:
            "Jesus was showing that religious knowledge alone is not enough. True relationship with God requires a spiritual rebirth that only God can provide.",
        },
        {
          question: "How can someone be born again?",
          answer:
            "By believing in Jesus Christ and receiving the Holy Spirit. It is a work of God in response to faith, not something achieved by human effort.",
        },
      ],
      bibleQuotes: [
        {
          reference: "John 3:3",
          attribution: "Jesus",
          text: '"Very truly I tell you, no one can see the kingdom of God unless they are born again."',
          imageUrl: unsplash("photo-1497449493050-aad1e7cad165", 1400),
          backgroundColor: "#1A1815",
        },
        {
          reference: "John 3:5",
          attribution: "Jesus",
          text: '"Very truly I tell you, no one can enter the kingdom of God unless they are born of water and the Spirit."',
          imageUrl: unsplash("photo-1574957973698-418ac4c877af", 1400),
          backgroundColor: "#72593A",
        },
        {
          reference: "John 3:16",
          text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
          imageUrl: unsplash("photo-1506748686214-e9df14d4d9d0", 1400),
          backgroundColor: "#5F4C5E",
        },
        {
          reference: "Free Resources",
          text: "Want to understand more about the resurrection?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1522442676585-c751dab71864"),
          backgroundColor: "#A88E78",
        },
      ],
    }),
  }

  // ── 8. Did Jesus Come Back from the Dead ──────────────────────────────
  const resurrectionSection: SectionBlock = {
    t: "section",
    sectionKey: "did-jesus-come-back-section",
    backgroundColor: "dark",
    staticOverlay: false,
    content: buildVideoSectionContent(lookup, {
      sectionKey: "did-jesus-come-back-from-the-dead/english",
      videoSlug: "did-jesus-come-back-from-the-dead",
      title: "Did Jesus Come Back From the Dead?",
      subtitle: "The Truth About Jesus' Resurrection",
      textSubtitle: "Did Jesus Come Back From the Dead?",
      textHeading: "The Truth About Jesus' Resurrection",
      description: [
        "Jesus told people he would die and then come back to life. This short film explains the details surrounding Jesus' death and resurrection. His closest followers struggled to believe, but eyewitnesses confirmed the truth: He rose again. The news of His resurrection spread across the world, changing lives forever. Because of these witnesses, we can have confidence in the reality of Jesus' resurrection.",
      ],
      questions: [
        {
          question: "How do we know Jesus really died and rose again?",
          answer:
            "Multiple eyewitnesses saw Jesus alive after His crucifixion. The empty tomb, the transformed disciples, and the explosive growth of the early church all point to the reality of the resurrection.",
        },
        {
          question: "Why is the resurrection of Jesus important?",
          answer:
            "The resurrection validates Jesus’ claim to be the Son of God, proves death has been defeated, and guarantees eternal life for believers.",
        },
        {
          question: "How should we respond to Jesus' death and resurrection?",
          answer:
            "By believing in Jesus, accepting His sacrifice for our sins, and beginning a personal relationship with Him through faith.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Romans 5:8",
          text: "But God demonstrates his own love for us in this: While we were still sinners, Christ died for us.",
          imageUrl: unsplash("photo-1482424917728-d82d29662023", 1400),
          backgroundColor: "#201617",
        },
        {
          reference: "John 3:16",
          text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
          imageUrl: unsplash("photo-1658512341640-2db6ae31906b", 1400),
          backgroundColor: "#72593A",
        },
        {
          reference: "1 Peter 2:24",
          text: "He himself bore our sins in his body on the cross, so that we might die to sins and live for righteousness; by his wounds you have been healed.",
          imageUrl: unsplash("photo-1586490110711-7e174d0d043f", 1400),
          backgroundColor: "#5F4C5E",
        },
        {
          reference: "Free Resources",
          text: "Want to understand more about the resurrection?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1522442676585-c751dab71864"),
          backgroundColor: "#A88E78",
        },
      ],
    }),
  }

  // ── 9. Easter Events Day By Day ───────────────────────────────────────
  const eventsSection: SectionBlock = {
    t: "section",
    sectionKey: "easter-events-day-by-day",
    backgroundColor: "dark",
    dynamicBackgroundImage: false,
    staticOverlay: true,
    content: [
      {
        t: "videoCarousel",
        sectionKey: "easter-events-carousel",
        subtitle: "Bible Videos",
        title: "Easter Events Day By Day",
        description:
          "Follow along with the events of Easter day by day as described in the Gospel of Luke.",
        items: JESUS_CHAPTERS.map((ch, i) => ({
          videoId: lookup(ch.slug),
          imageUrl: imgCinematic(CHAPTER_IMG_IDS[i]),
          backgroundColor: "#1A1815",
          titleOverride: ch.title,
        })),
      },
    ],
  }

  // ── 10. The Story Short Film ──────────────────────────────────────────
  const storySection: SectionBlock = {
    t: "section",
    sectionKey: "the-story-section",
    backgroundColor: "dark",
    staticOverlay: false,
    content: buildVideoSectionContent(lookup, {
      sectionKey: "the-story-short-film/english",
      videoSlug: "the-story-short-film",
      title: "The Story Short Film",
      subtitle: "The Story: How It All Began and How It Will Never End",
      textSubtitle: "The Story Short Film",
      textHeading: "The Story: How It All Began and How It Will Never End",
      description: [
        "The Story is a short film of how everything began and how it can never end. This film shares the overarching story of the Bible, a story that redeems all stories and brings new life through salvation in Jesus alone. It answers life's biggest questions: Where did we come from? What went wrong? Is there any hope? And what does the future hold?",
      ],
      questions: [
        {
          question:
            "Where did everything come from? Is there a purpose to life?",
          answer:
            "The Bible teaches that God created the heavens and the earth with purpose and intention. Every person is created in God’s image, with inherent value and purpose.",
        },
        {
          question:
            "If God is good, why is there so much suffering in the world?",
          answer:
            "Suffering entered the world through humanity’s choice to turn away from God. But God did not abandon us—He sent Jesus to restore what was broken.",
        },
        {
          question: "Is there any hope for the world to be made right again?",
          answer:
            "Yes. Through Jesus’ death and resurrection, God has begun the work of making all things new. He promises a future with no more pain, death, or tears.",
        },
        {
          question:
            "What will happen in the future? Is there life after death?",
          answer:
            "The Bible promises that those who trust in Jesus will have eternal life. God will create a new heaven and new earth where His people will live with Him forever.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Genesis 1:1",
          text: "In the beginning, God created the heavens and the earth.",
          imageUrl: unsplash("photo-1444703686981-a3abbc4d4fe3", 1400),
          backgroundColor: "#1A1815",
        },
        {
          reference: "Romans 3:23-24",
          text: "For all have sinned and fall short of the glory of God, and all are justified freely by His grace through the redemption that came by Christ Jesus.",
          imageUrl: unsplash("photo-1513082325166-c105b20374bb", 1400),
          backgroundColor: "#72593A",
        },
        {
          reference: "Revelation 21:4",
          text: "He will wipe every tear from their eyes. There will be no more death or mourning or crying or pain, for the old order of things has passed away.",
          imageUrl: unsplash("photo-1524088484081-4ca7e08e3e19", 1400),
          backgroundColor: "#201617",
        },
        {
          reference: "Free Resources",
          text: "Want to explore life's biggest questions?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 11. Chosen Witness ────────────────────────────────────────────────
  const chosenSection: SectionBlock = {
    t: "section",
    sectionKey: "chosen-witness-section",
    backgroundColor: "dark",
    staticOverlay: false,
    content: buildVideoSectionContent(lookup, {
      sectionKey: "chosen-witness/english",
      videoSlug: "chosen-witness",
      title: "Chosen Witness",
      subtitle: "Mary Magdalene: A Life Transformed by Jesus",
      textSubtitle: "Chosen Witness",
      textHeading: "Mary Magdalene: A Life Transformed by Jesus",
      description: [
        "Mary Magdalene’s life was dramatically transformed by Jesus, the man who would change the world forever. Once an outcast, she became one of His most devoted followers. In this animated short film, witness the life of Jesus through her eyes—from her redemption to the moment she became the first to witness His resurrection.",
      ],
      questions: [
        {
          question:
            "In what ways do you identify with the main character, Mary Magdalene?",
          answer:
            "Mary’s story reminds us that everyone has a past, but Jesus offers transformation and a new identity to all who come to Him.",
        },
        {
          question: "Why do you think the elders didn't approve of Jesus?",
          answer:
            "The religious leaders saw Jesus as a threat to their authority and traditions. His message of grace challenged their system of rules-based religion.",
        },
        {
          question:
            "After his resurrection, why do you think Jesus chose to speak first with Mary?",
          answer:
            "Jesus’ choice to appear first to Mary demonstrates that God values faithfulness and devotion. She was present at the cross and the tomb when others had fled.",
        },
      ],
      bibleQuotes: [
        {
          reference: "Luke 8:2",
          text: "And also some women who had been cured of evil spirits and diseases: Mary (called Magdalene) from whom seven demons had come out.",
          imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
          backgroundColor: "#201617",
        },
        {
          reference: "John 20:16",
          text: 'Jesus said to her, "Mary." She turned toward him and cried out in Aramaic, "Rabboni!" (which means "Teacher").',
          imageUrl: unsplash("photo-1522442676585-c751dab71864"),
          backgroundColor: "#A88E78",
        },
        {
          reference: "Mark 16:9",
          text: "Now when Jesus was risen early the first day of the week, he appeared first to Mary Magdalene, out of whom he had cast seven devils.",
          imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
          backgroundColor: "#72593A",
        },
        {
          reference: "Free Resources",
          text: "Want to deepen your understanding of Jesus' life?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── 12. New Believer Course ───────────────────────────────────────────
  const nbcSection: SectionBlock = {
    t: "section",
    sectionKey: "new-believer-course",
    backgroundColor: "primary",
    dynamicBackgroundImage: false,
    staticOverlay: true,
    content: [
      {
        t: "videoCarousel",
        sectionKey: "new-believer-course-carousel",
        subtitle: "Video Course",
        title: "New Believer Course",
        description:
          "If you’ve ever wondered what Christianity is about, or what sort of lifestyle it empowers you to live, the New Believer Course exists to help you understand the Gospel and live your life in response to it.",
        items: NBC.map((n) => ({
          videoId: lookup(n.slug),
          imageUrl: imgCinematic(n.img),
          backgroundColor: "#1C160B",
          titleOverride: n.title,
        })),
      },
    ],
  }

  // ── 13. Invitation to Know Jesus ──────────────────────────────────────
  const invitationSection: SectionBlock = {
    t: "section",
    sectionKey: "invitation-section",
    backgroundColor: "dark",
    staticOverlay: false,
    content: buildVideoSectionContent(lookup, {
      sectionKey: "invitation-to-know-jesus/english",
      videoSlug: "invitation-to-know-jesus-personally",
      title: "Invitation to Know Jesus Personally",
      subtitle: "Are you ready to make the next step of faith?",
      textSubtitle: "Are you ready to make the next step of faith?",
      textHeading: "Invitation to Know Jesus Personally",
      description: [
        "The invitation is open to everyone. It means turning to God and trusting Jesus with our lives and to forgive our sins. We can speak to Him in prayer when we’re ready to become followers of Jesus.",
      ],
      questions: [
        {
          question: "Why do I need saving if I'm a good person?",
          answer:
            "The Bible teaches that all have sinned and fall short of God’s standard. No amount of good deeds can bridge the gap—only God’s grace through Jesus can.",
        },
        {
          question: "Why did Jesus have to die? Couldn't God just forgive us?",
          answer:
            "God’s justice requires that sin be paid for. Jesus willingly took that payment upon Himself so that God could both be just and forgive those who believe.",
        },
        {
          question:
            "If Jesus rose from the dead, why doesn't everyone believe in Him?",
          answer:
            "Faith is a personal response to God’s invitation. God gives everyone the freedom to choose, and the evidence is available for those who seek it sincerely.",
        },
      ],
      bibleQuotes: [
        {
          reference: "John 1:29",
          text: "Look, the Lamb of God, who takes away the sin of the world!",
          imageUrl: unsplash("photo-1521106581851-da5b6457f674"),
          backgroundColor: "#1A1815",
        },
        {
          reference: "Romans 6:23",
          text: "For the wages of sin is death, but the gift of God is eternal life in Christ Jesus our Lord.",
          imageUrl: unsplash("photo-1678181896030-11cf0237d704"),
          backgroundColor: "#72593A",
        },
        {
          reference: "Revelation 3:20",
          text: "Here I am! I stand at the door and knock. If anyone hears my voice and opens the door, I will come in and eat with that person, and they with me.",
          imageUrl: unsplash("photo-1508558936510-0af1e3cccbab", 1400),
          backgroundColor: "#201617",
        },
        {
          reference: "Free Resources",
          text: "Want to deepen your understanding of Jesus' life?",
          ctaLabel: "Join Our Bible Study",
          ctaLink: BSF_CTA,
          imageUrl: unsplash("photo-1650658720644-e1588bd66de3"),
          backgroundColor: "#5F4C5E",
        },
      ],
    }),
  }

  // ── Assemble in production order ──────────────────────────────────────
  const blocks: Block[] = [
    heroBlock,
    mainSection,
    collectionSection,
    myLastDaySection,
    documentarySection,
    whyDieSection,
    nicodemusSection,
    resurrectionSection,
    eventsSection,
    storySection,
    chosenSection,
    nbcSection,
    invitationSection,
  ]

  const { blocks: normalizedBlocks, updatedRecords } =
    await backfillExperienceVideoLanguageIds({
      prisma,
      blocks,
      locale: "en",
    })

  process.stdout.write(
    JSON.stringify({
      event: "seed-easter.video-language-identity",
      updatedRecords,
    }) + "\n",
  )

  // Validate eagerly so we surface errors against the source-of-truth Zod
  // schema rather than the database.
  const parsed = BlocksSchema.safeParse(normalizedBlocks)
  if (!parsed.success) {
    process.stderr.write(
      JSON.stringify(
        { event: "seed-easter.zod_failed", issues: parsed.error.issues },
        null,
        2,
      ) + "\n",
    )
    process.exit(1)
  }

  // Replace any existing easter experience(s).
  const existing = await prisma.experienceLocale.findMany({
    where: { slug: EASTER_EXPERIENCE_SLUG },
    select: { id: true, experienceId: true },
  })
  if (existing.length > 0) {
    const expIds = [...new Set(existing.map((r) => r.experienceId))]
    await prisma.experience.deleteMany({ where: { id: { in: expIds } } })
    process.stdout.write(
      JSON.stringify({
        event: "seed-easter.deleted_existing",
        experienceIds: expIds,
      }) + "\n",
    )
  }

  const created = await prisma.experience.create({
    data: {
      isTemplate: false,
      ownerId: null,
      locales: {
        create: {
          locale: "en",
          slug: EASTER_EXPERIENCE_SLUG,
          title: "Easter",
          metaDescription: `Easter ${CURRENT_YEAR} - videos and resources about Lent, Holy Week, and Resurrection`,
          pathSegment: "easter",
          status: "PUBLISHED",
          publishedAt: new Date(),
          blocks: parsed.data,
        },
      },
    },
    include: { locales: true },
  })

  process.stdout.write(
    JSON.stringify({
      event: "seed-easter.complete",
      experienceId: created.id,
      experienceLocaleId: created.locales[0]?.id,
      slug: EASTER_EXPERIENCE_SLUG,
      blockCount: blocks.length,
      videoIdsResolved: videoMap.size,
    }) + "\n",
  )

  await prisma.$disconnect()
}

main().catch(async (err) => {
  process.stderr.write(
    `[seed-easter] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  )
  process.exit(1)
})
