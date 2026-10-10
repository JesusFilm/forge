import { ensureDubMedia, type DubMediaCallbacks } from "../dubMediaFetch"
import type { VariantMedia } from "../normalizeVideo"

const MEDIA: VariantMedia = {
  downloads: [
    { documentId: "dl-1", quality: "high", size: "100", url: "https://x/h" },
  ],
  subtitles: [],
}

// Flush microtasks (then/catch/finally) by yielding a macrotask tick.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeCallbacks(): DubMediaCallbacks & {
  onStart: jest.Mock
  onSuccess: jest.Mock
  onError: jest.Mock
  onSettled: jest.Mock
} {
  return {
    onStart: jest.fn(),
    onSuccess: jest.fn(),
    onError: jest.fn(),
    onSettled: jest.fn(),
  }
}

describe("ensureDubMedia", () => {
  it("is a no-op for a null/undefined id", () => {
    const cb = makeCallbacks()
    const fetchMedia = jest.fn(async () => MEDIA)
    ensureDubMedia(null, new Set(), fetchMedia, cb)
    ensureDubMedia(undefined, new Set(), fetchMedia, cb)
    expect(fetchMedia).not.toHaveBeenCalled()
    expect(cb.onStart).not.toHaveBeenCalled()
  })

  it("is a no-op when the id is already in the requested ledger", () => {
    const cb = makeCallbacks()
    const fetchMedia = jest.fn(async () => MEDIA)
    ensureDubMedia("d1", new Set(["d1"]), fetchMedia, cb)
    expect(fetchMedia).not.toHaveBeenCalled()
  })

  it("dedupes concurrent calls for the same id to a single fetch", async () => {
    const cb = makeCallbacks()
    const requested = new Set<string>()
    const fetchMedia = jest.fn(async () => MEDIA)
    ensureDubMedia("d1", requested, fetchMedia, cb)
    ensureDubMedia("d1", requested, fetchMedia, cb)
    ensureDubMedia("d1", requested, fetchMedia, cb)
    expect(fetchMedia).toHaveBeenCalledTimes(1)
    expect(requested.has("d1")).toBe(true)
    await flush()
  })

  it("on success: onStart, onSuccess(id, media), onSettled — no onError; id stays requested", async () => {
    const cb = makeCallbacks()
    const requested = new Set<string>()
    ensureDubMedia("d1", requested, async () => MEDIA, cb)
    expect(cb.onStart).toHaveBeenCalledWith("d1")
    await flush()
    expect(cb.onSuccess).toHaveBeenCalledWith("d1", MEDIA)
    expect(cb.onSettled).toHaveBeenCalledWith("d1")
    expect(cb.onError).not.toHaveBeenCalled()
    // Successful fetch keeps the ledger entry so it is not re-fetched.
    expect(requested.has("d1")).toBe(true)
  })

  it("on failure: onError + onSettled fire, no onSuccess, and the id is released for retry", async () => {
    const cb = makeCallbacks()
    const requested = new Set<string>()
    ensureDubMedia(
      "d1",
      requested,
      async () => {
        throw new Error("network")
      },
      cb,
    )
    await flush()
    expect(cb.onError).toHaveBeenCalledWith("d1")
    expect(cb.onSettled).toHaveBeenCalledWith("d1")
    expect(cb.onSuccess).not.toHaveBeenCalled()
    // Released so a later ensure() can retry.
    expect(requested.has("d1")).toBe(false)
  })

  it("retries after a failed fetch (second call re-fires once the first settled)", async () => {
    const cb = makeCallbacks()
    const requested = new Set<string>()
    let attempt = 0
    const fetchMedia = jest.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error("transient")
      return MEDIA
    })
    ensureDubMedia("d1", requested, fetchMedia, cb)
    await flush()
    expect(fetchMedia).toHaveBeenCalledTimes(1)
    expect(requested.has("d1")).toBe(false)
    // Retry
    ensureDubMedia("d1", requested, fetchMedia, cb)
    await flush()
    expect(fetchMedia).toHaveBeenCalledTimes(2)
    expect(cb.onSuccess).toHaveBeenCalledWith("d1", MEDIA)
  })

  it("treats a synchronous throw before dispatch as a failed attempt and releases the ledger", async () => {
    const cb = makeCallbacks()
    const requested = new Set<string>()
    const fetchMedia = jest.fn(() => {
      throw new Error("sync boom")
    })
    expect(() =>
      ensureDubMedia("d1", requested, fetchMedia as never, cb),
    ).not.toThrow()
    expect(cb.onError).toHaveBeenCalledWith("d1")
    expect(cb.onSettled).toHaveBeenCalledWith("d1")
    expect(cb.onSuccess).not.toHaveBeenCalled()
    expect(requested.has("d1")).toBe(false)
  })

  it("attributes media to the id it was called with, not a later one (no cross-dub leak)", async () => {
    const cb = makeCallbacks()
    const requested = new Set<string>()
    const aMedia: VariantMedia = { downloads: [], subtitles: [] }
    const bMedia: VariantMedia = { ...MEDIA }
    // Fire A, then B, each resolving to its own media.
    ensureDubMedia("A", requested, async () => aMedia, cb)
    ensureDubMedia("B", requested, async () => bMedia, cb)
    await flush()
    expect(cb.onSuccess).toHaveBeenCalledWith("A", aMedia)
    expect(cb.onSuccess).toHaveBeenCalledWith("B", bMedia)
  })
})
