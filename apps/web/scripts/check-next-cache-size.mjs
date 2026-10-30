import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { performance } from "node:perf_hooks"
import { AsyncLocalStorage } from "node:async_hooks"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, URL } from "node:url"
import FixtureHandler from "./fixtures/cache-size-handler.mjs"

// Next's server bootstrap normally installs this global before loading routes.
globalThis.AsyncLocalStorage ??= AsyncLocalStorage
const require = createRequire(import.meta.url)
const nextRoot = path.dirname(require.resolve("next/package.json"))

const manifest = () => ({
  version: 4,
  routes: {},
  dynamicRoutes: {},
  notFoundRoutes: [],
  preview: { previewModeId: "synthetic-fixture" },
})
const handlerPath = fileURLToPath(
  new URL("./fixtures/cache-size-handler.mjs", import.meta.url),
)
const route = { kind: "APP_PAGE", sourceRoute: "/cache-size-fixture" }
const pageContext = {
  fetchCache: false,
  route,
  cacheControl: { revalidate: 60, expire: 3600 },
}

async function createCache(runtime, custom = true, dev = false) {
  if (runtime === "standalone") {
    const { IncrementalCache } = require(
      path.join(nextRoot, "dist/server/lib/incremental-cache/index.js"),
    )
    return new IncrementalCache({
      dev,
      requestHeaders: {},
      getPrerenderManifest: manifest,
      CurCacheHandler: custom ? FixtureHandler : undefined,
    })
  }
  const { AppPageRouteModule } = require(
    path.join(nextRoot, "dist/compiled/next-server", runtime),
  )
  return AppPageRouteModule.prototype.getIncrementalCache.call(
    {
      distDir: ".next",
      relativeProjectDir: "",
      isDev: dev,
      loadCustomCacheHandlers: async () => {},
    },
    { headers: {} },
    {
      experimental: {},
      cacheMaxMemorySize: 0,
      ...(custom ? { cacheHandler: handlerPath } : {}),
    },
    manifest(),
    false,
  )
}

function pageFixture(bytes = 1_941_310) {
  let expansions = 0
  const rscData = Buffer.alloc(bytes, 97)
  rscData.toJSON = function () {
    expansions += 1
    return Buffer.prototype.toJSON.call(this)
  }
  return {
    value: { kind: "APP_PAGE", html: "<p>fixture</p>", rscData },
    expansions: () => expansions,
  }
}

async function check(runtime) {
  const cache = await createCache(runtime)
  assert.equal(cache.hasCustomCacheHandler, true)
  const fixture = pageFixture()
  await cache.set("/cache-size-fixture", fixture.value, pageContext)
  assert.equal(cache.cacheHandler.writes.length, 1)
  assert.equal(cache.cacheHandler.writes[0].value, fixture.value)
  assert.equal(
    fixture.expansions(),
    0,
    `${runtime}: Next expanded the page buffer for an unused size check`,
  )
  const hit = await cache.get("/cache-size-fixture", {
    kind: "APP_PAGE",
    route,
    isFallback: false,
  })
  assert.equal(hit.value, fixture.value)

  // Other Next apps do not configure a custom cache handler. Preserve their
  // existing size serialization exactly, even though APP_PAGE has no size cap.
  const defaultPage = await createCache(runtime, false)
  defaultPage.cacheHandler = new FixtureHandler()
  const defaultFixture = pageFixture(64)
  await defaultPage.set(
    "/default-cache-fixture",
    defaultFixture.value,
    pageContext,
  )
  assert.equal(
    defaultFixture.expansions(),
    1,
    `${runtime}: default-handler behavior changed outside Watch's custom path`,
  )
  assert.equal(defaultPage.cacheHandler.writes[0].value, defaultFixture.value)

  for (const dev of [false, true]) {
    const builtin = await createCache(runtime, false, dev)
    // A recording backend after construction retains the actual built-in
    // size policy; the custom-handler constructor branch above is separate.
    builtin.cacheHandler = new FixtureHandler()
    assert.equal(builtin.hasCustomCacheHandler, false)
    const fetchValue = (length) => ({
      kind: "FETCH",
      data: { headers: {}, body: "x".repeat(length), status: 200, url: "" },
      revalidate: 60,
    })
    const sizeLimit = 2 * 1024 * 1024
    const overhead = JSON.stringify(fetchValue(0)).length
    const atLimit = fetchValue(sizeLimit - overhead)
    const aboveLimit = fetchValue(sizeLimit - overhead + 1)
    const context = { fetchCache: true, fetchUrl: "https://fixture.invalid" }
    await builtin.set("at-limit", atLimit, context)
    assert.equal(builtin.cacheHandler.writes.length, 1)
    if (dev) {
      await assert.rejects(builtin.set("above-limit", aboveLimit, context), {
        __NEXT_ERROR_CODE: "E1003",
      })
    } else {
      const warnings = []
      const original = console.warn
      console.warn = (...args) => warnings.push(args.join(" "))
      try {
        await builtin.set("above-limit", aboveLimit, context)
      } finally {
        console.warn = original
      }
      assert.equal(warnings.length, 1)
      assert.match(warnings[0], /items over 2MB/)
    }
    assert.equal(builtin.cacheHandler.writes.length, 1)
    await builtin.set("implicit-build", aboveLimit, {
      ...context,
      isImplicitBuildTimeCache: true,
    })
    assert.equal(builtin.cacheHandler.writes.length, 2)

    const custom = await createCache(runtime, true, dev)
    await custom.set("custom-fetch", aboveLimit, context)
    assert.equal(custom.cacheHandler.writes.length, 1)
    const cyclic = { kind: "FETCH" }
    cyclic.self = cyclic
    await custom.set("exempt-fetch", cyclic, context)
    assert.equal(custom.cacheHandler.writes[1].value, cyclic)
  }
  console.log(
    `PASS ${runtime}: custom path optimized; default behavior and FETCH limits preserved`,
  )
}

async function benchmark(runtime) {
  const cache = await createCache(runtime)
  const fixture = pageFixture()
  cache.cacheHandler.storageCodec = process.argv.includes("--storage-codec")
  await cache.set("/cache-size-fixture", fixture.value, pageContext)
  const results = []
  for (let i = 0; i < 12; i++) {
    cache.cacheHandler.writes.length = 0
    const started = performance.now()
    const read = cache.get("/cache-size-fixture", {
      kind: "APP_PAGE",
      route,
      isFallback: false,
    })
    // The real get() has a pending async storage callback. Actual Next set()
    // executes on this same thread while that callback is waiting.
    await cache.set(`/cold-${i}`, fixture.value, pageContext)
    const hit = await read
    assert.equal(hit.value.html, fixture.value.html)
    assert.equal(Buffer.compare(hit.value.rscData, fixture.value.rscData), 0)
    results.push(performance.now() - started)
  }
  console.log(
    JSON.stringify({
      runtime,
      node: process.version,
      next: require(path.join(nextRoot, "package.json")).version,
      fixture_buffer_bytes: fixture.value.rscData.length,
      iterations: results.length,
      pending_hit_ms: results,
      buffer_json_expansions: fixture.expansions(),
      storage_codec: cache.cacheHandler.storageCodec
        ? "base64+JSON"
        : "identity",
      scope: "synthetic storage; actual Next get/set; not HTTP TTFB",
    }),
  )
}

const runtimes = [
  "standalone",
  "app-page.runtime.prod.js",
  "app-page-turbo.runtime.prod.js",
  "app-page-experimental.runtime.prod.js",
  "app-page-turbo-experimental.runtime.prod.js",
]
if (process.argv.includes("--benchmark")) {
  await benchmark("app-page-turbo.runtime.prod.js")
} else {
  let failed = false
  for (const runtime of runtimes) {
    try {
      await check(runtime)
    } catch (error) {
      failed = true
      console.error(error.message)
    }
  }
  if (failed) process.exitCode = 1
}
