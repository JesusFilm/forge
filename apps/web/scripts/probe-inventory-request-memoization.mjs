// Exercise the checkout's actual route through Next's production RSC runtime.
// Dependencies are controlled fixtures; this is not a production latency test.
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(webRoot, "../..")
const require = createRequire(join(webRoot, "package.json"))
const nextBin = require.resolve("next/dist/bin/next")
const args = process.argv.slice(2)
const customCacheHandler = args.includes("--custom-cache-handler")
const baselineCommit = args
  .find((arg) => arg.startsWith("--baseline-commit="))
  ?.replace(/^--baseline-commit=/, "")
assert.ok(
  new Set(args).size === args.length &&
    args.length <= 2 &&
    args.every(
      (arg) =>
        arg === "--custom-cache-handler" ||
        /^--baseline-commit=[a-f0-9]{40}$/.test(arg),
    ) &&
    args.filter((arg) => arg.startsWith("--baseline-commit=")).length <= 1,
  "Usage: node scripts/probe-inventory-request-memoization.mjs [--baseline-commit=<full SHA>] [--custom-cache-handler]",
)
const scratchRoot = join(repositoryRoot, ".tmp")
await mkdir(scratchRoot, { recursive: true })
const fixture = await mkdtemp(join(scratchRoot, "inventory-request-"))
const environment = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }
let server
let serverOutput = ""
const results = []

function fetchLocal(url, options = {}) {
  return globalThis.fetch(url, {
    ...options,
    signal: globalThis.AbortSignal.timeout(10_000),
  })
}

async function write(relativePath, content) {
  const path = join(fixture, relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function unusedPort() {
  const socket = createServer()
  socket.listen(0, "127.0.0.1")
  await once(socket, "listening")
  const port = socket.address().port
  await new Promise((resolveClose, reject) =>
    socket.close((error) => (error ? reject(error) : resolveClose())),
  )
  return port
}

try {
  await write("package.json", JSON.stringify({ private: true, type: "module" }))
  await symlink(
    join(webRoot, "node_modules"),
    join(fixture, "node_modules"),
    "dir",
  )
  const routeSource = await readFile(
    join(
      webRoot,
      "src/app/[locale]/[htmlLang]/(content)/videos/[languageSlug]/page.tsx",
    ),
    "utf8",
  )
  const aliases = Object.fromEntries(
    [
      ["next-intl", "i18n.jsx"],
      ["next-intl/server", "i18n.jsx"],
      [
        "@/components/watch-language-inventory/LanguageInventoryPage",
        "view.jsx",
      ],
      ["@/components/home/WatchHomeFooter", "view.jsx"],
      ["@/lib/watch-language-inventory", "inventory.js"],
      ["@/lib/locale", "helpers.js"],
      ["@/lib/routes", "helpers.js"],
      ["@/lib/inventory-language-name", "helpers.js"],
      ["@/i18n/client-messages", "i18n.jsx"],
    ].map(([name, file]) => [name, "./stubs/" + file]),
  )
  await write(
    "next.config.mjs",
    "export default " +
      JSON.stringify({
        turbopack: { root: repositoryRoot, resolveAlias: aliases },
        ...(customCacheHandler
          ? {
              cacheHandler: join(
                webRoot,
                "scripts/fixtures/cache-size-http-handler.mjs",
              ),
              cacheMaxMemorySize: 0,
            }
          : {}),
      }),
  )
  await write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2021",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "react-jsx",
        baseUrl: ".",
        paths: Object.fromEntries(
          Object.entries(aliases).map(([name, file]) => [name, [file]]),
        ),
      },
      include: [
        "**/*.ts",
        "**/*.tsx",
        "**/*.js",
        "**/*.jsx",
        ".next/types/**/*.ts",
      ],
      exclude: ["node_modules"],
    }),
  )
  await write(
    "app/layout.jsx",
    'export default function Layout({children}) { return <html lang="en"><body>{children}</body></html> }\n',
  )
  const staticPage =
    "app/static/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx"
  const renderedPage =
    "app/render/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx"
  await write(staticPage, routeSource)
  if (baselineCommit) {
    const baseline = spawnSync(
      "git",
      [
        "show",
        baselineCommit +
          ":apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    )
    assert.equal(baseline.status, 0, baseline.stderr)
    await write(
      "app/baseline/[locale]/[htmlLang]/videos/[languageSlug]/page.tsx",
      baseline.stdout,
    )
  }
  const routeImport = JSON.stringify(
    relative(dirname(join(fixture, renderedPage)), join(fixture, staticPage))
      .replaceAll("\\", "/")
      .replace(/\.tsx$/, ""),
  )
  await write(
    renderedPage,
    "export { default, generateMetadata } from " +
      routeImport +
      '\nexport const dynamic = "force-dynamic"\n',
  )
  await write(
    "stubs/inventory.js",
    [
      'const state = globalThis[Symbol.for("forge.inventory.request.probe")] ??= {}',
      "export function getCounts() { return state }",
      'export async function isAdmittedWatchInventoryLanguageSlug(slug) { return slug !== "blocked" }',
      "export async function resolveWatchLanguageInventory(locale, slug) {",
      ' const key = locale + ":" + slug',
      " state[key] = (state[key] ?? 0) + 1",
      " await new Promise(resolve => setTimeout(resolve, 20))",
      " return { languageName: locale + ' ' + slug, languageNativeName: slug === 'native' ? String(slug) : null, languageSlug: slug,",
      " cards: Array.from({length: 1000}, (_, i) => ({id: i, title: 'Fixture video ' + i})) }",
      "}",
    ].join("\n"),
  )
  await write(
    "stubs/helpers.js",
    [
      "export function resolveWatchLocaleIdentity(locale) { return {locale} }",
      "export function inventoryLanguageNameForTemplate({name, uiLocale, template}) { return name }",
      'export const WATCH_BASE_PATH = "/watch"',
      'export const WATCH_PUBLIC_METADATA_ORIGIN = "https://fixture.invalid"',
    ].join("\n"),
  )
  await write(
    "stubs/i18n.jsx",
    [
      "export function NextIntlClientProvider({children, locale, messages}) { return children }",
      "export function setRequestLocale(locale) {}",
      'export const LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES = ["LanguageInventory"]',
      "export async function loadClientMessages(locale, namespaces) { return {} }",
      "export async function getTranslations({locale, namespace}) {",
      ' const t = (key, {language}) => key + ": " + language',
      ' t.raw = (key) => "{language}"',
      " return t",
      "}",
    ].join("\n"),
  )
  await write(
    "stubs/view.jsx",
    [
      'export function WatchHomeFooter() { return <footer data-fixture-footer="true">Footer</footer> }',
      "export function LanguageInventoryPage({inventory}) {",
      ' return <main><h1>{inventory.languageName}</h1>{inventory.cards.map(card => <a key={card.id} data-fixture-card={card.id} href={"/watch/fixture-" + card.id + ".html"}>{card.title}</a>)}</main>',
      "}",
    ].join("\n"),
  )
  await write(
    "app/stats/route.js",
    'import {getCounts} from "../../stubs/inventory"\nexport const dynamic = "force-dynamic"\nexport function GET() { return Response.json(getCounts()) }\n',
  )

  const build = spawnSync(process.execPath, [nextBin, "build", fixture], {
    cwd: fixture,
    env: environment,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(
    build.status,
    0,
    build.error?.message ?? build.stdout + build.stderr,
  )
  const port = await unusedPort()
  const origin = "http://127.0.0.1:" + port
  server = spawn(
    process.execPath,
    [
      nextBin,
      "start",
      fixture,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: fixture, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  )
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (data) => {
      serverOutput = (serverOutput + data.toString()).slice(-16_000)
    })
  }
  let ready = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode != null) throw new Error(serverOutput)
    try {
      const response = await fetchLocal(origin + "/stats")
      if (response.ok) {
        await response.arrayBuffer()
        ready = true
        break
      }
    } catch {
      // The local process has not opened its socket yet.
    }
    await delay(100)
  }
  assert.ok(ready, "Next fixture did not start: " + serverOutput)

  for (const [surface, locale, language, expectedDelta] of [
    ["static", "en", "english", 1],
    ["static", "en", "english", 0],
    ["render", "en", "german", 1],
    ["render", "en", "german", 1],
    ["render", "de", "german", 1],
    ["render", "en", "urdu", 1],
  ]) {
    const key = locale + ":" + language
    const before = await (await fetchLocal(origin + "/stats")).json()
    const started = performance.now()
    const response = await fetchLocal(
      origin + "/" + surface + "/" + locale + "/en/videos/" + language,
    )
    const headersMs = performance.now() - started
    const html = await response.text()
    const after = await (await fetchLocal(origin + "/stats")).json()
    const calls = (after[key] ?? 0) - (before[key] ?? 0)
    results.push({ surface, locale, language, calls, headersMs })
    assert.equal(response.status, 200)
    assert.equal([...html.matchAll(/data-fixture-card="/g)].length, 1000)
    assert.ok(html.includes("<title>metadataTitle: " + locale + " " + language))
    assert.ok(
      html.includes(
        "https://fixture.invalid/watch/" + language + ".html/videos",
      ),
    )
    assert.ok(html.includes('data-fixture-footer="true"'))
    assert.equal(calls, expectedDelta, JSON.stringify(results))
  }

  const prefetch = await fetchLocal(
    origin + "/static/en/en/videos/portuguese",
    {
      headers: { RSC: "1", "Next-Router-Prefetch": "1" },
    },
  )
  const flight = await prefetch.text()
  const prefetchCounts = await (await fetchLocal(origin + "/stats")).json()
  assert.equal(prefetch.status, 200)
  assert.ok(flight.includes("Fixture video 999"))
  assert.ok(flight.includes("metadataTitle: en portuguese"))
  assert.equal(prefetchCounts["en:portuguese"], 1)

  const blocked = await fetchLocal(origin + "/static/en/en/videos/blocked")
  await blocked.arrayBuffer()
  const blockedCounts = await (await fetchLocal(origin + "/stats")).json()
  assert.equal(blocked.status, 404)
  assert.equal(blockedCounts["en:blocked"], undefined)

  const comparison = []
  if (baselineCommit) {
    for (let sample = 0; sample < 8; sample += 1) {
      // Alternate order to reduce simple warmup/order bias. These are bounded
      // local renders with controlled dependencies, not an incident load replay.
      const surfaces =
        sample % 2 === 0 ? ["baseline", "static"] : ["static", "baseline"]
      for (const surface of surfaces) {
        const language = "sample-" + sample
        const key = "en:" + language
        const before = await (await fetchLocal(origin + "/stats")).json()
        const started = performance.now()
        const response = await fetchLocal(
          origin + "/" + surface + "/en/en/videos/" + language,
        )
        const headersMs = performance.now() - started
        const html = await response.text()
        const after = await (await fetchLocal(origin + "/stats")).json()
        const calls = (after[key] ?? 0) - (before[key] ?? 0)
        assert.equal(response.status, 200)
        assert.equal([...html.matchAll(/data-fixture-card="/g)].length, 1000)
        assert.equal(calls, surface === "baseline" ? 2 : 1)
        comparison.push({
          surface,
          sample,
          calls,
          headersMs,
          bytes: Buffer.byteLength(html),
        })
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        result: "passed",
        scope:
          "Actual route source with controlled dependencies; not production latency evidence.",
        cacheHandler: customCacheHandler ? "custom fixture" : "default",
        requests: results,
        comparison,
      },
      null,
      2,
    ),
  )
} finally {
  if (server && server.exitCode == null && server.signalCode == null) {
    const exited = once(server, "exit")
    server.kill("SIGTERM")
    await Promise.race([exited, delay(5000)])
    if (server.exitCode == null && server.signalCode == null) {
      server.kill("SIGKILL")
      await exited
    }
  }
  await rm(fixture, { recursive: true, force: true })
}
