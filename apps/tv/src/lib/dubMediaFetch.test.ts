import { ensureDubMedia, type DubMediaCallbacks } from "./dubMediaFetch"
import type { VariantMedia } from "./normalizeVideo"

const EMPTY_MEDIA: VariantMedia = { downloads: [], subtitles: [] }

// Drain the fire-and-forget promise chain (.then → .catch → .finally). A
// macrotask flush guarantees every queued microtask has run, so onSettled
// (which fires from .finally, one turn after .then/.catch) has landed.
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

function makeCallbacks(): {
  cb: DubMediaCallbacks
  starts: string[]
  successes: Array<{ id: string; media: VariantMedia }>
  errors: string[]
  settles: string[]
} {
  const starts: string[] = []
  const successes: Array<{ id: string; media: VariantMedia }> = []
  const errors: string[] = []
  const settles: string[] = []
  return {
    starts,
    successes,
    errors,
    settles,
    cb: {
      onStart: (id) => starts.push(id),
      onSuccess: (id, media) => successes.push({ id, media }),
      onError: (id) => errors.push(id),
      onSettled: (id) => settles.push(id),
    },
  }
}

describe("ensureDubMedia", () => {
  it("ignores a null / undefined id without touching the ledger", () => {
    const requested = new Set<string>()
    const fetchMedia = jest.fn(async () => EMPTY_MEDIA)
    const { cb, starts } = makeCallbacks()

    ensureDubMedia(null, requested, fetchMedia, cb)
    ensureDubMedia(undefined, requested, fetchMedia, cb)

    expect(fetchMedia).not.toHaveBeenCalled()
    expect(starts).toEqual([])
    expect(requested.size).toBe(0)
  })

  it("fetches once for concurrent requests of the same id", () => {
    const requested = new Set<string>()
    const fetchMedia = jest.fn(async () => EMPTY_MEDIA)
    const { cb, starts } = makeCallbacks()

    ensureDubMedia("dub-1", requested, fetchMedia, cb)
    ensureDubMedia("dub-1", requested, fetchMedia, cb)
    ensureDubMedia("dub-1", requested, fetchMedia, cb)

    expect(fetchMedia).toHaveBeenCalledTimes(1)
    expect(starts).toEqual(["dub-1"])
    expect(requested.has("dub-1")).toBe(true)
  })

  it("keeps distinct ids independent", () => {
    const requested = new Set<string>()
    const fetchMedia = jest.fn(async () => EMPTY_MEDIA)
    const { cb } = makeCallbacks()

    ensureDubMedia("dub-1", requested, fetchMedia, cb)
    ensureDubMedia("dub-2", requested, fetchMedia, cb)

    expect(fetchMedia).toHaveBeenCalledTimes(2)
    expect(requested.has("dub-1")).toBe(true)
    expect(requested.has("dub-2")).toBe(true)
  })

  it("reports success with the fetched media and settles", async () => {
    const requested = new Set<string>()
    const media: VariantMedia = {
      downloads: [
        { documentId: "d1", quality: "720p", size: "1", url: "http://x/720" },
      ],
      subtitles: [],
    }
    const fetchMedia = jest.fn(async () => media)
    const { cb, successes, errors, settles } = makeCallbacks()

    ensureDubMedia("dub-1", requested, fetchMedia, cb)
    await flush()

    expect(successes).toEqual([{ id: "dub-1", media }])
    expect(errors).toEqual([])
    expect(settles).toEqual(["dub-1"])
    // A successful id stays in the ledger so it is never re-fetched.
    expect(requested.has("dub-1")).toBe(true)
  })

  it("removes a failed id from the ledger and a subsequent call retries", async () => {
    const requested = new Set<string>()
    let attempt = 0
    const fetchMedia = jest.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error("network")
      return EMPTY_MEDIA
    })
    const { cb, errors, settles, successes } = makeCallbacks()

    // First attempt fails.
    ensureDubMedia("dub-1", requested, fetchMedia, cb)
    await flush()

    expect(errors).toEqual(["dub-1"])
    expect(settles).toEqual(["dub-1"])
    // Failure released the slot so retry is possible.
    expect(requested.has("dub-1")).toBe(false)

    // Retry succeeds.
    ensureDubMedia("dub-1", requested, fetchMedia, cb)
    await flush()

    expect(fetchMedia).toHaveBeenCalledTimes(2)
    expect(successes).toEqual([{ id: "dub-1", media: EMPTY_MEDIA }])
    expect(requested.has("dub-1")).toBe(true)
  })

  it("settles into error and releases the slot when fetchMedia rejects (e.g. a hung admin hits the timeout)", async () => {
    // Mirrors the provider's GET_VIDEO_DUB timeout (hung query raced against an
    // 8 s reject). ensureDubMedia must treat the rejection as a failed attempt:
    // error fired, settled, and the ledger slot freed so the next ensure retries.
    const requested = new Set<string>()
    const fetchMedia = jest.fn(
      (): Promise<VariantMedia> =>
        Promise.reject(new Error("dub_media_fetch_timeout")),
    )
    const { cb, errors, settles, successes } = makeCallbacks()

    ensureDubMedia("dub-1", requested, fetchMedia, cb)
    await flush()

    expect(errors).toEqual(["dub-1"])
    expect(settles).toEqual(["dub-1"])
    expect(successes).toEqual([])
    // Slot released — no permanent loading/ledger wedge from the hung fetch.
    expect(requested.has("dub-1")).toBe(false)
  })

  it("releases the slot when fetchMedia throws synchronously (no permanent wedge)", () => {
    const requested = new Set<string>()
    const fetchMedia = jest.fn((): Promise<VariantMedia> => {
      throw new Error("synchronous boom")
    })
    const { cb, errors, settles } = makeCallbacks()

    ensureDubMedia("dub-1", requested, fetchMedia, cb)

    // The synchronous throw is treated as a failed attempt: error + settled
    // fired, and the ledger slot released so the next call can retry.
    expect(errors).toEqual(["dub-1"])
    expect(settles).toEqual(["dub-1"])
    expect(requested.has("dub-1")).toBe(false)

    // A retry actually re-dispatches (slot was released).
    const fetchOk = jest.fn(async () => EMPTY_MEDIA)
    ensureDubMedia("dub-1", requested, fetchOk, cb)
    expect(fetchOk).toHaveBeenCalledTimes(1)
  })

  it("releases the slot when fetchMedia returns a non-thenable (post-dispatch wedge)", () => {
    const requested = new Set<string>()
    // Returns null instead of a promise: attaching `.then` throws synchronously
    // AFTER fetchMedia "returned". The catch must still release + fire onError —
    // otherwise the id wedges into a permanent no-op with no error/settled.
    const fetchMedia = jest.fn(() => null as unknown as Promise<VariantMedia>)
    const { cb, errors, settles } = makeCallbacks()

    ensureDubMedia("dub-1", requested, fetchMedia, cb)

    expect(errors).toEqual(["dub-1"])
    expect(settles).toEqual(["dub-1"])
    // No permanent wedge: the id is back out of the ledger so a retry can run.
    expect(requested.has("dub-1")).toBe(false)

    // A retry actually re-dispatches (slot was released).
    const fetchOk = jest.fn(async () => EMPTY_MEDIA)
    ensureDubMedia("dub-1", requested, fetchOk, cb)
    expect(fetchOk).toHaveBeenCalledTimes(1)
  })

  it("releases the slot when onStart throws synchronously", () => {
    const requested = new Set<string>()
    const fetchMedia = jest.fn(async () => EMPTY_MEDIA)
    const cb: DubMediaCallbacks = {
      onStart: () => {
        throw new Error("onStart boom")
      },
      onSuccess: jest.fn(),
      onError: jest.fn(),
      onSettled: jest.fn(),
    }

    ensureDubMedia("dub-1", requested, fetchMedia, cb)

    // onStart threw before fetchMedia ran, so dispatched is false: error +
    // settled fire and the slot is released.
    expect(fetchMedia).not.toHaveBeenCalled()
    expect(cb.onError).toHaveBeenCalledWith("dub-1")
    expect(cb.onSettled).toHaveBeenCalledWith("dub-1")
    expect(requested.has("dub-1")).toBe(false)
  })
})
