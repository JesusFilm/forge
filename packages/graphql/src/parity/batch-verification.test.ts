import { describe, expect, it, vi } from "vitest"

import {
  BearerMissingError,
  FETCH_MAX_RETRIES,
  RateLimitExhaustedError,
  backoffDelayMs,
  buildReport,
  combineAllowLists,
  compareSlug,
  formatSummary,
  parseAllowListFile,
  parseArgs,
  postGraphQL,
  readBearerFromEnv,
  runBatchVerification,
  sanitizeError,
  stratifiedSample,
  type BatchReport,
  type CorpusEntry,
  type Fetchers,
  type SlugReport,
} from "./batch-verification"
import type { AdminExperienceLocaleInput } from "./normalize-admin"
import type { StrapiExperienceInput } from "./normalize-strapi"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ORIGIN = "https://cdn.example.com"

/**
 * Hand-rolled Strapi input. The `documentId` is shared with the
 * matching admin input below — production has them diverge (admin uses
 * cuid; Strapi uses documentId), but the divergence is suppressed by
 * the `/id` entry on DEFAULT_ALLOW_LIST. Tests that pass `allowList:
 * []` to isolate harness behavior would otherwise see /id as a value
 * diff. Using a shared id keeps the harness-logic tests focused on
 * what the harness adds, not on what the comparator already covers.
 */
function makeStrapiInput(
  slug: string,
  locale: string,
  overrides: Partial<StrapiExperienceInput> = {},
): StrapiExperienceInput {
  return {
    documentId: `shared-${slug}`,
    slug,
    locale,
    title: `Title for ${slug}`,
    metaDescription: "shared description",
    ogImage: null,
    blocks: [],
    ...overrides,
  }
}

function makeAdminInput(
  slug: string,
  locale: string,
  overrides: Partial<AdminExperienceLocaleInput> = {},
): AdminExperienceLocaleInput {
  return {
    id: `shared-${slug}`,
    slug,
    locale,
    title: `Title for ${slug}`,
    description: "shared description",
    ogImageUrl: null,
    blocks: [],
    ...overrides,
  }
}

function makeFetchers(args: {
  readonly corpus: ReadonlyArray<CorpusEntry>
  readonly strapi: Map<string, StrapiExperienceInput>
  readonly admin: Map<string, AdminExperienceLocaleInput>
  readonly strapiErrors?: Map<string, string>
  readonly adminErrors?: Map<string, string>
  readonly onFetchStart?: () => void
  readonly onFetchEnd?: () => void
}): Fetchers {
  return {
    enumerateCorpus: async () => args.corpus,
    fetchStrapi: async (slug, locale) => {
      args.onFetchStart?.()
      try {
        const err = args.strapiErrors?.get(`${slug}@${locale}`)
        if (err) throw new Error(err)
        const row = args.strapi.get(`${slug}@${locale}`)
        if (!row) throw new Error(`Strapi: not found: ${slug}@${locale}`)
        return row
      } finally {
        args.onFetchEnd?.()
      }
    },
    fetchAdmin: async (slug, locale) => {
      args.onFetchStart?.()
      try {
        const err = args.adminErrors?.get(`${slug}@${locale}`)
        if (err) throw new Error(err)
        const row = args.admin.get(`${slug}@${locale}`)
        if (!row) throw new Error(`admin: not found: ${slug}@${locale}`)
        return row
      } finally {
        args.onFetchEnd?.()
      }
    },
  }
}

// Deterministic RNG for sampling tests. Uses a basic LCG so the same
// seed produces the same sequence across test runs.
function seededRng(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("returns defaults for empty argv", () => {
    const args = parseArgs([])
    expect(args).toEqual({
      sample: null,
      concurrency: 5,
      out: null,
      allowList: null,
      since: null,
      anonymous: false,
      help: false,
    })
  })

  it("parses every flag", () => {
    const args = parseArgs([
      "--sample",
      "10",
      "--concurrency",
      "3",
      "--out",
      "out.json",
      "--allow-list",
      "allow.json",
      "--since",
      "2026-05-12T00:00:00Z",
      "--anonymous",
    ])
    expect(args.sample).toBe(10)
    expect(args.concurrency).toBe(3)
    expect(args.out).toBe("out.json")
    expect(args.allowList).toBe("allow.json")
    expect(args.since).toBe("2026-05-12T00:00:00Z")
    expect(args.anonymous).toBe(true)
  })

  it("rejects non-integer --sample", () => {
    expect(() => parseArgs(["--sample", "abc"])).toThrow(/positive integer/)
  })

  it("rejects zero --concurrency", () => {
    expect(() => parseArgs(["--concurrency", "0"])).toThrow(/positive integer/)
  })

  it("rejects malformed --since", () => {
    expect(() => parseArgs(["--since", "yesterday"])).toThrow(/ISO timestamp/)
  })

  it("rejects unrecognized flag", () => {
    expect(() => parseArgs(["--magic"])).toThrow(/unrecognized flag/)
  })

  it("sets help on --help or -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true)
    expect(parseArgs(["-h"]).help).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// readBearerFromEnv — the hard-fail-on-anonymous contract
// ---------------------------------------------------------------------------

describe("readBearerFromEnv", () => {
  it("returns null when --anonymous is set", () => {
    expect(readBearerFromEnv({}, true)).toBeNull()
  })

  it("throws BearerMissingError when env unset and --anonymous not passed", () => {
    expect(() => readBearerFromEnv({}, false)).toThrow(BearerMissingError)
  })

  it("error message names the self-DoS risk", () => {
    try {
      readBearerFromEnv({}, false)
    } catch (err) {
      expect((err as Error).message).toMatch(/self-DoS|public:\$\{ip\}/)
      return
    }
    throw new Error("expected throw")
  })

  it("returns first CSV entry, trimmed", () => {
    expect(
      readBearerFromEnv({ WEB_ADMIN_API_KEYS: " key-a , key-b " }, false),
    ).toBe("key-a")
  })

  it("throws when env value is only whitespace", () => {
    expect(() =>
      readBearerFromEnv({ WEB_ADMIN_API_KEYS: "   " }, false),
    ).toThrow(BearerMissingError)
  })

  it("throws when first CSV entry is empty", () => {
    expect(() =>
      readBearerFromEnv({ WEB_ADMIN_API_KEYS: ",key-b" }, false),
    ).toThrow(BearerMissingError)
  })
})

// ---------------------------------------------------------------------------
// sanitizeError — bearer redaction
// ---------------------------------------------------------------------------

describe("sanitizeError", () => {
  it("strips bearer from error message", () => {
    const msg = sanitizeError(
      new Error("HTTP 500: bad token sk-secret-12345"),
      "sk-secret-12345",
    )
    expect(msg).not.toContain("sk-secret-12345")
    expect(msg).toContain("[REDACTED]")
  })

  it("passes through when bearer is null", () => {
    const msg = sanitizeError(new Error("plain error"), null)
    expect(msg).toBe("Error: plain error")
  })

  it("handles non-Error throws", () => {
    expect(sanitizeError("oops", null)).toBe("oops")
    expect(sanitizeError(42, null)).toBe("42")
  })
})

// ---------------------------------------------------------------------------
// parseAllowListFile
// ---------------------------------------------------------------------------

describe("parseAllowListFile", () => {
  it("parses a valid array", () => {
    const raw = JSON.stringify([
      { path: "/foo", channel: "value", rationale: "see docs" },
    ])
    const entries = parseAllowListFile(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      path: "/foo",
      channel: "value",
      rationale: "see docs",
    })
  })

  it("rejects non-JSON", () => {
    expect(() => parseAllowListFile("not json")).toThrow(/valid JSON/)
  })

  it("rejects non-array root", () => {
    expect(() => parseAllowListFile("{}")).toThrow(/top-level JSON array/)
  })

  it("rejects entry with empty rationale", () => {
    const raw = JSON.stringify([
      { path: "/foo", channel: "value", rationale: "" },
    ])
    expect(() => parseAllowListFile(raw)).toThrow(/empty rationale/)
  })

  it("rejects invalid channel", () => {
    const raw = JSON.stringify([
      { path: "/foo", channel: "fake", rationale: "ok" },
    ])
    expect(() => parseAllowListFile(raw)).toThrow(/invalid channel/)
  })
})

// ---------------------------------------------------------------------------
// combineAllowLists
// ---------------------------------------------------------------------------

describe("combineAllowLists", () => {
  it("prepends DEFAULT_ALLOW_LIST to operator entries", () => {
    const combined = combineAllowLists([
      { path: "/custom", channel: "value", rationale: "operator note" },
    ])
    expect(combined.length).toBeGreaterThan(1)
    // The operator entry is last.
    expect(combined[combined.length - 1]).toEqual({
      path: "/custom",
      channel: "value",
      rationale: "operator note",
    })
  })

  it("returns DEFAULT only when operator list is empty", () => {
    const combined = combineAllowLists([])
    expect(combined.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// stratifiedSample
// ---------------------------------------------------------------------------

describe("stratifiedSample", () => {
  it("returns the corpus unchanged when sample >= corpus length", () => {
    const corpus = ["a", "b", "c"]
    expect(stratifiedSample(corpus, 10)).toEqual(corpus)
  })

  it("returns empty for sample <= 0", () => {
    expect(stratifiedSample(["a", "b"], 0)).toEqual([])
  })

  it("returns exactly `sample` entries", () => {
    const corpus = Array.from({ length: 100 }, (_, i) => `slug-${i}`)
    const sampled = stratifiedSample(corpus, 10, seededRng(42))
    expect(sampled).toHaveLength(10)
  })

  it("is deterministic for a given seed", () => {
    const corpus = Array.from({ length: 100 }, (_, i) => `slug-${i}`)
    const a = stratifiedSample(corpus, 30, seededRng(42))
    const b = stratifiedSample(corpus, 30, seededRng(42))
    expect(a).toEqual(b)
  })

  it("draws from the oldest band, middle, and newest band (no skew to one end)", () => {
    const corpus = Array.from({ length: 100 }, (_, i) => i)
    const sampled = stratifiedSample(corpus, 30, seededRng(7))
    const numbers = sampled as ReadonlyArray<number>
    // Expect at least one entry from the oldest third, one from middle, one from newest.
    const oldThird = numbers.some((n) => n < 33)
    const midThird = numbers.some((n) => n >= 33 && n < 66)
    const newThird = numbers.some((n) => n >= 66)
    expect(oldThird).toBe(true)
    expect(midThird).toBe(true)
    expect(newThird).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// compareSlug — happy path + per-side error edges
// ---------------------------------------------------------------------------

describe("compareSlug", () => {
  it("returns a clean report when both sides match", async () => {
    const entry: CorpusEntry = { slug: "happy", locale: "en", updatedAt: null }
    const fetchers = makeFetchers({
      corpus: [entry],
      strapi: new Map([[`happy@en`, makeStrapiInput("happy", "en")]]),
      admin: new Map([[`happy@en`, makeAdminInput("happy", "en")]]),
    })
    const report = await compareSlug(entry, {
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
    })
    expect(report.error).toBeUndefined()
    expect(report.structural.count).toBe(0)
    expect(report.value.count).toBe(0)
    expect(report.order.count).toBe(0)
    expect(report.semantic.count).toBe(0)
  })

  it("records 'admin missing' when admin fetch fails", async () => {
    const entry: CorpusEntry = { slug: "lost", locale: "en", updatedAt: null }
    const fetchers = makeFetchers({
      corpus: [entry],
      strapi: new Map([[`lost@en`, makeStrapiInput("lost", "en")]]),
      admin: new Map(),
      adminErrors: new Map([[`lost@en`, "admin missing"]]),
    })
    const report = await compareSlug(entry, {
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
    })
    expect(report.error).toEqual({
      side: "admin",
      message: "Error: admin missing",
    })
  })

  it("records 'both' when both sides fail", async () => {
    const entry: CorpusEntry = { slug: "gone", locale: "en", updatedAt: null }
    const fetchers = makeFetchers({
      corpus: [entry],
      strapi: new Map(),
      admin: new Map(),
      strapiErrors: new Map([[`gone@en`, "strapi 500"]]),
      adminErrors: new Map([[`gone@en`, "admin 500"]]),
    })
    const report = await compareSlug(entry, {
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
    })
    expect(report.error?.side).toBe("both")
    expect(report.error?.message).toContain("strapi 500")
    expect(report.error?.message).toContain("admin 500")
  })

  it("redacts the bearer from any per-fetch error message", async () => {
    const bearer = "sk-secret-7777"
    const entry: CorpusEntry = { slug: "leaky", locale: "en", updatedAt: null }
    const fetchers = makeFetchers({
      corpus: [entry],
      strapi: new Map([[`leaky@en`, makeStrapiInput("leaky", "en")]]),
      admin: new Map(),
      adminErrors: new Map([
        [`leaky@en`, `unauthorized — supplied ${bearer} not allowed`],
      ]),
    })
    const report = await compareSlug(entry, {
      fetchers,
      bearer,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
    })
    expect(report.error?.message).not.toContain(bearer)
    expect(report.error?.message).toContain("[REDACTED]")
  })

  it("records a value diff when titles differ", async () => {
    const entry: CorpusEntry = { slug: "diff", locale: "en", updatedAt: null }
    const fetchers = makeFetchers({
      corpus: [entry],
      strapi: new Map([
        [`diff@en`, makeStrapiInput("diff", "en", { title: "Strapi" })],
      ]),
      admin: new Map([
        [`diff@en`, makeAdminInput("diff", "en", { title: "Admin" })],
      ]),
    })
    const report = await compareSlug(entry, {
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
    })
    expect(report.value.count).toBe(1)
    expect(report.value.paths).toContain("/title")
  })

  it("applies the allow-list — listed diffs land in allowListed bucket, not value", async () => {
    const entry: CorpusEntry = { slug: "allow", locale: "en", updatedAt: null }
    const fetchers = makeFetchers({
      corpus: [entry],
      strapi: new Map([
        [`allow@en`, makeStrapiInput("allow", "en", { title: "Strapi" })],
      ]),
      admin: new Map([
        [`allow@en`, makeAdminInput("allow", "en", { title: "Admin" })],
      ]),
    })
    const report = await compareSlug(entry, {
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [
        {
          path: "/title",
          channel: "value",
          rationale: "test override",
        },
      ],
    })
    expect(report.value.count).toBe(0)
    expect(report.allowListed.count).toBe(1)
    expect(report.allowListed.paths).toContain("/title")
  })
})

// ---------------------------------------------------------------------------
// runBatchVerification — orchestration + concurrency + gate logic
// ---------------------------------------------------------------------------

describe("runBatchVerification", () => {
  it("PASSED gate when every slug is diff-free", async () => {
    const corpus: CorpusEntry[] = ["a", "b", "c"].map((slug) => ({
      slug,
      locale: "en",
      updatedAt: null,
    }))
    const strapi = new Map(
      corpus.map((c) => [
        `${c.slug}@${c.locale}`,
        makeStrapiInput(c.slug, c.locale),
      ]),
    )
    const admin = new Map(
      corpus.map((c) => [
        `${c.slug}@${c.locale}`,
        makeAdminInput(c.slug, c.locale),
      ]),
    )
    const fetchers = makeFetchers({ corpus, strapi, admin })
    const report = await runBatchVerification({
      args: parseArgs([]),
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
      now: () => new Date("2026-05-12T00:00:00Z"),
    })
    expect(report.gate).toBe("PASSED")
    expect(report.totals.slugs).toBe(3)
  })

  it("FAILED gate when any slug has a non-allow-listed diff", async () => {
    const corpus: CorpusEntry[] = [
      { slug: "ok", locale: "en", updatedAt: null },
      { slug: "drift", locale: "en", updatedAt: null },
    ]
    const strapi = new Map([
      [`ok@en`, makeStrapiInput("ok", "en")],
      [`drift@en`, makeStrapiInput("drift", "en", { title: "S" })],
    ])
    const admin = new Map([
      [`ok@en`, makeAdminInput("ok", "en")],
      [`drift@en`, makeAdminInput("drift", "en", { title: "A" })],
    ])
    const fetchers = makeFetchers({ corpus, strapi, admin })
    const report = await runBatchVerification({
      args: parseArgs([]),
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
      now: () => new Date("2026-05-12T00:00:00Z"),
    })
    expect(report.gate).toBe("FAILED")
    expect(report.totals.withValue).toBe(1)
  })

  it("FAILED gate when any slug has an error row (even with zero diffs elsewhere)", async () => {
    const corpus: CorpusEntry[] = [
      { slug: "good", locale: "en", updatedAt: null },
      { slug: "lost", locale: "en", updatedAt: null },
    ]
    const strapi = new Map([[`good@en`, makeStrapiInput("good", "en")]])
    const admin = new Map([[`good@en`, makeAdminInput("good", "en")]])
    const fetchers = makeFetchers({
      corpus,
      strapi,
      admin,
      strapiErrors: new Map([[`lost@en`, "strapi 500"]]),
      adminErrors: new Map([[`lost@en`, "admin 500"]]),
    })
    const report = await runBatchVerification({
      args: parseArgs([]),
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
      now: () => new Date("2026-05-12T00:00:00Z"),
    })
    expect(report.gate).toBe("FAILED")
    expect(report.totals.withErrors).toBe(1)
  })

  it("respects the concurrency cap — never more than N concurrent fetches", async () => {
    // 8 slugs, concurrency 3. Each fetch holds 20ms before resolving.
    let inFlight = 0
    let maxInFlight = 0
    const corpus: CorpusEntry[] = Array.from({ length: 8 }, (_, i) => ({
      slug: `s${i}`,
      locale: "en",
      updatedAt: null,
    }))
    const strapi = new Map(
      corpus.map((c) => [
        `${c.slug}@${c.locale}`,
        makeStrapiInput(c.slug, c.locale),
      ]),
    )
    const admin = new Map(
      corpus.map((c) => [
        `${c.slug}@${c.locale}`,
        makeAdminInput(c.slug, c.locale),
      ]),
    )

    // Wrap fetchers to count concurrent in-flight invocations across both sides.
    // The per-slug worker fetches Strapi THEN admin sequentially, but pLimit
    // controls how many slug-workers run in parallel. Track at the slug level.
    let slugInFlight = 0
    let maxSlugInFlight = 0
    const baseFetchers = makeFetchers({ corpus, strapi, admin })
    const wrapped: Fetchers = {
      enumerateCorpus: baseFetchers.enumerateCorpus,
      fetchStrapi: async (slug, locale) => {
        slugInFlight++
        maxSlugInFlight = Math.max(maxSlugInFlight, slugInFlight)
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise<void>((r) => setTimeout(r, 5))
        inFlight--
        return baseFetchers.fetchStrapi(slug, locale)
      },
      fetchAdmin: async (slug, locale) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise<void>((r) => setTimeout(r, 5))
        inFlight--
        const out = await baseFetchers.fetchAdmin(slug, locale)
        slugInFlight--
        return out
      },
    }

    await runBatchVerification({
      args: parseArgs(["--concurrency", "3"]),
      fetchers: wrapped,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
      now: () => new Date("2026-05-12T00:00:00Z"),
    })
    expect(maxSlugInFlight).toBeLessThanOrEqual(3)
  })

  it("applies --since filter to corpus", async () => {
    const corpus: CorpusEntry[] = [
      { slug: "old", locale: "en", updatedAt: "2025-01-01T00:00:00Z" },
      { slug: "new", locale: "en", updatedAt: "2026-05-12T12:00:00Z" },
    ]
    const strapi = new Map(
      corpus.map((c) => [
        `${c.slug}@${c.locale}`,
        makeStrapiInput(c.slug, c.locale),
      ]),
    )
    const admin = new Map(
      corpus.map((c) => [
        `${c.slug}@${c.locale}`,
        makeAdminInput(c.slug, c.locale),
      ]),
    )
    const fetchers = makeFetchers({ corpus, strapi, admin })
    const report = await runBatchVerification({
      args: parseArgs(["--since", "2026-01-01T00:00:00Z"]),
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
      now: () => new Date("2026-05-12T00:00:00Z"),
    })
    expect(report.totals.slugs).toBe(1)
    expect(report.slugs[0].slug).toBe("new")
  })

  it("does not crash when a slug fetcher throws (Promise.allSettled posture)", async () => {
    const corpus: CorpusEntry[] = [
      { slug: "a", locale: "en", updatedAt: null },
      { slug: "b", locale: "en", updatedAt: null },
    ]
    const fetchers: Fetchers = {
      enumerateCorpus: async () => corpus,
      fetchStrapi: async (slug, locale) =>
        slug === "a"
          ? makeStrapiInput(slug, locale)
          : Promise.reject(new Error("transient strapi")),
      fetchAdmin: async (slug, locale) =>
        slug === "a"
          ? makeAdminInput(slug, locale)
          : Promise.reject(new Error("transient admin")),
    }
    const report = await runBatchVerification({
      args: parseArgs([]),
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
      now: () => new Date("2026-05-12T00:00:00Z"),
    })
    expect(report.totals.slugs).toBe(2)
    expect(report.totals.withErrors).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 429 backoff + timeout — postGraphQL retry shape
// ---------------------------------------------------------------------------

describe("backoffDelayMs", () => {
  it("grows exponentially and caps at 30000", () => {
    expect(backoffDelayMs(0)).toBe(500)
    expect(backoffDelayMs(1)).toBe(1000)
    expect(backoffDelayMs(2)).toBe(2000)
    expect(backoffDelayMs(20)).toBe(30000)
  })
})

describe("postGraphQL — 429 backoff", () => {
  it("retries on 429 then succeeds on 200", async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls === 1) {
        return new Response("rate limited", { status: 429 })
      }
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
      })
    }) as unknown as typeof fetch

    const sleep = vi.fn(async () => undefined)
    const result = await postGraphQL({
      url: "https://example.test/graphql",
      query: "{ ok }",
      bearer: null,
      fetchImpl,
      sleep,
    })
    expect(result).toEqual({ data: { ok: true } })
    expect(calls).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it("throws RateLimitExhaustedError after FETCH_MAX_RETRIES consecutive 429s", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("rate limited", { status: 429 }),
    ) as unknown as typeof fetch
    const sleep = vi.fn(async () => undefined)
    await expect(
      postGraphQL({
        url: "https://example.test/graphql",
        query: "{ ok }",
        bearer: null,
        fetchImpl,
        sleep,
      }),
    ).rejects.toBeInstanceOf(RateLimitExhaustedError)
    // FETCH_MAX_RETRIES total attempts.
    expect(
      (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls
        .length,
    ).toBe(FETCH_MAX_RETRIES)
  })

  it("sets Authorization header when bearer is provided", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      const headers = (init as { headers: Record<string, string> }).headers
      expect(headers.Authorization).toBe("Bearer abc123")
      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }) as unknown as typeof fetch
    await postGraphQL({
      url: "https://example.test/graphql",
      query: "{}",
      bearer: "abc123",
      fetchImpl,
      sleep: async () => undefined,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("does not set Authorization header in anonymous mode", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init: unknown) => {
      const headers = (init as { headers: Record<string, string> }).headers
      expect(headers.Authorization).toBeUndefined()
      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }) as unknown as typeof fetch
    await postGraphQL({
      url: "https://example.test/graphql",
      query: "{}",
      bearer: null,
      fetchImpl,
      sleep: async () => undefined,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// formatSummary + buildReport
// ---------------------------------------------------------------------------

describe("buildReport", () => {
  it("counts a slug toward exactly the channels with positive count", () => {
    const slugs: SlugReport[] = [
      makeSlugReport({ structural: ["/a"] }),
      makeSlugReport({ value: ["/b"], structural: ["/c"] }),
    ]
    const report = buildReport("2026-05-12T00:00:00Z", slugs)
    expect(report.totals.withStructural).toBe(2)
    expect(report.totals.withValue).toBe(1)
    expect(report.gate).toBe("FAILED")
  })

  it("PASSED only when totals across all channels are zero AND no errors", () => {
    const slugs: SlugReport[] = [makeSlugReport({})]
    const report = buildReport("2026-05-12T00:00:00Z", slugs)
    expect(report.gate).toBe("PASSED")
  })
})

describe("formatSummary", () => {
  it("prints the gate verdict on the last line", () => {
    const report = buildReport("2026-05-12T00:00:00Z", [makeSlugReport({})])
    const text = formatSummary(report)
    expect(text).toMatch(/Gate: PASSED/)
  })
})

// ---------------------------------------------------------------------------
// JSON-shape snapshot — locks the downstream contract.
// ---------------------------------------------------------------------------

describe("report JSON shape — downstream contract", () => {
  it("matches the locked snapshot", async () => {
    // Deterministic two-slug fixture: one clean, one with a value diff.
    const corpus: CorpusEntry[] = [
      { slug: "clean", locale: "en", updatedAt: "2026-05-01T00:00:00Z" },
      { slug: "drift", locale: "en", updatedAt: "2026-05-02T00:00:00Z" },
    ]
    const strapi = new Map([
      [`clean@en`, makeStrapiInput("clean", "en")],
      [`drift@en`, makeStrapiInput("drift", "en", { title: "From Strapi" })],
    ])
    const admin = new Map([
      [`clean@en`, makeAdminInput("clean", "en")],
      [`drift@en`, makeAdminInput("drift", "en", { title: "From Admin" })],
    ])
    const fetchers = makeFetchers({ corpus, strapi, admin })
    const report = await runBatchVerification({
      args: parseArgs([]),
      fetchers,
      bearer: null,
      baseOrigin: BASE_ORIGIN,
      allowList: [],
      now: () => new Date("2026-05-12T00:00:00Z"),
    })
    // Strip timing values from the snapshot — they're nondeterministic
    // but the shape (the keys themselves) is what's load-bearing.
    const stripped = stripTimings(report)
    expect(stripped).toMatchInlineSnapshot(`
      {
        "gate": "FAILED",
        "generatedAt": "2026-05-12T00:00:00.000Z",
        "slugs": [
          {
            "allowListed": {
              "count": 0,
              "paths": [],
            },
            "locale": "en",
            "order": {
              "count": 0,
              "paths": [],
            },
            "semantic": {
              "count": 0,
              "paths": [],
            },
            "slug": "clean",
            "structural": {
              "count": 0,
              "paths": [],
            },
            "timingMs": "REDACTED",
            "value": {
              "count": 0,
              "paths": [],
            },
          },
          {
            "allowListed": {
              "count": 0,
              "paths": [],
            },
            "locale": "en",
            "order": {
              "count": 0,
              "paths": [],
            },
            "semantic": {
              "count": 0,
              "paths": [],
            },
            "slug": "drift",
            "structural": {
              "count": 0,
              "paths": [],
            },
            "timingMs": "REDACTED",
            "value": {
              "count": 1,
              "paths": [
                "/title",
              ],
            },
          },
        ],
        "totals": {
          "allowListed": 0,
          "slugs": 2,
          "withErrors": 0,
          "withOrder": 0,
          "withSemantic": 0,
          "withStructural": 0,
          "withValue": 1,
        },
      }
    `)
  })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeSlugReport(overrides: {
  readonly structural?: ReadonlyArray<string>
  readonly value?: ReadonlyArray<string>
  readonly order?: ReadonlyArray<string>
  readonly semantic?: ReadonlyArray<string>
  readonly allowListed?: ReadonlyArray<string>
  readonly error?: SlugReport["error"]
}): SlugReport {
  return {
    slug: "test",
    locale: "en",
    structural: {
      count: overrides.structural?.length ?? 0,
      paths: overrides.structural ?? [],
    },
    value: {
      count: overrides.value?.length ?? 0,
      paths: overrides.value ?? [],
    },
    order: {
      count: overrides.order?.length ?? 0,
      paths: overrides.order ?? [],
    },
    semantic: {
      count: overrides.semantic?.length ?? 0,
      paths: overrides.semantic ?? [],
    },
    allowListed: {
      count: overrides.allowListed?.length ?? 0,
      paths: overrides.allowListed ?? [],
    },
    timingMs: { strapi: 0, admin: 0, compare: 0 },
    error: overrides.error,
  }
}

/**
 * Strip the per-slug `timingMs` block from a BatchReport for snapshot
 * purposes — timings are nondeterministic but the surrounding shape is.
 */
function stripTimings(report: BatchReport): unknown {
  return {
    ...report,
    slugs: report.slugs.map((s) => {
      // Sort keys for stable snapshot ordering, drop timings entirely.
      const out: Record<string, unknown> = {}
      const keys = Object.keys(s).sort()
      for (const k of keys) {
        if (k === "timingMs") {
          out[k] = "REDACTED"
          continue
        }
        if (k === "error" && s.error === undefined) continue
        out[k] = (s as unknown as Record<string, unknown>)[k]
      }
      return out
    }),
  }
}
