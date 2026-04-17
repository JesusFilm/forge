import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ExperienceEditor } from "./experience-editor"

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}))

const action = vi.fn(async () => ({ ok: true }))

function renderEditor(
  blocks: unknown[],
  options: { isTemplate?: boolean } = {},
) {
  return renderToStaticMarkup(
    <ExperienceEditor
      canPublish
      hasPublishedVersion={false}
      calendarDate="2026-04-17"
      ownerLabel="Editor"
      publishedAtLabel="not yet published"
      revisionEntries={[]}
      localeEntries={[
        {
          id: "locale-1",
          code: "en",
          title: "English",
          href: "/dashboard/experiences/exp-1?locale=en",
          stateLabel: "DRAFT",
          stateTone: "warning",
          active: true,
        },
      ]}
      videoLibrary={[
        {
          key: "video-1",
          title: "The Story",
          description: "A localized description.",
          id: "core-video-1",
          label: "FEATURE_FILM",
          labelLabel: "Feature Film",
          sourceLabel: "Core",
          sourceTone: "success",
          dubs: "3 dubs",
          updated: "2026-04-16T00:00:00.000Z",
          duration: "12:34",
          durationSeconds: 754,
          previewImageUrl: "https://example.com/image.jpg",
          previewStreamUrl: "https://example.com/video.mp4",
        },
      ]}
      initialValues={{
        localeId: "locale-1",
        title: "Experience title",
        slug: "experience-title",
        metaDescription: "Meta description",
        ogTitle: "",
        ogDescription: "",
        ogImageUrl: "",
        pathSegment: "",
        isHomepage: false,
        isTemplate: options.isTemplate ?? false,
        blocksJson: JSON.stringify(blocks),
      }}
      saveAction={action}
      publishAction={action}
      restoreAction={action}
    />,
  )
}

describe("ExperienceEditor", () => {
  it("renders first-class controls for repeatable non-layout block editors", () => {
    const infoBlocksBlock = {
      t: "infoBlocks",
      sectionKey: "info",
      intro: "Overview",
      heading: "Info",
      description: "Details",
      blocks: [
        {
          icon: "favorite",
          title: "Card one",
          description: "Card detail",
        },
        {
          icon: "video_library",
          title: "Card two",
          description: "Second card detail",
        },
        {
          icon: "menu_book",
          title: "Card three",
          description: "Third card detail",
        },
        {
          icon: "forum",
          title: "Card four",
          description: "Fourth card detail",
        },
      ],
    }
    const navigationCarouselBlock = {
      t: "navigationCarousel",
      sectionKey: "nav",
      items: [
        {
          contentId: "destination-1",
          title: "Destination One",
          category: "Topic",
        },
        {
          contentId: "destination-2",
          title: "Destination Two",
          category: "Topic",
        },
        {
          contentId: "destination-3",
          title: "Destination Three",
          category: "Topic",
        },
        {
          contentId: "destination-4",
          title: "Destination Four",
          category: "Topic",
        },
      ],
    }
    const mediaCollectionBlock = {
      t: "mediaCollection",
      sectionKey: "media",
      variant: "grid",
      itemsSource: "manual",
      title: "Media",
      items: [
        {
          videoId: "video-1",
          titleOverride: "Featured video",
        },
      ],
    }
    const relatedQuestionsBlock = {
      t: "relatedQuestions",
      sectionKey: "questions",
      heading: "Questions",
      questions: [
        {
          question: "Why does this matter?",
          answer: "Because it helps editors finish the page.",
        },
      ],
    }
    const bibleQuotesCarouselBlock = {
      t: "bibleQuotesCarousel",
      sectionKey: "quotes",
      heading: "Quotes",
      quotes: [
        {
          reference: "John 3:16",
          text: "For God so loved the world...",
          backgroundColor: "#663399",
          ctaEnabled: false,
        },
      ],
    }

    const html = renderEditor([
      infoBlocksBlock,
      navigationCarouselBlock,
      mediaCollectionBlock,
      relatedQuestionsBlock,
      bibleQuotesCarouselBlock,
    ])

    expect(html).toContain("Support cards")
    expect(html).toContain("Key Details")
    expect(html).toContain("Destinations")
    expect(html).toContain("Media items")
    expect(html).toContain("Questions and answers")
    expect(html).toContain("Quote cards")

    expect(renderEditor([infoBlocksBlock])).toContain("Add card")
    expect(renderEditor([infoBlocksBlock])).toContain("Overview")
    expect(renderEditor([infoBlocksBlock])).toContain(
      "Add a short label above the details",
    )
    expect(renderEditor([infoBlocksBlock])).toContain("Add a details heading")
    expect(renderEditor([infoBlocksBlock])).toContain(
      "Explain what these details help clarify",
    )
    expect(renderEditor([infoBlocksBlock])).toContain("Name this detail")
    expect(renderEditor([infoBlocksBlock])).toContain("Explain the detail")
    expect(renderEditor([infoBlocksBlock])).toContain("Choose info card icon")
    expect(renderEditor([infoBlocksBlock])).toContain("Drag info card")
    expect(renderEditor([infoBlocksBlock])).toContain("+2")
    expect(renderEditor([infoBlocksBlock])).toContain("more cards")
    expect(renderEditor([infoBlocksBlock])).toContain(
      "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_48%)]",
    )
    expect(renderEditor([infoBlocksBlock])).not.toContain("+1")
    expect(renderEditor([infoBlocksBlock])).not.toContain("Use Favorite icon")
    expect(renderEditor([infoBlocksBlock])).not.toContain("Close icon picker")
    expect(renderEditor([infoBlocksBlock])).not.toContain("Move info card up")
    expect(renderEditor([infoBlocksBlock])).not.toContain("Width Percent")
    expect(renderEditor([infoBlocksBlock])).not.toContain("Info Blocks")
    expect(renderEditor([infoBlocksBlock])).not.toContain("Info Grid")
    expect(renderEditor([infoBlocksBlock])).not.toContain('placeholder="Intro"')
    expect(renderEditor([infoBlocksBlock])).not.toContain("Key Details title")
    expect(renderEditor([infoBlocksBlock])).not.toContain(
      "Key Details description",
    )
    expect(renderEditor([bibleQuotesCarouselBlock])).toContain(
      "Introduce these verses",
    )
    expect(renderEditor([bibleQuotesCarouselBlock])).toContain("#663399")
    expect(renderEditor([bibleQuotesCarouselBlock])).not.toContain(
      "Add a quotes heading",
    )
    expect(renderEditor([bibleQuotesCarouselBlock])).not.toContain(
      "Quote Carousel title",
    )
    expect(renderEditor([navigationCarouselBlock])).toContain("Add destination")
    expect(renderEditor([navigationCarouselBlock])).toContain("+2")
    expect(renderEditor([navigationCarouselBlock])).toContain(
      "more destinations",
    )
    expect(renderEditor([mediaCollectionBlock])).toContain("Add video")
    expect(renderEditor([relatedQuestionsBlock])).toContain(
      "Add another question",
    )
    expect(renderEditor([relatedQuestionsBlock])).toContain(
      "Write the question",
    )
    expect(renderEditor([relatedQuestionsBlock])).not.toContain(
      'placeholder="Question"',
    )
    expect(renderEditor([bibleQuotesCarouselBlock])).toContain(
      "Add another quote",
    )
  })

  it("renders a real empty state for questions and answers", () => {
    const html = renderEditor([
      {
        t: "relatedQuestions",
        sectionKey: "questions",
        heading: "Questions",
        questions: [],
        ctaEnabled: true,
        ctaLabel: "Start here",
        ctaLink: "/start",
      },
    ])

    expect(html).toContain(
      "Add questions and answers to help visitors decide what to do next.",
    )
    expect(html).toContain("Select this block to add questions and answers.")
    expect(html).toContain("Start here")
    expect(html).not.toContain("divide-y divide-[var(--color-hairline)]")
  })

  it("previews card imagery as a canvas background", () => {
    const html = renderEditor([
      {
        t: "card",
        sectionKey: "card",
        title: "Card title",
        description: "Card detail",
        mediaUrl: "https://example.com/card.jpg",
        backgroundColor: "#224466",
        link: "/card",
      },
    ])

    expect(html).toContain("https://example.com/card.jpg")
    expect(html).toContain("#224466")
    expect(html).toContain("Choose card image from asset library")
    expect(html).toContain("Choose card background color")
    expect(html).toContain("linear-gradient(0deg")
    expect(html).not.toContain("Background Color")
    expect(html).not.toContain("Paste image URL")
    expect(html).not.toContain("Choose image")
    expect(html).not.toContain("Media Url")
    expect(html).not.toContain("Media URL")
  })

  it("uses selected video artwork for navigation destinations", () => {
    const html = renderEditor([
      {
        t: "navigationCarousel",
        sectionKey: "nav",
        items: [],
      },
      {
        t: "videoHero",
        sectionKey: "hero-video",
        useRouteVideo: false,
        videoId: "video-1",
        headingSource: "videoTitle",
      },
      {
        t: "video",
        sectionKey: "single-video",
        useRouteVideo: false,
        videoId: "video-1",
        titleSource: "videoTitle",
      },
    ])

    expect(html).toContain("The Story")
    expect(html).toContain("Video Hero")
    expect(html).toContain("Video")
    expect(html).toContain("https://example.com/image.jpg")
  })

  it("renders every non-layout block family in the editor shell", () => {
    const html = renderEditor([
      {
        t: "videoHero",
        sectionKey: "hero",
        useRouteVideo: false,
        videoId: "video-1",
        headingSource: "videoTitle",
        subheadingSource: "videoDescription",
      },
      {
        t: "videoCarousel",
        sectionKey: "video-carousel",
        itemsSource: "manual",
        title: "Video carousel",
        description: "Featured videos",
        items: [{ videoId: "video-1" }],
      },
      {
        t: "text",
        sectionKey: "text",
        heading: "Text section",
        contentParagraphs: ["A paragraph for the experience."],
      },
      {
        t: "cta",
        sectionKey: "cta",
        heading: "Continue",
        body: "Move into the next step.",
        buttonLabel: "Go",
      },
      {
        t: "card",
        sectionKey: "card",
        title: "Card title",
        description: "Card detail",
      },
      {
        t: "promoBanner",
        sectionKey: "promo",
        heading: "Promo",
        description: "Promo detail",
      },
      {
        t: "easterDates",
        sectionKey: "easter",
        easterDatesTitle: "Easter Dates",
        westernEasterLabel: "Western Easter",
        orthodoxEasterLabel: "Orthodox Easter",
        passoverLabel: "Passover",
      },
      {
        t: "adventCountdown",
        sectionKey: "advent",
        title: "Advent Countdown",
        scripture: "Isaiah 9:6",
        scriptureReference: "Isaiah 9:6",
      },
    ])

    expect(html).toContain("Video Hero")
    expect(html).toContain("Add the hero headline")
    expect(html).toContain("Add a short hero summary")
    expect(html).toContain("Video Carousel")
    expect(html).toContain("Name this video collection")
    expect(html).not.toContain("Name this video row")
    expect(html).toContain("Carousel videos")
    expect(html).toContain("Text")
    expect(html).toContain("Call to Action")
    expect(html).toContain("Write the call to action")
    expect(html).not.toContain("Invite the next step")
    expect(html).toContain("Card")
    expect(html).toContain("Promo Banner")
    expect(html).toContain("Easter Dates")
    expect(html).toContain("Advent Countdown")
  })

  it("keeps video attachment and publish controls visible", () => {
    const html = renderEditor([
      {
        t: "video",
        sectionKey: "video",
        useRouteVideo: false,
        videoId: "video-1",
        titleSource: "videoTitle",
        subtitleSource: "videoDescription",
      },
    ])

    expect(html).toContain("The Story")
    expect(html).toContain("Add the video title")
    expect(html).toContain("Add a short video summary")
    expect(html).toContain("Video settings")
    expect(html).toContain("Save Draft")
    expect(html).toContain("Publish")
  })

  it("gates route video block templates behind template mode", () => {
    const standardHtml = renderEditor([])

    expect(standardHtml).not.toContain("Route Video Hero")
    expect(standardHtml).not.toContain("Route Video Carousel")

    const templateHtml = renderEditor([], { isTemplate: true })

    expect(templateHtml).toContain("Route Video Hero")
    expect(templateHtml).toContain("Route Video")
    expect(templateHtml).toContain("Route Video Carousel")
  })
})
