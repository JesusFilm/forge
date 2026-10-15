const mockStore = new Map<string, string>()
const mockWrite = jest.fn(async (_json: string) => true)
const mockClear = jest.fn(async () => {})
const mockFetch = jest.fn()
const mockQuery = jest.fn()
let mockGeneration = 0
jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: true },
  AppState: { currentState: "active" },
}))
jest.mock("../safeStorage", () => ({
  getStorage: () => ({
    getItem: async (key: string) => mockStore.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStore.set(key, value)
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
  jest.clearAllMocks()
  mockGeneration = 0
  mockFetch.mockResolvedValue(delivery)
  delete process.env.EXPO_PUBLIC_TV_TOP_SHELF_PREVIEW_ENABLED
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
