/**
 * The shared cue cache (KTD20): one fetch and one parse per network track,
 * a byte cap enforced during the read, transient and definitive failures,
 * LRU eviction with pins, and derived data that leaves with its track.
 */

import {
  VTT_CACHE_MAX_TRACKS,
  VTT_FETCH_TIMEOUT_MS,
  VTT_MAX_BYTES,
  getVttDerived,
  loadVttCues,
  peekVttCues,
  pinVtt,
  resetVttCacheForTests,
  setVttDerived,
  vttDerivedKey,
  type VttLoadResult,
} from "../vttCache"

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>()
const originalFetch = globalThis.fetch
const encoder = new TextEncoder()
const CHUNK = 64 * 1024

function url(n: number): string {
  return `https://cdn.example.com/subtitles/track-${n}.vtt`
}

function vtt(text = "Hello world"): string {
  return `WEBVTT

00:00:01.000 --> 00:00:04.000
${text}`
}

function callsFor(src: string): number {
  return fetchMock.mock.calls.filter(([called]) => called === src).length
}

function signalOf(call: number): AbortSignal {
  const signal = fetchMock.mock.calls[call]?.[1]?.signal
  if (!signal) throw new Error(`fetch call ${call} had no signal`)
  return signal
}

function firstText(result: VttLoadResult): string | undefined {
  return result.ok ? result.cues[0]?.text : undefined
}

// A fetch the test settles by hand. It rejects on abort, as a real fetch does.
function controlledFetch() {
  let resolve!: (response: Response) => void
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise<Response>((done, reject) => {
        resolve = done
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
      }),
  )
  return { resolve: (response: Response) => resolve(response) }
}

// Serves `bytes` in fixed chunks, so a chunk edge can split a character.
function chunkedResponse(bytes: Uint8Array): Response {
  let offset = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close()
          return
        }
        controller.enqueue(bytes.subarray(offset, offset + CHUNK))
        offset += CHUNK
      },
    }),
  )
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  resetVttCacheForTests()
  fetchMock.mockReset()
  fetchMock.mockImplementation((src) => Promise.resolve(new Response(vtt(src))))
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.useRealTimers()
})

afterAll(() => {
  resetVttCacheForTests()
  globalThis.fetch = originalFetch
})

describe("loadVttCues — loading and sharing", () => {
  it("loads a network track as cues sorted by start, with its byte size", async () => {
    const body = `WEBVTT

00:00:10.000 --> 00:00:12.000
Later

00:00:02.000 --> 00:00:04.000
Earlier`
    fetchMock.mockResolvedValueOnce(new Response(body))

    const result = await loadVttCues(url(1))

    expect(result).toEqual({
      ok: true,
      cues: [
        { start: 2, end: 4, text: "Earlier" },
        { start: 10, end: 12, text: "Later" },
      ],
      bytes: encoder.encode(body).byteLength,
    })
  })

  it("moves a track that starts at 01:00:05 to 00:00:05", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("WEBVTT\n\n01:00:05.000 --> 01:00:08.000\nBroadcast"),
    )
    const result = await loadVttCues(url(1))
    expect(result.ok && result.cues).toEqual([
      { start: 5, end: 8, text: "Broadcast" },
    ])
  })

  it("serves a later call from the cache with the same parsed cues", async () => {
    const first = await loadVttCues(url(1))
    const second = await loadVttCues(url(1))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.ok && second.ok).toBe(true)
    expect(second.ok && second.cues).toBe(first.ok && first.cues)
    expect(peekVttCues(url(1))).toBe(first.ok && first.cues)
  })

  it("gives two readers of one source one fetch and one parse", async () => {
    const [a, b] = await Promise.all([
      loadVttCues(url(1)),
      loadVttCues(url(1), { signal: new AbortController().signal }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a.ok && b.ok).toBe(true)
    expect(a.ok && a.cues).toBe(b.ok && b.cues)
  })

  it("does not cancel a shared fetch when one reader aborts", async () => {
    const response = controlledFetch()
    const engine = loadVttCues(url(1))
    const overlay = new AbortController()
    const overlayRead = loadVttCues(url(1), { signal: overlay.signal })

    overlay.abort()
    await expect(overlayRead).resolves.toEqual({
      ok: false,
      reason: "aborted",
      definitive: false,
      bytes: 0,
    })
    expect(signalOf(0).aborted).toBe(false)

    response.resolve(new Response(vtt("Shared")))
    expect(firstText(await engine)).toBe("Shared")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps a fetch going while any reader with a signal remains", async () => {
    const response = controlledFetch()
    const first = new AbortController()
    const second = new AbortController()
    const firstRead = loadVttCues(url(1), { signal: first.signal })
    const secondRead = loadVttCues(url(1), { signal: second.signal })

    first.abort()
    await expect(firstRead).resolves.toMatchObject({ reason: "aborted" })
    expect(signalOf(0).aborted).toBe(false)

    response.resolve(new Response(vtt("Still wanted")))
    expect(firstText(await secondRead)).toBe("Still wanted")
  })

  it("cancels the fetch when its last reader aborts, and the next call fetches again", async () => {
    controlledFetch()
    const reader = new AbortController()
    const read = loadVttCues(url(1), { signal: reader.signal })

    reader.abort()
    await expect(read).resolves.toMatchObject({ reason: "aborted" })
    expect(signalOf(0).aborted).toBe(true)

    expect(firstText(await loadVttCues(url(1)))).toBe(url(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns aborted at once for a signal that is already aborted", async () => {
    const reader = new AbortController()
    reader.abort()
    await expect(
      loadVttCues(url(1), { signal: reader.signal }),
    ).resolves.toMatchObject({ reason: "aborted", definitive: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not let a flight that its readers left overwrite the next flight", async () => {
    // This fetch ignores the abort and resolves late, after a new flight began.
    let resolveOld!: (response: Response) => void
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((done) => (resolveOld = done)),
    )
    const reader = new AbortController()
    const abandoned = loadVttCues(url(1), { signal: reader.signal })
    reader.abort()
    await abandoned

    const next = controlledFetch()
    const current = loadVttCues(url(1))
    next.resolve(new Response(vtt("New")))
    expect(firstText(await current)).toBe("New")

    // The abandoned flight lands last, so only the identity check keeps "New".
    resolveOld(new Response(vtt("Old")))
    await flushMicrotasks()
    expect(firstText(await loadVttCues(url(1)))).toBe("New")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("loadVttCues — unsafe and downloaded sources", () => {
  it.each([
    "ftp://cdn.example.com/track.vtt",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s without a fetch", async (src) => {
    await expect(loadVttCues(src)).resolves.toEqual({
      ok: false,
      reason: "unsafe_url",
      definitive: true,
      bytes: 0,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("never lets a downloaded file: track into the cache", async () => {
    for (let n = 1; n <= VTT_CACHE_MAX_TRACKS; n++) await loadVttCues(url(n))

    const fileSrc = "file:///docs/offline-downloads/jesus/en.vtt"
    await expect(loadVttCues(fileSrc)).resolves.toMatchObject({
      reason: "unsafe_url",
    })
    expect(peekVttCues(fileSrc)).toBeUndefined()

    // All twelve network tracks are still cached, so the file took no slot.
    for (let n = 1; n <= VTT_CACHE_MAX_TRACKS; n++) {
      expect(peekVttCues(url(n))).toBeDefined()
    }
    expect(fetchMock).toHaveBeenCalledTimes(VTT_CACHE_MAX_TRACKS)
  })
})

describe("loadVttCues — failures", () => {
  it("times out at 8 s as a transient failure, and a later call fetches again", async () => {
    jest.useFakeTimers()
    controlledFetch()
    let settled = false
    const read = loadVttCues(url(1)).then((result) => {
      settled = true
      return result
    })

    jest.advanceTimersByTime(VTT_FETCH_TIMEOUT_MS - 1)
    await flushMicrotasks()
    expect(settled).toBe(false)
    expect(signalOf(0).aborted).toBe(false)

    jest.advanceTimersByTime(1)
    await expect(read).resolves.toEqual({
      ok: false,
      reason: "timeout",
      definitive: false,
      bytes: 0,
    })
    expect(signalOf(0).aborted).toBe(true)

    jest.useRealTimers()
    expect((await loadVttCues(url(1))).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    [404, true],
    [403, true],
    [410, true],
    [408, false],
    [429, false],
    [500, false],
    [503, false],
  ])(
    "treats a %i as definitive=%s, and fetches again only when transient",
    async (status, definitive) => {
      fetchMock.mockResolvedValueOnce(new Response("error page", { status }))

      await expect(loadVttCues(url(1))).resolves.toEqual({
        ok: false,
        reason: `http_${status}`,
        definitive,
        bytes: 0,
      })
      await loadVttCues(url(1))
      expect(fetchMock).toHaveBeenCalledTimes(definitive ? 1 : 2)
    },
  )

  it("treats a network error as transient", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"))

    await expect(loadVttCues(url(1))).resolves.toEqual({
      ok: false,
      reason: "network_error",
      definitive: false,
      bytes: 0,
    })
    expect((await loadVttCues(url(1))).ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("treats a track with no cues as definitive and does not fetch it again", async () => {
    const body = "WEBVTT\n\nNOTE nothing here\n"
    fetchMock.mockResolvedValueOnce(new Response(body))

    await expect(loadVttCues(url(1))).resolves.toEqual({
      ok: false,
      reason: "parse_empty",
      definitive: true,
      bytes: encoder.encode(body).byteLength,
    })
    await expect(loadVttCues(url(1))).resolves.toMatchObject({
      reason: "parse_empty",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("loadVttCues — byte cap", () => {
  it("cancels the reader of a body over the cap and fails definitively", async () => {
    let cancelled = false
    const chunk = new Uint8Array(CHUNK).fill(0x61)
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          // Endless: only a cancel can stop this body.
          pull(controller) {
            controller.enqueue(chunk)
          },
          cancel() {
            cancelled = true
          },
        }),
      ),
    )

    const result = await loadVttCues(url(1))

    expect(cancelled).toBe(true)
    expect(result).toMatchObject({
      ok: false,
      reason: "over_cap",
      definitive: true,
    })
    expect(result.bytes).toBeGreaterThan(VTT_MAX_BYTES)
    expect(result.bytes).toBeLessThanOrEqual(VTT_MAX_BYTES + CHUNK)
    await loadVttCues(url(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("loads a near-cap body of 3-byte characters split across chunks", async () => {
    const header = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n"
    const count = Math.floor(
      (VTT_MAX_BYTES - encoder.encode(header).byteLength) / 3,
    )
    const text = "あ".repeat(count)
    const bytes = encoder.encode(header + text)
    expect(bytes.byteLength).toBeGreaterThan(VTT_MAX_BYTES - 3)
    // 64 KiB is not a multiple of 3, so chunk edges split characters.
    fetchMock.mockResolvedValueOnce(chunkedResponse(bytes))

    const result = await loadVttCues(url(1))

    expect(result.ok && result.bytes).toBe(bytes.byteLength)
    expect(firstText(result) === text).toBe(true)
  })

  it("loads a body of exactly the cap and refuses one byte more", async () => {
    const header = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n"
    const fill = VTT_MAX_BYTES - encoder.encode(header).byteLength
    fetchMock.mockResolvedValueOnce(
      chunkedResponse(encoder.encode(header + "x".repeat(fill))),
    )
    fetchMock.mockResolvedValueOnce(
      chunkedResponse(encoder.encode(header + "x".repeat(fill + 1))),
    )

    expect(await loadVttCues(url(1))).toMatchObject({
      ok: true,
      bytes: VTT_MAX_BYTES,
    })
    expect(await loadVttCues(url(2))).toMatchObject({
      reason: "over_cap",
      bytes: VTT_MAX_BYTES + 1,
    })
  })

  it("applies the same cap to a response with no body stream", async () => {
    // RN's own fetch (the EXPO_PUBLIC_USE_RN_FETCH opt-out) has no stream.
    function noStream(body: string): Response {
      const buffer = encoder.encode(body).buffer
      return {
        ok: true,
        status: 200,
        body: null,
        arrayBuffer: () => Promise.resolve(buffer),
      } as unknown as Response
    }
    fetchMock.mockResolvedValueOnce(noStream(vtt("Buffered")))
    fetchMock.mockResolvedValueOnce(noStream("x".repeat(VTT_MAX_BYTES + 1)))

    expect(firstText(await loadVttCues(url(1)))).toBe("Buffered")
    expect(await loadVttCues(url(2))).toMatchObject({
      reason: "over_cap",
      definitive: true,
    })
  })
})

describe("eviction, pins, and derived data", () => {
  async function loadRange(from: number, to: number) {
    for (let n = from; n <= to; n++) await loadVttCues(url(n))
  }

  it("evicts the least recently used track when the 13th arrives", async () => {
    await loadRange(1, VTT_CACHE_MAX_TRACKS)
    await loadVttCues(url(1)) // now the most recent
    await loadVttCues(url(13))

    expect(peekVttCues(url(1))).toBeDefined()
    expect(peekVttCues(url(2))).toBeUndefined()
    expect(peekVttCues(url(13))).toBeDefined()

    await loadVttCues(url(2))
    expect(callsFor(url(2))).toBe(2)
    expect(callsFor(url(1))).toBe(1)
  })

  it("keeps a pinned track when it is the oldest", async () => {
    pinVtt(url(1))
    await loadRange(1, VTT_CACHE_MAX_TRACKS + 1)

    expect(peekVttCues(url(1))).toBeDefined()
    expect(peekVttCues(url(2))).toBeUndefined()
    await loadVttCues(url(1))
    expect(callsFor(url(1))).toBe(1)
  })

  it("lets a released track be evicted again", async () => {
    const release = pinVtt(url(1))
    await loadRange(1, VTT_CACHE_MAX_TRACKS)
    release()
    await loadVttCues(url(13))

    expect(peekVttCues(url(1))).toBeUndefined()
    expect(peekVttCues(url(2))).toBeDefined()
  })

  it("counts pins, and a second call to one release does nothing", async () => {
    const releaseA = pinVtt(url(1))
    pinVtt(url(1))
    await loadRange(1, VTT_CACHE_MAX_TRACKS)
    releaseA()
    releaseA()
    await loadVttCues(url(13))

    expect(peekVttCues(url(1))).toBeDefined()
  })

  it("never evicts a track that is still loading", async () => {
    const pending = controlledFetch()
    const read = loadVttCues(url(1))
    await loadRange(2, VTT_CACHE_MAX_TRACKS + 1)

    pending.resolve(new Response(vtt("Arrived")))
    expect(firstText(await read)).toBe("Arrived")
    expect(peekVttCues(url(1))).toBeDefined()
    expect(peekVttCues(url(2))).toBeUndefined()
  })

  it("stores derived data on a loaded track, one slot per key name", async () => {
    const starts = vttDerivedKey<number[]>("eligible-starts:v1")
    const nextVersion = vttDerivedKey<number[]>("eligible-starts:v2")
    await loadVttCues(url(1))

    expect(getVttDerived(url(1), starts)).toBeUndefined()
    expect(setVttDerived(url(1), starts, [5, 12])).toBe(true)
    expect(setVttDerived(url(1), nextVersion, [7])).toBe(true)
    expect(getVttDerived(url(1), starts)).toEqual([5, 12])
    expect(getVttDerived(url(1), nextVersion)).toEqual([7])
  })

  it("stores no derived data on a track that is missing, loading, or failed", async () => {
    const starts = vttDerivedKey<number[]>("eligible-starts:v1")
    expect(setVttDerived(url(1), starts, [1])).toBe(false)

    controlledFetch()
    void loadVttCues(url(2))
    expect(setVttDerived(url(2), starts, [1])).toBe(false)

    fetchMock.mockResolvedValueOnce(new Response("gone", { status: 404 }))
    await loadVttCues(url(3))
    expect(setVttDerived(url(3), starts, [1])).toBe(false)
    expect(getVttDerived(url(3), starts)).toBeUndefined()
  })

  it("drops the derived data when its track is evicted", async () => {
    const starts = vttDerivedKey<number[]>("eligible-starts:v1")
    await loadVttCues(url(1))
    setVttDerived(url(1), starts, [5, 12])

    await loadRange(2, VTT_CACHE_MAX_TRACKS + 1)
    expect(getVttDerived(url(1), starts)).toBeUndefined()

    await loadVttCues(url(1))
    expect(callsFor(url(1))).toBe(2)
    expect(getVttDerived(url(1), starts)).toBeUndefined()
  })
})
