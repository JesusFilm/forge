import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getExperiencePreviewMock,
  loadClientMessagesMock,
  notFoundMock,
  resolveWatchHomePreviewMock,
  sectionRendererMock,
  setRequestLocaleMock,
  watchHomeExperiencePageMock,
} = vi.hoisted(() => ({
  getExperiencePreviewMock: vi.fn(),
  loadClientMessagesMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  resolveWatchHomePreviewMock: vi.fn(),
  sectionRendererMock: vi.fn(() => null),
  setRequestLocaleMock: vi.fn(),
  watchHomeExperiencePageMock: vi.fn(() => null),
}))

vi.mock("next/navigation", () => ({ notFound: notFoundMock }))
vi.mock("next-intl/server", () => ({
  setRequestLocale: setRequestLocaleMock,
}))
vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/lib/experience-preview", () => ({
  getExperiencePreview: getExperiencePreviewMock,
}))
vi.mock("@/i18n/client-messages", () => ({
  WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES: ["WatchHome"],
  loadClientMessages: loadClientMessagesMock,
}))
vi.mock("@/lib/watch-home", () => ({
  resolveWatchHomePreview: resolveWatchHomePreviewMock,
}))
vi.mock("@/components/home/WatchHomeExperiencePage", () => ({
  WatchHomeExperiencePage: watchHomeExperiencePageMock,
}))
vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: sectionRendererMock,
}))

import ExperiencePreviewPage, {
  dynamic,
  fetchCache,
  metadata,
  revalidate,
} from "@/app/(preview)/preview/experience/[token]/page"

// The media collection carries the enriched-item fields the renderer reads.
// `resolvedTitle` is the one this suite exists to protect: it arrives from
// Admin under a response alias, and nothing between the fetch and the renderer
// is allowed to drop or reshape it.
const mediaCollectionBlock = {
  __typename: "MediaCollectionBlock",
  sectionKey: "collection",
  items: [
    { videoId: "video-1", resolvedTitle: "Иисус", labelOverride: "COLLECTION" },
    { videoId: "video-2", resolvedTitle: null, labelOverride: "COLLECTION" },
  ],
}

const draft = {
  experienceId: "experience-1",
  localeId: "locale-1",
  locale: "ru",
  slug: "home",
  title: "Главная",
  isHomepage: false,
  blocks: [
    { __typename: "TextBlock", sectionKey: "intro" },
    mediaCollectionBlock,
  ],
}

beforeEach(() => {
  getExperiencePreviewMock.mockReset()
  loadClientMessagesMock.mockReset()
  resolveWatchHomePreviewMock.mockReset()
  sectionRendererMock.mockClear()
  setRequestLocaleMock.mockClear()
  watchHomeExperiencePageMock.mockClear()
  notFoundMock.mockClear()
  loadClientMessagesMock.mockResolvedValue({ WatchHome: {} })
})

describe("Experience draft preview page", () => {
  it("is dynamic, uncached, and has no discovery metadata", () => {
    expect(dynamic).toBe("force-dynamic")
    expect(revalidate).toBe(0)
    expect(fetchCache).toBe("force-no-store")
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
    expect(metadata.alternates).toBeUndefined()
    expect(metadata.openGraph).toBeUndefined()
  })

  it("renders staged blocks with persistent draft context", async () => {
    getExperiencePreviewMock.mockResolvedValue(draft)

    const page = await ExperiencePreviewPage({
      params: Promise.resolve({ token: "capability-token" }),
    })
    const wrapper = page.props.children
    const [bannerElement, content] = wrapper.props.children
    const banner = bannerElement.type(bannerElement.props)

    expect(getExperiencePreviewMock).toHaveBeenCalledWith("capability-token")
    expect(setRequestLocaleMock).toHaveBeenCalledWith("ru")
    expect(wrapper.props.lang).toBe("ru")
    expect(wrapper.props.dir).toBe("ltr")
    expect(banner.props.role).toBe("status")
    expect(JSON.stringify(banner.props.children)).toContain("Not live")
    expect(content.props.blocks).toEqual(draft.blocks)
    expect(content.props.languageSlug).toBe("russian")
    expect(resolveWatchHomePreviewMock).not.toHaveBeenCalled()
  })

  it("builds Homepage composition from staged blocks without canonical cache", async () => {
    getExperiencePreviewMock.mockResolvedValue({ ...draft, isHomepage: true })
    const heroModel = {
      heroSlides: [],
      sections: [],
      carousel: { pools: [] },
      missingData: [],
    }
    resolveWatchHomePreviewMock.mockResolvedValue({
      data: heroModel,
      error: null,
    })

    const page = await ExperiencePreviewPage({
      params: Promise.resolve({ token: "homepage-token" }),
    })
    const home = page.props.children.props.children[1]

    expect(resolveWatchHomePreviewMock).toHaveBeenCalledWith(
      "ru",
      "russian",
      draft.blocks,
    )
    expect(home.type).toBe(watchHomeExperiencePageMock)
    expect(home.props).toEqual({
      heroModel,
      blocks: draft.blocks,
      languageSlug: "russian",
      dynamicCollectionCacheScope: "preview",
    })
  })

  it("forwards resolved card titles to the section renderer", async () => {
    getExperiencePreviewMock.mockResolvedValue(draft)

    const page = await ExperiencePreviewPage({
      params: Promise.resolve({ token: "capability-token" }),
    })
    const [, content] = page.props.children.props.children

    const forwarded = content.props.blocks.find(
      (block: { __typename: string }) =>
        block.__typename === "MediaCollectionBlock",
    )

    expect(forwarded.items).toEqual(mediaCollectionBlock.items)
    expect(forwarded.items[0].resolvedTitle).toBe("Иисус")
  })

  it("forwards resolved card titles through the Homepage composition", async () => {
    getExperiencePreviewMock.mockResolvedValue({ ...draft, isHomepage: true })
    resolveWatchHomePreviewMock.mockResolvedValue({
      data: {
        heroSlides: [],
        sections: [],
        carousel: { pools: [] },
        missingData: [],
      },
      error: null,
    })

    const page = await ExperiencePreviewPage({
      params: Promise.resolve({ token: "homepage-token" }),
    })
    const home = page.props.children.props.children[1]

    const forwarded = home.props.blocks.find(
      (block: { __typename: string }) =>
        block.__typename === "MediaCollectionBlock",
    )

    expect(forwarded.items[0].resolvedTitle).toBe("Иисус")
    // watch-home-visible-content.ts enriches items off these same staged
    // blocks, so the homepage path must receive them unchanged too.
    expect(resolveWatchHomePreviewMock).toHaveBeenCalledWith(
      "ru",
      "russian",
      draft.blocks,
    )
  })

  it("forwards an absent title as null rather than dropping the item", async () => {
    getExperiencePreviewMock.mockResolvedValue(draft)

    const page = await ExperiencePreviewPage({
      params: Promise.resolve({ token: "capability-token" }),
    })
    const [, content] = page.props.children.props.children

    const forwarded = content.props.blocks.find(
      (block: { __typename: string }) =>
        block.__typename === "MediaCollectionBlock",
    )

    expect(forwarded.items).toHaveLength(2)
    expect(forwarded.items[1].resolvedTitle).toBeNull()
  })

  it("preserves block and item order on the way to the renderer", async () => {
    getExperiencePreviewMock.mockResolvedValue(draft)

    const page = await ExperiencePreviewPage({
      params: Promise.resolve({ token: "capability-token" }),
    })
    const [, content] = page.props.children.props.children

    expect(
      content.props.blocks.map(
        (block: { __typename: string }) => block.__typename,
      ),
    ).toEqual(["TextBlock", "MediaCollectionBlock"])
    expect(
      content.props.blocks[1].items.map(
        (item: { videoId: string }) => item.videoId,
      ),
    ).toEqual(["video-1", "video-2"])
  })

  it("returns not found for an invalidated capability", async () => {
    getExperiencePreviewMock.mockResolvedValue(null)

    await expect(
      ExperiencePreviewPage({
        params: Promise.resolve({ token: "retired-token" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })
})
