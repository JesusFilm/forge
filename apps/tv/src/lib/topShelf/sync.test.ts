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
