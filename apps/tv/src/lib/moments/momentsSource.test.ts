import {
  __resetMomentsCacheForTests,
  MOMENTS_QUERY_DEADLINE_MS,
  loadVideoMoments,
  parseMomentRows,
} from "./momentsSource"

// A minimal client double: only `query` is consulted. Typed loosely on
// purpose — the source's type-only client import means jest never loads the
// real Apollo module.
function clientReturning(data: unknown) {
  return {
    query: jest.fn(async () => ({ data })),
  } as unknown as Parameters<typeof loadVideoMoments>[0]["client"]
}

beforeEach(() => {
  __resetMomentsCacheForTests()
})

describe("parseMomentRows", () => {
  it("returns [] for non-arrays and narrows rows defensively", () => {
    expect(parseMomentRows(null)).toEqual([])
    expect(parseMomentRows({})).toEqual([])
    const parsed = parseMomentRows([
      null,
      "junk",
      {
        startSeconds: 30,
        endSeconds: "sixty",
        summary: "",
        bibleVerses: ["John 3:16", 42],
      },
    ])
    expect(parsed).toEqual([
      {
        startSeconds: 30,
        endSeconds: null,
        summary: null,
        bibleVerses: ["John 3:16"],
      },
    ])
  })
})

describe("loadVideoMoments", () => {
  const TIMED = {
    videoBySlug: {
      documentId: "v1",
      moments: [
        { startSeconds: 10, endSeconds: 40, summary: "One", bibleVerses: [] },
        { startSeconds: 90, endSeconds: null, summary: "Two", bibleVerses: [] },
      ],
    },
  }

  it("classifies fetched rows and caches per (slug, language)", async () => {
    const client = clientReturning(TIMED)
    const first = await loadVideoMoments({ client, slug: "jesus" })
    expect(first).toMatchObject({
      ok: true,
      classification: { kind: "timed" },
    })

    const second = await loadVideoMoments({ client, slug: "jesus" })
    expect(second).toEqual(first)
    expect(
      (client as unknown as { query: jest.Mock }).query,
    ).toHaveBeenCalledTimes(1)
  })

  it("keys the cache on language too — a dub switch is not a cache hit", async () => {
    const client = clientReturning(TIMED)
    await loadVideoMoments({ client, slug: "jesus" })
    await loadVideoMoments({ client, slug: "jesus", languageSlug: "spanish" })
    expect(
      (client as unknown as { query: jest.Mock }).query,
    ).toHaveBeenCalledTimes(2)
  })

  it("maps a missing video / empty moments to the empty classification", async () => {
    const result = await loadVideoMoments({
      client: clientReturning({ videoBySlug: null }),
      slug: "nope",
    })
    expect(result).toEqual({
      ok: true,
      classification: { kind: "empty" },
    })
  })

  it("returns fetch-failed on a rejected query, and does NOT cache it", async () => {
    const failing = {
      query: jest.fn(async () => {
        throw new Error("network down")
      }),
    } as unknown as Parameters<typeof loadVideoMoments>[0]["client"]

    const result = await loadVideoMoments({ client: failing, slug: "jesus" })
    expect(result).toEqual({ ok: false, reason: "fetch-failed" })

    // Recovery: the next open retries rather than serving a cached failure.
    const ok = await loadVideoMoments({
      client: clientReturning(TIMED),
      slug: "jesus",
    })
    expect(ok.ok).toBe(true)
  })

  it("classifies a timeout distinctly, with a real (tiny) deadline", async () => {
    // Real timers on a never-resolving query: the withTimeout race is the
    // mechanism under test and fake timers cannot intercept it faithfully.
    expect(MOMENTS_QUERY_DEADLINE_MS).toBeGreaterThan(0)
    const hanging = {
      query: jest.fn(() => new Promise(() => {})),
    } as unknown as Parameters<typeof loadVideoMoments>[0]["client"]

    const result = await loadVideoMoments({ client: hanging, slug: "jesus" })
    expect(result).toEqual({ ok: false, reason: "timeout" })
  }, 15000)
})
