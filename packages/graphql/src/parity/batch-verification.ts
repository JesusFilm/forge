/**
 * Batch verification harness — the cutover gate. Operators read this report
 * before flipping consumers from Strapi to admin; zero non-allow-listed
 * diffs across all four channels means the migration is safe to ship.
 *
 * The CLI shim (scripts/run-batch-verification.ts) provides fetchers + argv;
 * orchestration + report shape live here so they're typechecked + testable.
 *
 * Critical invariants:
 * - Bounded parallelism via p-limit + Promise.allSettled (never bare
 *   Promise.all). See docs/solutions/best-practices/bounded-parallelism-
 *   per-target-workflow-pattern-20260505.md.
 * - SECURITY: bearer is auto-read from env, never a CLI flag. Anonymous
 *   mode requires explicit opt-in (anonymous-against-admin consumes
 *   `public:${ip}` and self-DoSes the verification window). The bearer
 *   never appears in any log; `sanitizeError` strips it before surfacing.
 * - Report JSON shape is a DOWNSTREAM CONTRACT — operator dashboards
 *   automate against it. Adding is safe; renaming/removing breaks tooling.
 *   Snapshot test locks it.
 *
 * Throwaway; deletes with the rest of parity/. See parity/index.ts checklist.
 */

import pLimit from "p-limit"

import {
  DEFAULT_ALLOW_LIST,
  type AllowListEntry,
  type AllowListChannel,
} from "./allow-list"
import { compareNormalizedRoutes, type DiffReport } from "./compare"
import {
  normalizeAdmin,
  type AdminExperienceLocaleInput,
} from "./normalize-admin"
import { normalizeStrapi, type StrapiExperienceInput } from "./normalize-strapi"

// Public types — the JSON report shape is a downstream contract.

/** `count` alongside `paths` lets dashboards sum without re-scanning paths. */
export type ChannelSummary = {
  readonly count: number
  readonly paths: ReadonlyArray<string>
}

export type SlugTimings = {
  readonly strapi: number
  readonly admin: number
  readonly compare: number
}

export type SlugErrorSide = "strapi" | "admin" | "compare" | "both"

export type SlugError = {
  readonly side: SlugErrorSide
  readonly message: string
}

/** Cutover-gate contract — snapshot-locked. Add fields freely; never rename/remove. */
export type SlugReport = {
  readonly slug: string
  readonly locale: string
  readonly structural: ChannelSummary
  readonly value: ChannelSummary
  readonly order: ChannelSummary
  readonly semantic: ChannelSummary
  /** Diffs suppressed by the combined allow-list (DEFAULT + operator-supplied). */
  readonly allowListed: ChannelSummary
  readonly timingMs: SlugTimings
  /** Present when fetch or normalization failed on one or both sides. */
  readonly error?: SlugError
}

export type BatchReport = {
  /** ISO timestamp at run start. */
  readonly generatedAt: string
  readonly totals: {
    readonly slugs: number
    readonly withStructural: number
    readonly withValue: number
    readonly withOrder: number
    readonly withSemantic: number
    readonly withErrors: number
    readonly allowListed: number
  }
  /** PASSED when remaining non-allow-listed diffs across all channels are zero AND no error rows. */
  readonly gate: "PASSED" | "FAILED"
  readonly slugs: ReadonlyArray<SlugReport>
}

// Args + CLI parsing

export type BatchArgs = {
  /** Random-stratified sample size. `null` = full corpus. */
  readonly sample: number | null
  /** Parallel fetch ceiling. */
  readonly concurrency: number
  /** Report output path. `null` = default `.tmp/batch-verification-${ts}.json`. */
  readonly out: string | null
  /** Path to operator-supplied allow-list JSON. `null` = DEFAULT only. */
  readonly allowList: string | null
  /** ISO timestamp filter for delta-mode runs. `null` = no filter. */
  readonly since: string | null
  /** When true, skip auto-bearer-from-env. Required to bypass hard-fail. */
  readonly anonymous: boolean
  /** When set, print help text and exit 0. */
  readonly help: boolean
}

export const HELP_TEXT = `\
run-batch-verification — Strapi/admin parity gate (plan-003 U8)

Runs the four-class differ against every published slug from Strapi and
admin in parallel, producing a structured per-slug report. PASS gate is
zero non-allow-listed diffs across all channels AND zero error rows.

USAGE
  pnpm tsx packages/graphql/scripts/run-batch-verification.ts [flags]

FLAGS
  --sample <n>          Random-stratified sample (default: full corpus).
  --concurrency <n>     Parallel fetch ceiling (default: 5).
  --out <path>          Report output path (default: .tmp/batch-verification-<ts>.json).
  --allow-list <path>   Operator-supplied additional allow-list JSON.
  --since <iso>         Delta-mode filter — only slugs updated at or after this ISO timestamp.
  --anonymous           Opt out of bearer auto-read. Risks self-DoS; use only for
                        ad-hoc local checks against a non-rate-limited target.
  --help                Print this help and exit 0.

REQUIRED ENV
  WEB_ADMIN_API_KEYS    Comma-separated bearer keys (first entry used).
                        Mandatory unless --anonymous is set.
                        Hard-fail rationale: anonymous queries consume
                        admin's \`public:\${ip}\` bucket and would self-DoS
                        the verification window.
  STRAPI_GRAPHQL_URL    Strapi GraphQL endpoint URL.
  ADMIN_GRAPHQL_URL     Admin GraphQL endpoint URL.
  STRAPI_PUBLIC_ORIGIN  Base origin for URL canonicalization.

EDITORIAL FREEZE COORDINATION
  Run within the 24-48h editorial freeze window between gate-green and
  env-flip, OR use \`--since <iso>\` for a delta re-run immediately before
  env-flip. Editorial-freeze coordination is operator workflow, not code.

EXIT CODES
  0   Gate PASSED.
  1   Gate FAILED.
  2   Misconfiguration (bad args, missing env).
`

export function parseArgs(argv: ReadonlyArray<string>): BatchArgs {
  const args: BatchArgs = {
    sample: null,
    concurrency: 5,
    out: null,
    allowList: null,
    since: null,
    anonymous: false,
    help: false,
  }
  const mut = args as { -readonly [K in keyof BatchArgs]: BatchArgs[K] }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--help":
      case "-h":
        mut.help = true
        break
      case "--anonymous":
        mut.anonymous = true
        break
      case "--sample": {
        const v = argv[++i]
        if (v === undefined) throw new Error("--sample requires a value")
        const n = Number(v)
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`--sample must be a positive integer, got ${v}`)
        }
        mut.sample = n
        break
      }
      case "--concurrency": {
        const v = argv[++i]
        if (v === undefined) throw new Error("--concurrency requires a value")
        const n = Number(v)
        if (!Number.isInteger(n) || n <= 0) {
          throw new Error(`--concurrency must be a positive integer, got ${v}`)
        }
        mut.concurrency = n
        break
      }
      case "--out": {
        const v = argv[++i]
        if (v === undefined) throw new Error("--out requires a path")
        mut.out = v
        break
      }
      case "--allow-list": {
        const v = argv[++i]
        if (v === undefined) throw new Error("--allow-list requires a path")
        mut.allowList = v
        break
      }
      case "--since": {
        const v = argv[++i]
        if (v === undefined)
          throw new Error("--since requires an ISO timestamp")
        const t = Date.parse(v)
        if (Number.isNaN(t)) {
          throw new Error(`--since requires a valid ISO timestamp, got ${v}`)
        }
        mut.since = v
        break
      }
      default:
        throw new Error(`unrecognized flag: ${arg}`)
    }
  }
  return args
}

// Allow-list combination

/** Mismatched shape throws — operators fix the file, not silently suppress unrelated diffs. */
export function parseAllowListFile(raw: string): ReadonlyArray<AllowListEntry> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `allow-list file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error("allow-list file must contain a top-level JSON array")
  }
  const out: AllowListEntry[] = []
  const validChannels: ReadonlySet<AllowListChannel> = new Set([
    "structural",
    "value",
    "order",
    "semantic",
  ])
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as Record<string, unknown>
    if (
      typeof entry?.path !== "string" ||
      typeof entry?.channel !== "string" ||
      typeof entry?.rationale !== "string"
    ) {
      throw new Error(
        `allow-list entry [${i}] must have string fields: path, channel, rationale`,
      )
    }
    if (!validChannels.has(entry.channel as AllowListChannel)) {
      throw new Error(
        `allow-list entry [${i}] has invalid channel '${entry.channel}'; expected one of: structural, value, order, semantic`,
      )
    }
    if (entry.rationale === "") {
      throw new Error(
        `allow-list entry [${i}] has empty rationale — every entry MUST cite a decision doc`,
      )
    }
    out.push({
      path: entry.path,
      channel: entry.channel as AllowListChannel,
      rationale: entry.rationale,
    })
  }
  return out
}

export function combineAllowLists(
  operator: ReadonlyArray<AllowListEntry>,
): ReadonlyArray<AllowListEntry> {
  return [...DEFAULT_ALLOW_LIST, ...operator]
}

// Sampling

/**
 * Corpus must be sorted by `updatedAt` ascending. Stratifies newest 30 /
 * oldest 30 / middle 40 so coverage spans editorial recency rather than
 * skewing to the heaviest bucket. `rng` is injectable for deterministic tests.
 */
export function stratifiedSample<T>(
  corpus: ReadonlyArray<T>,
  sample: number,
  rng: () => number = Math.random,
): ReadonlyArray<T> {
  if (sample >= corpus.length) return corpus
  if (sample <= 0) return []

  // Edge-case: tiny corpus / tiny sample, fall back to simple shuffle-trim.
  if (corpus.length < 10 || sample < 10) {
    const idx = Array.from({ length: corpus.length }, (_, i) => i)
    shuffleInPlace(idx, rng)
    return idx.slice(0, sample).map((i) => corpus[i])
  }

  const newestCount = Math.floor(sample * 0.3)
  const oldestCount = Math.floor(sample * 0.3)
  const middleCount = sample - newestCount - oldestCount

  // Corpus is oldest-first. Last N are newest, first N are oldest.
  const oldestIdx = Array.from(
    { length: Math.min(corpus.length, sample) },
    (_, i) => i,
  )
  const newestIdx = Array.from(
    { length: Math.min(corpus.length, sample) },
    (_, i) => corpus.length - 1 - i,
  )
  // Middle band is everything except the head/tail sample windows.
  const headSize = Math.min(oldestCount * 3, Math.floor(corpus.length / 3))
  const tailSize = Math.min(newestCount * 3, Math.floor(corpus.length / 3))
  const middleStart = headSize
  const middleEnd = corpus.length - tailSize
  const middleIdx: number[] = []
  for (let i = middleStart; i < middleEnd; i++) middleIdx.push(i)

  shuffleInPlace(oldestIdx, rng)
  shuffleInPlace(newestIdx, rng)
  shuffleInPlace(middleIdx, rng)

  const picked = new Set<number>()
  for (const list of [oldestIdx, newestIdx, middleIdx]) {
    // No-op; just to keep TS happy that the loop var is read.
    void list
  }
  for (const i of oldestIdx.slice(0, oldestCount)) picked.add(i)
  for (const i of newestIdx.slice(0, newestCount)) picked.add(i)
  for (const i of middleIdx.slice(0, middleCount)) picked.add(i)

  // Top up from anywhere if dedup shrunk us below target.
  if (picked.size < sample) {
    const all = Array.from({ length: corpus.length }, (_, i) => i)
    shuffleInPlace(all, rng)
    for (const i of all) {
      if (picked.size >= sample) break
      picked.add(i)
    }
  }

  return Array.from(picked)
    .slice(0, sample)
    .map((i) => corpus[i])
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
}

// Fetcher interfaces — transport is injected from the CLI shim.

export type CorpusEntry = {
  readonly slug: string
  readonly locale: string
  readonly updatedAt: string | null
}

export type EnumerateCorpus = () => Promise<ReadonlyArray<CorpusEntry>>

export type FetchStrapi = (
  slug: string,
  locale: string,
) => Promise<StrapiExperienceInput>

export type FetchAdmin = (
  slug: string,
  locale: string,
) => Promise<AdminExperienceLocaleInput>

export type Fetchers = {
  readonly enumerateCorpus: EnumerateCorpus
  readonly fetchStrapi: FetchStrapi
  readonly fetchAdmin: FetchAdmin
}

// SECURITY: bearer key must never appear in output.
// URLs / slugs / locales are safe; the bearer is the only secret here.
export function sanitizeError(err: unknown, bearer: string | null): string {
  let msg: string
  if (err instanceof Error) msg = `${err.name}: ${err.message}`
  else msg = String(err)
  if (bearer && bearer !== "" && msg.includes(bearer)) {
    msg = msg.split(bearer).join("[REDACTED]")
  }
  return msg
}

// Per-slug worker

export type RunSlugDeps = {
  readonly fetchers: Fetchers
  readonly bearer: string | null
  readonly baseOrigin: string
  readonly allowList: ReadonlyArray<AllowListEntry>
}

/**
 * Catches per-side errors → SlugReport.error; orchestrator never sees throws.
 */
export async function compareSlug(
  entry: CorpusEntry,
  deps: RunSlugDeps,
): Promise<SlugReport> {
  // Parallel Strapi+admin halves the per-slug wall-clock vs sequential.
  const tStrapiStart = Date.now()
  const tAdminStart = tStrapiStart
  const [strapiSettled, adminSettled] = await Promise.allSettled([
    deps.fetchers.fetchStrapi(entry.slug, entry.locale),
    deps.fetchers.fetchAdmin(entry.slug, entry.locale),
  ])
  const tStrapiEnd = Date.now()
  const tAdminEnd = tStrapiEnd

  const strapiInput: StrapiExperienceInput | null =
    strapiSettled.status === "fulfilled" ? strapiSettled.value : null
  const strapiErr: string | null =
    strapiSettled.status === "rejected"
      ? sanitizeError(strapiSettled.reason, deps.bearer)
      : null
  const adminInput: AdminExperienceLocaleInput | null =
    adminSettled.status === "fulfilled" ? adminSettled.value : null
  const adminErr: string | null =
    adminSettled.status === "rejected"
      ? sanitizeError(adminSettled.reason, deps.bearer)
      : null

  // Both failed — record "both" so the operator sees the join-failure case.
  if (strapiErr && adminErr) {
    return errorReport(
      entry,
      "both",
      `strapi: ${strapiErr} | admin: ${adminErr}`,
      {
        strapi: tStrapiEnd - tStrapiStart,
        admin: tAdminEnd - tAdminStart,
        compare: 0,
      },
    )
  }
  if (strapiErr) {
    return errorReport(entry, "strapi", strapiErr, {
      strapi: tStrapiEnd - tStrapiStart,
      admin: tAdminEnd - tAdminStart,
      compare: 0,
    })
  }
  if (adminErr) {
    return errorReport(entry, "admin", adminErr, {
      strapi: tStrapiEnd - tStrapiStart,
      admin: tAdminEnd - tAdminStart,
      compare: 0,
    })
  }

  // Both sides loaded. Normalize + compare.
  const tCompareStart = Date.now()
  let diff: DiffReport
  try {
    const strapiNormalized = normalizeStrapi(strapiInput!, {
      urlLocale: entry.locale,
      baseOrigin: deps.baseOrigin,
    })
    const adminNormalized = normalizeAdmin(adminInput!, {
      urlLocale: entry.locale,
      baseOrigin: deps.baseOrigin,
    })
    diff = compareNormalizedRoutes(strapiNormalized, adminNormalized, {
      urlLocale: entry.locale,
      allowList: deps.allowList,
    })
  } catch (err) {
    const tCompareEnd = Date.now()
    return errorReport(entry, "compare", sanitizeError(err, deps.bearer), {
      strapi: tStrapiEnd - tStrapiStart,
      admin: tAdminEnd - tAdminStart,
      compare: tCompareEnd - tCompareStart,
    })
  }
  const tCompareEnd = Date.now()

  return {
    slug: entry.slug,
    locale: entry.locale,
    structural: channelSummary(diff.structural.map((d) => d.path)),
    value: channelSummary(diff.value.map((d) => d.path)),
    order: channelSummary(diff.order.map((d) => d.path)),
    semantic: channelSummary(diff.semantic.map((d) => d.path)),
    allowListed: channelSummary(diff.meta.appliedAllowList.map((d) => d.path)),
    timingMs: {
      strapi: tStrapiEnd - tStrapiStart,
      admin: tAdminEnd - tAdminStart,
      compare: tCompareEnd - tCompareStart,
    },
  }
}

function errorReport(
  entry: CorpusEntry,
  side: SlugErrorSide,
  message: string,
  timingMs: SlugTimings,
): SlugReport {
  return {
    slug: entry.slug,
    locale: entry.locale,
    structural: { count: 0, paths: [] },
    value: { count: 0, paths: [] },
    order: { count: 0, paths: [] },
    semantic: { count: 0, paths: [] },
    allowListed: { count: 0, paths: [] },
    timingMs,
    error: { side, message },
  }
}

function channelSummary(paths: ReadonlyArray<string>): ChannelSummary {
  return { count: paths.length, paths: Object.freeze([...paths]) }
}

// Orchestrator

export type RunBatchOptions = {
  readonly args: BatchArgs
  readonly fetchers: Fetchers
  readonly bearer: string | null
  readonly baseOrigin: string
  readonly allowList: ReadonlyArray<AllowListEntry>
  readonly rng?: () => number
  /** Injectable clock for deterministic `generatedAt` in tests. */
  readonly now?: () => Date
  /** Optional progress callback — called per-slug completion with the result. */
  readonly onSlugComplete?: (
    report: SlugReport,
    index: number,
    total: number,
  ) => void
}

export async function runBatchVerification(
  opts: RunBatchOptions,
): Promise<BatchReport> {
  const generatedAt = (opts.now?.() ?? new Date()).toISOString()
  const corpus = await opts.fetchers.enumerateCorpus()

  const filtered = opts.args.since
    ? corpus.filter((e) => {
        if (e.updatedAt === null) return false
        return Date.parse(e.updatedAt) >= Date.parse(opts.args.since!)
      })
    : corpus

  const targets =
    opts.args.sample !== null
      ? stratifiedSample(filtered, opts.args.sample, opts.rng)
      : filtered

  const limit = pLimit(opts.args.concurrency)
  const deps: RunSlugDeps = {
    fetchers: opts.fetchers,
    bearer: opts.bearer,
    baseOrigin: opts.baseOrigin,
    allowList: opts.allowList,
  }

  let completed = 0
  const settled = await Promise.allSettled(
    targets.map((entry) =>
      limit(async () => {
        const report = await compareSlug(entry, deps)
        completed++
        opts.onSlugComplete?.(report, completed, targets.length)
        return report
      }),
    ),
  )

  // A rejection here is a bug (onSlugComplete threw). Surface as an error
  // row so the harness never crashes mid-run.
  const slugs: SlugReport[] = []
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === "fulfilled") {
      slugs.push(result.value)
    } else {
      const entry = targets[i]
      slugs.push(
        errorReport(
          entry,
          "compare",
          sanitizeError(result.reason, opts.bearer),
          { strapi: 0, admin: 0, compare: 0 },
        ),
      )
    }
  }

  return buildReport(generatedAt, slugs)
}

export function buildReport(
  generatedAt: string,
  slugs: ReadonlyArray<SlugReport>,
): BatchReport {
  let withStructural = 0
  let withValue = 0
  let withOrder = 0
  let withSemantic = 0
  let withErrors = 0
  let allowListed = 0
  for (const s of slugs) {
    if (s.structural.count > 0) withStructural++
    if (s.value.count > 0) withValue++
    if (s.order.count > 0) withOrder++
    if (s.semantic.count > 0) withSemantic++
    if (s.error) withErrors++
    if (s.allowListed.count > 0) allowListed++
  }
  const gate: BatchReport["gate"] =
    withStructural === 0 &&
    withValue === 0 &&
    withOrder === 0 &&
    withSemantic === 0 &&
    withErrors === 0
      ? "PASSED"
      : "FAILED"

  return {
    generatedAt,
    totals: {
      slugs: slugs.length,
      withStructural,
      withValue,
      withOrder,
      withSemantic,
      withErrors,
      allowListed,
    },
    gate,
    slugs: Object.freeze([...slugs]),
  }
}

// Stdout summary

export function formatSummary(report: BatchReport): string {
  const t = report.totals
  const lines = [
    `Batch verification — ${t.slugs} slugs verified at ${report.generatedAt}`,
    `  structural: ${t.withStructural} slugs with diffs`,
    `      value: ${t.withValue} slugs with diffs`,
    `      order: ${t.withOrder} slugs with diffs`,
    `   semantic: ${t.withSemantic} slugs with diffs`,
    `     errors: ${t.withErrors} slugs failed to fetch/compare`,
    `allow-listed: ${t.allowListed} slugs had diffs suppressed by allow-list`,
    ``,
    `Gate: ${report.gate}`,
  ]
  return lines.join("\n")
}

// HTTP helpers — exposed so tests can drive 429-backoff + timeout shape
// against a mocked fetcher without reaching the network.

export class BearerMissingError extends Error {
  override readonly name = "BearerMissingError"
}

export class RateLimitExhaustedError extends Error {
  override readonly name = "RateLimitExhaustedError"
}

/**
 * SECURITY: hard-fails when neither `WEB_ADMIN_API_KEYS` nor `--anonymous`
 * is set. Anonymous against admin would consume `public:${ip}` and self-DoS
 * the verification window — operators must opt in explicitly.
 */
export function readBearerFromEnv(
  env: NodeJS.ProcessEnv,
  anonymous: boolean,
): string | null {
  if (anonymous) return null
  const raw = env.WEB_ADMIN_API_KEYS
  if (!raw || raw.trim() === "") {
    throw new BearerMissingError(
      "WEB_ADMIN_API_KEYS is required (or pass --anonymous to opt out). " +
        "Running anonymous against admin consumes the public:${ip} bucket " +
        "and may self-DoS the verification window.",
    )
  }
  const first = raw.split(",")[0]?.trim() ?? ""
  if (first === "") {
    throw new BearerMissingError(
      "WEB_ADMIN_API_KEYS is set but its first CSV entry is empty.",
    )
  }
  return first
}

/** Exponential base-500ms, cap 30s, full-jitter to avoid retry-storm collisions. */
export function backoffDelayMs(
  attempt: number,
  rng: () => number = Math.random,
): number {
  const raw = 500 * Math.pow(2, attempt)
  const capped = Math.min(raw, 30000)
  return Math.floor(rng() * capped)
}

// Fast-fail timeouts/aborts rather than retry — a persistent admin slowness
// is not a transient blip; 3× retries × 3s wastes gate-convergence time.
function isTimeoutOrAbortError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false
  const name = (err as { name?: unknown }).name
  return name === "AbortError" || name === "TimeoutError"
}

export const FETCH_TIMEOUT_MS = 3000
export const FETCH_MAX_RETRIES = 3

/** GraphQL POST with 3s budget + 429 retry. `fetchImpl` is injected for tests. */
export async function postGraphQL(args: {
  readonly url: string
  readonly query: string
  readonly variables?: Record<string, unknown>
  readonly bearer: string | null
  readonly fetchImpl?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
}): Promise<unknown> {
  const fetchFn = args.fetchImpl ?? fetch
  const sleep =
    args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (args.bearer) headers["Authorization"] = `Bearer ${args.bearer}`
  const body = JSON.stringify({
    query: args.query,
    variables: args.variables ?? {},
  })

  for (let attempt = 0; attempt < FETCH_MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetchFn(args.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.status === 429) {
        if (attempt === FETCH_MAX_RETRIES - 1) {
          throw new RateLimitExhaustedError(
            `429 from ${redactUrl(args.url)} after ${FETCH_MAX_RETRIES} attempts`,
          )
        }
        await sleep(backoffDelayMs(attempt))
        continue
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(
          `HTTP ${res.status} from ${redactUrl(args.url)}: ${text.slice(0, 200)}`,
        )
      }
      return (await res.json()) as unknown
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof RateLimitExhaustedError) throw err
      // Don't retry timeouts/aborts — see isTimeoutOrAbortError above.
      if (isTimeoutOrAbortError(err)) throw err
      if (attempt === FETCH_MAX_RETRIES - 1) throw err
      await sleep(backoffDelayMs(attempt))
    }
  }
  throw new Error("postGraphQL: exhausted retries without returning")
}

// SECURITY: strip query-string + userinfo before surfacing in errors — path
// is diagnostic but tokens in query strings must never reach logs.
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return "[unparseable-url]"
  }
}
