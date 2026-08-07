import { afterEach, describe, expect, it, vi } from "vitest"

import {
  cachedBoundedTtlValue,
  type BoundedTtlCache,
} from "./bounded-ttl-promise-cache"

function cacheValue<T>({
  cacheByOwner,
  owner,
  key,
  loader,
  ttlMs = 1_000,
  maxEntries = 2,
}: {
  cacheByOwner: WeakMap<object, BoundedTtlCache<T>>
  owner: object
  key: string
  loader: () => Promise<T>
  ttlMs?: number
  maxEntries?: number
}) {
  return cachedBoundedTtlValue({
    cacheByOwner,
    owner,
    key,
    ttlMs,
    maxEntries,
    loader,
  })
}

describe("cachedBoundedTtlValue", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("coalesces in-flight loads and reuses the resolved value", async () => {
    const cacheByOwner = new WeakMap<object, BoundedTtlCache<string>>()
    const owner = {}
    const loader = vi.fn(async () => "english")

    const first = cacheValue({ cacheByOwner, owner, key: "english", loader })
    const second = cacheValue({ cacheByOwner, owner, key: "english", loader })

    expect(first).toBe(second)
    await expect(first).resolves.toBe("english")
    await expect(
      cacheValue({ cacheByOwner, owner, key: "english", loader }),
    ).resolves.toBe("english")
    expect(loader).toHaveBeenCalledOnce()
  })

  it("expires values and removes rejected loads", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T00:00:00.000Z"))
    const cacheByOwner = new WeakMap<object, BoundedTtlCache<string>>()
    const owner = {}
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second")

    await expect(
      cacheValue({ cacheByOwner, owner, key: "language", loader }),
    ).rejects.toThrow("temporary failure")
    await expect(
      cacheValue({ cacheByOwner, owner, key: "language", loader }),
    ).resolves.toBe("first")

    vi.advanceTimersByTime(1_001)
    await expect(
      cacheValue({ cacheByOwner, owner, key: "language", loader }),
    ).resolves.toBe("second")
    expect(loader).toHaveBeenCalledTimes(3)
  })

  it("evicts the oldest entry when capacity is exceeded", async () => {
    const cacheByOwner = new WeakMap<object, BoundedTtlCache<string>>()
    const owner = {}
    const loader = vi.fn(async (value: string) => value)

    for (const key of ["one", "two", "three"]) {
      await cacheValue({
        cacheByOwner,
        owner,
        key,
        loader: () => loader(key),
      })
    }
    await cacheValue({
      cacheByOwner,
      owner,
      key: "one",
      loader: () => loader("one"),
    })

    expect(loader).toHaveBeenCalledTimes(4)
  })

  it("does not let an expired promise overwrite its replacement", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T00:00:00.000Z"))
    const cacheByOwner = new WeakMap<object, BoundedTtlCache<string>>()
    const owner = {}
    let resolveOld!: (value: string) => void
    const oldLoad = new Promise<string>((resolve) => {
      resolveOld = resolve
    })

    const oldResult = cacheValue({
      cacheByOwner,
      owner,
      key: "language",
      loader: async () => oldLoad,
    })
    vi.advanceTimersByTime(1_001)
    await expect(
      cacheValue({
        cacheByOwner,
        owner,
        key: "language",
        loader: async () => "replacement",
      }),
    ).resolves.toBe("replacement")

    resolveOld("stale")
    await expect(oldResult).resolves.toBe("stale")
    await expect(
      cacheValue({
        cacheByOwner,
        owner,
        key: "language",
        loader: async () => "unexpected",
      }),
    ).resolves.toBe("replacement")
  })
})
