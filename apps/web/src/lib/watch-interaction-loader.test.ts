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
  shouldRefreshCachedWatchLanguageOptions,
  warmWatchInteractionsNow,
} from "./watch-interaction-loader"

afterEach(() => {
  __resetWatchInteractionLoaderForTests()
  window.sessionStorage.clear()
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

  it("hydrates language options from browser storage", () => {
    seedStoredLanguageOptions("jesus", [englishVariant])

    expect(getCachedWatchLanguageOptions("jesus")).toEqual([englishVariant])
    expect(shouldRefreshCachedWatchLanguageOptions("jesus")).toBe(true)
  })

  it("persists successful language option loads to browser storage", async () => {
    const loadLanguageOptions = vi.fn(async () => [englishVariant])
    __setWatchLanguageOptionsLoaderForTests(loadLanguageOptions)

    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])

    const raw = getOnlyStoredLanguageOptionsPayload()
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw ?? "{}")).toEqual({
      version: 1,
      variants: [englishVariant],
    })
  })

  it("ignores invalid browser storage and replaces it after a successful load", async () => {
    seedRawStoredLanguageOptions("jesus", "{not-json")
    const loadLanguageOptions = vi.fn(async () => [englishVariant])
    __setWatchLanguageOptionsLoaderForTests(loadLanguageOptions)

    expect(getCachedWatchLanguageOptions("jesus")).toBeNull()
    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])

    expect(loadLanguageOptions).toHaveBeenCalledTimes(1)
    expect(JSON.parse(getOnlyStoredLanguageOptionsPayload() ?? "{}")).toEqual({
      version: 1,
      variants: [englishVariant],
    })
  })

  it("ignores schema-incompatible browser storage", async () => {
    seedRawStoredLanguageOptions(
      "jesus",
      JSON.stringify({ version: 0, variants: [englishVariant] }),
    )
    const loadLanguageOptions = vi.fn(async () => [englishVariant])
    __setWatchLanguageOptionsLoaderForTests(loadLanguageOptions)

    expect(getCachedWatchLanguageOptions("jesus")).toBeNull()
    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])

    expect(loadLanguageOptions).toHaveBeenCalledTimes(1)
  })

  it("ignores storage variants missing playable fields", async () => {
    seedRawStoredLanguageOptions(
      "jesus",
      JSON.stringify({
        version: 1,
        variants: [
          {
            documentId: "partial-dub",
            language: { slug: "english", name: "English" },
          },
        ],
      }),
    )
    const loadLanguageOptions = vi.fn(async () => [englishVariant])
    __setWatchLanguageOptionsLoaderForTests(loadLanguageOptions)

    expect(getCachedWatchLanguageOptions("jesus")).toBeNull()
    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])

    expect(loadLanguageOptions).toHaveBeenCalledTimes(1)
  })

  it("falls back to the loader when browser storage reads throw", async () => {
    const loadLanguageOptions = vi.fn(async () => [englishVariant])
    __setWatchLanguageOptionsLoaderForTests(loadLanguageOptions)
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied")
    })

    expect(getCachedWatchLanguageOptions("jesus")).toBeNull()
    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])

    expect(loadLanguageOptions).toHaveBeenCalledTimes(1)
  })

  it("still resolves when browser storage writes fail", async () => {
    const loadLanguageOptions = vi.fn(async () => [englishVariant])
    __setWatchLanguageOptionsLoaderForTests(loadLanguageOptions)
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded")
    })

    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])

    expect(getCachedWatchLanguageOptions("jesus")).toEqual([englishVariant])
  })

  it("does not repeatedly force refresh after a storage-backed refresh fails", async () => {
    seedStoredLanguageOptions("jesus", [englishVariant])
    const loadLanguageOptions = vi.fn(async () => {
      throw new Error("offline")
    })
    __setWatchLanguageOptionsLoaderForTests(loadLanguageOptions)

    expect(getCachedWatchLanguageOptions("jesus")).toEqual([englishVariant])
    expect(shouldRefreshCachedWatchLanguageOptions("jesus")).toBe(true)
    await expect(
      loadWatchLanguageOptionsForVideo("jesus", { forceRefresh: true }),
    ).rejects.toThrow("offline")

    expect(shouldRefreshCachedWatchLanguageOptions("jesus")).toBe(false)
    await expect(loadWatchLanguageOptionsForVideo("jesus")).resolves.toEqual([
      englishVariant,
    ])
    expect(loadLanguageOptions).toHaveBeenCalledTimes(1)
  })
})

function seedStoredLanguageOptions(
  videoSlug: string,
  variants: LanguagePickerVariant[],
) {
  seedRawStoredLanguageOptions(
    videoSlug,
    JSON.stringify({ version: 1, variants }),
  )
}

function seedRawStoredLanguageOptions(videoSlug: string, raw: string) {
  window.sessionStorage.setItem(
    `forge.watch.languageOptions.v1:${encodeURIComponent(videoSlug)}`,
    raw,
  )
}

function getOnlyStoredLanguageOptionsPayload(): string | null {
  const storageKeys = Array.from(
    { length: window.sessionStorage.length },
    (_, index) => window.sessionStorage.key(index),
  ).filter(
    (key): key is string =>
      key != null && key.startsWith("forge.watch.languageOptions.v1:"),
  )
  expect(storageKeys).toHaveLength(1)
  return window.sessionStorage.getItem(storageKeys[0] ?? "")
}
