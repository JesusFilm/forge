// Local-only real-browser transport probe. API and player are synthetic;
// the recorder, React lifecycle, fetch, timers, and HTTP transport are real.
import assert from "node:assert/strict"
import { Buffer } from "node:buffer"
import { execFile as execFileCallback } from "node:child_process"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath, URL } from "node:url"
import { promisify } from "node:util"
import { gzipSync } from "node:zlib"

const execFile = promisify(execFileCallback)
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(resolve(web, "package.json"))
const vitestRequire = createRequire(require.resolve("vitest/package.json"))
const viteRequire = createRequire(vitestRequire.resolve("vite/package.json"))
const { build } = viteRequire("esbuild")
const recorderPath =
  "src/components/recommendations/RecommendationPlaybackRecorder.tsx"
const baselineRef =
  process.env.PLAYBACK_BASELINE_REF ??
  "77eb63fbb325f6279955f34cffd1f8994f9281dd"
const { stdout: baseline } = await execFile(
  "git",
  ["show", `${baselineRef}:apps/web/${recorderPath}`],
  { cwd: web },
)
const entry = `
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RecommendationPlaybackRecorder } from './${recorderPath}';
import { RECOMMENDATION_TAB_CORRELATION_KEY } from './src/lib/recommendation-contracts';
class Player extends EventTarget { paused = true; currentTime = 0; duration = 120; muted = false; }
const player = new Player();
sessionStorage.setItem(RECOMMENDATION_TAB_CORRELATION_KEY, 'synthetic-claim-nonce-12345');
window.degradations = [];
window.addEventListener('forge:recommendation-playback-degraded', e => window.degradations.push({reason: e.detail.reason, disposition: e.detail.disposition}));
function Fixture() {
  useEffect(() => {
    performance.mark('fixture-mounted');
    const timer = setTimeout(() => { player.paused = false; player.dispatchEvent(new Event('playing')); }, 50);
    return () => clearTimeout(timer);
  }, []);
  return createElement(RecommendationPlaybackRecorder, {player, initiation: 'manual', mediaId: 'synthetic-media', durationSeconds: 120});
}
createRoot(document.getElementById('root')).render(createElement(Fixture));
`
const bundles = {}
for (const variant of ["baseline", "candidate"]) {
  const result = await build({
    absWorkingDir: web,
    stdin: { contents: entry, resolveDir: web, loader: "tsx" },
    bundle: true,
    write: false,
    minify: true,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@": resolve(web, "src") },
    plugins:
      variant === "baseline"
        ? [
            {
              name: "baseline-recorder",
              setup(plugin) {
                plugin.onLoad(
                  { filter: /\/RecommendationPlaybackRecorder\.tsx$/ },
                  () => ({
                    contents: baseline,
                    loader: "tsx",
                    resolveDir: resolve(web, dirname(recorderPath)),
                  }),
                )
              },
            },
          ]
        : [],
  })
  bundles[variant] = result.outputFiles[0].contents
}

const runs = new Map()
const serverFailures = []
const handleRequest = async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1")
  res.setHeader("cache-control", "no-store")
  if (url.pathname.endsWith(".js")) {
    res.setHeader("content-type", "text/javascript")
    res.end(bundles[url.pathname.slice(1, -3)])
    return
  }
  if (url.pathname === "/watch/api/recommendations/playback") {
    const run = runs.get(new URL(req.headers.referer).searchParams.get("run"))
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    res.setHeader("content-type", "application/json")
    if (body.action === "claim") {
      run.claims++
      run.claimStartedAt ??= performance.now()
      const at = performance.now() - run.claimStartedAt
      const failed = run.outage === "claim" && at < 8000
      run.claimAttempts.push({
        atMs: Math.round(at),
        status: failed ? 503 : 200,
      })
      const serialized = JSON.stringify(body)
      if (run.claimBody) assert.equal(run.claimBody, serialized)
      run.claimBody = serialized
      if (failed) {
        res.statusCode = 503
        res.end(JSON.stringify({ error: "upstream_unavailable" }))
        return
      }
      res.end(
        JSON.stringify({
          episode: {
            episodeId: "synthetic-episode",
            capability: "synthetic-capability",
            activeUntil: new Date(Date.now() + 3600000).toISOString(),
            hardUntil: new Date(Date.now() + 7200000).toISOString(),
          },
        }),
      )
      return
    }
    run.startedAt ??= performance.now()
    const at = performance.now() - run.startedAt
    const failed = run.outage === "facts" && at < 8000
    run.attempts.push({ atMs: Math.round(at), status: failed ? 503 : 200 })
    for (const fact of body.events) {
      const serialized = JSON.stringify(fact)
      if (run.seen.has(fact.eventId))
        assert.equal(run.seen.get(fact.eventId), serialized)
      run.seen.set(fact.eventId, serialized)
      if (!failed) run.accepted.add(fact.eventId)
    }
    res.statusCode = failed ? 503 : 200
    res.end(
      JSON.stringify(
        failed
          ? { error: "upstream_unavailable" }
          : {
              receipts: body.events.map((fact, i) => ({
                eventId: fact.eventId,
                status: "accepted",
                sequence: i + 1,
              })),
            },
      ),
    )
    return
  }
  res.setHeader("content-type", "text/html")
  const variant =
    url.searchParams.get("variant") === "baseline" ? "baseline" : "candidate"
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Playback recovery verification</title><script>window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});</script></head><body><h1>Playback recovery verification</h1><p>Local synthetic player and API; real recorder and browser transport.</p><div id="root"></div><script src="/${variant}.js"></script></body></html>`,
  )
}
const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    serverFailures.push(error)
    res.statusCode = 500
    res.end()
  })
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const session = `feat464-recovery-${process.pid}`
const browser = async (...args) =>
  (
    await execFile("agent-browser", ["--session", session, ...args], {
      timeout: 30000,
    })
  ).stdout
const results = []
try {
  for (const outage of ["none", "facts", "claim"]) {
    for (
      let iteration = 0;
      iteration < (outage === "none" ? 5 : 1);
      iteration++
    ) {
      for (const variant of ["baseline", "candidate"]) {
        const id = `${variant}-${outage}-${iteration}`
        const run = {
          outage,
          claims: 0,
          claimAttempts: [],
          attempts: [],
          seen: new Map(),
          accepted: new Set(),
        }
        runs.set(id, run)
        await browser("open", `${origin}/?run=${id}&variant=${variant}`)
        await browser("wait", outage === "none" ? "300" : "13000")
        const measurement = JSON.parse(
          await browser(
            "eval",
            "JSON.stringify({mountedAtMs:performance.getEntriesByName('fixture-mounted')[0]?.startTime,domContentLoadedMs:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,longTasks:window.longTasks,degradations:window.degradations})",
          ),
        )
        const metrics =
          typeof measurement === "string"
            ? JSON.parse(measurement)
            : measurement
        assert.deepEqual(serverFailures, [])
        assert.equal(run.claims, outage === "claim" ? 3 : 1)
        assert.equal(
          run.attempts.length,
          outage === "facts"
            ? 3
            : outage === "claim" && variant === "baseline"
              ? 0
              : 1,
        )
        assert.equal(
          run.accepted.size,
          outage !== "none" && variant === "baseline" ? 0 : 2,
        )
        if (outage !== "none" && variant === "candidate") {
          const attempts = outage === "claim" ? run.claimAttempts : run.attempts
          assert.ok(attempts[1].atMs >= 1000)
          assert.ok(attempts[2].atMs >= 9000)
          assert.equal(
            metrics.degradations.some((d) => d.disposition === "dropped"),
            false,
          )
        }
        // Navigation emits a later pagehide keepalive; snapshot this window now.
        results.push({
          variant,
          outage,
          iteration,
          claims: run.claims,
          claimAttempts: run.claimAttempts.map((attempt) => ({ ...attempt })),
          attempts: run.attempts.map((attempt) => ({ ...attempt })),
          uniqueFacts: run.seen.size,
          acceptedFacts: run.accepted.size,
          ...metrics,
        })
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        baselineRef,
        scope:
          "Real Chrome/HTTP/React/recorder; synthetic API and player, not full Watch/Admin integration or production",
        bundles: Object.fromEntries(
          Object.entries(bundles).map(([name, bytes]) => [
            name,
            { bytes: bytes.length, gzipBytes: gzipSync(bytes).length },
          ]),
        ),
        results,
      },
      null,
      2,
    ),
  )
} finally {
  await browser("close").catch(() => undefined)
  await new Promise((resolve) => server.close(resolve))
}
