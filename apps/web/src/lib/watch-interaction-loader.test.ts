/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import type { LanguagePickerVariant } from "@/components/watch/LanguagePickerModal"

import {
  __resetWatchInteractionLoaderForTests,
  __setWatchInteractionLoadersForTests,
  __setWatchLanguageOptionsLoaderForTests,
  getCachedWatchLanguageOptions,
  loadWatchInteraction,
  loadWatchLanguageOptionsForVideo,
  warmWatchInteractionsNow,
} from "./watch-interaction-loader"

afterEach(() => {
  __resetWatchInteractionLoaderForTests()
  vi.restoreAllMocks()
})

const englishVariant: LanguagePickerVariant = {
  documentId: "english-dub",
  hls: "https://example.com/english.m3u8",
  published: true,
  language: {
    slug: "english",
    name: "English",
    nativeName: "English",
  },
}

describe("watch interaction loader", () => {
  it("dedupes concurrent requests for the same interaction", async () => {
    const loadLanguage = vi.fn(async () => ({ default: "language" }))
    __setWatchInteractionLoadersForTests({ language: loadLanguage })

    const first = loadWatchInteraction("language")
    const second = loadWatchInteraction("language")

    expect(first).toBe(second)
    await Promise.all([first, second])
    expect(loadLanguage).toHaveBeenCalledTimes(1)
  })

  it("reuses an intent-started load when the idle warmup reaches that interaction", async () => {
    const order: string[] = []
    __setWatchInteractionLoadersForTests({
      language: vi.fn(async () => {
        order.push("language")
      }),
      search: vi.fn(async () => {
        order.push("search")
      }),
      share: vi.fn(async () => {
        order.push("share")
      }),
      download: vi.fn(async () => {
        order.push("download")
      }),
    })

    await loadWatchInteraction("search")
    await warmWatchInteractionsNow()

    expect(order).toEqual(["search", "language", "share", "download"])
  })

  it("warms interactions in product priority order", async () => {
    const order: string[] = []
    __setWatchInteractionLoadersForTests({
      language: vi.fn(async () => {
        order.push("language")
      }),
      search: vi.fn(async () => {
        order.push("search")
      }),
      share: vi.fn(async () => {
        order.push("share")
      }),
      download: vi.fn(async () => {
        order.push("download")
      }),
    })

    await warmWatchInteractionsNow()

    expect(order).toEqual(["language", "search", "share", "download"])
  })

  it("caches language options per video slug", async () => {
    const loadLanguageOptions = vi.fn(async () => [englishVariant])
    __setWatchLanguageOptionsLoaderForTests(loadLanguageOptions)

    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])
    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])

    expect(loadLanguageOptions).toHaveBeenCalledTimes(1)
    expect(getCachedWatchLanguageOptions("jesus")).toEqual([englishVariant])
  })
})
