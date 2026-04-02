import test from "node:test"
import assert from "node:assert/strict"
import { createSwrCache } from "./swr-cache"

test("SWR cache returns stale data during failure backoff after a refresh failure", async () => {
  let fetchCount = 0
  let shouldFail = false

  const cache = createSwrCache({
    fetcher: async () => {
      fetchCount += 1
      if (shouldFail) throw new Error("upstream down")
      return `value-${fetchCount}`
    },
    ttlMs: 0,
    maxStaleMs: 60_000,
    failureBackoffMs: 10_000,
    label: "test-cache",
  })

  const first = await cache.get()
  assert.equal(first, "value-1")

  shouldFail = true
  const second = await cache.get()
  assert.equal(second, "value-1")

  await new Promise((resolve) => setTimeout(resolve, 0))

  const third = await cache.get()
  assert.equal(third, "value-1")
  assert.equal(fetchCount, 2)
})

test("SWR cache throws when empty cache refresh fails", async () => {
  const cache = createSwrCache({
    fetcher: async () => {
      throw new Error("boom")
    },
    ttlMs: 0,
    maxStaleMs: 60_000,
    failureBackoffMs: 10_000,
    label: "empty-cache",
  })

  await assert.rejects(cache.get(), /boom/)
})
