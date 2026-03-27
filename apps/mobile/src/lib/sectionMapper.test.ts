import { mapSections, firstSectionTitle } from "./sectionMapper"
import type { ExperienceSection } from "./sectionModels"

// -- Fixtures (minimal raw GraphQL shapes matching aliased fields) ----------

const rawVideoHero = {
  __typename: "ComponentSectionsVideoHero" as const,
  id: "vh-1",
  sectionKey: "hero",
  videoHeroHeading: "Easter 2026",
  subheading: "Videos & resources",
  ctaLink: "/watch",
  ctaLabel: "Watch Now",
  heroVideo: {
    documentId: "v-1",
    slug: "easter-video",
    title: "The True Meaning of Easter",
    imageAlt: "Hero",
    images: [{ url: "https://img.example.com/hero.jpg" }],
  },
}

const rawMediaCollection = {
  __typename: "ComponentSectionsMediaCollection" as const,
  id: "mc-1",
  sectionKey: "videos",
  mediaCollectionTitle: "Featured Videos",
  subtitle: "Watch these",
  mediaCollectionDescription: "A curated collection",
  categoryLabel: "Short Films",
  mediaCollectionCtaLink: "/all",
  showItemNumbers: true,
  footerText: "See more",
  mediaCollectionVariant: "grid",
  items: [
    {
      id: "item-1",
      titleOverride: "Custom Title",
      subtitleOverride: null,
      collectionSize: "5",
      linkToSectionKey: "details",
      imageOverride: {
        url: "https://img.example.com/override.jpg",
        alternativeText: "Override",
      },
      itemVideo: {
        documentId: "v-2",
        slug: "my-last-day",
        title: "My Last Day",
        imageAlt: null,
        images: [{ url: "https://img.example.com/v2.jpg" }],
      },
    },
  ],
}

const rawCta = {
  __typename: "ComponentSectionsCta" as const,
  id: "cta-1",
  sectionKey: "cta-resources",
  ctaHeading: "Free Resources",
  body: "Grow deeper in your faith",
  buttonLabel: "Get Started",
  buttonLink: "/resources",
  ctaVariant: "primary",
}

const rawText = {
  __typename: "ComponentSectionsText" as const,
  id: "txt-1",
  sectionKey: "story",
  textHeading: "The Real Easter Story",
  headingLevel: "h2",
  textSubtitle: "A subtitle",
  textContent: "The true Easter narrative...",
  textVariant: "lead",
}

const rawRelatedQuestions = {
  __typename: "ComponentSectionsRelatedQuestions" as const,
  id: "rq-1",
  sectionKey: "faq",
  relatedQuestionsHeading: "Related Questions",
  questions: [
    { id: "q-1", question: "Why is Easter important?", answer: "Because..." },
    { id: "q-2", question: "What happened?", answer: "Jesus rose..." },
  ],
}

const rawBibleQuotesCarousel = {
  __typename: "ComponentSectionsBibleQuotesCarousel" as const,
  id: "bqc-1",
  sectionKey: "quotes",
  carouselHeading: "Scripture",
  quotes: [
    {
      id: "bq-1",
      reference: "1 Corinthians 15:55",
      text: "Where, O death, is your victory?",
      backgroundImage: {
        url: "https://img.example.com/bg.jpg",
        alternativeText: "Background",
      },
      ctaLabel: "Read More",
      ctaLink: "/verse",
      attribution: "Apostle Paul",
    },
  ],
}

const rawCard = {
  __typename: "ComponentSectionsCard" as const,
  id: "card-1",
  sectionKey: "featured",
  cardTitle: "JESUS Film",
  cardDescription: "Watch the classic film",
  media: {
    url: "https://img.example.com/jesus.jpg",
    alternativeText: "JESUS Film poster",
  },
  link: "/watch/jesus",
  cardVariant: "featured",
}

const rawVideo = {
  __typename: "ComponentSectionsVideo" as const,
  id: "vid-1",
  sectionKey: "player",
  streamingUrl: "https://stream.example.com/video.m3u8",
  videoTitle: "Victory Over Death",
  videoSubtitle: "A short film",
  videoMedia: {
    url: "https://img.example.com/thumb.jpg",
    alternativeText: "Thumbnail",
  },
  sectionVideo: {
    documentId: "v-3",
    slug: "victory",
    title: "Victory Over Death",
    imageAlt: null,
    images: [],
  },
}

const rawQuizButton = {
  __typename: "ComponentSectionsQuizButton" as const,
  id: "qb-1",
  buttonText: "What's your next step of faith?",
  iframeSrc: "https://www.nextstep.is/quiz/easter",
}

const rawEasterDates = {
  __typename: "ComponentSectionsEasterDates" as const,
  id: "ed-1",
  sectionKey: "easter",
  easterDatesTitle: "Easter {year}",
  westernEasterLabel: "Western Easter",
  orthodoxEasterLabel: "Orthodox Easter",
  passoverLabel: "Passover",
  locale: "en",
}

// -- Tests -----------------------------------------------------------------

describe("mapSections", () => {
  it("returns empty array for null/undefined input", () => {
    expect(mapSections(null)).toEqual([])
    expect(mapSections(undefined)).toEqual([])
    expect(mapSections([])).toEqual([])
  })

  it("skips null entries and deprecated types", () => {
    const raw = [
      null,
      { __typename: "ComponentSectionsPromoBanner" as const, id: "pb-1" },
      { __typename: "ComponentSectionsInfoBlocks" as const, id: "ib-1" },
      rawCta,
    ]
    const result = mapSections(raw as any)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe("cta")
  })

  it("maps VideoHero correctly", () => {
    const [section] = mapSections([rawVideoHero] as any)
    expect(section.kind).toBe("videoHero")
    if (section.kind !== "videoHero") return
    expect(section.heading).toBe("Easter 2026")
    expect(section.subheading).toBe("Videos & resources")
    expect(section.ctaLabel).toBe("Watch Now")
    expect(section.video.slug).toBe("easter-video")
    expect(section.video.image?.url).toBe("https://img.example.com/hero.jpg")
  })

  it("maps MediaCollection correctly", () => {
    const [section] = mapSections([rawMediaCollection] as any)
    expect(section.kind).toBe("mediaCollection")
    if (section.kind !== "mediaCollection") return
    expect(section.title).toBe("Featured Videos")
    expect(section.variant).toBe("grid")
    expect(section.showItemNumbers).toBe(true)
    expect(section.footerText).toBe("See more")
    expect(section.items).toHaveLength(1)
    expect(section.items[0].titleOverride).toBe("Custom Title")
    expect(section.items[0].video?.slug).toBe("my-last-day")
    expect(section.items[0].imageOverride?.url).toBe(
      "https://img.example.com/override.jpg",
    )
  })

  it("maps CTA correctly", () => {
    const [section] = mapSections([rawCta] as any)
    expect(section.kind).toBe("cta")
    if (section.kind !== "cta") return
    expect(section.heading).toBe("Free Resources")
    expect(section.buttonLabel).toBe("Get Started")
    expect(section.variant).toBe("primary")
  })

  it("maps Text correctly", () => {
    const [section] = mapSections([rawText] as any)
    expect(section.kind).toBe("text")
    if (section.kind !== "text") return
    expect(section.heading).toBe("The Real Easter Story")
    expect(section.headingLevel).toBe("h2")
    expect(section.content).toBe("The true Easter narrative...")
    expect(section.variant).toBe("lead")
  })

  it("maps RelatedQuestions correctly", () => {
    const [section] = mapSections([rawRelatedQuestions] as any)
    expect(section.kind).toBe("relatedQuestions")
    if (section.kind !== "relatedQuestions") return
    expect(section.questions).toHaveLength(2)
    expect(section.questions[0].question).toBe("Why is Easter important?")
  })

  it("maps BibleQuotesCarousel correctly", () => {
    const [section] = mapSections([rawBibleQuotesCarousel] as any)
    expect(section.kind).toBe("bibleQuotesCarousel")
    if (section.kind !== "bibleQuotesCarousel") return
    expect(section.heading).toBe("Scripture")
    expect(section.quotes).toHaveLength(1)
    expect(section.quotes[0].reference).toBe("1 Corinthians 15:55")
    expect(section.quotes[0].attribution).toBe("Apostle Paul")
    expect(section.quotes[0].backgroundImage?.url).toBe(
      "https://img.example.com/bg.jpg",
    )
  })

  it("maps Card correctly", () => {
    const [section] = mapSections([rawCard] as any)
    expect(section.kind).toBe("card")
    if (section.kind !== "card") return
    expect(section.title).toBe("JESUS Film")
    expect(section.variant).toBe("featured")
    expect(section.media?.alternativeText).toBe("JESUS Film poster")
  })

  it("maps Video correctly", () => {
    const [section] = mapSections([rawVideo] as any)
    expect(section.kind).toBe("video")
    if (section.kind !== "video") return
    expect(section.streamingUrl).toBe("https://stream.example.com/video.m3u8")
    expect(section.title).toBe("Victory Over Death")
    expect(section.video?.slug).toBe("victory")
  })

  it("maps EasterDates correctly", () => {
    const [section] = mapSections([rawEasterDates] as any)
    expect(section.kind).toBe("easterDates")
    if (section.kind !== "easterDates") return
    expect(section.easterDatesTitle).toBe("Easter {year}")
    expect(section.westernEasterLabel).toBe("Western Easter")
    expect(section.orthodoxEasterLabel).toBe("Orthodox Easter")
    expect(section.passoverLabel).toBe("Passover")
    expect(section.locale).toBe("en")
  })

  it("maps QuizButton correctly (top-level)", () => {
    const [section] = mapSections([rawQuizButton] as any)
    expect(section.kind).toBe("quizButton")
    if (section.kind !== "quizButton") return
    expect(section.buttonText).toBe("What's your next step of faith?")
    expect(section.iframeSrc).toBe("https://www.nextstep.is/quiz/easter")
  })

  it("maps QuizButton correctly via mapContentItem (SectionWrapper)", () => {
    const rawSectionWrapper = {
      __typename: "ComponentSectionsSection" as const,
      id: "sec-quiz",
      sectionKey: "quiz-section",
      backgroundColor: "dark",
      blurHash: null,
      sectionContent: [rawQuizButton],
    }
    const [section] = mapSections([rawSectionWrapper] as any)
    expect(section.kind).toBe("sectionWrapper")
    if (section.kind !== "sectionWrapper") return
    expect(section.content).toHaveLength(1)
    expect(section.content[0].kind).toBe("quizButton")
    if (section.content[0].kind !== "quizButton") return
    expect(section.content[0].buttonText).toBe(
      "What's your next step of faith?",
    )
    expect(section.content[0].iframeSrc).toBe(
      "https://www.nextstep.is/quiz/easter",
    )
  })

  it("maps EasterDates inside Container slot content", () => {
    const rawContainer = {
      __typename: "ComponentSectionsContainer" as const,
      id: "cont-easter",
      sectionKey: "easter-grid",
      slots: [
        {
          id: "slot-ed",
          gridSpan: 12,
          slotContent: [rawEasterDates],
        },
      ],
    }
    const [section] = mapSections([rawContainer] as any)
    expect(section.kind).toBe("container")
    if (section.kind !== "container") return
    expect(section.slots[0].content).toHaveLength(1)
    expect(section.slots[0].content[0].kind).toBe("easterDates")
  })

  it("maps Container with nested slot content", () => {
    const rawContainer = {
      __typename: "ComponentSectionsContainer" as const,
      id: "cont-1",
      sectionKey: "two-col",
      slots: [
        {
          id: "slot-1",
          gridSpan: 6,
          slotContent: [rawText, rawCta],
        },
        {
          id: "slot-2",
          gridSpan: 6,
          slotContent: [rawVideo],
        },
      ],
    }
    const [section] = mapSections([rawContainer] as any)
    expect(section.kind).toBe("container")
    if (section.kind !== "container") return
    expect(section.slots).toHaveLength(2)
    expect(section.slots[0].gridSpan).toBe(6)
    expect(section.slots[0].content).toHaveLength(2)
    expect(section.slots[0].content[0].kind).toBe("text")
    expect(section.slots[0].content[1].kind).toBe("cta")
    expect(section.slots[1].content[0].kind).toBe("video")
  })

  it("maps Section wrapper with nested content", () => {
    const rawSectionWrapper = {
      __typename: "ComponentSectionsSection" as const,
      id: "sec-1",
      sectionKey: "dark-section",
      backgroundColor: "dark",
      blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      sectionContent: [rawText, rawBibleQuotesCarousel],
    }
    const [section] = mapSections([rawSectionWrapper] as any)
    expect(section.kind).toBe("sectionWrapper")
    if (section.kind !== "sectionWrapper") return
    expect(section.backgroundColor).toBe("dark")
    expect(section.blurHash).toBe("LEHV6nWB2yk8pyo0adR*.7kCMdnj")
    expect(section.content).toHaveLength(2)
    expect(section.content[0].kind).toBe("text")
    expect(section.content[1].kind).toBe("bibleQuotesCarousel")
  })

  it("maps Section wrapper with nested Container", () => {
    const rawSectionWrapper = {
      __typename: "ComponentSectionsSection" as const,
      id: "sec-2",
      sectionKey: "nested",
      backgroundColor: "light",
      blurHash: null,
      sectionContent: [
        {
          __typename: "ComponentSectionsContainer" as const,
          id: "cont-nested",
          sectionKey: "inner-grid",
          slots: [{ id: "s-1", gridSpan: 12, slotContent: [rawCard] }],
        },
      ],
    }
    const [section] = mapSections([rawSectionWrapper] as any)
    expect(section.kind).toBe("sectionWrapper")
    if (section.kind !== "sectionWrapper") return
    expect(section.content).toHaveLength(1)
    expect(section.content[0].kind).toBe("container")
    if (section.content[0].kind !== "container") return
    expect(section.content[0].slots[0].content[0].kind).toBe("card")
  })

  it("maps a mixed array of all section types", () => {
    const all = [
      rawVideoHero,
      rawMediaCollection,
      rawCta,
      rawText,
      rawRelatedQuestions,
      rawBibleQuotesCarousel,
      rawCard,
      rawVideo,
      rawEasterDates,
      rawQuizButton,
    ]
    const result = mapSections(all as any)
    expect(result).toHaveLength(10)
    const kinds = result.map((s) => s.kind)
    expect(kinds).toEqual([
      "videoHero",
      "mediaCollection",
      "cta",
      "text",
      "relatedQuestions",
      "bibleQuotesCarousel",
      "card",
      "video",
      "easterDates",
      "quizButton",
    ])
  })
})

describe("firstSectionTitle", () => {
  it("returns first heading from videoHero", () => {
    const sections = mapSections([rawVideoHero, rawText] as any)
    expect(firstSectionTitle(sections)).toBe("Easter 2026")
  })

  it("returns first title from mediaCollection", () => {
    const sections = mapSections([rawMediaCollection] as any)
    expect(firstSectionTitle(sections)).toBe("Featured Videos")
  })

  it("returns null for empty array", () => {
    expect(firstSectionTitle([])).toBeNull()
  })

  it("skips sections with no heading", () => {
    const noHeading = {
      ...rawText,
      textHeading: null,
    }
    const sections = mapSections([
      noHeading,
      rawCta,
    ] as any) as ExperienceSection[]
    expect(firstSectionTitle(sections)).toBe("Free Resources")
  })
})
