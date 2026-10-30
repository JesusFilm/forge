// Overhead of feat-745 telemetry per cache call and per scheduler sample, with real dd-trace (agent unreachable).
import { createRequire } from "node:module"
import { readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const require = createRequire("<apps/web>/package.json")
const tracer = require("dd-trace").init({
  url: "http://127.0.0.1:9",
  runtimeMetrics: false,
  startupLogs: false,
  telemetry: { enabled: false },
})
const { createNextCacheTelemetry, NEXT_CACHE_TELEMETRY_KEY } =
  await import("<apps/web>/src/observability/next-cache-telemetry.ts")
const { readSchedulerSnapshot, computeSchedulerPressure } =
  await import("<apps/web>/src/observability/scheduler-pressure.ts")
const { InstrumentedCacheHandler } =
  await import("<apps/web>/cache-handler.mjs")
const handler = new InstrumentedCacheHandler({
  dev: false,
  serverDistDir: mkdtempSync(join(tmpdir(), "bench-")),
})
await handler.set(
  "k",
  {
    kind: "FETCH",
    data: { body: "{}", headers: {}, url: "x" },
    revalidate: 60,
  },
  { revalidate: 60, tags: [] },
)
async function time(label: string, n: number, fn: () => Promise<unknown>) {
  for (let i = 0; i < 2000; i++) await fn()
  const t = process.hrtime.bigint()
  for (let i = 0; i < n; i++) await fn()
  const us = Number(process.hrtime.bigint() - t) / n / 1000
  console.log(label, us.toFixed(2), "us/op")
  return us
}
const N = 50000
const ctx = { kind: "FETCH", softTags: [] }
const base = await time("get_without_telemetry", N, () => handler.get("k", ctx))
;(globalThis as any)[NEXT_CACHE_TELEMETRY_KEY] = createNextCacheTelemetry({
  distribution: (m, v, tags) => tracer.dogstatsd.distribution(m, v, tags),
  tags: { replica_id: "bench", deployment_id: "bench" },
  tracer: {
    trace: (name, o, fn) => tracer.trace(name, o, (span: any) => fn(span)),
  },
})
const instr = await time("get_with_span_and_metric", N, () =>
  tracer.trace("web.request", {}, () => handler.get("k", ctx)),
)
const req = await time("request_span_only_reference", N, () =>
  tracer.trace("web.request", {}, async () => null),
)
console.log("telemetry_overhead_us_per_get", (instr - base - req).toFixed(2))
const rf = (p: string) => {
  try {
    return readFileSync(p, "utf8")
  } catch {
    return undefined
  }
}
let prev = readSchedulerSnapshot(
  rf,
  process.pid,
  Number(process.hrtime.bigint()),
)
const S = 5000
const t = process.hrtime.bigint()
for (let i = 0; i < S; i++) {
  const next = readSchedulerSnapshot(
    rf,
    process.pid,
    Number(process.hrtime.bigint()),
  )
  const g = computeSchedulerPressure(prev, next)
  prev = next
  for (const [m, v] of Object.entries(g))
    tracer.dogstatsd.gauge(m, v, { replica_id: "bench" })
}
console.log(
  "scheduler_sample_with_emit_us",
  (Number(process.hrtime.bigint() - t) / S / 1000).toFixed(1),
)
process.exit(0)
