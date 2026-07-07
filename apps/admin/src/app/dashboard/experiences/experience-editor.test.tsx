// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MediaLibraryBrowserData } from "@/app/dashboard/media/media-library-browser-data"
import {
  ExperienceEditor,
  buildPublishedWatchUrl,
  cleanLocaleCode,
  cleanRoutePart,
  watchLanguageSlugForLocale,
} from "./experience-editor"

const { envState } = vi.hoisted(() => ({
  envState: {
    NEXT_PUBLIC_APP_NAME: "forge-admin",
    NEXT_PUBLIC_WATCH_URL: "http://localhost:3000" as string | undefined,
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

vi.mock("@/config/env", () => ({
  env: envState,
}))

const action = vi.fn(async () => ({ ok: true }))
const defaultMediaLibrary: MediaLibraryBrowserData = {
  rootLabel: "Library",
  folders: [],
  images: [
    {
      id: "asset-1",
      displayName: "Managed hero",
      altText: "Hero alt text",
      mimeType: "image/webp",
      byteSize: "12.0 KB",
      previewUrl: "/api/media-assets/asset-1/preview",
      updated: "2026-04-16T00:00:00.000Z",
      folderId: null,
      pathLabel: "Library",
    },
  ],
}

function renderEditorElement(
  blocks: unknown[],
  options: {
    isTemplate?: boolean
    saveAction?: typeof action
    publishAction?: typeof action
    canPublish?: boolean
    hasPublishedVersion?: boolean
    mediaLibrary?: MediaLibraryBrowserData
  } = {},
) {
  return (
    <ExperienceEditor
      canPublish={options.canPublish ?? true}
      hasPublishedVersion={options.hasPublishedVersion ?? false}
      calendarDate="2026-04-17"
      watchOrigin="https://watch.jesusfilm.org"
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
          hasGrounding: true,
        },
      ]}
      mediaLibrary={options.mediaLibrary ?? defaultMediaLibrary}
      canUploadImages
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
      saveAction={options.saveAction ?? action}
      publishAction={options.publishAction ?? action}
      createLocaleAction={action}
      restoreAction={action}
      uploadImageAction={action}
    />
  )
}

function renderEditor(
  blocks: unknown[],
  options: Parameters<typeof renderEditorElement>[1] = {},
) {
  return renderToStaticMarkup(renderEditorElement(blocks, options))
}

function renderEditorDom(
  blocks: unknown[],
  options: Parameters<typeof renderEditorElement>[1] = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  act(() => {
    root.render(renderEditorElement(blocks, options))
  })

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

function findButtonByText(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return button
}

function findButtonByAriaLabel(container: HTMLElement, label: string) {
  const button = container.querySelector(`button[aria-label="${label}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return button
}

function findButtonByExactText(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }
  return button
}

describe("ExperienceEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envState.NEXT_PUBLIC_WATCH_URL = "http://localhost:3000"
    document.body.innerHTML = ""
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    window.requestAnimationFrame ??= ((callback: FrameRequestCallback) =>
      window.setTimeout(
        () => callback(performance.now()),
        0,
      )) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame ??= ((handle: number) => {
      window.clearTimeout(handle)
    }) as typeof window.cancelAnimationFrame
    HTMLElement.prototype.scrollIntoView ??= vi.fn()
  })

  it("normalizes route editor values to slug-compatible path parts", () => {
    expect(cleanRoutePart("  Easter Story 2026  ", true)).toBe(
      "easter-story-2026",
    )
    expect(cleanRoutePart("Easter ")).toBe("easter-")
    expect(cleanRoutePart("sermon///notes")).toBe("sermonnotes")
    expect(cleanRoutePart("Palm_Sunday:Global!")).toBe("palmsundayglobal")
    expect(cleanRoutePart("alpha   beta---gamma")).toBe("alpha-beta-gamma")
  })

  it("normalizes locale codes for add-locale drafts", () => {
    expect(cleanLocaleCode("  ES 419  ", true)).toBe("es-419")
    expect(cleanLocaleCode("pt_BR")).toBe("pt-br")
    expect(cleanLocaleCode("fr///CA")).toBe("frca")
  })

  it("maps editor locales to public watch audio language slugs", () => {
    expect(watchLanguageSlugForLocale("en")).toBe("english")
    expect(watchLanguageSlugForLocale("es")).toBe("spanish-castilian")
    expect(watchLanguageSlugForLocale("zh-Hans")).toBe("chinese-simplified")
    // Regional variants fall back to the primary subtag mapping.
    expect(watchLanguageSlugForLocale("en-US")).toBe("english")
    expect(watchLanguageSlugForLocale("xx")).toBeNull()
    expect(watchLanguageSlugForLocale("")).toBeNull()
  })

  it("builds two-segment .html watch URLs for published previews", () => {
    // jsdom runs on localhost, so the local watch base wins over the origin.
    expect(
      buildPublishedWatchUrl("christmas", "en", "https://watch.jesusfilm.org"),
    ).toBe("http://localhost:3000/watch/christmas.html/english.html")
    expect(
      buildPublishedWatchUrl("christmas", "xx", "https://watch.jesusfilm.org"),
    ).toBeNull()
    expect(
      buildPublishedWatchUrl("", "en", "https://watch.jesusfilm.org"),
    ).toBeNull()
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

  it("points empty-canvas AI generation to chat instead of the legacy AI Draft panel", () => {
    const emptyHtml = renderEditor([])
    const filledHtml = renderEditor([{ t: "text", heading: "Filled" }])

    expect(emptyHtml).toContain("Use AI Chat to generate a first draft")
    expect(emptyHtml).not.toContain("AI Draft")
    expect(emptyHtml).not.toContain("Generate with AI")
    expect(filledHtml).not.toContain("Use AI Chat to generate a first draft")
  })

  it("scopes bottom editor chrome to the canvas instead of the shell sidebar", () => {
    const html = renderEditor([{ t: "text", heading: "Filled" }])

    expect(html).toContain("relative flex h-[calc(100vh-3rem)] overflow-hidden")
    expect(html).toContain(
      "pointer-events-none absolute bottom-0 left-0 right-0 z-[29]",
    )
    expect(html).toContain(
      "pointer-events-none absolute bottom-4 left-0 right-0 z-30",
    )
    expect(html).not.toContain("left-[240px]")
  })

  it("hides the empty canvas guidance entirely when parsedBlocks is non-empty", () => {
    const view = renderEditorDom([
      { t: "text", sectionKey: "intro", heading: "Existing content" },
    ])

    try {
      expect(view.container.textContent).not.toContain(
        "Use AI Chat to generate a first draft",
      )
      expect(view.container.textContent).not.toContain("AI Draft")
      expect(view.container.textContent).not.toContain("Empty Canvas")
    } finally {
      view.cleanup()
    }
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

  it("searches the full image library and writes selected image fields", () => {
    const view = renderEditorDom(
      [
        {
          t: "section",
          sectionKey: "story-section",
          backgroundColor: "#26313f",
          backgroundImageUrl: "",
          content: [],
        },
      ],
      {
        mediaLibrary: {
          rootLabel: "Library",
          folders: [
            {
              id: "folder-campaigns",
              label: "Campaigns",
              count: 0,
              directAssetCount: 0,
              childFolderCount: 1,
              parentId: null,
              depth: 0,
              pathLabel: "Library / Campaigns",
            },
            {
              id: "folder-easter",
              label: "Easter",
              count: 1,
              directAssetCount: 1,
              childFolderCount: 0,
              parentId: "folder-campaigns",
              depth: 1,
              pathLabel: "Library / Campaigns / Easter",
            },
          ],
          images: [
            {
              id: "asset-root",
              displayName: "Root hero",
              altText: "Root hero alt",
              mimeType: "image/webp",
              byteSize: "10.0 KB",
              previewUrl: "/api/media-assets/asset-root/preview",
              updated: "2026-04-16T00:00:00.000Z",
              folderId: null,
              pathLabel: "Library",
            },
            {
              id: "asset-easter",
              displayName: "Easter sunrise",
              altText: "Sunrise",
              mimeType: "image/webp",
              byteSize: "20.0 KB",
              previewUrl: "/api/media-assets/asset-easter/preview",
              updated: "2026-04-17T00:00:00.000Z",
              folderId: "folder-easter",
              pathLabel: "Library / Campaigns / Easter",
            },
          ],
        },
      },
    )

    try {
      act(() => {
        findButtonByAriaLabel(
          view.container,
          "Choose Section image from asset library",
        ).click()
      })

      expect(view.container.textContent).toContain("Library")
      expect(view.container.textContent).toContain("Campaigns")
      expect(view.container.textContent).toContain("Root hero")
      expect(view.container.textContent).not.toContain("Easter sunrise")

      const searchInput = view.container.querySelector(
        'input[placeholder="Search all image assets"]',
      )
      if (!(searchInput instanceof HTMLInputElement)) {
        throw new Error("Image search input not found")
      }

      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set

      act(() => {
        valueSetter?.call(searchInput, "easter")
        searchInput.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText" }),
        )
      })

      expect(view.container.textContent).toContain("Easter sunrise")
      expect(view.container.textContent).toContain(
        "Library / Campaigns / Easter",
      )

      const assetButton = findButtonByText(view.container, "Easter sunrise")
      act(() => {
        assetButton.click()
      })

      const blocksInput = view.container.querySelector('input[name="blocks"]')
      if (!(blocksInput instanceof HTMLInputElement)) {
        throw new Error("Blocks input not found")
      }
      const blocksBeforeSelect = JSON.parse(blocksInput.value) as Array<
        Record<string, unknown>
      >

      expect(blocksBeforeSelect[0]?.backgroundImageUrl).toBeUndefined()
      expect(view.container.textContent).toContain("Selected: Easter sunrise")

      const selectButton = findButtonByExactText(view.container, "Select")
      act(() => {
        selectButton.click()
      })

      const blocks = JSON.parse(blocksInput.value) as Array<
        Record<string, unknown>
      >

      expect(blocks[0]?.backgroundImageUrl).toBeUndefined()
      expect(blocks[0]?.backgroundImageAssetId).toBe("asset-easter")
    } finally {
      view.cleanup()
    }
  })

  it("opens the picker on the currently selected asset folder", () => {
    const view = renderEditorDom(
      [
        {
          t: "section",
          sectionKey: "hero",
          backgroundImageAssetId: "asset-easter",
          content: [],
        },
      ],
      {
        mediaLibrary: {
          rootLabel: "Library",
          folders: [
            {
              id: "folder-easter",
              label: "Easter",
              count: 1,
              directAssetCount: 1,
              childFolderCount: 0,
              parentId: null,
              depth: 0,
              pathLabel: "Library / Easter",
            },
          ],
          images: [
            {
              id: "asset-root",
              displayName: "Root hero",
              altText: "Root hero alt",
              mimeType: "image/webp",
              byteSize: "10.0 KB",
              previewUrl: "/api/media-assets/asset-root/preview",
              updated: "2026-04-16T00:00:00.000Z",
              folderId: null,
              pathLabel: "Library",
            },
            {
              id: "asset-easter",
              displayName: "Easter sunrise",
              altText: "Sunrise",
              mimeType: "image/webp",
              byteSize: "20.0 KB",
              previewUrl: "/api/media-assets/asset-easter/preview",
              updated: "2026-04-17T00:00:00.000Z",
              folderId: "folder-easter",
              pathLabel: "Library / Easter",
            },
          ],
        },
      },
    )

    try {
      act(() => {
        findButtonByAriaLabel(
          view.container,
          "Choose Section image from asset library",
        ).click()
      })

      expect(view.container.textContent).toContain("Easter sunrise")
      expect(view.container.textContent).toContain("Selected: Easter sunrise")
      expect(view.container.textContent).not.toContain("Root hero")
    } finally {
      view.cleanup()
    }
  })

  it("reopens the last browsed folder when no image is selected", () => {
    const view = renderEditorDom(
      [
        {
          t: "section",
          sectionKey: "hero",
          content: [],
        },
      ],
      {
        mediaLibrary: {
          rootLabel: "Library",
          folders: [
            {
              id: "folder-easter",
              label: "Easter",
              count: 1,
              directAssetCount: 1,
              childFolderCount: 0,
              parentId: null,
              depth: 0,
              pathLabel: "Library / Easter",
            },
          ],
          images: [
            {
              id: "asset-root",
              displayName: "Root hero",
              altText: "Root hero alt",
              mimeType: "image/webp",
              byteSize: "10.0 KB",
              previewUrl: "/api/media-assets/asset-root/preview",
              updated: "2026-04-16T00:00:00.000Z",
              folderId: null,
              pathLabel: "Library",
            },
            {
              id: "asset-easter",
              displayName: "Easter sunrise",
              altText: "Sunrise",
              mimeType: "image/webp",
              byteSize: "20.0 KB",
              previewUrl: "/api/media-assets/asset-easter/preview",
              updated: "2026-04-17T00:00:00.000Z",
              folderId: "folder-easter",
              pathLabel: "Library / Easter",
            },
          ],
        },
      },
    )

    try {
      act(() => {
        findButtonByAriaLabel(
          view.container,
          "Choose Section image from asset library",
        ).click()
      })

      expect(view.container.textContent).toContain("Root hero")
      expect(view.container.textContent).not.toContain("Easter sunrise")

      const folderNav = view.container.querySelector(
        'nav[aria-label="Image folders"]',
      )
      if (!(folderNav instanceof HTMLElement)) {
        throw new Error("Image folder navigation not found")
      }

      act(() => {
        findButtonByText(folderNav, "Easter").click()
      })

      expect(view.container.textContent).toContain("Easter sunrise")
      expect(view.container.textContent).not.toContain("Root hero")

      act(() => {
        findButtonByExactText(view.container, "Cancel").click()
      })

      act(() => {
        findButtonByAriaLabel(
          view.container,
          "Choose Section image from asset library",
        ).click()
      })

      expect(view.container.textContent).toContain("Easter sunrise")
      expect(view.container.textContent).not.toContain("Root hero")
    } finally {
      view.cleanup()
    }
  })

  it("clears the current image from inside the picker dialog", () => {
    const view = renderEditorDom(
      [
        {
          t: "section",
          sectionKey: "hero",
          backgroundImageAssetId: "asset-easter",
          content: [],
        },
      ],
      {
        mediaLibrary: {
          rootLabel: "Library",
          folders: [
            {
              id: "folder-easter",
              label: "Easter",
              count: 1,
              directAssetCount: 1,
              childFolderCount: 0,
              parentId: null,
              depth: 0,
              pathLabel: "Library / Easter",
            },
          ],
          images: [
            {
              id: "asset-easter",
              displayName: "Easter sunrise",
              altText: "Sunrise",
              mimeType: "image/webp",
              byteSize: "20.0 KB",
              previewUrl: "/api/media-assets/asset-easter/preview",
              updated: "2026-04-17T00:00:00.000Z",
              folderId: "folder-easter",
              pathLabel: "Library / Easter",
            },
          ],
        },
      },
    )

    try {
      act(() => {
        findButtonByAriaLabel(
          view.container,
          "Choose Section image from asset library",
        ).click()
      })

      expect(view.container.textContent).toContain("Remove image")

      act(() => {
        findButtonByExactText(view.container, "Remove image").click()
      })

      const blocksInput = view.container.querySelector('input[name="blocks"]')
      if (!(blocksInput instanceof HTMLInputElement)) {
        throw new Error("Blocks input not found")
      }

      const blocks = JSON.parse(blocksInput.value) as Array<
        Record<string, unknown>
      >

      expect(blocks[0]?.backgroundImageUrl).toBeUndefined()
      expect(blocks[0]?.backgroundImageAssetId).toBeUndefined()
      expect(view.container.textContent).not.toContain("Remove image")
    } finally {
      view.cleanup()
    }
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

  it("renders preview instead of publish when nothing changed on a published locale", () => {
    const html = renderEditor([], { hasPublishedVersion: true })
    expect(html).toContain("Preview")
    expect(html).not.toContain("Open Published Page")
  })

  it("renders preview on the server even when the watch URL is inferred in the browser", () => {
    envState.NEXT_PUBLIC_WATCH_URL = undefined

    const html = renderEditor([], { hasPublishedVersion: true })

    expect(html).toContain("Preview")
    expect(html).not.toContain("Publish")
  })

  it("opens the published page from preview when a published version exists", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    const { container, cleanup } = renderEditorDom([], {
      hasPublishedVersion: true,
    })

    try {
      const previewButton = findButtonByText(container, "Preview")
      expect(previewButton.disabled).toBe(false)

      await act(async () => {
        previewButton.click()
      })

      expect(openSpy).toHaveBeenCalledWith(
        "http://localhost:3000/watch/experience-title.html/english.html",
        "_blank",
        "noopener,noreferrer",
      )
    } finally {
      cleanup()
      openSpy.mockRestore()
    }
  })

  it("allows publishing changed content over an existing published version", () => {
    const { container, cleanup } = renderEditorDom([], {
      hasPublishedVersion: true,
    })

    try {
      expect(findButtonByText(container, "Preview").disabled).toBe(false)

      const titleInput = container.querySelector(
        'input[placeholder="Untitled Experience"]',
      )
      if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("Title input not found")
      }

      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set

      act(() => {
        valueSetter?.call(titleInput, "Experience title updated")
        titleInput.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText" }),
        )
      })

      const publishButton = findButtonByText(container, "Publish")
      expect(publishButton.disabled).toBe(false)
    } finally {
      cleanup()
    }
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
