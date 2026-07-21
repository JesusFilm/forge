import { parseVtt } from "../parseVtt"
import { deriveSentenceTiming } from "./sentenceTiming"
import {
  createSentenceTimingSource,
  resolveSentenceTimingWithinBudget,
} from "./sentenceTimingSource"

// A real slice of the Birth of Jesus English track — <b> tags intact to prove stripping,
// and two real sentence pauses so the derived timing is non-empty.
const FIXTURE_VTT = `WEBVTT

00:01.230 --> 00:06.630
<b>an orderly account of the things that have taken place among us,</b>

00:06.690 --> 00:11.630
<b>so that you may know the absolute truth about everything.</b>

00:18.550 --> 00:24.440
<b>when Herod the Great was king of Judea,</b>

00:24.490 --> 00:32.280
<b>And the virgin's name was Mary.</b>
`

type Subtitle = {
  vttSrc: string
  primary?: boolean
  aiGenerated?: boolean
  language: { slug: string } | null
}

function englishSub(
  vttSrc: string,
  overrides: Partial<Subtitle> = {},
): Subtitle {
  return {
    vttSrc,
    primary: true,
    aiGenerated: false,
    language: { slug: "english" },
    ...overrides,
  }
}

// A fake Apollo client whose subtitle query returns the given rows (or a per-slug URL).
function clientReturning(
  subtitles: unknown,
): Parameters<typeof createSentenceTimingSource>[0] {
  return {
    query: jest.fn(async () => ({
      data: {
        videoBySlug: {
          preferredPlayableDub: { videoEdition: { subtitles } },
        },
      },
    })),
  } as unknown as Parameters<typeof createSentenceTimingSource>[0]
}

function okFetch(text: string): jest.Mock {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => text,
  }))
}

const asFetch = (mock: jest.Mock) => mock as unknown as typeof fetch

describe("createSentenceTimingSource — happy path + cache (AE7)", () => {
  it("derives timing from the fetched vtt and serves the second call from cache", async () => {
    const fetchImpl = okFetch(FIXTURE_VTT)
    const source = createSentenceTimingSource(
      clientReturning([englishSub("https://cdn/a.vtt")]),
      { fetchImpl: asFetch(fetchImpl), cache: new Map() },
    )

    const first = await source("birth-of-jesus")
    expect(first).toEqual({
      ok: true,
      timing: deriveSentenceTiming(parseVtt(FIXTURE_VTT)),
    })

    const second = await source("birth-of-jesus")
    expect(second).toEqual(first)
    // A cache hit keyed by vttSrc means no refetch on the reel's loop-around.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe("createSentenceTimingSource — subtitle pick (KTD-2)", () => {
  it("prefers the primary English track, then a human track over an AI one", async () => {
    const fetchImpl = okFetch(FIXTURE_VTT)
    const source = createSentenceTimingSource(
      clientReturning([
        englishSub("https://cdn/ai.vtt", { primary: false, aiGenerated: true }),
        englishSub("https://cdn/human.vtt", { primary: false }),
        englishSub("https://cdn/primary.vtt"),
        englishSub("https://cdn/es.vtt", { language: { slug: "spanish" } }),
      ]),
      { fetchImpl: asFetch(fetchImpl), cache: new Map() },
    )

    await source("slug")
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://cdn/primary.vtt",
      expect.anything(),
    )
  })
})

describe("createSentenceTimingSource — no-subtitle", () => {
  it("returns no-subtitle when the edition has no English row", async () => {
    const fetchImpl = okFetch(FIXTURE_VTT)
    const source = createSentenceTimingSource(
      clientReturning([
        englishSub("https://cdn/es.vtt", { language: { slug: "spanish" } }),
      ]),
      { fetchImpl: asFetch(fetchImpl), cache: new Map() },
    )
    expect(await source("slug")).toEqual({ ok: false, reason: "no-subtitle" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("returns no-subtitle when the video has no English dub at all", async () => {
    const client = {
      query: jest.fn(async () => ({
        data: { videoBySlug: { preferredPlayableDub: null } },
      })),
    } as unknown as Parameters<typeof createSentenceTimingSource>[0]
    const source = createSentenceTimingSource(client, {
      fetchImpl: asFetch(okFetch(FIXTURE_VTT)),
      cache: new Map(),
    })
    expect(await source("slug")).toEqual({ ok: false, reason: "no-subtitle" })
  })

  it("returns no-subtitle and never fetches when the subtitle URL is unsafe", async () => {
    const fetchImpl = okFetch(FIXTURE_VTT)
    const source = createSentenceTimingSource(
      clientReturning([englishSub("javascript:alert(1)")]),
      { fetchImpl: asFetch(fetchImpl), cache: new Map() },
    )
    expect(await source("slug")).toEqual({ ok: false, reason: "no-subtitle" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("createSentenceTimingSource — fetch-failed", () => {
  it("returns fetch-failed when the subtitle query rejects", async () => {
    const client = {
      query: jest.fn(async () => {
        throw new Error("network down")
      }),
    } as unknown as Parameters<typeof createSentenceTimingSource>[0]
    const source = createSentenceTimingSource(client, {
      fetchImpl: asFetch(okFetch(FIXTURE_VTT)),
      cache: new Map(),
    })
    expect(await source("slug")).toEqual({ ok: false, reason: "fetch-failed" })
  })

  it("returns fetch-failed when the vtt fetch rejects", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("boom")
    })
    const source = createSentenceTimingSource(
      clientReturning([englishSub("https://cdn/a.vtt")]),
      { fetchImpl: asFetch(fetchImpl), cache: new Map() },
    )
    expect(await source("slug")).toEqual({ ok: false, reason: "fetch-failed" })
  })

  it("returns fetch-failed on a non-OK response", async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => "not found",
    }))
    const source = createSentenceTimingSource(
      clientReturning([englishSub("https://cdn/a.vtt")]),
      { fetchImpl: asFetch(fetchImpl), cache: new Map() },
    )
    expect(await source("slug")).toEqual({ ok: false, reason: "fetch-failed" })
  })

  it("returns fetch-failed on an oversize body", async () => {
    const oversize = "WEBVTT\n\n" + "x".repeat(1_500_001)
    const source = createSentenceTimingSource(
      clientReturning([englishSub("https://cdn/a.vtt")]),
      { fetchImpl: asFetch(okFetch(oversize)), cache: new Map() },
    )
    expect(await source("slug")).toEqual({ ok: false, reason: "fetch-failed" })
  })

  it("aborts the vtt fetch at the fetch deadline and reports fetch-failed", async () => {
    // Real (tiny) timer: fake timers can't intercept the AbortController path. The injected
    // fetch captures the signal and only settles when it aborts.
    let captured: AbortSignal | undefined
    const fetchImpl = jest.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          captured = opts.signal
          opts.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          )
        }),
    )
    const source = createSentenceTimingSource(
      clientReturning([englishSub("https://cdn/a.vtt")]),
      { fetchImpl: asFetch(fetchImpl), cache: new Map(), fetchDeadlineMs: 30 },
    )
    expect(await source("slug")).toEqual({ ok: false, reason: "fetch-failed" })
    expect(captured?.aborted).toBe(true)
  })
})

describe("createSentenceTimingSource — parse-empty", () => {
  it("returns parse-empty when the vtt has no cues", async () => {
    const source = createSentenceTimingSource(
      clientReturning([englishSub("https://cdn/a.vtt")]),
      {
        fetchImpl: asFetch(okFetch("WEBVTT\n\nnothing parseable here")),
        cache: new Map(),
      },
    )
    expect(await source("slug")).toEqual({ ok: false, reason: "parse-empty" })
  })
})

describe("createSentenceTimingSource — bounded cache (KTD-7)", () => {
  it("evicts the oldest entry past the cap without unbounded growth", async () => {
    const cache = new Map()
    const client = {
      query: jest.fn(
        async ({ variables }: { variables: { slug: string } }) => ({
          data: {
            videoBySlug: {
              preferredPlayableDub: {
                videoEdition: {
                  subtitles: [englishSub(`https://cdn/${variables.slug}.vtt`)],
                },
              },
            },
          },
        }),
      ),
    } as unknown as Parameters<typeof createSentenceTimingSource>[0]
    const source = createSentenceTimingSource(client, {
      fetchImpl: asFetch(okFetch(FIXTURE_VTT)),
      cache,
    })

    for (let i = 0; i < 10; i++) await source(`slug-${i}`)

    expect(cache.size).toBe(8)
    expect(cache.has("https://cdn/slug-0.vtt")).toBe(false) // oldest evicted
    expect(cache.has("https://cdn/slug-1.vtt")).toBe(false)
    expect(cache.has("https://cdn/slug-9.vtt")).toBe(true) // newest kept
  })
})

describe("resolveSentenceTimingWithinBudget — total budget (KTD-5/AE5)", () => {
  it("returns timeout when the acquisition never resolves inside the budget", async () => {
    // The reel must not stall on the chapter card: a never-resolving acquire yields the
    // fixed grid within a tiny real budget.
    const neverResolves = () => new Promise<never>(() => {})
    const result = await resolveSentenceTimingWithinBudget(neverResolves, 30)
    expect(result).toEqual({ timing: null, reason: "timeout" })
  })

  it("passes a resolved timing through untouched", async () => {
    const timing = deriveSentenceTiming(parseVtt(FIXTURE_VTT))
    const result = await resolveSentenceTimingWithinBudget(
      async () => ({ ok: true, timing }),
      1000,
    )
    expect(result).toEqual({ timing })
  })

  it("maps an acquisition failure reason straight through", async () => {
    const result = await resolveSentenceTimingWithinBudget(
      async () => ({ ok: false, reason: "no-subtitle" }),
      1000,
    )
    expect(result).toEqual({ timing: null, reason: "no-subtitle" })
  })
})
