const mockStore = new Map<string, string>()
const mockWrite = jest.fn(async (_json: string) => true)
const mockClear = jest.fn(async () => {})
const mockFetch = jest.fn()
const mockQuery = jest.fn()
const mockStoreSet = jest.fn()
let mockGeneration = 0
jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: true },
  AppState: { currentState: "active" },
}))
jest.mock("../safeStorage", () => ({
  getStorage: () => ({
    getItem: async (key: string) => mockStore.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      await mockStoreSet(key, value)
    },
    removeItem: async (key: string) => {
      mockStore.delete(key)
    },
  }),
}))
jest.mock("../../../modules/top-shelf", () => ({
  topShelf: {
    writeSnapshot: (json: string) => mockWrite(json),
    clearSnapshot: () => mockClear(),
  },
}))
jest.mock("../apolloClient", () => ({
  getApolloClient: () => ({ query: mockQuery }),
}))
jest.mock("../recommendations/client", () => ({
  fetchForYou: (...args: unknown[]) => mockFetch(...args),
  recommendationsEnabled: () => true,
  getRecommendationGeneration: () => mockGeneration,
}))
import {
  syncTopShelf,
  clearPersonalTopShelf,
  invalidateTopShelfLanguage,
} from "./sync"
import type { WatchHomeModel } from "../watchHome/model"
import type { ContinueWatchingEntry } from "../watchEvents/continueWatching"
import { localDay } from "./model"

const model: WatchHomeModel = { featured: [], sections: [], missingData: [] }
const delivery = {
  result: "available",
  items: [
    {
      position: 0,
      targetMediaId: "recommended",
      videoSlug: "recommended-video",
      videoTitle: "Recommended video",
      description: "For you",
      imageUrl: "https://image.mux.com/a/thumbnail.jpg",
      durationSeconds: 120,
      episodeCapability: "must-not-export",
    },
  ],
}
beforeEach(() => {
  mockStore.clear()
  jest.resetAllMocks()
  mockWrite.mockResolvedValue(true)
  mockStoreSet.mockImplementation(async (key: string, value: string) => {
    mockStore.set(key, value)
  })
  mockGeneration = 0
  mockFetch.mockResolvedValue(delivery)
  delete process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED
})

const resumeEntry = (slug = "real-film"): ContinueWatchingEntry => ({
  videoId: slug,
  slug,
  title: "Saved title",
  imageUrl: "https://image.mux.com/original/thumbnail.jpg",
  positionSeconds: 159,
  durationSeconds: 3600,
  progress: 159 / 3600,
  updatedAt: "2026-10-19T09:00:00.000Z",
})
const videoResponse = (title = "Current title", slug = "real-film") => ({
  data: {
    videoBySlug: {
      id: slug,
      slug,
      durationSeconds: 3600,
      locales: [{ title, snippet: "Current description" }],
      images: [
        { mobileCinematicHigh: "https://image.mux.com/current/thumbnail.jpg" },
      ],
      preferredPlayableDub: {
        published: true,
        hls: "https://stream.mux.com/current.m3u8",
        language: { slug: "english" },
      },
    },
  },
})

it("revalidates same-day persisted metadata without deleting genuine history", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  const history = JSON.stringify([resumeEntry()])
  mockStore.set("forge.watch.continue_watching", history)
  mockStore.set(
    "watch.top-shelf.catalog.v1",
    JSON.stringify({
      day: localDay(new Date()),
      language: "english",
      slugs: "real-film",
      videos: [
        {
          id: "real-film",
          slug: "real-film",
          title: "Old same-day title",
          summary: "Old",
          imageURL: "https://image.mux.com/old/thumbnail.jpg",
          duration: 3600,
          kind: "video",
        },
      ],
      journeys: [],
    }),
  )
  mockQuery.mockResolvedValue(videoResponse())
  await syncTopShelf(model, [resumeEntry()], "english", "continue")
  expect(mockQuery).toHaveBeenCalledTimes(1)
  expect(mockQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      fetchPolicy: "network-only",
      context: expect.objectContaining({ queryDeduplication: false }),
    }),
  )
  expect(JSON.parse(mockWrite.mock.calls[0][0])).toMatchObject({
    concept: "continue",
    items: [
      { title: "Current title", slug: "real-film", progress: 159 / 3600 },
    ],
  })
  expect(mockStore.get("forge.watch.continue_watching")).toBe(history)
})

it("updates resume copy again in the same process without a cache reset", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  mockQuery.mockResolvedValueOnce(videoResponse("First title"))
  await syncTopShelf(model, [resumeEntry()], "english", "continue")
  mockQuery.mockResolvedValueOnce(videoResponse("Changed title"))
  await syncTopShelf(model, [resumeEntry()], "english", "continue")
  expect(mockQuery).toHaveBeenCalledTimes(2)
  expect(JSON.parse(mockWrite.mock.calls[1][0]).items[0].title).toBe(
    "Changed title",
  )
  expect(mockStore.has("watch.top-shelf.catalog.v1")).toBe(false)
})

it("keeps the exact unexpired snapshot when metadata transport fails, then recovers", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  mockQuery.mockResolvedValueOnce(videoResponse())
  await syncTopShelf(model, [resumeEntry()], "english", "continue")
  const before = mockStore.get("watch.top-shelf.snapshot.v1")
  mockWrite.mockClear()
  mockQuery.mockRejectedValueOnce(new Error("offline"))
  const status = jest.fn()
  await syncTopShelf(model, [resumeEntry()], "english", "continue", status)
  expect(mockWrite).not.toHaveBeenCalled()
  expect(mockStore.get("watch.top-shelf.snapshot.v1")).toBe(before)
  expect(status).toHaveBeenLastCalledWith(
    "Could not update Top Shelf (video information). Try again.",
  )
  mockQuery.mockResolvedValueOnce(videoResponse("Recovered title"))
  await syncTopShelf(model, [resumeEntry()], "english", "continue")
  expect(JSON.parse(mockWrite.mock.calls[0][0]).items[0].title).toBe(
    "Recovered title",
  )
})

it.each(["removed", "unpublished", "wrong-language"])(
  "drops newly %s resume content without changing local viewing history",
  async (reason) => {
    process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
    mockQuery.mockResolvedValueOnce(videoResponse())
    await syncTopShelf(model, [resumeEntry()], "english", "continue")
    const response = videoResponse()
    if (reason === "unpublished")
      response.data.videoBySlug.preferredPlayableDub.published = false
    if (reason === "wrong-language")
      response.data.videoBySlug.preferredPlayableDub.language.slug = "thai"
    mockQuery.mockResolvedValueOnce(
      reason === "removed" ? { data: { videoBySlug: null } } : response,
    )
    await syncTopShelf(model, [resumeEntry()], "english", "continue")
    expect(
      JSON.parse(mockWrite.mock.calls[1][0]).items.map(
        (item: { slug: string }) => item.slug,
      ),
    ).not.toContain("real-film")
  },
)

it("prunes confirmed removal even when another metadata request fails, without extending stale expiry", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  const resume = [resumeEntry("removed-film"), resumeEntry("offline-film")]
  mockQuery.mockImplementation(
    async ({ variables }: { variables: { slug: string } }) =>
      videoResponse("Original title", variables.slug),
  )
  await syncTopShelf(model, resume, "english", "continue")
  const before = JSON.parse(mockStore.get("watch.top-shelf.snapshot.v1")!)
  mockQuery.mockImplementation(
    async ({ variables }: { variables: { slug: string } }) => {
      if (variables.slug === "removed-film")
        return { data: { videoBySlug: null } }
      throw new Error("offline")
    },
  )
  await syncTopShelf(model, resume, "english", "continue")
  const after = JSON.parse(mockWrite.mock.calls[1][0])
  expect(after.items.map((item: { slug: string }) => item.slug)).toEqual([
    "offline-film",
  ])
  expect(after.expiresAt).toBe(before.expiresAt)
  expect(after.generatedAt).toBe(before.generatedAt)
})

it("does not reintroduce a removed resume film through an overlapping recommendation", async () => {
  mockFetch.mockResolvedValue({
    ...delivery,
    items: [
      {
        ...delivery.items[0],
        targetMediaId: "real-film",
        videoSlug: "real-film",
      },
    ],
  })
  mockQuery.mockResolvedValue({ data: { videoBySlug: null } })
  await syncTopShelf(model, [resumeEntry()], "english")
  expect(JSON.parse(mockWrite.mock.calls[0][0]).items).toEqual([])
})

it("ignores a superseded metadata completion instead of overwriting a newer refresh", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  let finish: (value: ReturnType<typeof videoResponse>) => void = () => {}
  let started: () => void = () => {}
  const querying = new Promise<void>((resolve) => {
    started = resolve
  })
  mockQuery.mockImplementationOnce(() => {
    started()
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const stale = syncTopShelf(model, [resumeEntry()], "english", "continue")
  await querying
  mockQuery.mockResolvedValueOnce(videoResponse("Newest title"))
  await syncTopShelf(model, [resumeEntry()], "english", "continue")
  finish(videoResponse("Obsolete title"))
  await stale
  expect(mockWrite).toHaveBeenCalledTimes(1)
  expect(JSON.parse(mockWrite.mock.calls[0][0]).items[0].title).toBe(
    "Newest title",
  )
})

it("does not restore retired content after metadata resolves following personalization reset", async () => {
  mockQuery.mockImplementationOnce(async () => {
    mockGeneration++
    await clearPersonalTopShelf()
    return videoResponse()
  })
  await syncTopShelf(model, [resumeEntry()], "english")
  expect(mockWrite).not.toHaveBeenCalled()
  expect(mockStore.has("watch.top-shelf.snapshot.v1")).toBe(false)
  expect(mockStore.has("watch.top-shelf.catalog.v1")).toBe(false)
})

function fixedRotation() {
  const value = JSON.stringify({
    day: localDay(new Date()),
    concept: "spotlight",
    remaining: ["short"],
  })
  mockStore.set("watch.top-shelf.rotation.v1", value)
  return value
}

it("ignores stored preview choices in production", async () => {
  fixedRotation()
  await syncTopShelf(model, [], "english", "short")
  expect(JSON.parse(mockWrite.mock.calls[0][0]).concept).toBe("spotlight")
})

it("publishes an eligible beta preview without consuming automatic rotation", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  const previous = fixedRotation()
  await syncTopShelf(model, [], "english", "short")
  expect(JSON.parse(mockWrite.mock.calls[0][0]).concept).toBe("short")
  expect(mockStore.get("watch.top-shelf.rotation.v1")).toBe(previous)
})

it("falls back to Automatic for a preview without real eligible content", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  fixedRotation()
  await syncTopShelf(model, [], "english", "continue")
  expect(JSON.parse(mockWrite.mock.calls[0][0])).toMatchObject({
    concept: "spotlight",
    items: [{ slug: "recommended-video" }],
  })
})

it("restores the automatic snapshot after previewing", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  fixedRotation()
  await syncTopShelf(model, [], "english", "short")
  await syncTopShelf(model, [], "english", "automatic")
  expect(JSON.parse(mockWrite.mock.calls[1][0]).concept).toBe("spotlight")
})

it("reports beta publication status without exposing upstream error bodies", async () => {
  const status = jest.fn()
  mockFetch.mockRejectedValue(new Error("private upstream detail"))
  await syncTopShelf(model, [], "english", "automatic", status)
  expect(status).toHaveBeenLastCalledWith(
    "Could not update Top Shelf (recommendations). Try again.",
  )
  expect(JSON.stringify(status.mock.calls)).not.toContain(
    "private upstream detail",
  )
})

it("treats an unchanged native snapshot as successful publication", async () => {
  const status = jest.fn()
  mockWrite.mockResolvedValueOnce(false)
  await syncTopShelf(model, [], "english", "automatic", status)
  expect(status).toHaveBeenLastCalledWith(
    "Top Shelf updated. Return to Apple TV Home.",
  )
  expect(mockStore.has("watch.top-shelf.snapshot.v1")).toBe(true)
})

it("publishes the recommendation feed without exporting private capabilities or querying editorial picks", async () => {
  await syncTopShelf(model, [], "english")
  expect(mockFetch).toHaveBeenCalledWith("english")
  expect(mockQuery).not.toHaveBeenCalled()
  const payload = mockWrite.mock.calls[0]?.[0] as unknown as string
  expect(JSON.parse(payload).items[0].slug).toBe("recommended-video")
  expect(payload).not.toContain("must-not-export")
  expect(JSON.parse(payload).source).toBe("recommendations")
})
it("removes prior-language content before unavailable new-language delivery", async () => {
  await syncTopShelf(model, [], "english")
  mockWrite.mockClear()
  await invalidateTopShelfLanguage("thai")
  mockFetch.mockResolvedValue({ result: "unavailable", items: [] })
  await syncTopShelf(model, [], "thai")
  expect(mockWrite).toHaveBeenCalledTimes(1)
  expect(JSON.parse(mockWrite.mock.calls[0][0])).toMatchObject({
    language: "thai",
    items: [],
  })
})
it("retains the existing native snapshot on a recommendation transport failure", async () => {
  mockFetch.mockRejectedValue(new Error("offline"))
  await syncTopShelf(model, [], "english")
  expect(mockWrite).not.toHaveBeenCalled()
})
it("fences a recommendation delivery after personalization changes and clears shared caches", async () => {
  mockFetch.mockImplementation(async () => {
    mockGeneration++
    return delivery
  })
  await syncTopShelf(model, [], "english")
  expect(mockWrite).not.toHaveBeenCalled()
  mockStore.set("watch.top-shelf.snapshot.v1", "old")
  await clearPersonalTopShelf()
  expect(mockClear).toHaveBeenCalled()
  expect(mockStore.has("watch.top-shelf.snapshot.v1")).toBe(false)
})

it("does not repopulate a retired cache after an in-flight native write resolves", async () => {
  const status = jest.fn()
  mockWrite.mockImplementationOnce(async () => {
    mockGeneration++
    await clearPersonalTopShelf()
    return true
  })
  await syncTopShelf(model, [], "english", "automatic", status)
  expect(mockStore.has("watch.top-shelf.snapshot.v1")).toBe(false)
  expect(mockStore.has("watch.top-shelf.rotation.v1")).toBe(false)
  expect(status).not.toHaveBeenCalledWith(
    "Top Shelf updated. Return to Apple TV Home.",
  )
})

it("does not restore a retired snapshot after awaiting the rotation write", async () => {
  mockStoreSet.mockImplementation(async (key: string, value: string) => {
    mockStore.set(key, value)
    if (key === "watch.top-shelf.rotation.v1") {
      mockGeneration++
      await clearPersonalTopShelf()
    }
  })
  const status = jest.fn()
  await syncTopShelf(model, [], "english", "automatic", status)
  expect(mockClear).toHaveBeenCalled()
  expect(mockStore.has("watch.top-shelf.snapshot.v1")).toBe(false)
  expect(status).not.toHaveBeenCalledWith(
    "Top Shelf updated. Return to Apple TV Home.",
  )
})

it("does not keep removed local history in the fallback when remaining metadata is offline", async () => {
  process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED = "true"
  mockQuery.mockImplementation(
    async ({ variables }: { variables: { slug: string } }) =>
      videoResponse("Original title", variables.slug),
  )
  await syncTopShelf(
    model,
    [resumeEntry("removed-history"), resumeEntry("remaining-film")],
    "english",
    "continue",
  )
  const before = JSON.parse(mockStore.get("watch.top-shelf.snapshot.v1")!)
  mockQuery.mockRejectedValue(new Error("offline"))
  await syncTopShelf(
    model,
    [resumeEntry("remaining-film")],
    "english",
    "continue",
  )
  const after = JSON.parse(mockWrite.mock.calls[1][0])
  expect(after.items.map((item: { slug: string }) => item.slug)).toEqual([
    "remaining-film",
  ])
  expect(after.expiresAt).toBe(before.expiresAt)
})

it("does not keep a removed Journey in the fallback during unrelated metadata failure", async () => {
  const previous = {
    schemaVersion: 1,
    concept: "journey",
    language: "english",
    source: "recommendations",
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    items: [
      {
        id: "removed-section",
        slug: "removed-section",
        title: "Jesus stories",
        summary: "Former section",
        imageURL: "https://image.mux.com/old/thumbnail.jpg",
        duration: 0,
        kind: "section",
      },
    ],
  }
  mockStore.set("watch.top-shelf.snapshot.v1", JSON.stringify(previous))
  mockQuery.mockRejectedValue(new Error("offline"))
  await syncTopShelf(model, [resumeEntry()], "english")
  expect(JSON.parse(mockWrite.mock.calls[0][0])).toEqual({
    ...previous,
    items: [],
  })
})
