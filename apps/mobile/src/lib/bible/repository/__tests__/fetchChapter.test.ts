// The chapter body is a real bible.helloao.org response (gue_wbt JHN 3).
// Streams and responses are the runtime's own classes, so a cancel is real.
import {
  CHAPTER_FETCH_TIMEOUT_MS,
  CHAPTER_MAX_BYTES,
  chapterUrl,
  fetchChapter,
  type FetchLike,
} from "../fetchChapter"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

const JHN_3 = fs.readFileSync(
  `${__dirname}/fixtures/gue_wbt-JHN-3.json`,
  "utf8",
)
const ADDRESS = { translationId: "gue_wbt", bookId: "JHN", chapter: 3 } as const
const URL_JHN_3 = "https://bible.helloao.org/api/gue_wbt/JHN/3.json"

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function respondWith(response: Response): FetchLike {
  return async () => response
}

// A response whose `body` IS the stream, as expo/fetch gives it. The jest
// `Response` wraps a stream and hangs a cancel while a read is pending.
function withBody(stream: ReadableStream<Uint8Array>): Response {
  return {
    ok: true,
    status: 200,
    body: stream,
    headers: new Headers(),
  } as unknown as Response
}

/** A stream of fixed chunks that records a cancel. */
function chunkedStream(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>
  cancelled: () => boolean
} {
  let cancelled = false
  let index = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      index += 1
      if (chunk === undefined) controller.close()
      else controller.enqueue(chunk)
    },
    cancel() {
      cancelled = true
    },
  })
  return { stream, cancelled: () => cancelled }
}

/** A JSON body padded with spaces to an exact byte length. */
function paddedTo(byteLength: number): string {
  const pad = byteLength - encode(JHN_3).byteLength
  return JHN_3 + " ".repeat(pad)
}

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("chapterUrl", () => {
  it("builds the bible.helloao.org path for one chapter", () => {
    expect(chapterUrl(ADDRESS)).toBe(URL_JHN_3)
  })
})

describe("fetchChapter", () => {
  it("returns the normalized chapter from a good response", async () => {
    const fetchImpl = jest.fn<Promise<Response>, Parameters<FetchLike>>(
      async () => new Response(JHN_3, { status: 200 }),
    )

    const result = await fetchChapter(ADDRESS, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(URL_JHN_3)
    expect(fetchImpl.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
    if (result.status !== "ok") throw new Error(result.reason)
    expect(result.text.translationId).toBe("gue_wbt")
    expect(result.text.bookId).toBe("JHN")
    expect(result.text.chapter.number).toBe(3)
    expect(result.text.chapter.verses.length).toBeGreaterThan(0)
  })

  it("returns offline when the request does not reach the server", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("Network request failed")
    }
    await expect(fetchChapter(ADDRESS, { fetchImpl })).resolves.toEqual({
      status: "failed",
      reason: "offline",
    })
  })

  it("returns not-found for a 404 and cancels the error body", async () => {
    const body = chunkedStream([encode("<html>not found</html>")])
    const result = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(new Response(body.stream, { status: 404 })),
    })

    expect(result).toEqual({
      status: "failed",
      reason: "not-found",
      httpStatus: 404,
    })
    expect(body.cancelled()).toBe(true)
  })

  it("returns http-status with the code for another failure", async () => {
    const result = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(new Response("busy", { status: 503 })),
    })
    expect(result).toEqual({
      status: "failed",
      reason: "http-status",
      httpStatus: 503,
    })
  })

  it("returns timeout at 8 seconds and aborts the request", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] })
    let signal: AbortSignal | undefined
    // A request that ignores the abort: only the time limit can end it.
    const fetchImpl: FetchLike = (_url, init) => {
      signal = init.signal
      return new Promise<Response>(() => {})
    }
    let settled: unknown
    void fetchChapter(ADDRESS, { fetchImpl }).then((result) => {
      settled = result
    })

    await jest.advanceTimersByTimeAsync(CHAPTER_FETCH_TIMEOUT_MS - 1)
    expect(settled).toBeUndefined()
    expect(signal?.aborted).toBe(false)

    await jest.advanceTimersByTimeAsync(1)
    expect(CHAPTER_FETCH_TIMEOUT_MS).toBe(8_000)
    expect(settled).toEqual({ status: "failed", reason: "timeout" })
    expect(signal?.aborted).toBe(true)
  })

  it("cancels a body that stalls past the time limit", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] })
    let cancelled = false
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel() {
        cancelled = true
      },
    })
    let settled: unknown
    void fetchChapter(ADDRESS, {
      fetchImpl: respondWith(withBody(stalled)),
    }).then((result) => {
      settled = result
    })

    await jest.advanceTimersByTimeAsync(CHAPTER_FETCH_TIMEOUT_MS)

    expect(settled).toEqual({ status: "failed", reason: "timeout" })
    expect(cancelled).toBe(true)
  })

  it("cancels the stream past 512 KB and returns too-large", async () => {
    let cancelled = false
    let pulled = 0
    const chunk = new Uint8Array(64 * 1024).fill(0x20)
    // Without the cap, this body never ends.
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    })

    const result = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(withBody(endless)),
    })

    expect(CHAPTER_MAX_BYTES).toBe(512 * 1024)
    expect(result).toEqual({ status: "failed", reason: "too-large" })
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThanOrEqual(CHAPTER_MAX_BYTES + 4 * chunk.length)
  })

  it("accepts a body of exactly 512 KB, and refuses one byte more", async () => {
    const atCap = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(
        new Response(paddedTo(CHAPTER_MAX_BYTES), { status: 200 }),
      ),
    })
    expect(atCap.status).toBe("ok")

    const overCap = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(
        new Response(paddedTo(CHAPTER_MAX_BYTES + 1), { status: 200 }),
      ),
    })
    expect(overCap).toEqual({ status: "failed", reason: "too-large" })
  })

  it("joins chunks that split a three-byte character", async () => {
    const source = JSON.stringify({
      translation: { id: "gue_wbt", textDirection: "ltr" },
      book: { id: "JHN", name: "John" },
      chapter: {
        number: 3,
        content: [{ type: "verse", number: 1, content: ["あいう"] }],
      },
    })
    const all = encode(source)
    const split = all.indexOf(0xe3) + 1
    const body = chunkedStream([all.slice(0, split), all.slice(split)])

    const result = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(new Response(body.stream, { status: 200 })),
    })

    if (result.status !== "ok") throw new Error(result.reason)
    expect(result.text.chapter.verses[0]?.lines[0]?.text).toBe("あいう")
  })

  it("returns malformed-text for a body that is not JSON, with no log", async () => {
    const logs = [
      jest.spyOn(console, "log").mockImplementation(() => {}),
      jest.spyOn(console, "warn").mockImplementation(() => {}),
      jest.spyOn(console, "error").mockImplementation(() => {}),
    ]

    const result = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(
        new Response('{"secret body text', { status: 200 }),
      ),
    })

    expect(result).toEqual({ status: "failed", reason: "malformed-text" })
    for (const log of logs) expect(log).not.toHaveBeenCalled()
  })

  it("returns malformed-text for a chapter that U1 refuses", async () => {
    const result = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(new Response('{"chapter": {}}', { status: 200 })),
    })
    expect(result).toEqual({ status: "failed", reason: "malformed-text" })
  })

  it("returns malformed-text for a response about another chapter", async () => {
    const result = await fetchChapter(
      { ...ADDRESS, chapter: 4 },
      { fetchImpl: respondWith(new Response(JHN_3, { status: 200 })) },
    )
    expect(result).toEqual({ status: "failed", reason: "malformed-text" })
  })

  it("checks the declared length when a response has no body stream", async () => {
    // RN's older fetch gives no `body`. The fallback reads the whole body,
    // so it refuses a declared length past the cap before it reads.
    const arrayBuffer = jest.fn(async () => encode(JHN_3).buffer)
    function streamless(contentLength: number): Response {
      return {
        ok: true,
        status: 200,
        body: null,
        headers: new Headers({ "content-length": String(contentLength) }),
        arrayBuffer,
      } as unknown as Response
    }

    const tooLarge = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(streamless(CHAPTER_MAX_BYTES + 1)),
    })
    expect(tooLarge).toEqual({ status: "failed", reason: "too-large" })
    expect(arrayBuffer).not.toHaveBeenCalled()

    const fits = await fetchChapter(ADDRESS, {
      fetchImpl: respondWith(streamless(encode(JHN_3).byteLength)),
    })
    expect(fits.status).toBe("ok")
  })
})
