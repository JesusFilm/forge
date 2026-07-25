/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import type { LanguagePickerVariant } from "@/components/watch/LanguagePickerModal"
import type { GlobalLanguageOption } from "@/lib/watch-language-switcher"

import {
  __resetWatchInteractionLoaderForTests,
  __setGlobalWatchLanguageOptionsLoaderForTests,
  __setWatchInteractionLoadersForTests,
  __setWatchLanguageOptionsLoaderForTests,
  getCachedWatchLanguageOptions,
  loadGlobalWatchLanguageOptions,
  loadWatchInteraction,
  loadWatchLanguageOptionsForVideo,
  scheduleWatchInteractionWarmup,
  shouldRefreshCachedWatchLanguageOptions,
  warmWatchInteractionsNow,
} from "./watch-interaction-loader"

afterEach(() => {
  __resetWatchInteractionLoaderForTests()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

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

const globalLanguageOptions: GlobalLanguageOption[] = [
  { slug: "english", englishName: "English", nativeName: null },
  { slug: "french", englishName: "French", nativeName: "Français" },
]

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

  it("dedupes the lazy global-language module and retries a rejected module load", async () => {
    const loadGlobalLanguage = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ GlobalLanguagePickerModal: vi.fn() })
    __setWatchInteractionLoadersForTests({
      "global-language": loadGlobalLanguage,
    })

    const first = loadWatchInteraction("global-language")
    expect(loadWatchInteraction("global-language")).toBe(first)
    await expect(first).rejects.toThrow("chunk unavailable")

    await expect(loadWatchInteraction("global-language")).resolves.toEqual({
      GlobalLanguagePickerModal: expect.any(Function),
    })
    expect(loadGlobalLanguage).toHaveBeenCalledTimes(2)
  })

  it("dedupes and caches the compact global language option request", async () => {
    const request = deferred<GlobalLanguageOption[]>()
    const loadGlobalOptions = vi.fn(() => request.promise)
    __setGlobalWatchLanguageOptionsLoaderForTests(loadGlobalOptions)

    const first = loadGlobalWatchLanguageOptions()
    const second = loadGlobalWatchLanguageOptions()
    expect(second).toBe(first)

    request.resolve(globalLanguageOptions)
    await expect(first).resolves.toEqual(globalLanguageOptions)
    await expect(loadGlobalWatchLanguageOptions()).resolves.toEqual(
      globalLanguageOptions,
    )
    expect(loadGlobalOptions).toHaveBeenCalledTimes(1)
  })

  it("does not poison the global option cache when loading fails", async () => {
    const loadGlobalOptions = vi
      .fn<() => Promise<GlobalLanguageOption[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(globalLanguageOptions)
    __setGlobalWatchLanguageOptionsLoaderForTests(loadGlobalOptions)

    await expect(loadGlobalWatchLanguageOptions()).rejects.toThrow("offline")
    await expect(loadGlobalWatchLanguageOptions()).resolves.toEqual(
      globalLanguageOptions,
    )
    expect(loadGlobalOptions).toHaveBeenCalledTimes(2)
  })

  it("loads the default global catalog through the Watch GET API", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ options: globalLanguageOptions }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(loadGlobalWatchLanguageOptions()).resolves.toEqual(
      globalLanguageOptions,
    )
    expect(fetchMock).toHaveBeenCalledWith("/watch/api/language-options", {
      cache: "no-store",
      headers: { accept: "application/json" },
      method: "GET",
    })
  })

  it("rejects malformed default global catalog responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ options: [{ slug: "english" }] })),
    )

    await expect(loadGlobalWatchLanguageOptions()).rejects.toThrow(
      "Invalid global language options response",
    )
  })

  it("retries the default global catalog after an HTTP failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: "Language options are temporarily unavailable." },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ options: globalLanguageOptions }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(loadGlobalWatchLanguageOptions()).rejects.toThrow(
      "Global language options request failed",
    )
    await expect(loadGlobalWatchLanguageOptions()).resolves.toEqual(
      globalLanguageOptions,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not request the global picker or its options before post-load idle warmup", async () => {
    const idleCallbacks: IdleRequestCallback[] = []
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    })
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal("requestIdleCallback", requestIdleCallback)
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback)
    vi.spyOn(document, "readyState", "get").mockReturnValue("complete")
    const loadGlobalModule = vi.fn(async () => ({}))
    const loadGlobalOptions = vi.fn(async () => globalLanguageOptions)
    __setWatchInteractionLoadersForTests({
      "global-language": loadGlobalModule,
      language: vi.fn(async () => ({})),
      search: vi.fn(async () => ({})),
      share: vi.fn(async () => ({})),
      download: vi.fn(async () => ({})),
    })
    __setGlobalWatchLanguageOptionsLoaderForTests(loadGlobalOptions)

    const cleanup = scheduleWatchInteractionWarmup({ globalLanguage: true })

    expect(loadGlobalModule).not.toHaveBeenCalled()
    expect(loadGlobalOptions).not.toHaveBeenCalled()
    expect(requestIdleCallback).toHaveBeenCalledTimes(1)

    idleCallbacks[0]?.({
      didTimeout: false,
      timeRemaining: () => 50,
    })

    await vi.waitFor(() => {
      expect(loadGlobalModule).toHaveBeenCalledTimes(1)
      expect(loadGlobalOptions).toHaveBeenCalledTimes(1)
    })

    cleanup()
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
