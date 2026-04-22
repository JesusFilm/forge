import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ExperienceEditor, cleanRoutePart } from "./experience-editor"

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
  it("normalizes route editor values to slug-compatible path parts", () => {
    expect(cleanRoutePart("  Easter Story 2026  ", true)).toBe(
      "easter-story-2026",
    )
    expect(cleanRoutePart("Easter ")).toBe("easter-")
    expect(cleanRoutePart("sermon///notes")).toBe("sermonnotes")
    expect(cleanRoutePart("Palm_Sunday:Global!")).toBe("palmsundayglobal")
    expect(cleanRoutePart("alpha   beta---gamma")).toBe("alpha-beta-gamma")
  })

  it("renders container layout as a visual responsive grid editor", () => {
    const html = renderEditor([
      {
        t: "container",
        sectionKey: "responsive-grid",
        content: [
          {
            t: "containerSlot",
            gridSpan: 6,
            spans: { xs: 12, sm: 12, md: 6, lg: 5, xl: 4 },
          },
          { t: "text", heading: "Slot copy" },
        ],
      },
    ])

    expect(html).toContain("Container")
    expect(html).toContain("Edit Container")
    expect(html).not.toContain("Edit workspace")
    expect(html).not.toContain("Edit container workspace")
    expect(html).not.toContain("Slot list")
    expect(html).not.toContain("Screen MD")
    expect(html).not.toContain("Slot 1")
    expect(html).not.toContain("Add slot divider")
    expect(html).not.toContain("Divider block")
    expect(html).not.toContain("MD 6/12")
    expect(html).not.toContain("Decrease slot span")
    expect(html).not.toContain("Increase slot span")
    expect(html).not.toContain("Move slot content up")
    expect(html).not.toContain("Remove slot content")
    expect(html).not.toContain("Move nested block up")
    expect(html).not.toContain("Remove nested block")
    expect(html).not.toContain("Heading Level")
    expect(html).not.toContain("Section Key")
    expect(html).not.toContain("Resize slot from right")
    expect(html).not.toContain(
      "Container slot composition is edited in the JSON field below.",
    )
  })

  it("renders a compact empty preview when a container has no slots", () => {
    const html = renderEditor([
      {
        t: "container",
        sectionKey: "empty-grid",
        content: [],
      },
    ])

    expect(html).toContain("Edit Container")
    expect(html).not.toContain("No blocks inside yet")
    expect(html).not.toContain("Edit container workspace")
    expect(html).not.toContain("Choose a slot layout")
    expect(html).not.toContain(
      "Create dividers with responsive spans already set.",
    )
  })

  it("renders section content as a compact editable block preview", () => {
    const html = renderEditor([
      {
        t: "section",
        sectionKey: "story-section",
        backgroundColor: "#26313f",
        backgroundImageUrl: "https://example.com/section.jpg",
        content: [
          {
            t: "text",
            heading: "Section copy",
            contentParagraphs: ["A paragraph inside the section."],
          },
          {
            t: "card",
            title: "Featured card",
            mediaUrl: "https://example.com/section-card.jpg",
          },
        ],
      },
    ])

    expect(html).toContain("Edit Section")
    expect(html).toContain("Choose Section background color")
    expect(html).toContain("Choose Section image from asset library")
    expect(html).toContain("https://example.com/section.jpg")
    expect(html).toContain("Section copy")
    expect(html).toContain("https://example.com/section-card.jpg")
    expect(html).not.toContain("Background Color")
    expect(html).not.toContain("Blur Hash")
    expect(html).not.toContain("Background Opacity")
    expect(html).not.toContain("Dynamic Background Image")
    expect(html).not.toContain("Static Overlay")
    expect(html).not.toContain("Back to page")
    expect(html).not.toContain("Empty Section")
    expect(html).not.toContain("Move nested block up")
    expect(html).not.toContain("Remove nested block")
  })

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

    expect(html).toContain("Build this section from related questions")
    expect(html).toContain(
      "Add questions and answers to help visitors understand the next step before they act.",
    )
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
