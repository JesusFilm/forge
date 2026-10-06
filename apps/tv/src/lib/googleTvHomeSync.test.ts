import type { GoogleTvHomeResult } from "../../modules/google-tv-home"
import type { WatchHomeModel } from "./watchHome/model"

const mockValues = new Map<string, string>()
const mockFetchForYou = jest.fn()
jest.mock("./recommendations/client", () => ({
  fetchForYou: (...args: unknown[]) => mockFetchForYou(...args),
  recommendationsEnabled: () => true,
  getRecommendationGeneration: () => 0,
}))
jest.mock("./watchPreferences", () => ({
  loadWatchPreferences: async () => ({ audioLanguageSlug: "thai" }),
}))
const mockModule = {
  getStatus: jest.fn(),
  publish: jest.fn(),
  remove: jest.fn(),
}
jest.mock("react-native", () => ({
  Platform: { OS: "android", isTV: true },
  AppState: { currentState: "active" },
}))
jest.mock("../../modules/google-tv-home", () => ({
  getGoogleTvHomeModule: () => mockModule,
}))
jest.mock("./safeStorage", () => ({
  getStorage: () => ({
    getItem: async (key: string) => mockValues.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockValues.set(key, value)
    },
  }),
}))
jest.mock("./watchEvents/continueWatching", () => ({
  loadContinueWatching: async () => [
    {
      slug: "jesus",
      positionSeconds: 60,
      durationSeconds: 3600,
      updatedAt: new Date().toISOString(),
    },
  ],
}))
const data: WatchHomeModel = {
  featured: [
    {
      id: "jesus",
      sourceId: "jesus",
      coreId: "jesus",
      slug: "jesus",
      title: "JESUS",
      rawLabel: "FEATURE_FILM",
      label: "Film",
      description: null,
      metaLabel: null,
      imageUrl: null,
      landscapeImageUrl: "https://image.mux.com/abc/thumbnail.jpg",
      imageAlt: "JESUS",
      muxPlaybackId: null,
      durationSeconds: 3600,
      childCount: 0,
      parentCoreId: null,
      parentSlug: null,
      missingData: [],
    },
  ],
  sections: [],
  missingData: [],
}
const result = (status: GoogleTvHomeResult["status"]): GoogleTvHomeResult => ({
  status,
  environment: "production",
  message: status,
  count: 0,
})

beforeEach(() => {
  jest.resetModules()
  mockValues.clear()
  mockFetchForYou.mockReset().mockResolvedValue({
    items: [
      {
        videoSlug: "jesus",
        videoTitle: "Personalized JESUS",
        imageUrl: "https://image.mux.com/personal/thumbnail.jpg",
        description: "For you",
        durationSeconds: 3600,
        capability: "never-export",
        viewerToken: "never-export",
      },
    ],
  })
  mockModule.publish.mockReset().mockResolvedValue(result("published"))
  mockModule.remove.mockReset().mockResolvedValue(result("removed"))
  mockModule.getStatus.mockReset().mockResolvedValue(result("available"))
})

test("does not publish on Home without adult local permission", async () => {
  const sync =
    jest.requireActual<typeof import("./googleTvHomeSync")>(
      "./googleTvHomeSync",
    )
  await sync.syncGoogleTvHome(data)
  expect(mockModule.publish).not.toHaveBeenCalled()
})
test("explicit local permission publishes real unfinished viewing without account", async () => {
  const sync =
    jest.requireActual<typeof import("./googleTvHomeSync")>(
      "./googleTvHomeSync",
    )
  await sync.syncGoogleTvHome(data)
  await sync.setGoogleTvContinuationEnabled(true)
  expect(mockModule.publish).toHaveBeenCalledWith(
    [expect.objectContaining({ slug: "jesus", positionMillis: 60000 })],
    true,
    "Continue Watching",
    true,
  )
})
test("disabling persists pending removal on failure and never re-enables sharing", async () => {
  const sync =
    jest.requireActual<typeof import("./googleTvHomeSync")>(
      "./googleTvHomeSync",
    )
  mockModule.remove.mockResolvedValueOnce(result("error"))
  await sync.setGoogleTvContinuationEnabled(false)
  expect(await sync.isGoogleTvContinuationEnabled()).toBe(false)
  expect([...mockValues.values()]).toContain("pending-removal")
  await sync.syncGoogleTvHome(data)
  expect(mockModule.remove).toHaveBeenCalledTimes(2)
  expect([...mockValues.values()]).toContain("off")
  expect(mockModule.publish).not.toHaveBeenCalled()
})
test("production discovery fails closed even when service is available", async () => {
  const sync =
    jest.requireActual<typeof import("./googleTvHomeSync")>(
      "./googleTvHomeSync",
    )
  await sync.syncGoogleTvHome(data)
  expect((await sync.publishGoogleTvDiscoveryPreview()).status).toBe("blocked")
  expect(mockModule.publish).not.toHaveBeenCalled()
})
test("discovery verification never sends local watch position", async () => {
  const sync =
    jest.requireActual<typeof import("./googleTvHomeSync")>(
      "./googleTvHomeSync",
    )
  mockModule.getStatus.mockResolvedValue({
    ...result("available"),
    environment: "verification",
  })
  await sync.syncGoogleTvHome(data)
  await sync.publishGoogleTvDiscoveryPreview()
  const videos = mockModule.publish.mock.calls[0]![0]
  expect(mockFetchForYou).toHaveBeenCalledWith("thai")
  expect(videos[0]).toMatchObject({
    title: "Personalized JESUS",
    posterUri: expect.stringContaining("/personal/"),
  })
  expect(videos[0]).not.toHaveProperty("positionMillis")
  expect(videos[0]).not.toHaveProperty("capability")
  expect(videos[0]).not.toHaveProperty("viewerToken")
  expect(mockModule.publish).toHaveBeenCalledWith(
    videos,
    true,
    "Cinematic Spotlight",
    false,
  )
})
test("recommendation transport failure does not substitute editorial picks", async () => {
  const sync =
    jest.requireActual<typeof import("./googleTvHomeSync")>(
      "./googleTvHomeSync",
    )
  mockModule.getStatus.mockResolvedValue({
    ...result("available"),
    environment: "verification",
  })
  mockFetchForYou.mockRejectedValue(new Error("offline"))
  await sync.syncGoogleTvHome(data)
  expect((await sync.publishGoogleTvDiscoveryPreview()).status).toBe("blocked")
  expect(mockModule.publish).not.toHaveBeenCalled()
})
