/** Local-only real Chromium proof. Requires the disposable migrated acceptance DB. */
import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdir, readFile, writeFile } from "node:fs/promises"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const require = createRequire(resolve(repo, "package.json"))
const webRequire = createRequire(resolve(repo, "apps/web/package.json"))
const adminRequire = createRequire(resolve(repo, "apps/admin/package.json"))
const { build } = require(
  createRequire(require.resolve("tsx/package.json")).resolve("esbuild"),
)
const { chromium } = webRequire("@playwright/test")
const { PrismaClient } = adminRequire("@prisma/client")
const databaseUrl =
  process.env.WATCH_EXPOSURE_FIXTURE_DATABASE_URL ??
  "postgresql://forge:forge-local-fixture@127.0.0.1:32775/forge_exposure_acceptance"
const parsedDatabase = new URL(databaseUrl)
assert.equal(parsedDatabase.hostname, "127.0.0.1")
assert.equal(parsedDatabase.pathname, "/forge_exposure_acceptance")
const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
const scratch = resolve(repo, "work/watch-exposure-browser")
await mkdir(scratch, { recursive: true })
await build({
  entryPoints: [
    resolve(
      repo,
      "apps/admin/src/services/recommendations/watch-surface-exposure.service.ts",
    ),
  ],
  outfile: resolve(scratch, "admin.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "prisma-runtime",
      setup(builder) {
        builder.onResolve({ filter: /^@prisma\/client$/ }, () => ({
          path: adminRequire.resolve("@prisma/client"),
          external: true,
        }))
      },
    },
  ],
})
const { issueWatchSurfaceDelivery, recordWatchSurfaceExposureBatch } = require(
  resolve(scratch, "admin.cjs"),
)
const caller = {
  role: "CONSUMER_BEARER",
  rateLimitBucketKey: "local-browser-fixture",
}
const prefix = `browser-${Date.now()}`
const signerKey = "public-local-browser-fixture-only-key"
const sign = (manifest) =>
  createHmac("sha256", signerKey).update(JSON.stringify(manifest)).digest("hex")
const config = (name, suffix = "") => ({
  surface: "watch-search",
  block: "results",
  presentation: "result-list",
  placement: `${prefix}-${name}${suffix}`,
})
const cachedDescriptors = new Map()
const descriptor = (name, count, suffix = "") => {
  const key = `${name}:${count}:${suffix}`
  if (cachedDescriptors.has(key)) return cachedDescriptors.get(key)
  const items = Array.from({ length: count }, (_, position) => ({
    position,
    itemPath: `/watch/item-${position}.html`,
  }))
  const manifest = {
    ...config(name, suffix),
    policyVersion: "watch-exposure-v2",
    items,
    sourceVersion: createHash("sha256")
      .update(JSON.stringify(items))
      .digest("hex"),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }
  const signed = { manifest, signature: sign(manifest) }
  cachedDescriptors.set(key, signed)
  return signed
}
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{WatchExposureBoundary}from'${resolve(repo, "apps/web/src/components/recommendations/WatchExposureBoundary.tsx")}';
const f=window.fixtureConfig;window.fixturePageShows=[];window.addEventListener("pageshow",e=>window.fixturePageShows.push(e.persisted));const original=window.fetch;window.fixtureRequests=[];window.fetch=(url,init)=>{window.fixtureRequests.push({kind:String(url).split('/').pop(),ready:document.readyState,time:performance.now()});return original(url,init)};
function App(){const[order,setOrder]=useState(Array.from({length:f.count},(_,i)=>i));window.fixtureReorder=()=>setOrder([...order].reverse());const links=order.map(i=>React.createElement('a',{key:i,href:'/watch/item-'+i+'.html',id:'card-'+i,style:{display:'block',height:'90px'},onClick:f.navigate?undefined:e=>e.preventDefault()},'Card '+i));const blocks=f.mode==='baseline'?React.createElement('div',null,links):React.createElement(WatchExposureBoundary,{config:f.descriptors[0].manifest,manifest:f.descriptors[0]},links);return React.createElement(React.Fragment,null,blocks,f.repeat?React.createElement(WatchExposureBoundary,{config:f.descriptors[1].manifest,manifest:f.descriptors[1]},links.map((link,i)=>React.cloneElement(link,{id:'second-'+i}))):null)}createRoot(document.getElementById('app')).render(React.createElement(App));`
await build({
  stdin: {
    contents: entry,
    resolveDir: resolve(repo, "apps/web"),
    loader: "jsx",
  },
  outfile: resolve(scratch, "browser.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  tsconfig: resolve(repo, "apps/web/tsconfig.json"),
})
const js = await readFile(resolve(scratch, "browser.js"))
const transport = {
  issuances: [],
  ingestion: [],
  errors: [],
  retrySeen: new Set(),
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1")
    if (url.pathname === "/browser.js") {
      response.setHeader("content-type", "text/javascript")
      return response.end(js)
    }
    if (url.pathname === "/load-gate.svg") {
      await new Promise((resolve) => setTimeout(resolve, 400))
      response.setHeader("content-type", "image/svg+xml")
      return response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      )
    }
    if (url.pathname.startsWith("/watch/api/")) {
      let body = ""
      for await (const chunk of request) {
        body += chunk
        assert.ok(body.length <= 48 * 1024)
      }
      const input = JSON.parse(body)
      response.setHeader("content-type", "application/json")
      if (url.pathname.endsWith("surface-delivery")) {
        assert.equal(
          input.descriptor.signature,
          sign(input.descriptor.manifest),
        )
        const name = input.descriptor.manifest.placement
        if (name.includes("failure")) {
          response.statusCode = 503
          return response.end("{}")
        }
        const receipt = await issueWatchSurfaceDelivery(prisma, caller, {
          manifest: input.descriptor.manifest,
          attemptId: input.attemptId,
          trafficCategory: "ordinary_browser",
        })
        transport.issuances.push({
          name,
          attempt: input.attemptId,
          receipt: receipt.windowId,
          status: receipt.status,
        })
        if (
          name.includes("retry") &&
          !transport.retrySeen.has(input.attemptId)
        ) {
          transport.retrySeen.add(input.attemptId)
          request.socket.destroy()
          return
        }
        if (name.includes("early"))
          await new Promise((resolve) => setTimeout(resolve, 500))
        return response.end(JSON.stringify(receipt))
      }
      const receipts = await recordWatchSurfaceExposureBatch(
        prisma,
        caller,
        input,
      )
      transport.ingestion.push({
        count: receipts.length,
        status: receipts.map((value) => value.status),
      })
      return response.end(JSON.stringify(receipts))
    }
    if (/^\/watch\/item-\d+\.html$/.test(url.pathname))
      return response.end(
        "<!doctype html><title>Navigation completed</title><p>Destination</p>",
      )
    const name = url.searchParams.get("name") ?? "ordinary"
    const count = Number(url.searchParams.get("count") ?? 2)
    assert.ok(Number.isInteger(count) && count > 0 && count <= 70)
    const mode = url.searchParams.get("mode") ?? "enabled"
    const repeat = url.searchParams.has("repeat")
    const fixture = {
      mode,
      count,
      navigate: url.searchParams.has("navigate"),
      repeat,
      descriptors: [
        descriptor(name, count),
        ...(repeat ? [descriptor(name, count, "-repeat")] : []),
      ],
    }
    response.setHeader("content-type", "text/html")
    response.end(
      `<!doctype html><html><head><title>Local Watch exposure fixture</title></head><body><img src="/load-gate.svg" alt=""><div id="app"></div><script>window.fixtureConfig=${JSON.stringify(fixture)}</script><script type="module" src="/browser.js"></script></body></html>`,
    )
  } catch (error) {
    transport.errors.push(error.message)
    response.statusCode = 400
    response.end(JSON.stringify({ error: "fixture-rejected" }))
  }
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 900, height: 500 },
})
const page = await context.newPage()
const checks = []
const check = (name, passed, detail) => {
  checks.push({ name, passed, detail })
  assert.ok(passed, name)
}
const wait = (ms) => page.waitForTimeout(ms)
const rows = (name) =>
  prisma.watchSurfaceExposure.findMany({
    where: { placement: { startsWith: `${prefix}-${name}` } },
    select: {
      kind: true,
      position: true,
      policyVersion: true,
      visibilityCapability: true,
      duplicateCount: true,
      occurredAt: true,
    },
  })
const navigate = (name, query = "") =>
  page.goto(`${origin}/?name=${name}${query}`)
const evidence = {
  schema: 1,
  environment:
    "isolated local Chromium + actual React boundary + migrated disposable PostgreSQL + actual Admin issuer/ingestion",
  browser: browser.version(),
  checks,
  performance: [],
}
try {
  for (let i = 0; i < 8; i++) {
    const mode = i % 2 === 0 ? "baseline" : "enabled"
    await navigate(`perf-${i}`, `&count=70&mode=${mode}`)
    await wait(450)
    const metrics = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0]
      return {
        dclMs: n.domContentLoadedEventEnd,
        loadMs: n.loadEventEnd,
        fcpMs:
          performance.getEntriesByName("first-contentful-paint")[0]
            ?.startTime ?? null,
        resources: performance.getEntriesByType("resource").length,
        scriptBytes: performance
          .getEntriesByType("resource")
          .filter((r) => r.initiatorType === "script")
          .reduce((sum, r) => sum + r.encodedBodySize, 0),
        issuanceBeforeLoad: window.fixtureRequests.filter(
          (r) => r.kind === "surface-delivery" && r.ready !== "complete",
        ).length,
      }
    })
    evidence.performance.push({ mode, ...metrics })
    check(
      `performance-run-${i}-issuance-after-load`,
      metrics.issuanceBeforeLoad === 0,
      mode,
    )
  }
  await navigate("belowfold", "&count=10")
  await wait(1500)
  let facts = await rows("belowfold")
  check(
    "belowfold-is-served-and-rendered-without-eligibility",
    facts.some((f) => f.position === 9 && f.kind === "served") &&
      facts.some((f) => f.position === 9 && f.kind === "rendered") &&
      !facts.some((f) => f.position === 9 && f.kind === "eligible"),
    "Real viewport/intersection, 1.5 second dwell",
  )
  await page.locator("#card-9").scrollIntoViewIfNeeded()
  await wait(1350)
  check(
    "scroll-plus-dwell-produces-eligibility",
    (await rows("belowfold")).some(
      (f) => f.position === 9 && f.kind === "eligible",
    ),
    "Continuous real IntersectionObserver dwell",
  )
  await page.locator("#card-9").click()
  await wait(200)
  check(
    "selection-after-dwell-retains-eligibility",
    (await rows("belowfold")).some(
      (f) => f.position === 9 && f.kind === "selected",
    ),
    "No synthetic impression on click",
  )
  await page.locator("#card-0").scrollIntoViewIfNeeded()
  await wait(200)
  await page.locator("#card-9").scrollIntoViewIfNeeded()
  await wait(1350)
  check(
    "repeated-dwell-emits-once-per-card-window",
    (await rows("belowfold")).filter(
      (f) => f.position === 9 && f.kind === "eligible",
    ).length === 1,
    "Leave and return to same issued card",
  )
  await navigate("early")
  const earlyStarted = Date.now()
  await page.locator("#card-0").click()
  await wait(800)
  facts = await rows("early")
  check(
    "early-selection-preserves-anomaly",
    facts.some((f) => f.kind === "selected") &&
      facts
        .filter((f) => f.kind === "selected")
        .every((selected) =>
          facts
            .filter(
              (f) => f.kind === "eligible" && f.position === selected.position,
            )
            .every((eligible) => selected.occurredAt < eligible.occurredAt),
        ),
    "Selection buffered during delayed receipt; no eligibility fabricated",
  )
  evidence.earlySelectionElapsedMs = Date.now() - earlyStarted
  await navigate("departure", "&navigate=1")
  const departing = Date.now()
  await page.locator("#card-0").click()
  await page.waitForURL("**/watch/item-0.html")
  evidence.navigationElapsedMs = Date.now() - departing
  await wait(300)
  check(
    "navigation-completes-without-awaiting-telemetry",
    evidence.navigationElapsedMs < 1000 &&
      (await rows("departure")).some((f) => f.kind === "selected"),
    "Ordinary anchor destination and keepalive departure telemetry",
  )
  await navigate("repeat", "&repeat=1")
  await wait(1500)
  facts = await rows("repeat")
  check(
    "repeated-blocks-have-separate-served-windows",
    facts.filter((f) => f.kind === "served").length === 4 &&
      facts.filter((f) => f.kind === "rendered").length === 4,
    "Two explicit placements",
  )
  await navigate("reorder")
  await wait(550)
  await page.evaluate(() => window.fixtureReorder())
  await wait(650)
  facts = await rows("reorder")
  check(
    "reorder-cancels-continuous-dwell",
    !facts.some((f) => f.kind === "eligible"),
    "Reorder before initial one-second dwell",
  )
  await wait(700)
  facts = await rows("reorder")
  check(
    "reordered-unknown-projection-remains-v1",
    facts.some(
      (f) => f.kind === "rendered" && f.policyVersion === "watch-exposure-v1",
    ),
    "Origin slate is not rewritten by DOM reorder",
  )
  await navigate("failure")
  await page.locator("#card-0").click()
  await wait(450)
  facts = await rows("failure")
  check(
    "issuance-failure-falls-back-without-served",
    facts.some(
      (f) => f.kind === "selected" && f.policyVersion === "watch-exposure-v1",
    ) && !facts.some((f) => f.kind === "served"),
    "Two transport failures",
  )
  await navigate("retry")
  await wait(500)
  const attempts = transport.issuances.filter(
    (i) => i.name === `${prefix}-retry`,
  )
  check(
    "lost-receipt-retries-same-attempt",
    attempts.length === 2 &&
      attempts[0].attempt === attempts[1].attempt &&
      attempts[0].receipt === attempts[1].receipt &&
      attempts[1].status === "replay",
    "Server commits first issuance, socket loses response",
  )
  const cached = await page.evaluate(() => window.fixtureConfig.descriptors[0])
  await page.reload()
  await wait(500)
  const reusedDescriptor = await page.evaluate(
    () => window.fixtureConfig.descriptors[0],
  )
  check(
    "cached-descriptor-reused-verbatim",
    JSON.stringify(cached) === JSON.stringify(reusedDescriptor),
    "Fixture source-response descriptor cache, not full HTML cache",
  )
  const cachedAttempts = transport.issuances.filter(
    (i) => i.name === `${prefix}-retry`,
  )
  check(
    "new-navigation-issues-new-window",
    new Set(cachedAttempts.map((i) => i.receipt)).size === 2,
    "New React navigation; reusable source descriptor, cache equivalence checked separately",
  )
  evidence.cachedDescriptorLifetimeSeconds = Math.round(
    (new Date(cached.manifest.expiresAt) - Date.now()) / 1000,
  )
  await navigate("bfcache", "&navigate=1")
  await wait(450)
  await page.locator("#card-0").click()
  await page.waitForURL("**/watch/item-0.html")
  await page.goBack()
  await wait(600)
  evidence.bfcache = {
    persistedObserved: await page.evaluate(() =>
      window.fixturePageShows.includes(true),
    ),
    newWindows: new Set(
      transport.issuances
        .filter((i) => i.name === `${prefix}-bfcache`)
        .map((i) => i.receipt),
    ).size,
  }
  check(
    "back-navigation-creates-separate-window",
    evidence.bfcache.newWindows === 2,
    evidence.bfcache.persistedObserved
      ? "Native BFCache pageshow observed"
      : "History navigation reloaded; native BFCache not observed",
  )
  await navigate("hidden-simulation")
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await wait(1250)
  check(
    "simulated-hidden-document-cancels-dwell",
    !(await rows("hidden-simulation")).some((f) => f.kind === "eligible"),
    "Real browser with Document property simulation; headless tabs remain visible",
  )
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await wait(1350)
  check(
    "simulated-visible-document-requires-fresh-dwell",
    (await rows("hidden-simulation")).some((f) => f.kind === "eligible"),
    "Fresh one-second dwell after visibilitychange",
  )
  await navigate("occlusion")
  await page.evaluate(() => {
    const cover = document.createElement("div")
    cover.style.cssText = "position:fixed;inset:0;background:black;z-index:999"
    document.body.append(cover)
  })
  await wait(1350)
  facts = await rows("occlusion")
  evidence.occlusion = {
    eligible: facts.filter((f) => f.kind === "eligible").length,
    capabilities: [
      ...new Set(facts.map((f) => f.visibilityCapability).filter(Boolean)),
    ],
  }
  check(
    "occlusion-aware-observer-rejects-covered-dwell",
    !facts.some((f) => f.kind === "eligible"),
    "Real Chromium visibility tracking",
  )
  await navigate("prerender-simulation")
  await wait(500)
  // Reload with a Document property simulation before any React code. This is
  // activation lifecycle proof, not a browser-native speculative cache proof.
  await page.addInitScript(() =>
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      value: true,
    }),
  )
  const beforePrerender = transport.issuances.length
  await page.reload()
  await wait(400)
  check(
    "simulated-prerender-no-issuance",
    transport.issuances.length === beforePrerender,
    "Document property simulation, explicitly not native prerender",
  )
  await page.evaluate(() => {
    Object.defineProperty(document, "prerendering", {
      configurable: true,
      value: false,
    })
    document.dispatchEvent(new Event("prerenderingchange"))
  })
  await wait(500)
  check(
    "simulated-activation-starts-issuance",
    transport.issuances.length > beforePrerender,
    "After prerenderingchange",
  )
  check(
    "actual-admin-ingestion-has-no-fixture-errors",
    transport.errors.length === 0,
    `${transport.ingestion.length} accepted batches`,
  )
  const all = await prisma.watchSurfaceExposure.groupBy({
    by: ["kind", "policyVersion", "visibilityCapability"],
    where: { placement: { startsWith: prefix } },
    _count: { _all: true },
    _sum: { duplicateCount: true },
  })
  evidence.aggregate = all.map((row) => ({
    kind: row.kind,
    policyVersion: row.policyVersion,
    capability: row.visibilityCapability,
    count: row._count._all,
    duplicateAttempts: row._sum.duplicateCount ?? 0,
  }))
  evidence.transport = {
    issuedResponses: transport.issuances.length,
    acceptedBatches: transport.ingestion.length,
    errors: transport.errors.length,
  }
  evidence.limitations = [
    "Local production React bundle fixture, not the full Next app or deployed reconciliation",
    "Baseline includes same bundle bytes; isolates boundary initialization and requests",
    "Native prerender, real cached HTML and hidden-tab scheduling require separate deployed/browser harness proof; BFCache observed field records actual outcome",
    "Signing fixture uses public local-only key; actual Web signer and HTTP origin fences covered separately",
    "No production flags, identities, cookies, queries or deployment",
  ]
  await writeFile(
    resolve(repo, "docs/validation/2026-09-29-feat-373-browser-local.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  )
  console.log(
    JSON.stringify({
      passed: checks.length,
      browser: evidence.browser,
      aggregate: evidence.aggregate,
      transport: evidence.transport,
    }),
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
  await prisma.$disconnect()
}
