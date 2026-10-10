// Run against a local production build with local Redis and catalog data.
// Reports timing/status only; never saves response bodies or session cookies.
import assert from "node:assert/strict"
import { randomInt } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    origin: { type: "string" },
    "allow-failures": { type: "boolean", default: false },
  },
})
const base = new URL(values.base)
assert(
  base.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname),
  "This load probe is restricted to a local preview",
)
const headers = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
}
const paths = [
  "/watch",
  "/watch/chosen-witness.html",
  "/watch/english.html/videos",
]
const pages = []
const profiles = []

async function page(path) {
  const started = performance.now()
  const response = await fetch(new URL(path, base), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  })
  const bytes = (await response.arrayBuffer()).byteLength
  assert.equal(response.status, 200, `Fixture page unavailable: ${path}`)
  return {
    path,
    ms: Math.round(performance.now() - started),
    bytes,
    etag: response.headers.has("etag"),
    cacheControl: response.headers.get("cache-control"),
  }
}

// Warm all three routes before measuring cached serving, including ISR work.
for (const path of paths) await page(path)
await delay(1000)
const deadline = performance.now() + 20_000
// Separate local probe runs without exhausting one anonymous-IP test bucket.
const address = `198.18.${randomInt(256)}.${randomInt(1, 255)}`
const profileProbe = (async () => {
  while (performance.now() < deadline) {
    const started = performance.now()
    const response = await fetch(
      new URL("/watch/api/recommendations/profile", base),
      {
        method: "POST",
        redirect: "error",
        headers: {
          ...headers,
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
          origin: values.origin ?? base.origin,
          "cf-connecting-ip": address,
        },
        body: JSON.stringify({
          contractVersion: "recommendation-profile-v1",
          action: "status",
        }),
        signal: AbortSignal.timeout(5000),
      },
    ).catch(() => null)
    if (response) await response.arrayBuffer()
    profiles.push({
      status: response?.status ?? 0,
      ms: Math.round(performance.now() - started),
    })
    await delay(1000)
  }
})()
await Promise.all([
  profileProbe,
  ...Array.from({ length: 4 }, async (_, worker) => {
    let index = worker
    while (performance.now() < deadline) {
      pages.push(await page(paths[index++ % paths.length]))
      await delay(100)
    }
  }),
])
const summary = {
  profiles,
  pages: paths.map((path) => {
    const samples = pages.filter((sample) => sample.path === path)
    const times = samples.map(({ ms }) => ms).sort((a, b) => a - b)
    return {
      path,
      count: samples.length,
      p95Ms: times[Math.floor(times.length * 0.95)],
      maxMs: times.at(-1),
      bytes: samples[0]?.bytes,
      etag: samples[0]?.etag,
      cacheControl: samples[0]?.cacheControl,
    }
  }),
}
console.log(JSON.stringify(summary, null, 2))
if (!values["allow-failures"]) {
  assert(profiles.length >= 10, "Not enough profile requests completed")
  assert(
    profiles.every(({ status }) => status === 200),
    "Profile failed under page load",
  )
}
