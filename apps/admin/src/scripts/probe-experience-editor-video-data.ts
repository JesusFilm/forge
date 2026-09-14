import { createHash } from "node:crypto"
import { readFile, stat, writeFile } from "node:fs/promises"
import { cpus, hostname, platform, release, totalmem } from "node:os"
import { pathToFileURL } from "node:url"

const DEFAULT_RUNS = 30
const DEFAULT_WARMUPS = 1
const DEFAULT_CONCURRENCIES = [1, 4] as const
const DEFAULT_IDLE_MS = 60_000
const DEFAULT_DUB_MARKER = '"streamUrl"'
const RSS_POLL_MS = 25

type CliOptions = {
  activeDubs: number | null
  allowShortRun: boolean
  baselinePath: string | null
  bodyPath: string | null
  collectionBodyPath: string | null
  collectionUrl: URL | null
  concurrency: number[]
  confirmNonProduction: boolean
  cookiePath: string | null
  cycles: number
  dryRun: boolean
  dubMarker: string
  editorUrl: URL | null
  environment: "local" | "staging"
  fixture: string
  headersPath: string | null
  idleMs: number
  largestCollectionChildren: number | null
  outPath: string | null
  publicBodyPath: string | null
  publicUrl: URL | null
  referencedVideos: number | null
  revision: string
  runs: number
  saveBodyPath: string | null
  saveHeadersPath: string | null
  saveUrl: URL | null
  serverLogPath: string | null
  serverPid: number | null
  sqlLogPath: string | null
  warmups: number
}

type RequestSpec = {
  body: string | null
  cookie: string | null
  headers: Record<string, string>
  method: "GET" | "POST"
  url: URL
}

type HttpSample = {
  elapsedMs: number
  responseBytes: number
  serializedDubRecords: number
  status: number
}

type ProfileResult = {
  concurrency: number
  failures: number
  publicFailures: number | null
  publicSamples: HttpSample[] | null
  poolTimeouts: number | null
  rssBeforeBytes: number | null
  rssPeakBytes: number | null
  rssPeakDeltaBytes: number | null
  samples: HttpSample[]
  sqlStatements: number | null
}

function usage() {
  return `Experience editor bounded-data probe

Required for a live run:
  --environment <local|staging>  Target class; production is unsupported
  --fixture <label>              Stable fixture label
  --revision <git-sha>           Revision being measured
  --editor-url <url>             Authenticated editor GET URL
  --referenced-videos <count>    Fixture referenced-video count
  --active-dubs <count>          Fixture active-Dub count
  --largest-collection-children <count>

Measurement options:
  --runs <n>                     Samples per profile (default: 30)
  --warmups <n>                  Unrecorded requests (default: 1)
  --concurrency <csv>            Editor profiles (default: 1,4)
  --cookie-file <path>           Mode-0600 cookie value; never emitted
  --headers-file <path>          JSON object of request headers; values never emitted
  --body-file <path>             Optional editor POST body (switches editor to POST)
  --public-url <url>             No-editor control URL
  --public-body-file <path>      Optional public POST body
  --save-url <url>               Optional idempotent save-cycle URL
  --save-body-file <path>        Required with --save-url
  --save-headers-file <path>     Optional save-only JSON headers
  --cycles <n>                   Open/save RSS cycles (default: 20 with save URL)
  --idle-ms <n>                  Idle after each cycle (default: 60000)
  --server-pid <pid>             Local Admin PID for RSS sampling
  --sql-log <path>               Append-only JSONL, one emitted SQL statement per line
  --server-log <path>            Append-only Admin log for pool-timeout detection
  --collection-url <url>         Largest-collection expansion request
  --collection-body-file <path>  Optional collection POST body
  --dub-marker <text>            Serialized Dub record marker (default: "streamUrl")
  --baseline <path>              Baseline JSON from this probe for comparison
  --out <path>                   Write JSON report in addition to stdout

Inspection options:
  --dry-run                      Validate and print the redacted workload contract
  --allow-short-run              Permit fewer than 30 timing samples
  --confirm-non-production       Required for staging targets
  --help
`
}

function takeValue(args: string[], index: number, flag: string) {
  const value = args[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function positiveInteger(value: string, flag: string, allowZero = false) {
  const number = Number(value)
  const minimum = allowZero ? 0 : 1
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${flag} must be an integer >= ${minimum}`)
  }
  return number
}

function optionalUrl(value: string | undefined, flag: string) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol")
    }
    return url
  } catch {
    throw new Error(`${flag} must be an HTTP(S) URL`)
  }
}

export function parseOptions(args: string[]): CliOptions {
  const values = new Map<string, string>()
  const switches = new Set<string>()
  const switchNames = new Set([
    "--allow-short-run",
    "--confirm-non-production",
    "--dry-run",
  ])

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === "--") continue
    if (flag === "--help") {
      process.stdout.write(usage())
      process.exit(0)
    }
    if (!flag?.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`)
    if (switchNames.has(flag)) {
      switches.add(flag)
      continue
    }
    values.set(flag, takeValue(args, index, flag))
    index += 1
  }

  const environment = values.get("--environment") ?? "local"
  if (environment !== "local" && environment !== "staging") {
    throw new Error("--environment must be local or staging")
  }
  const concurrency = (
    values.get("--concurrency") ?? DEFAULT_CONCURRENCIES.join(",")
  )
    .split(",")
    .map((value) => positiveInteger(value.trim(), "--concurrency"))
  const saveUrl = optionalUrl(values.get("--save-url"), "--save-url")

  return {
    activeDubs: values.has("--active-dubs")
      ? positiveInteger(values.get("--active-dubs")!, "--active-dubs")
      : null,
    allowShortRun: switches.has("--allow-short-run"),
    baselinePath: values.get("--baseline") ?? null,
    bodyPath: values.get("--body-file") ?? null,
    collectionBodyPath: values.get("--collection-body-file") ?? null,
    collectionUrl: optionalUrl(
      values.get("--collection-url"),
      "--collection-url",
    ),
    concurrency: Array.from(new Set(concurrency)),
    confirmNonProduction: switches.has("--confirm-non-production"),
    cookiePath: values.get("--cookie-file") ?? null,
    cycles: values.has("--cycles")
      ? positiveInteger(values.get("--cycles")!, "--cycles", true)
      : saveUrl
        ? 20
        : 0,
    dryRun: switches.has("--dry-run"),
    dubMarker: values.get("--dub-marker") ?? DEFAULT_DUB_MARKER,
    editorUrl: optionalUrl(values.get("--editor-url"), "--editor-url"),
    environment,
    fixture: values.get("--fixture") ?? "unconfigured",
    headersPath: values.get("--headers-file") ?? null,
    idleMs: values.has("--idle-ms")
      ? positiveInteger(values.get("--idle-ms")!, "--idle-ms", true)
      : DEFAULT_IDLE_MS,
    largestCollectionChildren: values.has("--largest-collection-children")
      ? positiveInteger(
          values.get("--largest-collection-children")!,
          "--largest-collection-children",
          true,
        )
      : null,
    outPath: values.get("--out") ?? null,
    publicBodyPath: values.get("--public-body-file") ?? null,
    publicUrl: optionalUrl(values.get("--public-url"), "--public-url"),
    referencedVideos: values.has("--referenced-videos")
      ? positiveInteger(
          values.get("--referenced-videos")!,
          "--referenced-videos",
        )
      : null,
    revision: values.get("--revision") ?? "unconfigured",
    runs: values.has("--runs")
      ? positiveInteger(values.get("--runs")!, "--runs")
      : DEFAULT_RUNS,
    saveBodyPath: values.get("--save-body-file") ?? null,
    saveHeadersPath: values.get("--save-headers-file") ?? null,
    saveUrl,
    serverLogPath: values.get("--server-log") ?? null,
    serverPid: values.has("--server-pid")
      ? positiveInteger(values.get("--server-pid")!, "--server-pid")
      : null,
    sqlLogPath: values.get("--sql-log") ?? null,
    warmups: values.has("--warmups")
      ? positiveInteger(values.get("--warmups")!, "--warmups", true)
      : DEFAULT_WARMUPS,
  }
}

function isLoopback(url: URL) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
}

function validateOptions(options: CliOptions) {
  const errors: string[] = []
  if (!options.dryRun && !options.editorUrl)
    errors.push("--editor-url is required")
  if (!options.dryRun && options.fixture === "unconfigured") {
    errors.push("--fixture is required")
  }
  if (!options.dryRun && options.revision === "unconfigured") {
    errors.push("--revision is required")
  }
  if (!options.dryRun && options.referencedVideos == null) {
    errors.push("--referenced-videos is required")
  }
  if (!options.dryRun && options.activeDubs == null) {
    errors.push("--active-dubs is required")
  }
  if (!options.dryRun && options.largestCollectionChildren == null) {
    errors.push("--largest-collection-children is required")
  }
  if (options.runs < 30 && !options.allowShortRun) {
    errors.push(
      "--runs must be at least 30 unless --allow-short-run is present",
    )
  }
  if (options.environment === "staging" && !options.confirmNonProduction) {
    errors.push("staging requires --confirm-non-production")
  }
  for (const url of [
    options.editorUrl,
    options.publicUrl,
    options.saveUrl,
    options.collectionUrl,
  ]) {
    if (url && options.environment === "local" && !isLoopback(url)) {
      errors.push(`local target is not loopback: ${url.hostname}`)
    }
  }
  if (options.saveUrl && !options.saveBodyPath) {
    errors.push("--save-body-file is required with --save-url")
  }
  if (options.cycles > 0 && !options.saveUrl) {
    errors.push("--cycles requires --save-url")
  }
  if (errors.length > 0) throw new Error(errors.join("; "))
}

function targetFingerprint(url: URL | null) {
  if (!url) return null
  return createHash("sha256").update(url.href).digest("hex").slice(0, 16)
}

async function loadHeaders(path: string | null) {
  if (!path) return {}
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`)
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`${path}: header ${name} must be a string`)
    }
    if (["authorization", "cookie"].includes(name.toLowerCase())) {
      throw new Error(
        `${path}: put credentials in --cookie-file, not headers JSON`,
      )
    }
    headers[name] = value
  }
  return headers
}

async function loadCookie(path: string | null) {
  if (!path) return null
  const metadata = await stat(path)
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${path} must not be readable or writable by group/other`)
  }
  const cookie = (await readFile(path, "utf8")).trim()
  if (!cookie) throw new Error(`${path} is empty`)
  return cookie
}

async function requestSpec({
  bodyPath,
  cookie,
  headersPath,
  url,
}: {
  bodyPath: string | null
  cookie: string | null
  headersPath: string | null
  url: URL
}): Promise<RequestSpec> {
  return {
    body: bodyPath ? await readFile(bodyPath, "utf8") : null,
    cookie,
    headers: await loadHeaders(headersPath),
    method: bodyPath ? "POST" : "GET",
    url,
  }
}

function countMarker(body: string, marker: string) {
  if (!marker) return 0
  const escaped = marker.replaceAll('"', '\\"')
  let count = 0
  let offset = 0
  while (offset < body.length) {
    const directIndex = body.indexOf(marker, offset)
    const escapedIndex = escaped === marker ? -1 : body.indexOf(escaped, offset)
    const candidates = [directIndex, escapedIndex].filter((index) => index >= 0)
    if (candidates.length === 0) break
    offset = Math.min(...candidates) + marker.length
    count += 1
  }
  return count
}

async function runRequest(spec: RequestSpec, dubMarker: string) {
  const startedAt = performance.now()
  const response = await fetch(spec.url, {
    body: spec.body,
    headers: {
      accept: "text/x-component, text/html, application/json",
      "accept-encoding": "identity",
      ...(spec.body ? { "content-type": "application/json" } : {}),
      ...spec.headers,
      ...(spec.cookie ? { cookie: spec.cookie } : {}),
    },
    method: spec.method,
    redirect: "manual",
    signal: AbortSignal.timeout(180_000),
  })
  const body = await response.text()
  return {
    elapsedMs: performance.now() - startedAt,
    responseBytes: Buffer.byteLength(body),
    serializedDubRecords: countMarker(body, dubMarker),
    status: response.status,
  } satisfies HttpSample
}

async function readRssBytes(pid: number | null) {
  if (!pid) return null
  const status = await readFile(`/proc/${pid}/status`, "utf8")
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)
  if (!match) throw new Error(`VmRSS is unavailable for PID ${pid}`)
  return Number(match[1]) * 1024
}

async function fileOffset(path: string | null) {
  if (!path) return null
  return (await stat(path)).size
}

async function appendedText(path: string | null, offset: number | null) {
  if (!path || offset == null) return null
  const content = await readFile(path)
  if (content.length < offset)
    throw new Error(`${path} rotated during the probe`)
  return content.subarray(offset).toString("utf8")
}

function nonemptyLines(value: string | null) {
  if (value == null) return null
  return value.split(/\r?\n/u).filter((line) => line.trim()).length
}

function poolTimeoutCount(value: string | null) {
  if (value == null) return null
  return value
    .split(/\r?\n/u)
    .filter((line) =>
      /P2024|pool timeout|timed out fetching a new connection/iu.test(line),
    ).length
}

async function withRssPeak<T>(pid: number | null, operation: () => Promise<T>) {
  const before = await readRssBytes(pid)
  let peak = before
  const timer = pid
    ? setInterval(() => {
        void readRssBytes(pid).then((value) => {
          if (value != null) peak = Math.max(peak ?? value, value)
        })
      }, RSS_POLL_MS)
    : null
  try {
    const result = await operation()
    const after = await readRssBytes(pid)
    if (after != null) peak = Math.max(peak ?? after, after)
    return { result, rssBefore: before, rssPeak: peak }
  } finally {
    if (timer) clearInterval(timer)
  }
}

async function runProfile({
  concurrency,
  dubMarker,
  runs,
  serverLogPath,
  serverPid,
  publicSpec,
  spec,
  sqlLogPath,
}: {
  concurrency: number
  dubMarker: string
  runs: number
  serverLogPath: string | null
  serverPid: number | null
  publicSpec?: RequestSpec | null
  spec: RequestSpec
  sqlLogPath: string | null
}): Promise<ProfileResult> {
  const sqlOffset = await fileOffset(sqlLogPath)
  const serverOffset = await fileOffset(serverLogPath)
  const measured = await withRssPeak(serverPid, async () => {
    const samples: HttpSample[] = []
    const publicSamples: HttpSample[] = []
    for (let round = 0; round < runs; round += 1) {
      const results = await Promise.all([
        ...Array.from({ length: concurrency }, () =>
          runRequest(spec, dubMarker),
        ),
        ...(publicSpec ? [runRequest(publicSpec, dubMarker)] : []),
      ])
      samples.push(...results.slice(0, concurrency))
      if (publicSpec) publicSamples.push(...results.slice(concurrency))
    }
    return { publicSamples, samples }
  })
  const sqlText = await appendedText(sqlLogPath, sqlOffset)
  const serverText = await appendedText(serverLogPath, serverOffset)
  return {
    concurrency,
    failures: measured.result.samples.filter((sample) => sample.status >= 500)
      .length,
    publicFailures: publicSpec
      ? measured.result.publicSamples.filter((sample) => sample.status >= 500)
          .length
      : null,
    publicSamples: publicSpec ? measured.result.publicSamples : null,
    poolTimeouts: poolTimeoutCount(serverText),
    rssBeforeBytes: measured.rssBefore,
    rssPeakBytes: measured.rssPeak,
    rssPeakDeltaBytes:
      measured.rssBefore == null || measured.rssPeak == null
        ? null
        : measured.rssPeak - measured.rssBefore,
    samples: measured.result.samples,
    sqlStatements: nonemptyLines(sqlText),
  }
}

function percentile(values: readonly number[], quantile: number) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? null
}

function mean(values: readonly number[]) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

function summarizeSamples(samples: readonly HttpSample[]) {
  return {
    count: samples.length,
    elapsedMs: {
      min: samples.length
        ? Math.min(...samples.map((sample) => sample.elapsedMs))
        : null,
      median: percentile(
        samples.map((sample) => sample.elapsedMs),
        0.5,
      ),
      p95: percentile(
        samples.map((sample) => sample.elapsedMs),
        0.95,
      ),
      max: samples.length
        ? Math.max(...samples.map((sample) => sample.elapsedMs))
        : null,
    },
    responseBytes: {
      median: percentile(
        samples.map((sample) => sample.responseBytes),
        0.5,
      ),
      max: samples.length
        ? Math.max(...samples.map((sample) => sample.responseBytes))
        : null,
    },
    serializedDubRecords: {
      median: percentile(
        samples.map((sample) => sample.serializedDubRecords),
        0.5,
      ),
      max: samples.length
        ? Math.max(...samples.map((sample) => sample.serializedDubRecords))
        : null,
    },
    statuses: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.status))]
        .sort((left, right) => left - right)
        .map((status) => [
          status,
          samples.filter((sample) => sample.status === status).length,
        ]),
    ),
  }
}

function linearTrend(values: readonly number[]) {
  if (values.length < 3) return null
  const xMean = (values.length - 1) / 2
  const yMean = mean(values)!
  const sxx = values.reduce(
    (sum, _value, index) => sum + (index - xMean) ** 2,
    0,
  )
  const slope =
    values.reduce(
      (sum, value, index) => sum + (index - xMean) * (value - yMean),
      0,
    ) / sxx
  const residualSumSquares = values.reduce(
    (sum, value, index) =>
      sum + (value - (yMean + slope * (index - xMean))) ** 2,
    0,
  )
  const standardError = Math.sqrt(
    residualSumSquares / (values.length - 2) / sxx,
  )
  // With the required 20 cycles this is Student t(18), not a large-sample
  // normal interval. Longer runs use the asymptotic 1.96 cutoff.
  const criticalValue =
    values.length === 20 ? 2.101 : values.length < 30 ? 2.16 : 1.96
  const margin = criticalValue * standardError
  return {
    ci95: [slope - margin, slope + margin],
    ci95IncludesZero: slope - margin <= 0 && slope + margin >= 0,
    slopeBytesPerCycle: slope,
  }
}

async function runCycles({
  dubMarker,
  idleMs,
  open,
  save,
  serverPid,
  total,
}: {
  dubMarker: string
  idleMs: number
  open: RequestSpec
  save: RequestSpec
  serverPid: number | null
  total: number
}) {
  const rssAfterIdleBytes: number[] = []
  const timings: Array<{ openMs: number; saveMs: number }> = []
  for (let index = 0; index < total; index += 1) {
    const openSample = await runRequest(open, dubMarker)
    const saveSample = await runRequest(save, dubMarker)
    if (openSample.status >= 400 || saveSample.status >= 400) {
      throw new Error(
        `open/save cycle ${index + 1} failed (${openSample.status}/${saveSample.status})`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, idleMs))
    const rss = await readRssBytes(serverPid)
    if (rss != null) rssAfterIdleBytes.push(rss)
    timings.push({ openMs: openSample.elapsedMs, saveMs: saveSample.elapsedMs })
  }
  const firstFiveMean = mean(rssAfterIdleBytes.slice(0, 5))
  const finalFiveMean = mean(rssAfterIdleBytes.slice(-5))
  return {
    firstFiveMeanBytes: firstFiveMean,
    finalFiveMeanBytes: finalFiveMean,
    finalFiveWithinFivePercent:
      firstFiveMean == null || finalFiveMean == null
        ? null
        : finalFiveMean <= firstFiveMean * 1.05,
    idleMs,
    rssAfterIdleBytes,
    timings,
    total,
    trend: linearTrend(rssAfterIdleBytes),
  }
}

function reductionPercent(baseline: number | null, fixed: number | null) {
  if (baseline == null || fixed == null || baseline === 0) return null
  return ((baseline - fixed) / baseline) * 100
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function field(value: unknown, ...path: string[]) {
  let current: unknown = value
  for (const part of path) {
    current = record(current)?.[part]
  }
  return current
}

function numericField(value: unknown, ...path: string[]) {
  const candidate = field(value, ...path)
  return typeof candidate === "number" ? candidate : null
}

function medianFromReport(report: unknown, name: string) {
  const profiles = field(report, "profiles")
  if (!Array.isArray(profiles)) return null
  return numericField(profiles[0], "summary", name, "median")
}

function peakDeltaFromReport(report: unknown) {
  const profiles = field(report, "profiles")
  if (!Array.isArray(profiles)) return null
  const values = profiles
    .map((profile) => field(profile, "rssPeakDeltaBytes"))
    .filter((value: unknown): value is number => typeof value === "number")
  return values.length ? Math.max(...values) : null
}

function compareReports(baseline: unknown, fixed: unknown) {
  const baselineDubs = medianFromReport(baseline, "serializedDubRecords")
  const fixedDubs = medianFromReport(fixed, "serializedDubRecords")
  const baselineRss = peakDeltaFromReport(baseline)
  const fixedRss = peakDeltaFromReport(fixed)
  const baselinePublicP95 = numericField(
    baseline,
    "publicControl",
    "summary",
    "elapsedMs",
    "p95",
  )
  const fixedPublicP95 = numericField(
    fixed,
    "publicControl",
    "summary",
    "elapsedMs",
    "p95",
  )
  return {
    initialSerializedDubReductionPercent: reductionPercent(
      baselineDubs,
      fixedDubs,
    ),
    peakRssDeltaReductionPercent: reductionPercent(baselineRss, fixedRss),
    publicP95IncreasePercent:
      baselinePublicP95 == null ||
      fixedPublicP95 == null ||
      baselinePublicP95 === 0
        ? null
        : ((fixedPublicP95 - baselinePublicP95) / baselinePublicP95) * 100,
    sameFixture:
      field(baseline, "fixture", "label") ===
        field(fixed, "fixture", "label") &&
      field(baseline, "fixture", "referencedVideos") ===
        field(fixed, "fixture", "referencedVideos") &&
      field(baseline, "fixture", "activeDubs") ===
        field(fixed, "fixture", "activeDubs") &&
      field(baseline, "fixture", "largestCollectionChildren") ===
        field(fixed, "fixture", "largestCollectionChildren"),
  }
}

function redactedContract(options: CliOptions) {
  return {
    fixture: {
      activeDubs: options.activeDubs,
      label: options.fixture,
      largestCollectionChildren: options.largestCollectionChildren,
      referencedVideos: options.referencedVideos,
    },
    measurement: {
      concurrency: options.concurrency,
      cycles: options.cycles,
      dubMarker: options.dubMarker,
      idleMs: options.idleMs,
      roundsPerProfile: options.runs,
      warmups: options.warmups,
    },
    revision: options.revision,
    target: {
      collectionFingerprint: targetFingerprint(options.collectionUrl),
      editorFingerprint: targetFingerprint(options.editorUrl),
      environment: options.environment,
      hasCookie: Boolean(options.cookiePath),
      headerNames: [],
      publicFingerprint: targetFingerprint(options.publicUrl),
      saveFingerprint: targetFingerprint(options.saveUrl),
    },
  }
}

function evidenceGaps(options: CliOptions) {
  return [
    !options.cookiePath ? "authenticated editor cookie" : null,
    !options.publicUrl
      ? "public-query control and paired contention samples"
      : null,
    !options.serverPid ? "Admin process RSS" : null,
    !options.sqlLogPath ? "emitted SQL statement count" : null,
    !options.serverLogPath ? "pool-timeout log count" : null,
    !options.collectionUrl ? "largest-collection expansion" : null,
    !options.saveUrl || options.cycles < 20
      ? "20 open/save cycles with post-idle RSS"
      : null,
  ].filter((gap): gap is string => gap != null)
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  validateOptions(options)
  const contract = redactedContract(options)
  const gaps = evidenceGaps(options)
  if (options.dryRun) {
    const report = {
      contract: "experience-editor-video-data-probe/v1",
      readiness: {
        status: "not_measured",
        reason:
          "dry-run validates the redacted workload contract without network or database access",
        gaps,
      },
      ...contract,
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }

  const cookie = await loadCookie(options.cookiePath)
  const editor = await requestSpec({
    bodyPath: options.bodyPath,
    cookie,
    headersPath: options.headersPath,
    url: options.editorUrl!,
  })
  const publicControl = options.publicUrl
    ? await requestSpec({
        bodyPath: options.publicBodyPath,
        cookie: null,
        headersPath: null,
        url: options.publicUrl,
      })
    : null
  const save = options.saveUrl
    ? await requestSpec({
        bodyPath: options.saveBodyPath,
        cookie,
        headersPath: options.saveHeadersPath,
        url: options.saveUrl,
      })
    : null

  const cold = await runRequest(editor, options.dubMarker)

  for (let index = 0; index < options.warmups; index += 1) {
    await runRequest(editor, options.dubMarker)
  }

  const profiles = []
  for (const concurrency of options.concurrency) {
    const profile = await runProfile({
      concurrency,
      dubMarker: options.dubMarker,
      runs: options.runs,
      serverLogPath: options.serverLogPath,
      serverPid: options.serverPid,
      publicSpec: publicControl,
      spec: editor,
      sqlLogPath: options.sqlLogPath,
    })
    profiles.push({ ...profile, summary: summarizeSamples(profile.samples) })
  }

  const controlProfile = publicControl
    ? await runProfile({
        concurrency: 1,
        dubMarker: options.dubMarker,
        runs: options.runs,
        serverLogPath: options.serverLogPath,
        serverPid: options.serverPid,
        publicSpec: null,
        spec: publicControl,
        sqlLogPath: options.sqlLogPath,
      })
    : null
  const collectionSample = options.collectionUrl
    ? await runRequest(
        await requestSpec({
          bodyPath: options.collectionBodyPath,
          cookie,
          headersPath: options.headersPath,
          url: options.collectionUrl,
        }),
        options.dubMarker,
      )
    : null
  const cycles =
    save && options.cycles > 0
      ? await runCycles({
          dubMarker: options.dubMarker,
          idleMs: options.idleMs,
          open: editor,
          save,
          serverPid: options.serverPid,
          total: options.cycles,
        })
      : null
  const publicControlSummary = controlProfile
    ? summarizeSamples(controlProfile.samples)
    : null
  const publicControlP95 = publicControlSummary?.elapsedMs.p95 ?? null

  const report = {
    contract: "experience-editor-video-data-probe/v1",
    evidenceCoverage: {
      complete: gaps.length === 0,
      gaps,
    },
    generatedAt: new Date().toISOString(),
    hardware: {
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      hostname: hostname(),
      platform: platform(),
      release: release(),
      totalMemoryBytes: totalmem(),
    },
    ...contract,
    cold,
    collection: collectionSample,
    cycles,
    profiles: profiles.map((profile) => {
      const publicSummary = profile.publicSamples
        ? summarizeSamples(profile.publicSamples)
        : null
      const pairedPublicP95 = publicSummary?.elapsedMs.p95 ?? null
      return {
        ...profile,
        pairedPublicP95IncreasePercent:
          pairedPublicP95 == null ||
          publicControlP95 == null ||
          publicControlP95 === 0
            ? null
            : ((pairedPublicP95 - publicControlP95) / publicControlP95) * 100,
        publicSummary,
      }
    }),
    publicControl: controlProfile
      ? { ...controlProfile, summary: publicControlSummary }
      : null,
  }
  const reportWithComparison = options.baselinePath
    ? {
        ...report,
        comparison: compareReports(
          JSON.parse(await readFile(options.baselinePath, "utf8")) as unknown,
          report,
        ),
      }
    : report
  const serialized = `${JSON.stringify(reportWithComparison, null, 2)}\n`
  if (options.outPath) await writeFile(options.outPath, serialized, "utf8")
  process.stdout.write(serialized)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `[experience-editor-video-data-probe] ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
