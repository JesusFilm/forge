import { createRequire } from "node:module"
import { afterEach, describe, expect, it, vi } from "vitest"
import createEsmHandler from "@fortedigital/nextjs-cache-handler/redis-strings"

const require = createRequire(import.meta.url)
const createCjsHandler =
  require("@fortedigital/nextjs-cache-handler/redis-strings").default
const prefix = "cleanup-test:"

function fixture() {
  const expired = Array.from({ length: 1_501 }, (_, i) => `expired-${i}`)
  const matching = Array.from({ length: 1_001 }, (_, i) => `matching-${i}`)
  const live = ["keep-live"]
  const tags = new Map([
    ...expired.map((key) => [key, '["expired"]']),
    ...matching.map((key) => [key, '["matching"]']),
    ...live.map((key) => [key, '["unrelated"]']),
  ])
  const ttls = new Map([
    ...expired.map((key) => [key, "1"]),
    ...matching.concat(live).map((key) => [key, "9999999999"]),
  ])
  const values = new Set([...tags.keys()].map((key) => prefix + key))
  const client = {
    isReady: true,
    hScan: vi.fn(async (key) => ({
      cursor: "0",
      entries: Array.from(key.endsWith("__sharedTags__") ? tags : ttls).map(
        ([field, value]) => ({ field, value }),
      ),
    })),
    unlink: vi.fn(async (keys) => {
      for (const key of keys) values.delete(key)
    }),
    hDel: vi.fn(async (key, fields) => {
      const hash = key.endsWith("__sharedTags__") ? tags : ttls
      for (const field of fields) hash.delete(field)
    }),
  }
  return { client, expired, matching, tags, ttls, values }
}

afterEach(() => vi.restoreAllMocks())

describe.each([
  ["ESM", createEsmHandler],
  ["CommonJS", createCjsHandler],
])("Redis cache cleanup (%s)", (_name, createHandler) => {
  it("removes every expired entry in bounded batches and retains live entries", async () => {
    const f = fixture()
    await createHandler({ client: f.client, keyPrefix: prefix }).prepare()

    expect(f.tags.size).toBe(f.matching.length + 1)
    expect([...f.ttls.keys()]).toEqual([...f.tags.keys()])
    expect([...f.values]).toEqual([...f.tags.keys()].map((key) => prefix + key))
    expect(f.expired.some((key) => f.tags.has(key))).toBe(false)
    expect(f.client.unlink.mock.calls.map(([keys]) => keys.length)).toEqual([
      500, 500, 500, 1,
    ])
    expect(
      f.client.hDel.mock.calls.every(([, fields]) => fields.length <= 500),
    ).toBe(true)
  })

  it("invalidates every matching tag and expired entry without deleting unrelated content", async () => {
    const f = fixture()
    await createHandler({ client: f.client, keyPrefix: prefix }).revalidateTag(
      "matching",
    )

    expect([...f.tags.keys()]).toEqual(["keep-live"])
    expect([...f.ttls.keys()]).toEqual(["keep-live"])
    expect([...f.values]).toEqual([prefix + "keep-live"])
    expect(
      f.client.unlink.mock.calls.every(([keys]) => keys.length <= 500),
    ).toBe(true)
    expect(
      f.client.hDel.mock.calls.every(([, fields]) => fields.length <= 500),
    ).toBe(true)
  })

  it("waits for the current batch and propagates a failure before starting another", async () => {
    const f = fixture()
    let rejectFirst
    f.client.unlink.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject
        }),
    )
    const cleanup = createHandler({
      client: f.client,
      keyPrefix: prefix,
    }).prepare()
    const failed = expect(cleanup).rejects.toThrow("Redis unavailable")
    await vi.waitFor(() => expect(f.client.unlink).toHaveBeenCalledTimes(1))
    expect(f.client.hDel).toHaveBeenCalledTimes(2)
    expect(f.client.unlink.mock.calls[0][0]).toHaveLength(500)
    rejectFirst(new Error("Redis unavailable"))
    await failed
    expect(f.client.unlink).toHaveBeenCalledTimes(1)
  })

  it("stops submitting batches when the original cleanup deadline expires", async () => {
    const f = fixture()
    const controller = new AbortController()
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal)
    f.client.unlink.mockImplementationOnce(async () => {
      controller.abort()
    })
    await expect(
      createHandler({ client: f.client, keyPrefix: prefix }).prepare(),
    ).rejects.toThrow(/abort/i)
    expect(f.client.unlink).toHaveBeenCalledTimes(1)
    expect(f.client.unlink.mock.calls[0][0]).toHaveLength(500)
  })
})
