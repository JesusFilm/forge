import { afterEach, describe, expect, it, vi } from "vitest"

import {
  cachedBoundedTtlBatchValues,
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

describe("cachedBoundedTtlBatchValues", () => {
  afterEach(() => vi.useRealTimers())

  it("loads misses once while preserving cached and requested order", async () => {
    const cacheByOwner = new WeakMap<object, BoundedTtlCache<string>>()
    const owner = {}
    const loader = vi.fn(async (keys: readonly string[]) =>
      keys.map((key) => `value:${key}`),
    )

    await expect(
      cachedBoundedTtlBatchValues({
        cacheByOwner,
        owner,
        keys: ["one"],
        ttlMs: 1_000,
        maxEntries: 3,
        loader,
      }),
    ).resolves.toEqual(["value:one"])
    await expect(
      cachedBoundedTtlBatchValues({
        cacheByOwner,
        owner,
        keys: ["one", "two", "three"],
        ttlMs: 1_000,
        maxEntries: 3,
        loader,
      }),
    ).resolves.toEqual(["value:one", "value:two", "value:three"])

    expect(loader).toHaveBeenNthCalledWith(2, ["two", "three"])
  })

  it("coalesces overlapping in-flight batches", async () => {
    const cacheByOwner = new WeakMap<object, BoundedTtlCache<string>>()
    const owner = {}
    let resolveFirst!: (values: readonly string[]) => void
    const firstLoad = new Promise<readonly string[]>((resolve) => {
      resolveFirst = resolve
    })
    const loader = vi
      .fn<(keys: readonly string[]) => Promise<readonly string[]>>()
      .mockReturnValueOnce(firstLoad)
      .mockImplementationOnce(async (keys) => keys.map((key) => `value:${key}`))

    const first = cachedBoundedTtlBatchValues({
      cacheByOwner,
      owner,
      keys: ["one", "two"],
      ttlMs: 1_000,
      maxEntries: 3,
      loader,
    })
    const second = cachedBoundedTtlBatchValues({
      cacheByOwner,
      owner,
      keys: ["two", "three"],
      ttlMs: 1_000,
      maxEntries: 3,
      loader,
    })
    resolveFirst(["value:one", "value:two"])

    await expect(first).resolves.toEqual(["value:one", "value:two"])
    await expect(second).resolves.toEqual(["value:two", "value:three"])
    expect(loader).toHaveBeenNthCalledWith(2, ["three"])
  })

  it("expires, evicts, and removes every failed batch miss", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"))
    const cacheByOwner = new WeakMap<object, BoundedTtlCache<string>>()
    const owner = {}
    const loader = vi
      .fn<(keys: readonly string[]) => Promise<readonly string[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (keys) => keys.map((key) => `value:${key}`))

    const load = (keys: readonly string[]) =>
      cachedBoundedTtlBatchValues({
        cacheByOwner,
        owner,
        keys,
        ttlMs: 1_000,
        maxEntries: 2,
        loader,
      })
    await expect(load(["one", "two"])).rejects.toThrow("offline")
    await expect(load(["one", "two"])).resolves.toEqual([
      "value:one",
      "value:two",
    ])
    await expect(load(["three"])).resolves.toEqual(["value:three"])
    await expect(load(["one"])).resolves.toEqual(["value:one"])
    vi.advanceTimersByTime(1_001)
    await expect(load(["three"])).resolves.toEqual(["value:three"])

    expect(loader).toHaveBeenCalledTimes(5)
  })

  it("rejects and evicts a batch with the wrong result count", async () => {
    const cacheByOwner = new WeakMap<object, BoundedTtlCache<string>>()
    const owner = {}
    const loader = vi
      .fn<(keys: readonly string[]) => Promise<readonly string[]>>()
      .mockResolvedValueOnce(["only-one"])
      .mockImplementationOnce(async (keys) => keys.map((key) => `value:${key}`))
    const options = {
      cacheByOwner,
      owner,
      keys: ["one", "two"],
      ttlMs: 1_000,
      maxEntries: 2,
      loader,
    }

    await expect(cachedBoundedTtlBatchValues(options)).rejects.toThrow(
      "result count mismatch",
    )
    await expect(cachedBoundedTtlBatchValues(options)).resolves.toEqual([
      "value:one",
      "value:two",
    ])
  })
})
