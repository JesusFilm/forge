import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PUBLIC_WATCH_LANGUAGE_SLUGS } from "@forge/watch-url-policy/routes"

import { proxy } from "./proxy"
import {
  canWatchRouteManifestProveMiss,
  clearWatchRouteManifestCache,
  getWatchRouteManifest,
  setWatchRouteManifestSourceForTest,
  type WatchRouteManifest,
} from "./lib/watch-route-manifest"

// Real proxy + real manifest fetch/parser/cache. Only the upstream transport
// and clock are synthetic; no source override bypasses cache freshness.
const START = Date.parse("2026-10-24T12:00:00Z")
const NEW_LANGUAGE = "fixture-published-after-snapshot"
const snapshot: WatchRouteManifest = {
  version: "before-publication",
  generatedAt: "2026-10-01T00:00:00Z",
  contentSlugs: ["jesus", "removed-film", "series"],
  oneSegmentSlugs: [],
  episodePairsByParent: { series: ["episode"] },
  audioLanguageSlugs: ["english", "spanish-latin-american"],
  audioLanguageIndexesByContent: { jesus: [0], "removed-film": [0] },
  audioLanguageIndexesByEpisode: { series: { episode: [0] } },
  nestedContainerAudioLanguageIndexesByParent: {},
}
const published: WatchRouteManifest = {
  ...snapshot,
  version: "after-publication",
  contentSlugs: ["jesus", "published-film", "series"],
  audioLanguageSlugs: [...snapshot.audioLanguageSlugs, NEW_LANGUAGE],
  audioLanguageIndexesByContent: { jesus: [0, 1, 2], "published-film": [0] },
}

type Upstream = WatchRouteManifest | "503" | "throw" | "invalid" | "304"
let upstream: Upstream
let fetchFixture: ReturnType<typeof vi.fn<typeof fetch>>
let restoreSource: () => void

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(START)
  vi.stubEnv("ADMIN_GRAPHQL_URL", "https://admin.fixture.test/api/graphql")
  vi.stubEnv("WEB_ADMIN_API_KEYS", "synthetic-fixture-bearer,unused-key")
  vi.spyOn(console, "warn").mockImplementation(() => {})
  restoreSource = setWatchRouteManifestSourceForTest(null)
  upstream = snapshot
  fetchFixture = vi.fn<typeof fetch>(async () => {
    if (upstream === "throw") throw new Error("synthetic transport failure")
    if (upstream === "503") return new Response(null, { status: 503 })
    if (upstream === "304") return new Response(null, { status: 304 })
    return Response.json(
      upstream === "invalid" ? { invalid: true } : upstream,
      {
        headers: { etag: '"fixture-version"' },
      },
    )
  })
  vi.stubGlobal("fetch", fetchFixture)
})

afterEach(() => {
  restoreSource()
  clearWatchRouteManifestCache()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function request(path: string, rsc = false) {
  return proxy(
    new NextRequest(`https://viewer.fixture.test${path}`, {
      headers: rsc ? { RSC: "1", "Next-Router-Prefetch": "1" } : {},
    }),
  )
}

function expectRecovery(response: Response, status: 200 | 404) {
  expect(response.status).toBe(status)
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  )
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow")
  expect(response.headers.get("referrer-policy")).toBe("strict-origin")
  expect(response.headers.get("location")).toBeNull()
  const rewrite = new URL(response.headers.get("x-middleware-rewrite")!)
  const sentinel = status === 404 ? "404" : "recover"
  expect([
    `/en/en/${sentinel}`,
    `/es/es-419/unavailable/${sentinel}`,
  ]).toContain(rewrite.pathname)
  expect(rewrite.origin).toBe("https://viewer.fixture.test")
  expect(JSON.stringify([...response.headers])).not.toContain(
    "synthetic-fixture-bearer",
  )
}

describe("proxy manifest negative-proof freshness", () => {
  it("preserves fresh video, non-English, exact episode and nested-parent admission", async () => {
    upstream = {
      ...snapshot,
      contentSlugs: [...snapshot.contentSlugs, "nested-child"],
      audioLanguageIndexesByContent: {
        ...snapshot.audioLanguageIndexesByContent,
        jesus: [0, 1],
        series: [],
        "nested-child": [0],
      },
      nestedContainerAudioLanguageIndexesByParent: {
        series: { "nested-child": [0] },
      },
    }
    for (const path of [
      "/jesus.html",
      "/jesus.html/english.html",
      "/jesus.html/spanish-latin-american.html",
      "/series.html/episode/english.html",
      "/series.html/episode.html",
      "/series.html",
      "/series.html/english.html",
    ]) {
      const response = await request(path)
      expect(response.status).toBe(200)
      expect(response.headers.get("x-middleware-rewrite")).not.toContain("404")
      expect(response.headers.get("x-robots-tag")).toBeNull()
    }
    expect(fetchFixture).toHaveBeenCalledTimes(1)
  })

  it.each(["503", "throw", "invalid"] as const)(
    "soft-recovers new routes and languages after last-good -> %s, then recovers publication",
    async (failure) => {
      expect(PUBLIC_WATCH_LANGUAGE_SLUGS).not.toContain(NEW_LANGUAGE)
      const knownPositive = await request("/jesus.html/english.html")
      expect(knownPositive.status).toBe(200)
      expect(knownPositive.headers.get("x-middleware-rewrite")).toContain(
        "/en/en/jesus.html/english.html",
      )
      vi.setSystemTime(START + 60_000)
      upstream = failure
      for (const path of [
        "/published-film.html",
        "/published-film.html/english.html",
        `/jesus.html/${NEW_LANGUAGE}.html`,
        "/jesus.html/spanish-latin-american.html",
      ]) {
        expectRecovery(await request(path), 200)
        expectRecovery(await request(path, true), 200)
      }
      const outagePositive = await request("/jesus.html/english.html")
      expect(outagePositive.status).toBe(200)
      expect(outagePositive.headers.get("x-middleware-rewrite")).toContain(
        "/en/en/jesus.html/english.html",
      )
      expect(outagePositive.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      )
      expect(outagePositive.headers.get("x-robots-tag")).toBeNull()
      // Retry TTL bounds upstream work, but cannot renew negative proof.
      expect(fetchFixture).toHaveBeenCalledTimes(2)
      vi.setSystemTime(START + 120_000)
      upstream = published
      for (const path of [
        "/published-film.html",
        "/published-film.html/english.html",
        `/jesus.html/${NEW_LANGUAGE}.html`,
        "/jesus.html/spanish-latin-american.html",
      ]) {
        const response = await request(path)
        expect(response.status).toBe(200)
        expect(response.headers.get("x-middleware-rewrite")).not.toContain(
          "404",
        )
      }
      expectRecovery(await request("/removed-film.html/english.html"), 404)
      expect(fetchFixture).toHaveBeenCalledTimes(3)
    },
  )

  it("reproduces the original seven-day outage through the real proxy", async () => {
    await request("/jesus.html/english.html")
    upstream = "503"
    for (const days of [7, 14]) {
      vi.setSystemTime(START + days * 86_400_000)
      expectRecovery(await request("/published-film.html/english.html"), 200)
      expectRecovery(await request(`/jesus.html/${NEW_LANGUAGE}.html`), 200)
    }
    expect(fetchFixture).toHaveBeenCalledTimes(3)
  })

  it("hard-404s complete confirmed misses only before the exclusive 60-second deadline", async () => {
    expectRecovery(await request("/absent-film.html/english.html"), 404)
    expectRecovery(await request("/series.html/missing-episode.html"), 404)
    expectRecovery(
      await request("/jesus.html/spanish-latin-american.html"),
      404,
    )
    vi.setSystemTime(START + 59_999)
    upstream = "503"
    expectRecovery(await request("/absent-film.html/english.html"), 404)
    expect(fetchFixture).toHaveBeenCalledTimes(1)
    vi.setSystemTime(START + 60_000)
    expectRecovery(await request("/absent-film.html/english.html"), 200)
    expectRecovery(
      await request("/jesus.html/spanish-latin-american.html"),
      200,
    )
    expect(fetchFixture).toHaveBeenCalledTimes(2)
  })

  it("conditionally revalidates an old generatedAt snapshot without transferring a new body", async () => {
    await request("/jesus.html/english.html")
    vi.setSystemTime(START + 60_000)
    upstream = "304"
    expectRecovery(await request("/absent-film.html/english.html"), 404)
    expect(fetchFixture.mock.calls[1][1]?.headers).toMatchObject({
      "If-None-Match": '"fixture-version"',
    })
    upstream = "503"
    vi.setSystemTime(START + 120_000)
    expectRecovery(await request("/absent-film.html/english.html"), 200)
  })

  describe("responses outstanding across cache invalidation", () => {
    async function replaceDuringRefresh(replacementEtag: string | null) {
      const original = await getWatchRouteManifest()
      vi.setSystemTime(START + 60_000)
      let finish!: (response: Response) => void
      let fail!: (error: Error) => void
      fetchFixture.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve
            fail = reject
          }),
      )
      const pending = getWatchRouteManifest()
      expect(fetchFixture.mock.calls[1][1]?.headers).toMatchObject({
        "If-None-Match": '"fixture-version"',
      })
      clearWatchRouteManifestCache()
      expect(canWatchRouteManifestProveMiss(original)).toBe(false)
      vi.setSystemTime(START + 60_100)
      fetchFixture.mockResolvedValueOnce(
        Response.json(
          { ...snapshot, version: "replacement-B" },
          { headers: replacementEtag ? { etag: replacementEtag } : {} },
        ),
      )
      const replacement = await getWatchRouteManifest()
      expect(replacement?.version).toBe("replacement-B")
      expect(canWatchRouteManifestProveMiss(replacement)).toBe(true)
      vi.setSystemTime(START + 61_400) // Old response is within the 1.5s timeout.
      return { pending, replacement, finish, fail }
    }

    it.each([
      ["different ETag", '"B"'],
      ["same ETag", '"fixture-version"'],
      ["no ETag", null],
    ])("does not credit a delayed A 304 to B with %s", async (_label, etag) => {
      const { pending, replacement, finish } = await replaceDuringRefresh(etag)
      finish(new Response(null, { status: 304 }))
      expect(await pending).toBe(replacement)
      upstream = "503"
      const paths = [
        "/published-film.html/english.html",
        "/jesus.html/spanish-latin-american.html",
      ]
      vi.setSystemTime(START + 120_099) // B age 59,999ms: still authoritative.
      for (const path of paths) expectRecovery(await request(path), 404)
      expect(fetchFixture).toHaveBeenCalledTimes(3)
      for (const age of [60_000, 60_001]) {
        vi.setSystemTime(START + 60_100 + age)
        for (const path of paths) {
          expectRecovery(await request(path), 200)
          expectRecovery(await request(path, true), 200)
        }
        expect(canWatchRouteManifestProveMiss(replacement)).toBe(false)
      }
      // One failed refresh at B's deadline; old A cannot delay B's retry.
      expect(fetchFixture).toHaveBeenCalledTimes(4)
      const positive = await request("/jesus.html/english.html")
      expect(positive.status).toBe(200)
      expect(positive.headers.get("x-middleware-rewrite")).not.toContain("404")
      expect(positive.headers.get("x-robots-tag")).toBeNull()
      expect(positive.headers.get("cache-control")).toContain("no-store")
    })

    it.each(["200", "503", "invalid", "throw"])(
      "discards superseded %s completion without overwriting B or its retry deadline",
      async (outcome) => {
        const { pending, replacement, finish, fail } =
          await replaceDuringRefresh('"B"')
        if (outcome === "throw") fail(new Error("delayed fixture failure"))
        else if (outcome === "503") finish(new Response(null, { status: 503 }))
        else
          finish(
            Response.json(
              outcome === "invalid" ? { invalid: true } : published,
              { headers: { etag: '"old-response"' } },
            ),
          )
        expect(await pending).toBe(replacement)
        expect(await getWatchRouteManifest()).toBe(replacement)
        expect(fetchFixture).toHaveBeenCalledTimes(3)
        vi.setSystemTime(START + 120_100)
        upstream = published
        const response = await request("/published-film.html/english.html")
        expect(response.status).toBe(200)
        expect(response.headers.get("x-middleware-rewrite")).not.toContain(
          "404",
        )
        expect(fetchFixture).toHaveBeenCalledTimes(4)
        expect(fetchFixture.mock.calls[3][1]?.headers).toMatchObject({
          "If-None-Match": '"B"',
        })
        expectRecovery(await request("/removed-film.html/english.html"), 404)
      },
    )

    it("discards an old 200 whose JSON body finishes after B replaces the cache", async () => {
      await getWatchRouteManifest()
      vi.setSystemTime(START + 60_000)
      let finishBody!: (body: WatchRouteManifest) => void
      const response = Response.json(published, {
        headers: { etag: '"old-body"' },
      })
      vi.spyOn(response, "json").mockImplementation(
        () =>
          new Promise((resolve) => {
            finishBody = resolve
          }),
      )
      fetchFixture.mockResolvedValueOnce(response)
      const pending = getWatchRouteManifest()
      await vi.waitFor(() => expect(finishBody).toBeTypeOf("function"))
      clearWatchRouteManifestCache()
      vi.setSystemTime(START + 60_100)
      const replacement = await getWatchRouteManifest()
      vi.setSystemTime(START + 61_400)
      finishBody(published)
      expect(await pending).toBe(replacement)
      expect(await getWatchRouteManifest()).toBe(replacement)
      expect(fetchFixture).toHaveBeenCalledTimes(3)
    })

    it.each([304, 200])(
      "keeps B's pending single-flight slot when old A returns %s",
      async (status) => {
        await getWatchRouteManifest()
        vi.setSystemTime(START + 60_000)
        let finishA!: (response: Response) => void
        fetchFixture.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishA = resolve
            }),
        )
        const pendingA = getWatchRouteManifest()
        clearWatchRouteManifestCache()
        vi.setSystemTime(START + 60_100)
        let finishB!: (response: Response) => void
        fetchFixture.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishB = resolve
            }),
        )
        const pendingB = getWatchRouteManifest()
        vi.setSystemTime(START + 61_400)
        finishA(
          status === 304
            ? new Response(null, { status })
            : Response.json(snapshot),
        )
        expect(await pendingA).toBeNull()
        const concurrent = getWatchRouteManifest()
        finishB(Response.json(published, { headers: { etag: '"B"' } }))
        const replacement = await pendingB
        expect(await concurrent).toBe(replacement)
        expect(await getWatchRouteManifest()).toBe(replacement)
        expect(replacement?.version).toBe(published.version)
        expect(fetchFixture).toHaveBeenCalledTimes(3)
      },
    )

    it("revalidates the exact current snapshot until its exclusive renewed deadline", async () => {
      const original = await getWatchRouteManifest()
      vi.setSystemTime(START + 60_000)
      upstream = "304"
      expect(await getWatchRouteManifest()).toBe(original)
      expect(fetchFixture.mock.calls[1][1]?.headers).toMatchObject({
        "If-None-Match": '"fixture-version"',
      })
      vi.setSystemTime(START + 119_999)
      for (const path of [
        "/published-film.html/english.html",
        "/jesus.html/spanish-latin-american.html",
      ])
        expectRecovery(await request(path), 404)
      upstream = "503"
      vi.setSystemTime(START + 120_000)
      for (const path of [
        "/published-film.html/english.html",
        "/jesus.html/spanish-latin-american.html",
      ])
        expectRecovery(await request(path), 200)
      expect(fetchFixture).toHaveBeenCalledTimes(3)
    })
  })

  it.each([
    "audioLanguageIndexesByContent",
    "audioLanguageIndexesByEpisode",
    "nestedContainerAudioLanguageIndexesByParent",
  ] as const)(
    "keeps fresh older-shaped %s omissions inconclusive",
    async (field) => {
      const incomplete = { ...snapshot }
      delete incomplete[field]
      upstream = incomplete
      expectRecovery(await request("/absent-film.html/english.html"), 200)
      const response = await request("/jesus.html/spanish-latin-american.html")
      if (field === "audioLanguageIndexesByContent") {
        // Preserve the existing older-manifest fallback admission policy.
        expect(response.status).toBe(200)
        expect(response.headers.get("x-middleware-rewrite")).not.toContain(
          "404",
        )
        expect(response.headers.get("cache-control")).toBe(
          "private, no-store, max-age=0",
        )
      } else {
        expectRecovery(response, 200)
      }
    },
  )

  it.each([
    { audioLanguageIndexesByContent: { jesus: [99] } },
    { audioLanguageIndexesByEpisode: { series: { episode: [99] } } },
    {
      nestedContainerAudioLanguageIndexesByParent: { series: { nested: [99] } },
    },
  ])(
    "rejects out-of-range language indexes instead of proving a false gap: %j",
    async (indexes) => {
      upstream = { ...snapshot, ...indexes }
      expectRecovery(await request("/series.html/missing-episode.html"), 200)
    },
  )

  it("does not renew proof for a 304 when no validator was sent", async () => {
    fetchFixture.mockResolvedValueOnce(Response.json(snapshot))
    expectRecovery(await request("/absent-film.html/english.html"), 404)
    vi.setSystemTime(START + 60_000)
    upstream = "304"
    expectRecovery(await request("/absent-film.html/english.html"), 200)
    expect(fetchFixture.mock.calls[1][1]?.headers).not.toHaveProperty(
      "If-None-Match",
    )
  })

  it("does not accept a partial or pending success status as authoritative", async () => {
    for (const status of [202, 206]) {
      clearWatchRouteManifestCache()
      fetchFixture.mockResolvedValueOnce(Response.json(snapshot, { status }))
      expectRecovery(await request("/series.html/missing-episode.html"), 200)
    }
  })

  it("single-flights failed refreshes without making arbitrary misses renderer/cache identities", async () => {
    await request("/jesus.html/english.html")
    vi.setSystemTime(START + 60_000)
    let finish!: (response: Response) => void
    fetchFixture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = Array.from({ length: 8 }, (_, i) =>
      request(`/absent-${i}.html/english.html`),
    )
    expect(fetchFixture).toHaveBeenCalledTimes(2)
    finish(new Response(null, { status: 503 }))
    for (const response of await Promise.all(pending))
      expectRecovery(response, 200)
    expect(fetchFixture).toHaveBeenCalledTimes(2)
  })

  it("never treats an unsolicited 304 as a complete snapshot", async () => {
    upstream = "304"
    expectRecovery(await request("/series.html/missing-episode.html"), 200)
  })

  it("keeps fetch origin, credentials and timeout independent of caller paths and queries", async () => {
    await request(
      "/jesus.html/english.html?token=private-query&url=https://evil.test",
    )
    expect(fetchFixture).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFixture.mock.calls[0]
    expect(url).toBe("https://admin.fixture.test/api/watch-route-manifest")
    expect(init?.headers).toEqual({
      Authorization: "Bearer synthetic-fixture-bearer",
    })
    expect(init?.cache).toBe("no-store")
    expect(init?.redirect).toBe("error")
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})
