import type { Core } from "@strapi/strapi"

const EASTER_EXPERIENCE_SLUG = "easter"
const DEFAULT_LOCALE = "en"

// ── Mux streaming URLs (from Urim Chae, 2026-03-25) ────────────────────────
const MUX = {
  heroBackground:
    "https://stream.mux.com/J3WBxqGgXxi01201FYmW0202ayeL7PGXfuuXR02nvjQCE7bI.m3u8",
  easterExplained:
    "https://stream.mux.com/x3XKV1Yi01z7dyF6f8ZLBMNrHtNWS02iHoQw6vIcf4hBw.m3u8",
  myLastDay:
    "https://stream.mux.com/9kSyeRzEyT9uOzKGjTPNMBr6NuoPNaUYpgxoQYIT9J00.m3u8",
  howDidJesusDie:
    "https://stream.mux.com/XMrVrxN5T569taEZJF901iRP686a1LwpF7S1bjI81fmw.m3u8",
  whyDidJesusHaveToDie:
    "https://stream.mux.com/SjQStsNJ8P9jIZkbvJc5zAebqHhwUtiMUBI4Mp4ovFQ.m3u8",
  talkWithNicodemus:
    "https://stream.mux.com/udNH2pbg8TaZcYcGStpY2MC7rTHjW3FVNcR22mG2Lv8.m3u8",
  didJesusComeBack:
    "https://stream.mux.com/gaWAaQKnxddoWt7AmoTvQt00DZrPhWaWSNioHlg1s006w.m3u8",
  theSimpleGospel:
    "https://stream.mux.com/279mJsIfidib02HlmY2Px01yCfAQ5urCkfimsCcJ36rBA.m3u8",
  theStoryShortFilm:
    "https://stream.mux.com/ukCsv3wCRfyqBmxjZHJuka4ou9lBg4z3iUSdyHwk7UE.m3u8",
  reflectionsOfHope:
    "https://stream.mux.com/02Ry6Gfw77pUUbxR00ZGpwRuH8QmkcIYJQAsUzSv8NivA.m3u8",
  chosenWitness:
    "https://stream.mux.com/9gv5sllVjxiC1qKm5A9iG7A3tWvcrBuxUvztNwtXVcE.m3u8",
  invitationToKnowJesus:
    "https://stream.mux.com/00EamMd1vjQPSI3402YD4Mc4QjRzyRByLKSBjkjoTor8Q.m3u8",
} as const

const DOCUMENTARY_MUX = {
  whatHappenedNext:
    "https://stream.mux.com/j5JcToIUxcPWjWMy4DYB0044SAE5IqlFEk25H502C3W00g.m3u8",
  whyEasterBunnies:
    "https://stream.mux.com/HwVU0102j988ttK2A9F3pBTZLSrvmxGrIvmTec1WBhvVs.m3u8",
} as const

// ── Image CDN helpers ───────────────────────────────────────────────────────
const IMG = "https://imagedelivery.net/tMY86qEHFACTO8_0kAeRFA"
const imgCinematic = (id: string) =>
  `${IMG}/${id}.mobileCinematicHigh.jpg/f=jpg,w=1280,h=600,q=95`

const UNSPLASH = "https://images.unsplash.com"
const unsplash = (id: string, w = 900) =>
  `${UNSPLASH}/${id}?w=${w}&auto=format&fit=crop&q=60`

// Local poster files in apps/web/public/images/thumbnails/ — used because
// the MediaCollection component prepends BASE_PATH to imageUrl, breaking
// absolute CDN URLs. Production uses cdn-std.droplr.net/files/acc_760170/*.
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

// ── Types ───────────────────────────────────────────────────────────────────

type VideoDocument = {
  title: string
  slug: string
  documentId: string
}

type ExperienceDocument = {
  documentId: string
}

type DocumentService<TDocument extends Record<string, unknown>> = {
  findFirst: (input: Record<string, unknown>) => Promise<TDocument | null>
  create: (input: Record<string, unknown>) => Promise<TDocument>
  delete: (input: Record<string, unknown>) => Promise<unknown>
}

function getVideoService(
  strapi: Core.Strapi,
): DocumentService<VideoDocument & Record<string, unknown>> {
  return strapi.documents("api::video.video") as unknown as DocumentService<
    VideoDocument & Record<string, unknown>
  >
}

function getExperienceService(
  strapi: Core.Strapi,
): DocumentService<ExperienceDocument & Record<string, unknown>> {
  return strapi.documents(
    "api::experience.experience",
  ) as unknown as DocumentService<ExperienceDocument & Record<string, unknown>>
}

async function findOrCreatePublishedVideo(
  strapi: Core.Strapi,
  slug: string,
  title: string,
): Promise<VideoDocument> {
  const videoService = getVideoService(strapi)
  const existingVideo = await videoService.findFirst({
    locale: DEFAULT_LOCALE,
    status: "published",
    filters: { slug },
  })

  if (existingVideo) {
    strapi.log.info(
      `[seed-easter] Using existing Video "${existingVideo.title}" (${existingVideo.documentId})`,
    )
    return existingVideo
  }

  const createdVideo = await videoService.create({
    locale: DEFAULT_LOCALE,
    status: "published",
    data: { title, slug },
  })
  strapi.log.info(
    `[seed-easter] Created Video "${createdVideo.title}" (${createdVideo.documentId})`,
  )
  return createdVideo
}

// ── Helper: build video section content blocks ──────────────────────────────

function buildVideoSectionContent(opts: {
  sectionKey: string
  videoId: string
  streamingUrl: string
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
}) {
  const videoBlock = {
    __component: "sections.video" as const,
    sectionKey: opts.sectionKey,
    video: opts.videoId,
    streamingUrl: opts.streamingUrl,
    title: opts.title,
    subtitle: opts.subtitle,
  }

  const textBlock: Record<string, unknown> = {
    __component: "sections.text" as const,
    contentParagraphs: opts.description,
  }
  if (opts.textHeading) textBlock.heading = opts.textHeading
  if (opts.textSubtitle) textBlock.subtitle = opts.textSubtitle

  const container = {
    __component: "sections.container" as const,
    slots: [
      { gridSpan: 7, content: [textBlock] },
      {
        gridSpan: 5,
        content: [
          {
            __component: "sections.related-questions" as const,
            heading: "Related questions",
            ctaLabel: "Ask yours",
            ctaLink: ISSUES_CTA,
            questions: opts.questions,
          },
        ],
      },
    ],
  }

  const quotes = {
    __component: "sections.bible-quotes-carousel" as const,
    sectionKey: `${opts.sectionKey}-bible-quotes`,
    heading: "Bible quotes",
    quotes: opts.bibleQuotes,
  }

  const quizButton = {
    __component: "sections.quiz-button" as const,
    buttonText: "What's your next step of faith?",
    iframeSrc: "https://your.nextstep.is/embed/easter2025?expand=false",
  }

  if (opts.skipQuiz) return [videoBlock, container, quotes]
  return [videoBlock, container, quotes, quizButton]
}

// ── Main seed function ──────────────────────────────────────────────────────

export async function seedEaster(strapi: Core.Strapi): Promise<void> {
  const CURRENT_YEAR = new Date().getFullYear()
  const experienceService = getExperienceService(strapi)

  // ── Create all video documents ──────────────────────────────────────────

  const heroVideo = await findOrCreatePublishedVideo(
    strapi,
    "easter-hero",
    "Easter Hero",
  )
  const easterExplainedVideo = await findOrCreatePublishedVideo(
    strapi,
    "easter-explained",
    "Easter Explained",
  )
  const myLastDayVideo = await findOrCreatePublishedVideo(
    strapi,
    "my-last-day",
    "My Last Day",
  )
  const whyDidJesusDieVideo = await findOrCreatePublishedVideo(
    strapi,
    "why-did-jesus-have-to-die",
    "Why Did Jesus Have to Die?",
  )
  const talkWithNicodemusVideo = await findOrCreatePublishedVideo(
    strapi,
    "talk-with-nicodemus",
    "Talk with Nicodemus",
  )
  const didJesusComeBackVideo = await findOrCreatePublishedVideo(
    strapi,
    "did-jesus-come-back-from-the-dead",
    "Did Jesus Come Back from the Dead?",
  )
  const theStoryVideo = await findOrCreatePublishedVideo(
    strapi,
    "the-story-short-film",
    "The Story",
  )
  const chosenWitnessVideo = await findOrCreatePublishedVideo(
    strapi,
    "chosen-witness",
    "Chosen Witness",
  )
  const invitationVideo = await findOrCreatePublishedVideo(
    strapi,
    "invitation-to-know-jesus",
    "Invitation to Know Jesus Personally",
  )
  const docHowDidJesusDie = await findOrCreatePublishedVideo(
    strapi,
    "31-how-did-jesus-die",
    "How Did Jesus Die?",
  )
  const docWhatHappenedNext = await findOrCreatePublishedVideo(
    strapi,
    "32-what-happened-next",
    "What Happened Next?",
  )
  const docWhyEasterBunnies = await findOrCreatePublishedVideo(
    strapi,
    "33-why-is-easter-celebrated-with-bunnies",
    "Why is Easter celebrated with bunnies?",
  )

  const collectionSlugs = [
    { slug: "jesus", title: "JESUS" },
    {
      slug: "life-of-jesus-gospel-of-john",
      title: "Life of Jesus (Gospel of John)",
    },
    {
      slug: "lumo-the-gospel-of-matthew",
      title: "LUMO - The Gospel of Matthew",
    },
    { slug: "lumo-the-gospel-of-mark", title: "LUMO - The Gospel of Mark" },
    { slug: "lumo-the-gospel-of-luke", title: "LUMO - The Gospel of Luke" },
    { slug: "lumo-the-gospel-of-john", title: "LUMO - The Gospel of John" },
  ]
  const collectionIds: string[] = []
  for (const v of collectionSlugs) {
    const doc = await findOrCreatePublishedVideo(strapi, v.slug, v.title)
    collectionIds.push(doc.documentId)
  }

  const jesusChapters = [
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
    {
      slug: "jf-jesus-is-brought-to-herod",
      title: "Jesus is Brought to Herod",
    },
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
  ]
  const chapterMuxUrls = [
    "https://stream.mux.com/02Ry6Gfw77pUUbxR00ZGpwRuH8QmkcIYJQAsUzSv8NivA.m3u8",
    "https://stream.mux.com/RdzWyJOvlFSGfSchJfJgZo02FZFmRxKKioAlwQLqhP1o.m3u8",
    "https://stream.mux.com/WqcB9gngC200Xd02jqLtWDH9kpl7SAA9hetPrZNQzEq2w.m3u8",
    "https://stream.mux.com/86fx02kyx00ofXfTG7nncAgSLyNAzYezJsDH1WBeJ4Jz00.m3u8",
    "https://stream.mux.com/ReVjLKXcnHpNXgndi3iZwAYVVWWSySLve8zlJOP99jQ.m3u8",
    "https://stream.mux.com/nDmSEYIs6bAXCyn4oLJ00kqNXZWpOAY7PmrW1WjNwHoE.m3u8",
    "https://stream.mux.com/02401fH4vQmNwN2dHrYPz02ov4kOSnAP7OR5eCgdkt00VrE.m3u8",
    "https://stream.mux.com/I9lWD00HnByLjW5wTscLBZWLAusYbJSRfGY4za99f02UE.m3u8",
    "https://stream.mux.com/ATLrJ8HbYpDkcWYzNdhoXXwg72CmxWpPLqxJAE02OoKQ.m3u8",
    "https://stream.mux.com/NfZQAEFDpx02daisV7hbnasNgrqsFb02FexupX01limAvM.m3u8",
    "https://stream.mux.com/hPHNL1W4UfMngRcQD14uK8Ie95kdI6aRKc8Z00wtsrXM.m3u8",
    "https://stream.mux.com/fYnMTk01h0100p5006Ad8KpS958nev01v1jh4e00jv5yU2WCE.m3u8",
    "https://stream.mux.com/LbACgzqoNe5pEd00FLKDCprh00BtKSVWzXQoHsGhR01017I.m3u8",
    MUX.invitationToKnowJesus,
  ]
  const chapterImgs = [
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
  const chapterIds: string[] = []
  for (const ch of jesusChapters) {
    const doc = await findOrCreatePublishedVideo(strapi, ch.slug, ch.title)
    chapterIds.push(doc.documentId)
  }

  const nbcEpisodes = [
    { slug: "nbc-the-simple-gospel", title: "The Simple Gospel" },
    { slug: "nbc-the-blood-of-jesus", title: "The Blood of Jesus" },
    { slug: "nbc-life-after-death", title: "Life After Death" },
    { slug: "nbc-gods-forgiveness", title: "God's Forgiveness" },
    { slug: "nbc-savior-lord-and-friend", title: "Savior, Lord, and Friend" },
    { slug: "nbc-being-made-new", title: "Being Made New" },
    { slug: "nbc-living-for-god", title: "Living for God" },
    { slug: "nbc-the-bible", title: "The Bible" },
    { slug: "nbc-prayer", title: "Prayer" },
    { slug: "nbc-church", title: "Church" },
  ]
  const nbcMuxUrls = [
    "https://stream.mux.com/279mJsIfidib02HlmY2Px01yCfAQ5urCkfimsCcJ36rBA.m3u8",
    "https://stream.mux.com/8qf4FwfwVe8LbH651SRJ2vLuQkks3Zz015y2b7Cnfg1A.m3u8",
    "https://stream.mux.com/C3TuBfyhZlXLQu6YGYPq1Ny6zzb9h802MDerNO9opED4.m3u8",
    "https://stream.mux.com/279mJsIfidib02HlmY2Px01yCfAQ5urCkfimsCcJ36rBA.m3u8",
    "https://stream.mux.com/EDzAZinsWhcEY1fbU2NpDw5XMjscjq01GVAARzmqcoy8.m3u8",
    "https://stream.mux.com/BQiPugpj0001dK3sI00I01ij7Nd1cyaucQKb6iSn3YMThWI.m3u8",
    "https://stream.mux.com/OGBK61ML9PXXQCCsUYJ7Q023X4s3j3FXC2tGEtkq8Nmg.m3u8",
    "https://stream.mux.com/S00MMmNY1Ho3fhcndh7ZkRQCKlEMQHtPXZnbkjXZXyu8.m3u8",
    "https://stream.mux.com/kzDfGLuPcBkAlrbIaSjEe3Q00eoK023CFU02MwUnzzuU8g.m3u8",
    "https://stream.mux.com/mFdtM2c02RSUcACqXv700etuF702JUpA02vRZzxMCr2Y5ic.m3u8",
  ]
  const nbcImgs = [
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
  ]
  const nbcIds: string[] = []
  for (const ep of nbcEpisodes) {
    const doc = await findOrCreatePublishedVideo(strapi, ep.slug, ep.title)
    nbcIds.push(doc.documentId)
  }

  // ── Find existing experience (deleted after new one is created) ─────────

  const existing = await experienceService.findFirst({
    locale: DEFAULT_LOCALE,
    status: "published",
    filters: { slug: EASTER_EXPERIENCE_SLUG },
  })

  // ══════════════════════════════════════════════════════════════════════════
  // PRODUCTION ORDER: Hero > Main > Collection > MyLastDay > Documentary >
  // WhyDie > Nicodemus > Resurrection > EasterEvents > Story > Chosen >
  // NBC > Invitation
  // ══════════════════════════════════════════════════════════════════════════

  // ── 1. Hero ───────────────────────────────────────────────────────────

  const heroBlock = {
    __component: "sections.video-hero" as const,
    video: heroVideo.documentId,
    streamingUrl: MUX.heroBackground,
    heading: "Easter",
    subheading: `Easter ${CURRENT_YEAR} - videos & resources about Lent, Holy Week, Resurrection`,
    ctaLabel: "Watch now",
    ctaLink: "",
  }

  // ── 2. Main (nav + intro + Easter Explained + quiz) ───────────────────

  const mainSection = {
    __component: "sections.section" as const,
    sectionKey: "easter-meaning",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: [
      {
        __component: "sections.navigation-carousel" as const,
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
      },
      {
        __component: "sections.container" as const,
        slots: [
          {
            gridSpan: 6,
            content: [
              {
                __component: "sections.text" as const,
                heading: "The Real Easter story",
                subtitle:
                  "Questioning? Searching? Discover the true power of Easter.",
                contentParagraphs: [
                  "Beyond eggs and bunnies lies the story of Jesus\u2019s life, death and resurrection. The true power of Easter goes beyond church services and rituals \u2014 and into the very reason why humans need a Savior.",
                  "The Gospels are shockingly honest about the emotions Jesus experienced \u2014 His deep anguish over one of His closest friends denying he even knew Him, and the other disciples\u2019 disbelief in His resurrection \u2014 raw emotions that mirror our own struggles.",
                  "Explore our collection of videos and interactive resources that invite you into the authentic story \u2014 one that changed history and continues to transform lives today. Because the greatest celebration in human history is about far more than traditions \u2014 it\u2019s about resurrection power.",
                ],
              },
            ],
          },
          {
            gridSpan: 6,
            content: [
              {
                __component: "sections.easter-dates" as const,
                easterDatesTitle: "When is Easter celebrated in {year}?",
                westernEasterLabel: "Western Easter (Catholic/Protestant)",
                orthodoxEasterLabel: "Orthodox",
                passoverLabel: "Jewish Passover",
                locale: "en-US",
              },
            ],
          },
        ],
      },
      ...buildVideoSectionContent({
        sectionKey: "easter-explained/english",
        videoId: easterExplainedVideo.documentId,
        streamingUrl: MUX.easterExplained,
        title: "Easter Explained",
        subtitle:
          "Is Easter about more than bunnies and eggs? Followers of Jesus celebrate His power of life over death on Easter Sunday. Are they right? Was He really raised from the dead?",
        textHeading: "The True Meaning of Easter",
        textSubtitle: "Jesus' Victory Over Sin and Death",
        description: [
          "Easter celebrates Jesus\u2019s death on the cross for our sins and His resurrection, demonstrating power over sin and death. His sacrifice offers forgiveness and eternal life. Easter is a time to celebrate this great hope and God\u2019s incredible gift to us.",
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
              "Easter marks Jesus\u2019 resurrection, proving His victory over death and fulfilling prophecies about the Messiah. It provides hope for eternal life.",
          },
          {
            question:
              "What happened during the three days between Jesus' death and resurrection?",
            answer:
              "Jesus\u2019 body was placed in a tomb guarded by Roman soldiers. His followers mourned in uncertainty. On the third day, He rose victorious over death.",
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

  const collectionSection = {
    __component: "sections.section" as const,
    sectionKey: "video-bible-collection-section",
    backgroundColor: "purple" as const,
    dynamicBackgroundImage: true,
    staticOverlay: true,
    content: [
      {
        __component: "sections.media-collection" as const,
        sectionKey: "video-bible-collection",
        categoryLabel: "Video Bible Collection",
        variant: "carousel",
        title: "The Easter story is a key part of a bigger picture",
        ctaLink: "https://www.jesusfilm.org/watch?utm_source=jesusfilm-watch",
        ctaLabel: "Watch",
        footerText:
          "Our mission is to introduce people to the Bible through films and videos that faithfully bring the Gospels to life. By visually telling the story of Jesus and God\u2019s love for humanity, we make Scripture more accessible, engaging, and easy to understand.",
        items: [
          {
            video: collectionIds[0],
            labelOverride: "Feature Film",
            collectionSize: "61 chapters",
            imageUrl: COLLECTION_POSTERS.jesus,
            subtitleOverride:
              "Jesus constantly surprises and confounds people, from His miraculous birth to His rise from the grave.",
          },
          {
            video: collectionIds[1],
            labelOverride: "Feature Film",
            collectionSize: "49 chapters",
            imageUrl: COLLECTION_POSTERS.lifeOfJesus,
            subtitleOverride:
              "And truly Jesus did many other signs in the presence of His disciples, which are not written in this book.",
          },
          {
            video: collectionIds[2],
            labelOverride: "Collection",
            collectionSize: "25 items",
            imageUrl: COLLECTION_POSTERS.gospelOfMatthew,
            subtitleOverride:
              "The Gospel of Matthew is a word-for-word portrayal of the biblical text.",
          },
          {
            video: collectionIds[3],
            labelOverride: "Collection",
            collectionSize: "15 items",
            imageUrl: COLLECTION_POSTERS.gospelOfMark,
            subtitleOverride:
              "According to the Gospel of Mark, Jesus is a heroic man of action, healer, and miracle worker.",
          },
          {
            video: collectionIds[4],
            labelOverride: "Collection",
            collectionSize: "26 items",
            imageUrl: COLLECTION_POSTERS.gospelOfLuke,
            subtitleOverride:
              "Luke acts as a narrator of events, painting a picture of Jesus as a very human character.",
          },
          {
            video: collectionIds[5],
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

  const myLastDaySection = {
    __component: "sections.section" as const,
    sectionKey: "my-last-day-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "my-last-day/english",
      videoId: myLastDayVideo.documentId,
      streamingUrl: MUX.myLastDay,
      title: "My Last Day",
      subtitle: "Last hour of Jesus' life from criminal's point of view",
      textSubtitle: "My Last Day",
      textHeading: "Last hour of Jesus' life from criminal's point of view",
      description: [
        'A condemned thief witnesses Jesus\u2019s brutal flogging, memories of his own crimes flooding his mind. Why would they punish an innocent man? Forced to carry their crosses to Golgotha, he stumbles beside Jesus. As nails pierce flesh and the sky darkens, he makes a desperate plea\u2014could this truly be the Messiah? In his final moments, Jesus gives him an unexpected promise: "Today, you will be with me in paradise."',
      ],
      questions: [
        {
          question: "Why would Jesus forgive a criminal so easily?",
          answer:
            "Jesus\u2019 forgiveness demonstrates that God\u2019s grace is not earned through good deeds. It is a free gift available to anyone who sincerely asks, regardless of their past.",
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
            "Paradise refers to being in God\u2019s presence after death. Jesus\u2019 promise to the thief means eternal life and restored relationship with God.",
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

  const documentarySection = {
    __component: "sections.section" as const,
    sectionKey: "easter-documentary-series",
    backgroundColor: "cosmic" as const,
    dynamicBackgroundImage: false,
    staticOverlay: true,
    content: [
      {
        __component: "sections.video-carousel" as const,
        sectionKey: "easter-documentary-carousel",
        subtitle: "Easter Documentary Series",
        title: "Did Jesus Defeat Death?",
        description:
          "Go on this adventure to time travel to the 1st century and check out other theories for Jesus\u2019s empty tomb.",
        items: [
          {
            video: docHowDidJesusDie.documentId,
            streamingUrl: MUX.howDidJesusDie,
            imageUrl: imgCinematic("7_0-nfs0301"),
            backgroundColor: "#161817",
            titleOverride: "How Did Jesus Die?",
          },
          {
            video: docWhatHappenedNext.documentId,
            streamingUrl: DOCUMENTARY_MUX.whatHappenedNext,
            imageUrl: imgCinematic("7_0-nfs0302"),
            backgroundColor: "#000906",
            titleOverride: "What Happened Next?",
          },
          {
            video: docWhyEasterBunnies.documentId,
            streamingUrl: DOCUMENTARY_MUX.whyEasterBunnies,
            imageUrl: imgCinematic("7_0-nfs0303"),
            backgroundColor: "#2B2018",
            titleOverride: "Why is Easter celebrated with bunnies?",
          },
        ],
      },
    ],
  }

  // ── 6. Why Did Jesus Have to Die ──────────────────────────────────────

  const whyDieSection = {
    __component: "sections.section" as const,
    sectionKey: "why-did-jesus-die-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "why-did-jesus-have-to-die/english",
      videoId: whyDidJesusDieVideo.documentId,
      streamingUrl: MUX.whyDidJesusHaveToDie,
      title: "Why Did Jesus Have to Die?",
      subtitle: "The Purpose of Jesus' Sacrifice",
      textSubtitle: "Why Did Jesus Have to Die?",
      textHeading: "The Purpose of Jesus' Sacrifice",
      description: [
        "God created humans to be spiritually and relationally connected with Him, but how can we keep God's commands? How can we live without shame? We can\u2019t restore ourselves to honor. It would seem we\u2019re doomed, except God doesn\u2019t want His creation to die. He is merciful and loving, and wants us to be restored, living with Him in full life.",
      ],
      questions: [
        {
          question: "Why was Jesus' death necessary?",
          answer:
            "Humanity\u2019s sin created a separation from God that we could not bridge on our own. Jesus\u2019 death satisfied God\u2019s justice while demonstrating His love.",
        },
        {
          question:
            "If God is loving, why didn't He just forgive sin without Jesus' sacrifice?",
          answer:
            "God is perfectly just and cannot simply ignore sin. Jesus\u2019 death satisfies God\u2019s justice while providing a way for forgiveness without compromising His holy character.",
        },
        {
          question: "How does Jesus' death affect our relationship with God?",
          answer:
            "Through Jesus\u2019 sacrifice, the barrier of sin between humanity and God is removed. We can now have a direct, personal relationship with God through faith in Jesus.",
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

  const nicodemusSection = {
    __component: "sections.section" as const,
    sectionKey: "talk-with-nicodemus-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "talk-with-nicodemus/english",
      videoId: talkWithNicodemusVideo.documentId,
      streamingUrl: MUX.talkWithNicodemus,
      title: "From Religion to Relationship",
      subtitle: "The Gospel in One Conversation",
      textSubtitle: "From Religion to Relationship",
      textHeading: "The Gospel in One Conversation",
      description: [
        "In a private conversation at night, Nicodemus, a respected Jewish teacher, came to Jesus seeking truth. Jesus told him that no one can see the kingdom of God unless they are born again. This deep conversation reveals the heart of Jesus' mission\u2014to bring spiritual rebirth through the Holy Spirit. Discover what it means to be born again and why it's essential for eternal life.",
      ],
      questions: [
        {
          question: "What does it mean to be born again?",
          answer:
            "Being born again is a spiritual transformation\u2014a new birth through the Holy Spirit that gives us new life and a relationship with God.",
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

  const resurrectionSection = {
    __component: "sections.section" as const,
    sectionKey: "did-jesus-come-back-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "did-jesus-come-back-from-the-dead/english",
      videoId: didJesusComeBackVideo.documentId,
      streamingUrl: MUX.didJesusComeBack,
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
            "The resurrection validates Jesus\u2019 claim to be the Son of God, proves death has been defeated, and guarantees eternal life for believers.",
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

  const eventsSection = {
    __component: "sections.section" as const,
    sectionKey: "easter-events-day-by-day",
    backgroundColor: "dark" as const,
    dynamicBackgroundImage: false,
    staticOverlay: true,
    content: [
      {
        __component: "sections.video-carousel" as const,
        sectionKey: "easter-events-carousel",
        subtitle: "Bible Videos",
        title: "Easter Events Day By Day",
        description:
          "Follow along with the events of Easter day by day as described in the Gospel of Luke.",
        items: jesusChapters.map((ch, i) => ({
          video: chapterIds[i],
          streamingUrl: chapterMuxUrls[i],
          imageUrl: imgCinematic(chapterImgs[i]),
          backgroundColor: "#1A1815",
          titleOverride: ch.title,
        })),
      },
    ],
  }

  // ── 10. The Story Short Film ──────────────────────────────────────────

  const storySection = {
    __component: "sections.section" as const,
    sectionKey: "the-story-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "the-story-short-film/english",
      videoId: theStoryVideo.documentId,
      streamingUrl: MUX.theStoryShortFilm,
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
            "The Bible teaches that God created the heavens and the earth with purpose and intention. Every person is created in God\u2019s image, with inherent value and purpose.",
        },
        {
          question:
            "If God is good, why is there so much suffering in the world?",
          answer:
            "Suffering entered the world through humanity\u2019s choice to turn away from God. But God did not abandon us\u2014He sent Jesus to restore what was broken.",
        },
        {
          question: "Is there any hope for the world to be made right again?",
          answer:
            "Yes. Through Jesus\u2019 death and resurrection, God has begun the work of making all things new. He promises a future with no more pain, death, or tears.",
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

  const chosenSection = {
    __component: "sections.section" as const,
    sectionKey: "chosen-witness-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "chosen-witness/english",
      videoId: chosenWitnessVideo.documentId,
      streamingUrl: MUX.chosenWitness,
      title: "Chosen Witness",
      subtitle: "Mary Magdalene: A Life Transformed by Jesus",
      textSubtitle: "Chosen Witness",
      textHeading: "Mary Magdalene: A Life Transformed by Jesus",
      description: [
        "Mary Magdalene\u2019s life was dramatically transformed by Jesus, the man who would change the world forever. Once an outcast, she became one of His most devoted followers. In this animated short film, witness the life of Jesus through her eyes\u2014from her redemption to the moment she became the first to witness His resurrection.",
      ],
      questions: [
        {
          question:
            "In what ways do you identify with the main character, Mary Magdalene?",
          answer:
            "Mary\u2019s story reminds us that everyone has a past, but Jesus offers transformation and a new identity to all who come to Him.",
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
            "Jesus\u2019 choice to appear first to Mary demonstrates that God values faithfulness and devotion. She was present at the cross and the tomb when others had fled.",
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

  const nbcSection = {
    __component: "sections.section" as const,
    sectionKey: "new-believer-course",
    backgroundColor: "primary" as const,
    dynamicBackgroundImage: false,
    staticOverlay: true,
    content: [
      {
        __component: "sections.video-carousel" as const,
        sectionKey: "new-believer-course-carousel",
        subtitle: "Video Course",
        title: "New Believer Course",
        description:
          "If you\u2019ve ever wondered what Christianity is about, or what sort of lifestyle it empowers you to live, the New Believer Course exists to help you understand the Gospel and live your life in response to it.",
        items: nbcEpisodes.map((ep, i) => ({
          video: nbcIds[i],
          streamingUrl: nbcMuxUrls[i],
          imageUrl: imgCinematic(nbcImgs[i]),
          backgroundColor: "#1C160B",
          titleOverride: ep.title,
        })),
      },
    ],
  }

  // ── 13. Invitation to Know Jesus ──────────────────────────────────────

  const invitationSection = {
    __component: "sections.section" as const,
    sectionKey: "invitation-section",
    backgroundColor: "dark" as const,
    staticOverlay: false,
    content: buildVideoSectionContent({
      sectionKey: "invitation-to-know-jesus/english",
      videoId: invitationVideo.documentId,
      streamingUrl: MUX.invitationToKnowJesus,
      title: "Invitation to Know Jesus Personally",
      subtitle: "Are you ready to make the next step of faith?",
      textSubtitle: "Are you ready to make the next step of faith?",
      textHeading: "Invitation to Know Jesus Personally",
      description: [
        "The invitation is open to everyone. It means turning to God and trusting Jesus with our lives and to forgive our sins. We can speak to Him in prayer when we\u2019re ready to become followers of Jesus.",
      ],
      questions: [
        {
          question: "Why do I need saving if I'm a good person?",
          answer:
            "The Bible teaches that all have sinned and fall short of God\u2019s standard. No amount of good deeds can bridge the gap\u2014only God\u2019s grace through Jesus can.",
        },
        {
          question: "Why did Jesus have to die? Couldn't God just forgive us?",
          answer:
            "God\u2019s justice requires that sin be paid for. Jesus willingly took that payment upon Himself so that God could both be just and forgive those who believe.",
        },
        {
          question:
            "If Jesus rose from the dead, why doesn't everyone believe in Him?",
          answer:
            "Faith is a personal response to God\u2019s invitation. God gives everyone the freedom to choose, and the evidence is available for those who seek it sincerely.",
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

  // ── Delete old + create new (back-to-back to minimise blank-page window) ─

  if (existing) {
    await experienceService.delete({ documentId: existing.documentId })
    strapi.log.info(
      `[seed-easter] Deleted existing Experience "${EASTER_EXPERIENCE_SLUG}" to re-create.`,
    )
  }

  const allBlocks = [
    { name: "heroBlock", data: heroBlock },
    { name: "mainSection", data: mainSection },
    { name: "collectionSection", data: collectionSection },
    { name: "myLastDaySection", data: myLastDaySection },
    { name: "documentarySection", data: documentarySection },
    { name: "whyDieSection", data: whyDieSection },
    { name: "nicodemusSection", data: nicodemusSection },
    { name: "resurrectionSection", data: resurrectionSection },
    { name: "eventsSection", data: eventsSection },
    { name: "storySection", data: storySection },
    { name: "chosenSection", data: chosenSection },
    { name: "nbcSection", data: nbcSection },
    { name: "invitationSection", data: invitationSection },
  ]

  // Diagnostic: try adding blocks incrementally to find which one causes
  // "Invalid relations". Remove this once the root cause is fixed.
  let lastGoodIndex = -1
  for (let i = 0; i < allBlocks.length; i++) {
    const subset = allBlocks.slice(0, i + 1).map((b) => b.data)
    try {
      // Delete previous attempt if it exists
      const prev = await experienceService.findFirst({
        locale: DEFAULT_LOCALE,
        filters: { slug: EASTER_EXPERIENCE_SLUG },
      })
      if (prev) {
        await experienceService.delete({ documentId: prev.documentId })
      }
      await experienceService.create({
        locale: DEFAULT_LOCALE,
        status: "published",
        data: {
          slug: EASTER_EXPERIENCE_SLUG,
          title: "Easter",
          metaDescription: `Easter ${CURRENT_YEAR} - videos and resources about Lent, Holy Week, and Resurrection`,
          pathSegment: "easter",
          blocks: subset,
        },
      })
      lastGoodIndex = i
      strapi.log.info(
        `[seed-easter] ✓ Block ${i} (${allBlocks[i].name}) OK — ${i + 1}/${allBlocks.length} blocks`,
      )
    } catch (blockError) {
      const msg =
        blockError instanceof Error ? blockError.message : String(blockError)
      strapi.log.error(
        `[seed-easter] ✗ Block ${i} (${allBlocks[i].name}) FAILED: ${msg}`,
      )
      strapi.log.error(
        `[seed-easter] Last good index: ${lastGoodIndex}. Failing block data: ${JSON.stringify(allBlocks[i].data).slice(0, 500)}`,
      )
      throw blockError
    }
  }
  strapi.log.info(
    `[seed-easter] Created Experience "${EASTER_EXPERIENCE_SLUG}" with all ${allBlocks.length} sections.`,
  )
}
