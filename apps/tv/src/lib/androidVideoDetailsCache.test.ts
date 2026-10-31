import { createAndroidVideoDetailsCache } from "./androidVideoDetailsCache"
import type { WatchVideoData } from "./videoQueries"

const empty: WatchVideoData = { videoBySlug: null }

it("deduplicates pending work and preserves response identity on warm visits", async () => {
  const fetch = jest.fn(async () => empty)
  const cache = createAndroidVideoDetailsCache(fetch)
  const first = cache.load("jesus")
  expect(cache.load("jesus")).toBe(first)
  await first
  expect(await cache.load("jesus")).toBe(empty)
  expect(cache.read("jesus")).toBe(empty)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it("expires responses and refreshes explicitly", async () => {
  let time = 0
  const fetch = jest.fn(async () => empty)
  const cache = createAndroidVideoDetailsCache(fetch, () => time)
  await cache.load("jesus")
  time = 300_001
  expect(cache.read("jesus")).toBeUndefined()
  await cache.load("jesus")
  await cache.load("jesus", true)
  expect(fetch).toHaveBeenCalledTimes(3)
})

it("bounds retention to eight recent videos", async () => {
  const cache = createAndroidVideoDetailsCache(async () => empty)
  for (let i = 0; i < 8; i++) await cache.load(String(i))
  await cache.load("0")
  await cache.load("8")
  expect(cache.read("0")).toBe(empty)
  expect(cache.read("1")).toBeUndefined()
})

it("does not retain failures", async () => {
  const fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(empty)
  const cache = createAndroidVideoDetailsCache(fetch)
  await expect(cache.load("jesus")).rejects.toThrow("offline")
  expect(await cache.load("jesus")).toBe(empty)
})

it("does not let an older response replace a forced refresh", async () => {
  let resolveOld!: (data: WatchVideoData) => void
  const newer: WatchVideoData = { videoBySlug: null }
  const fetch = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<WatchVideoData>((resolve) => {
          resolveOld = resolve
        }),
    )
    .mockResolvedValue(newer)
  const cache = createAndroidVideoDetailsCache(fetch)
  const old = cache.load("jesus")
  await cache.load("jesus", true)
  resolveOld(empty)
  await old
  expect(cache.read("jesus")).toBe(newer)
})
