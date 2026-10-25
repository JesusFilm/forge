/** Local component proof. Synthetic catalog, stubbed media/Next adapters, no production calls. */
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const require = createRequire(resolve(repo, "package.json"))
const webRequire = createRequire(resolve(repo, "apps/web/package.json"))
const { build } = require(
  createRequire(require.resolve("tsx/package.json")).resolve("esbuild"),
)
const { chromium } = webRequire("@playwright/test")
const scratch = await mkdtemp(resolve(tmpdir(), "watch-hero-authority-"))
const output =
  process.env.WATCH_HERO_FIXTURE_OUTPUT ??
  resolve(tmpdir(), `watch-hero-authority-result-${Date.now()}.json`)
let browser
let server
try {
  const envPlugin = (server = false) => ({
    name: "local-env",
    setup(builder) {
      builder.onResolve({ filter: /^(@\/env|server-only)$/ }, ({ path }) => ({
        path,
        namespace: "local-env",
      }))
      builder.onLoad({ filter: /.*/, namespace: "local-env" }, ({ path }) => ({
        contents:
          path === "server-only"
            ? ""
            : server
              ? 'export const env={REVALIDATION_SECRET:"local-hero-fixture-public-key",NEXT_PUBLIC_CANONICAL_ORIGIN:"https://www.jesusfilm.org"}'
              : 'export const env={NEXT_PUBLIC_CANONICAL_ORIGIN:"https://www.jesusfilm.org"}',
        loader: "js",
      }))
    },
  })
  await build({
    entryPoints: [
      resolve(repo, "apps/web/src/lib/watch-surface-manifest.server.ts"),
    ],
    outfile: resolve(scratch, "signer.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    tsconfig: resolve(repo, "apps/web/tsconfig.json"),
    plugins: [envPlugin(true)],
  })
  const {
    signWatchHomeHeroManifestCatalog,
    verifyWatchSurfaceManifest,
  } = require(resolve(scratch, "signer.cjs"))
  const videos = Array.from({ length: 1000 }, (_, i) => ({
    kind: "video",
    id: `candidate-${i}`,
    title: `Candidate ${i}`,
    label: "Segment",
    href: `/candidate-${i}.html`,
    posterUrl: null,
    thumbnailUrl: null,
    imageAlt: "",
    src: "https://media.invalid/fixture.m3u8",
    playbackId: null,
    durationSeconds: 600,
  }))
  const sequence = {
    pools: [{ id: "fixture-pool", collectionIds: [], videos }],
  }
  const source = {
    surface: "watch-home",
    block: "hero",
    presentation: "hero-card",
    placement: "home-hero",
    items: videos.map((slide) => ({
      position: 0,
      itemPath: `/watch${slide.href}`,
    })),
  }
  const started = performance.now()
  const catalog = signWatchHomeHeroManifestCatalog(source)
  const signingMs = performance.now() - started
  assert.equal(catalog.items.length, 1000)
  const baselineRef = "811f1ec81f359d1cf66cdda5bad8f5445631c44c"
  const scripts = {}
  for (const mode of ["baseline", "enabled"]) {
    const adapters = {
      name: "local-component-adapters",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(next\/link|next\/image|next-intl|@forge\/video-player\/mux-video)$/,
          },
          ({ path }) => ({ path, namespace: "adapters" }),
        )
        builder.onLoad({ filter: /.*/, namespace: "adapters" }, ({ path }) => ({
          resolveDir: resolve(repo, "apps/web"),
          loader: "jsx",
          contents:
            path === "next-intl"
              ? 'export const useTranslations=()=>(key,args)=>key==="showVideo"?"Show "+args.title:key'
              : path === "next/link"
                ? 'import React from "react";export default function Link({href,...props}){return <a {...props} href={href.startsWith("/watch/")?href:"/watch"+href} onClick={e=>e.preventDefault()}/>}'
                : path === "next/image"
                  ? 'import React from "react";export default function Image({alt}){return <span aria-label={alt}/>}'
                  : 'import React from "react";export default React.forwardRef(function Media(props,ref){window.fixtureMediaMounts.push({ready:document.readyState,time:performance.now()});return <video ref={ref} muted/>})',
        }))
        if (mode === "baseline")
          builder.onLoad(
            { filter: /\/(WatchHomeTvCarousel|WatchExposureBoundary)\.tsx$/ },
            ({ path }) => ({
              contents: execFileSync(
                "git",
                ["show", `${baselineRef}:${path.slice(repo.length + 1)}`],
                { cwd: repo, encoding: "utf8" },
              ),
              loader: "tsx",
              resolveDir: dirname(path),
            }),
          )
      },
    }
    const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{WatchHomeTvCarousel}from'${resolve(repo, "apps/web/src/components/home/WatchHomeTvCarousel.tsx")}';window.fixtureMediaMounts=[];window.fixtureRequests=[];Math.random=()=>0;const original=fetch;window.fetch=(url,init)=>{window.fixtureRequests.push({kind:String(url).split('/').pop(),ready:document.readyState,time:performance.now(),bytes:init?.body?.length??0});return original(url,init)};const f=await(await fetch('/fixture-config?mode=${mode}')).json();const start=performance.now();createRoot(document.getElementById('app')).render(React.createElement(WatchHomeTvCarousel,{slides:[],sequence:f.sequence,heroManifestCatalog:f.catalog}));requestAnimationFrame(()=>requestAnimationFrame(()=>window.fixtureRenderTwoFramesMs=performance.now()-start));`
    const outfile = resolve(scratch, `${mode}.js`)
    await build({
      stdin: {
        contents: entry,
        resolveDir: resolve(repo, "apps/web"),
        loader: "jsx",
      },
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      tsconfig: resolve(repo, "apps/web/tsconfig.json"),
      plugins: [envPlugin(), adapters],
    })
    scripts[mode] = await readFile(outfile)
    assert.ok(
      !scripts[mode].includes(Buffer.from("local-hero-fixture-public-key")),
    )
  }
  assert.ok(
    scripts.enabled.length <= scripts.baseline.length + 5000,
    "Keep the hero helper graph thin",
  )
  for (const marker of [
    "watchSurfaceManifestSchema",
    "signWatchHomeHeroManifestCatalog",
    "authoredWatchSurfaceSource",
  ])
    assert.ok(!scripts.enabled.includes(Buffer.from(marker)))
  const deliveries = []
  const selectedFacts = []
  const knownPaths = new Set(source.items.map((item) => item.itemPath))
  const GET_ROUTES = new Set([
    "/",
    "/baseline.js",
    "/enabled.js",
    "/load-gate.svg",
    "/fixture-config",
  ])
  const POST_ROUTES = new Set([
    "/watch/api/recommendations/surface-delivery",
    "/watch/api/recommendations/surface-exposure",
  ])
  const handle = async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff")
    const url = new URL(request.url, "http://127.0.0.1")
    if (!GET_ROUTES.has(url.pathname) && !POST_ROUTES.has(url.pathname)) {
      response.statusCode = 404
      return response.end("{}")
    }
    if (request.method !== (GET_ROUTES.has(url.pathname) ? "GET" : "POST")) {
      response.statusCode = 405
      return response.end("{}")
    }
    if (url.pathname === "/") {
      const mode =
        url.searchParams.get("mode") === "enabled" ? "enabled" : "baseline"
      response.setHeader("content-type", "text/html")
      return response.end(
        mode === "enabled"
          ? '<!doctype html><title>Local hero fixture</title><style>body{background:black;color:white}button,a{display:inline-block;margin:4px;padding:8px}video{display:none}</style><img src="/load-gate.svg" alt=""><div id="app"></div><script type="module" src="/enabled.js"></script>'
          : '<!doctype html><title>Local hero fixture</title><style>body{background:black;color:white}button,a{display:inline-block;margin:4px;padding:8px}video{display:none}</style><img src="/load-gate.svg" alt=""><div id="app"></div><script type="module" src="/baseline.js"></script>',
      )
    }
    if (url.pathname === "/baseline.js" || url.pathname === "/enabled.js") {
      response.setHeader("content-type", "text/javascript")
      return response.end(scripts[url.pathname.slice(1, -3)])
    }
    if (url.pathname === "/load-gate.svg") {
      await new Promise((done) => setTimeout(done, 400))
      response.setHeader("content-type", "image/svg+xml")
      return response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      )
    }
    response.setHeader("content-type", "application/json")
    if (url.pathname === "/fixture-config")
      return response.end(
        JSON.stringify({
          sequence,
          catalog: url.searchParams.get("mode") === "enabled" ? catalog : null,
        }),
      )
    if (request.headers["content-type"] !== "application/json") {
      response.statusCode = 415
      return response.end("{}")
    }
    let body = ""
    let bytes = 0
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > 64 * 1024)
        throw Object.assign(new Error("Body limit"), { statusCode: 413 })
      body += chunk
    }
    const input = JSON.parse(body)
    if (url.pathname === "/watch/api/recommendations/surface-delivery") {
      const manifest = verifyWatchSurfaceManifest(input.descriptor)
      assert.ok(manifest)
      assert.equal(manifest.items.length, 1)
      assert.equal(manifest.items[0].position, 0)
      deliveries.push({
        path: manifest.items[0].itemPath,
        bytes: Buffer.byteLength(body),
      })
      return response.end(
        JSON.stringify({
          disposition: "measured",
          status: "accepted",
          windowId: crypto.randomUUID(),
          items: manifest.items,
        }),
      )
    }
    assert.ok(Array.isArray(input) && input.length <= 64)
    for (const fact of input) {
      assert.ok(knownPaths.has(fact.itemPath))
      if (fact.kind === "selected")
        selectedFacts.push({
          path: fact.itemPath,
          policyVersion: fact.policyVersion,
        })
    }
    return response.end("[]")
  }
  server = createServer((request, response) => {
    response.setHeader("connection", "close")
    const timer = setTimeout(() => {
      if (!response.headersSent) {
        response.statusCode = 408
        response.end("{}")
      }
      request.destroy()
    }, 2000)
    void handle(request, response)
      .catch((error) => {
        if (!response.headersSent) {
          response.statusCode = error.statusCode === 413 ? 413 : 400
          response.setHeader("content-type", "application/json")
          response.end("{}")
        } else response.destroy()
      })
      .finally(() => clearTimeout(timer))
  })
  server.headersTimeout = 2000
  server.requestTimeout = 2000
  await new Promise((done, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", done)
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const [path, method, body, expected] of [
    ["/unknown", "POST", "{}", 404],
    ["/watch/api/recommendations/surface-delivery", "GET", undefined, 405],
    ["/watch/api/recommendations/surface-delivery", "POST", "{", 400],
    [
      "/watch/api/recommendations/surface-delivery",
      "POST",
      "a".repeat(65537),
      413,
    ],
  ]) {
    const rejected = await fetch(`${origin}${path}`, {
      method,
      body,
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(3000),
    })
    assert.equal(rejected.status, expected)
    await rejected.text()
  }
  browser = await chromium.launch({ headless: true, timeout: 15000 })
  const samples = { baseline: [], enabled: [] }
  const errors = []
  for (let i = 0; i < 6; i++)
    for (const mode of ["baseline", "enabled"]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      })
      context.setDefaultTimeout(5000)
      context.setDefaultNavigationTimeout(15000)
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      )
      const page = await context.newPage()
      page.on("pageerror", (error) => errors.push(error.message))
      await page.goto(`${origin}/?mode=${mode}`, { waitUntil: "load" })
      await page.waitForFunction(() => window.fixtureRenderTwoFramesMs != null)
      await page.waitForTimeout(150)
      samples[mode].push(
        await page.evaluate(() => {
          const n = performance.getEntriesByType("navigation")[0]
          return {
            dclMs: n.domContentLoadedEventEnd,
            loadMs: n.loadEventEnd,
            fcpMs:
              performance.getEntriesByName("first-contentful-paint")[0]
                ?.startTime ?? null,
            renderTwoFramesMs: window.fixtureRenderTwoFramesMs,
            resources: performance.getEntriesByType("resource").length,
            deliveryBeforeLoad: window.fixtureRequests.some(
              (r) => r.kind === "surface-delivery" && r.ready !== "complete",
            ),
          }
        }),
      )
      if (mode === "enabled" && i === 0) {
        await page.waitForFunction(() =>
          window.fixtureRequests.some((r) => r.kind === "surface-delivery"),
        )
        const prior = deliveries.length
        const target = page
          .locator('button[aria-label^="Show Candidate"]')
          .first()
        const title = (await target.getAttribute("aria-label")).replace(
          "Show ",
          "",
        )
        const expectedPath = `/watch/candidate-${title.replace("Candidate ", "")}.html`
        await target.focus()
        await target.evaluate((node) => {
          window.fixtureFocused = node
          node.click()
        })
        await page.waitForFunction(
          () =>
            document.activeElement === window.fixtureFocused &&
            window.fixtureFocused.isConnected &&
            window.fixtureFocused.getAttribute("aria-current") === "true",
        )
        await page.waitForFunction(
          (path) =>
            new URL(
              document.querySelector('[data-testid="watch-home-tv-actions"] a')
                .href,
            ).pathname === path,
          expectedPath,
        )
        await page.waitForTimeout(200)
        assert.ok(deliveries.length > prior)
        assert.equal(deliveries.at(-1).path, expectedPath)
        const selectionResponse = page.waitForResponse(
          (response) => {
            if (!response.url().endsWith("/surface-exposure")) return false
            const facts = JSON.parse(response.request().postData() ?? "[]")
            return (
              Array.isArray(facts) &&
              facts.some(
                (fact) =>
                  fact.kind === "selected" && fact.itemPath === expectedPath,
              )
            )
          },
          { timeout: 5000 },
        )
        await page.locator('[data-testid="watch-home-tv-actions"] a').click()
        await selectionResponse
        assert.deepEqual(selectedFacts.at(-1), {
          path: expectedPath,
          policyVersion: "watch-exposure-v2",
        })
      }
      await context.close()
    }
  assert.equal(errors.length, 0)
  assert.ok(samples.enabled.every((sample) => !sample.deliveryBeforeLoad))
  const median = (xs) => {
    assert.equal(xs.length, 6)
    assert.ok(
      xs.every(Number.isFinite),
      "Every sample must have a finite metric, including FCP",
    )
    const sorted = [...xs].sort((a, b) => a - b)
    return (sorted[2] + sorted[3]) / 2
  }
  const result = {
    scope:
      "Real Chromium component fixture; actual carousel/controller/signature verifier. Next/image/link/i18n/media adapters; mocked delivery receipts; no production or DB persistence claim. Hybrid component control: only carousel/controller TSX come from baselineRef; remaining imports/adapters are current. Six cold contexts per mode, alternating, 1280x800, 400ms shared load gate.",
    browser: browser.version(),
    baselineRef,
    launch: { headless: true, browserFeatureOverrides: false },
    candidates: 1000,
    signingMs,
    catalogBytes: Buffer.byteLength(JSON.stringify(catalog)),
    modelBytes: Buffer.byteLength(JSON.stringify(sequence)),
    scriptBytes: {
      baseline: scripts.baseline.length,
      enabled: scripts.enabled.length,
    },
    singletonDeliveryBytes: deliveries.map((r) => r.bytes),
    checks: {
      knownSingleton: true,
      slotZero: true,
      over100: true,
      focusedNodePreserved: true,
      currentTargetSwitch: true,
      deliveryAfterLoad: true,
      browserErrors: errors.length,
      exactSelectedTarget: true,
      malformedAndOversizedRequestsContained: true,
    },
    fcpSampleCounts: Object.fromEntries(
      Object.entries(samples).map(([mode, runs]) => [
        mode,
        runs.filter((run) => Number.isFinite(run.fcpMs)).length,
      ]),
    ),
    medians: Object.fromEntries(
      Object.entries(samples).map(([mode, runs]) => [
        mode,
        Object.fromEntries(
          ["dclMs", "loadMs", "fcpMs", "renderTwoFramesMs", "resources"].map(
            (metric) => [metric, median(runs.map((r) => r[metric]))],
          ),
        ),
      ]),
    ),
    samples,
  }
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ output, ...result, samples: undefined }))
} finally {
  const cleanups = []
  if (browser) cleanups.push(Promise.resolve().then(() => browser.close()))
  if (server) {
    server.closeAllConnections()
    cleanups.push(new Promise((done) => server.close(() => done())))
  }
  cleanups.push(rm(scratch, { recursive: true, force: true }))
  const outcomes = await Promise.allSettled(cleanups)
  if (outcomes.some((result) => result.status === "rejected")) {
    console.error("Fixture cleanup failed")
    process.exitCode = 1
  }
}
