import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WatchHomeSection } from "@/lib/watch-home"

const { resolveWatchHomeMock } = vi.hoisted(() => ({
  resolveWatchHomeMock: vi.fn(),
}))

vi.mock("@/lib/watch-home", () => ({
  resolveWatchHome: resolveWatchHomeMock,
}))

import { resolveLanguageHomeSections } from "@/lib/watch-language-home-sections"

const fallbackSections = [
  {
    id: "home-video-gospels",
    eyebrow: "Video Bible Collection",
    title: "Discover the full story",
    description: null,
    layout: "rail",
    orientation: "horizontal",
    showSequenceNumbers: false,
    cards: [
      {
        id: "video-1",
        sourceId: "1_jf-0-0",
        coreId: "1_jf-0-0",
        shareVideoSlug: "jesus",
        shareLanguageSlug: "english",
        title: "Jesus",
        description: null,
        label: "Feature film",
        metaLabel: null,
        href: "/jesus.html/english.html",
        imageUrl: null,
        blurDataUrl: null,
        dominantColor: null,
        imageAlt: "Jesus still",
        hls: null,
        playbackId: null,
        subtitleVttSrc: null,
        subtitleLanguageBcp47: null,
        durationSeconds: null,
        childCount: 0,
        parentCoreId: null,
        parentSlug: null,
        missingData: [],
      },
    ],
  },
] satisfies WatchHomeSection[]

beforeEach(() => {
  resolveWatchHomeMock.mockReset()
})

describe("resolveLanguageHomeSections", () => {
  it("keeps fallback card share identity aligned with the requested language", async () => {
    resolveWatchHomeMock
      .mockResolvedValueOnce({ data: { sections: [] }, error: null })
      .mockResolvedValueOnce({
        data: { sections: fallbackSections },
        error: null,
      })

    const sections = await resolveLanguageHomeSections("ru", "russian")
    const card = sections[0]?.cards[0]

    expect(card?.href).toBe("/jesus.html/russian.html")
    expect(card?.shareLanguageSlug).toBe("russian")
  })
})
