import http from "node:http"
import { expect, test } from "@playwright/test"

// Opt-in integration against a real production `next start`, with the local
// synthetic Admin fixture described in docs/operations/watch-route-manifest-freshness.md.
// Do not replace the document body or simulate an RSC response in this test.
const origin = process.env.WATCH_MANIFEST_DOCUMENT_ORIGIN
const fixtureOrigin = process.env.WATCH_MANIFEST_FIXTURE_ORIGIN

test("manifest proof controls actual Next document status and recovery", async ({
  request,
}, testInfo) => {
  test.skip(!origin || !fixtureOrigin, "Requires the isolated manifest fixture")
  test.setTimeout(230_000)
  const evidence: unknown[] = []
  async function document(path: string, status: number, recovery = false) {
    const response = await request.get(`${origin}/watch/${path}`, {
      maxRedirects: 0,
    })
    const body = await response.text()
    await testInfo.attach(`document-${evidence.length}-${path}`, {
      body,
      contentType: "text/html",
    })
    evidence.push({
      path,
      status: response.status(),
      headers: response.headers(),
      bytes: Buffer.byteLength(body),
    })
    expect(response.status()).toBe(status)
    expect(response.headers()["content-type"]).toContain("text/html")
    if (recovery) {
      expect(response.headers()["cache-control"]).toContain("private")
      expect(response.headers()["cache-control"]).toContain("no-store")
      expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow")
      expect(body).toContain('name="robots" content="noindex')
    }
    return body
  }
  async function control(state: Record<string, unknown>) {
    const response = await request.post(`${fixtureOrigin}/control`, {
      data: state,
    })
    expect(response.ok()).toBe(true)
  }
  try {
    // No SSR/proxy snapshot may be warmed before this first request. A compiled
    // language admits fallback content; manifest-only Spanish cannot. Exercise
    // both, including positive content, through the actual production renderer.
    await control({ mode: "unavailable" })
    for (const language of ["english", "spanish-latin-american", "spanish"]) {
      const path = `runtime-cold-absent.html/${language}.html`
      for (let attempt = 0; attempt < 2; attempt++) {
        const body = await document(path, 200)
        const response = evidence.at(-1) as { headers: Record<string, string> }
        expect(response.headers["cache-control"]).toContain("private")
        expect(response.headers["cache-control"]).toContain("no-store")
        expect(response.headers["cache-control"]).not.toContain("s-maxage")
        expect(response.headers["x-nextjs-cache"]).not.toBe("HIT")
        expect(response.headers["x-nextjs-prerender"]).toBeUndefined()
        expect(body).toContain('name="robots" content="noindex')
      }
    }
    for (const language of ["english", "spanish-latin-american"]) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const body = await document(
          `runtime-positive.html/${language}.html`,
          200,
        )
        expect(body).toContain("Rendered runtime-positive")
        const response = evidence.at(-1) as { headers: Record<string, string> }
        expect(response.headers["cache-control"]).toContain("private")
        expect(response.headers["cache-control"]).toContain("no-store")
        expect(response.headers["x-nextjs-cache"]).not.toBe("HIT")
      }
    }
    // A corpus-miss language still follows existing cold admission policy.
    await document("runtime-positive.html/spanish.html", 200, true)
    await control({ mode: "fresh" })
    await expect
      .poll(
        async () =>
          (await request.get(`${origin}/watch/runtime-positive.html`)).text(),
        { timeout: 70_000, intervals: [1000] },
      )
      .toContain("Rendered runtime-positive")
    // The normal retry has now retrieved the complete generation-1 fixture.
    expect(await document("runtime-positive.html", 200)).toContain(
      "Rendered runtime-positive",
    )
    expect(await document("runtime-absent.html", 404, true)).toContain(
      "watch-not-found-heading",
    )
    expect(
      await document("fixture-video.html/spanish.html", 404, true),
    ).toContain("WatchUnavailableLanguageClient")
    await document("fixture-video.html/spanish-latin-american.html", 404, true)
    await control({ mode: "unavailable", recoveryDelayMs: 1500 })
    // Real time, no fake clock: retain the successful snapshot through expiry
    // and the ordinary failed refresh. Avoid the renderer's independent cache.
    await expect
      .poll(
        async () =>
          (await request.get(`${origin}/watch/runtime-absent.html`)).status(),
        { timeout: 70_000, intervals: [1000] },
      )
      .toBe(200)
    await document("runtime-absent.html", 200, true)
    await document("fixture-video.html/spanish.html", 200, true)
    // Optional recovery metadata must not hold the soft document's first byte.
    // The fixture delays actual GraphQL lookups by 1500ms; no renderer stub.
    const started = performance.now()
    const streamed = await new Promise<{
      status: number | undefined
      headersMs: number
      bodyMs: number
      body: string
    }>((resolve, reject) => {
      http
        .get(
          `${origin}/watch/fixture-slow-video.html/spanish-latin-american.html`,
          (response) => {
            const headersMs = performance.now() - started
            let body = ""
            response.setEncoding("utf8")
            response.on("data", (chunk: string) => {
              body += chunk
            })
            response.on("end", () =>
              resolve({
                status: response.statusCode,
                headersMs,
                bodyMs: performance.now() - started,
                body,
              }),
            )
            response.on("error", reject)
          },
        )
        .on("error", reject)
    })
    evidence.push({
      path: "fixture-slow-video.html/spanish-latin-american.html",
      status: streamed.status,
      headersMs: streamed.headersMs,
      bodyMs: streamed.bodyMs,
    })
    expect(streamed.status).toBe(200)
    expect(streamed.body).toContain('aria-busy="true"')
    expect(streamed.bodyMs).toBeGreaterThanOrEqual(1400)
    expect(streamed.bodyMs - streamed.headersMs).toBeGreaterThan(750)
    await control({ recoveryDelayMs: 0 })
    expect(await document("runtime-positive.html", 200)).toContain(
      "Rendered runtime-positive",
    )
    await document("runtime-published.html", 200, true)
    await control({ mode: "fresh", published: true, generation: 2 })
    await expect
      .poll(
        async () =>
          (await request.get(`${origin}/watch/runtime-published.html`)).text(),
        { timeout: 70_000, intervals: [1000] },
      )
      .toContain("Rendered runtime-published")
    expect(await document("runtime-published.html", 200)).toContain(
      "Rendered runtime-published",
    )
    // A successfully retrieved replacement can prove both negatives again.
    await document("runtime-absent.html", 404, true)
    await document("fixture-video.html/spanish.html", 404, true)
  } finally {
    await testInfo.attach("actual-document-status", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    })
  }
})
