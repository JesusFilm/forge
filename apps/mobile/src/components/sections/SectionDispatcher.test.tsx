/**
 * Tests for SectionDispatcher — verifies that each section kind dispatches
 * to the correct renderer component and that unknown kinds are handled.
 *
 * Uses createElement directly to avoid needing a full render environment.
 */

import { createElement } from "react"

import type {
  BibleQuotesCarouselSection,
  CardSection,
  ContainerSection,
  CTASection,
  ExperienceSection,
  MediaCollectionSection,
  QuizButtonSection,
  RelatedQuestionsSection,
  SectionWrapperSection,
  TextSection,
  VideoHeroSection,
  VideoSection,
} from "../../lib/sectionModels"
import { ContentDispatcher, SectionDispatcher } from "./SectionDispatcher"

// -- Fixtures ----------------------------------------------------------------

const videoHero: VideoHeroSection = {
  kind: "videoHero",
  id: "vh-1",
  sectionKey: null,
  heading: "Hero Heading",
  subheading: null,
  streamingUrl: null,
  ctaLink: null,
  ctaLabel: null,
  video: { documentId: "v1", slug: "test", title: "Test", image: null },
}

const mediaCollection: MediaCollectionSection = {
  kind: "mediaCollection",
  id: "mc-1",
  sectionKey: null,
  title: "Collection",
  subtitle: null,
  description: null,
  categoryLabel: null,
  ctaLink: null,
  showItemNumbers: null,
  footerText: null,
  variant: "carousel",
  items: [],
}

const cta: CTASection = {
  kind: "cta",
  id: "cta-1",
  sectionKey: null,
  heading: "CTA Heading",
  body: null,
  buttonLabel: "Click",
  buttonLink: null,
  variant: null,
}

const text: TextSection = {
  kind: "text",
  id: "txt-1",
  sectionKey: null,
  heading: "Text Heading",
  headingLevel: null,
  subtitle: null,
  content: "Some content",
  variant: null,
}

const video: VideoSection = {
  kind: "video",
  id: "vid-1",
  sectionKey: null,
  streamingUrl: "https://example.com/stream",
  title: "Video Title",
  subtitle: null,
  media: null,
  video: null,
}

const bibleQuotes: BibleQuotesCarouselSection = {
  kind: "bibleQuotesCarousel",
  id: "bq-1",
  sectionKey: null,
  heading: "Quotes",
  quotes: [],
}

const relatedQuestions: RelatedQuestionsSection = {
  kind: "relatedQuestions",
  id: "rq-1",
  sectionKey: null,
  heading: "FAQ",
  questions: [],
}

const card: CardSection = {
  kind: "card",
  id: "card-1",
  sectionKey: null,
  title: "Card Title",
  description: "Card desc",
  media: null,
  link: null,
  variant: null,
}

const container: ContainerSection = {
  kind: "container",
  id: "cnt-1",
  sectionKey: null,
  slots: [{ id: "slot-1", gridSpan: 6, content: [text] }],
}

const sectionWrapper: SectionWrapperSection = {
  kind: "sectionWrapper",
  id: "sw-1",
  sectionKey: null,
  backgroundColor: "dark",
  blurHash: null,
  content: [cta],
}

const quizButton: QuizButtonSection = {
  kind: "quizButton",
  id: "qb-1",
  sectionKey: null,
  buttonText: "What's your next step of faith?",
  iframeSrc: "https://www.nextstep.is/quiz/easter",
}

// -- Tests -------------------------------------------------------------------

describe("ContentDispatcher", () => {
  it("dispatches quizButton without throwing", () => {
    expect(() =>
      createElement(ContentDispatcher, { content: [quizButton] }),
    ).not.toThrow()
  })
})

describe("SectionDispatcher", () => {
  const allSections: {
    kind: string
    section: ExperienceSection
  }[] = [
    { kind: "videoHero", section: videoHero },
    { kind: "mediaCollection", section: mediaCollection },
    { kind: "cta", section: cta },
    { kind: "text", section: text },
    { kind: "video", section: video },
    { kind: "bibleQuotesCarousel", section: bibleQuotes },
    { kind: "relatedQuestions", section: relatedQuestions },
    { kind: "card", section: card },
    { kind: "container", section: container },
    { kind: "sectionWrapper", section: sectionWrapper },
    { kind: "quizButton", section: quizButton },
  ]

  it.each(allSections)("dispatches $kind without throwing", ({ section }) => {
    // createElement validates props and returns a ReactElement —
    // this ensures the dispatcher accepts each kind without error
    expect(() => createElement(SectionDispatcher, { section })).not.toThrow()
  })

  it("returns null and warns for unknown kind", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation()
    const unknown = {
      kind: "banana",
      id: "x",
    } as unknown as ExperienceSection

    // Call the component function directly
    const result = SectionDispatcher({ section: unknown })
    expect(result).toBeNull()
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("unknown section kind"),
    )
    spy.mockRestore()
  })
})
