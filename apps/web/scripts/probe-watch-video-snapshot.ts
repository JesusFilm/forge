#!/usr/bin/env tsx
/**
 * Compare the old Watch route snapshot shape against the selected-dub
 * projection shape for one Admin video slug.
 *
 * This is an evidence harness, not an app runtime dependency. It runs both
 * GraphQL documents against the same Admin endpoint, sequentially, and reports
 * response bytes plus latency distribution so the performance impact of the
 * selected-dub projection can be proven or falsified against local/staging/prod.
 *
 * Required env, unless passed as flags:
 *   ADMIN_GRAPHQL_URL
 *   WEB_ADMIN_API_KEYS (CSV ok; first key is used)
 *
 * Example:
 *   pnpm --filter @forge/web probe:watch-video-snapshot \
 *     --slug life-of-jesus-gospel-of-john \
 *     --language-slug english \
 *     --locale en \
 *     --runs 9 \
 *     --json /tmp/watch-video-snapshot.json
 */

import { writeFileSync } from "node:fs"
import { performance } from "node:perf_hooks"

type Args = {
  url: string
  bearer: string | null
  slug: string
  languageSlug: string | null
  locale: string
  runs: number
  warmup: number
  jsonOut: string | null
  expectByteReductionPct: number | null
}

type ProbeName = "legacyFullDubs" | "selectedDubProjection"

type ProbeSample = {
  name: ProbeName
  run: number
  ok: boolean
  status: number
  durationMs: number
  bytes: number
  graphqlErrors: number
}

type ProbeSummary = {
  name: ProbeName
  runs: number
  okRuns: number
  bytesMedian: number
  bytesMean: number
  durationMedianMs: number
  durationMeanMs: number
  durationP95Ms: number
  graphqlErrors: number
}

const DEFAULT_RUNS = 7
const DEFAULT_WARMUP = 1

const LEGACY_FULL_DUBS_QUERY = `
  query LegacyWatchVideoRouteSnapshot(
    $locale: String!
    $languageSlug: String
    $videoSlug: String!
  ) {
    videoBySlug(slug: $videoSlug) {
      documentId: id
      slug
      noIndex
      label
      images {
        documentId: id
        url
        thumbnail
        mobileCinematicHigh
        mobileCinematicLow
      }
      primaryLanguage {
        coreId
        bcp47
      }
      parents {
        parent {
          documentId: id
          slug
          noIndex
          label
          images {
            documentId: id
            url
            thumbnail
            mobileCinematicHigh
            mobileCinematicLow
          }
          children {
            child {
              documentId: id
              slug
              label
              images {
                documentId: id
                url
                thumbnail
                mobileCinematicHigh
                mobileCinematicLow
              }
              muxPlaybackId(languageSlug: $languageSlug)
            }
          }
          exactLocales: locales(locale: $locale, languageSlug: $languageSlug) {
            documentId: id
            languageSlug
            title
          }
          broadLocales: locales(locale: $locale) {
            documentId: id
            languageSlug
            title
          }
          englishLocales: locales(locale: "en") {
            documentId: id
            languageSlug
            title
          }
        }
      }
      children {
        child {
          documentId: id
          slug
          label
          images {
            documentId: id
            url
            thumbnail
            mobileCinematicHigh
            mobileCinematicLow
          }
          durationSeconds
          muxPlaybackId(languageSlug: $languageSlug)
          exactLocales: locales(locale: $locale, languageSlug: $languageSlug) {
            documentId: id
            languageSlug
            title
          }
          broadLocales: locales(locale: $locale) {
            documentId: id
            languageSlug
            title
          }
          englishLocales: locales(locale: "en") {
            documentId: id
            languageSlug
            title
          }
        }
      }
      variants: dubs {
        documentId: id
        slug
        published
        hls
        duration
        language {
          coreId
          bcp47
          slug
          name
        }
      }
      bibleCitations {
        documentId: id
        chapterStart
        chapterEnd
        verseStart
        verseEnd
        order
        osisId
        bibleBook {
          documentId: id
          name
        }
      }
      exactLocales: locales(locale: $locale, languageSlug: $languageSlug) {
        documentId: id
        languageSlug
        title
        description
        snippet
        imageAlt
      }
      broadLocales: locales(locale: $locale) {
        documentId: id
        languageSlug
        title
        description
        snippet
        imageAlt
      }
      englishLocales: locales(locale: "en") {
        documentId: id
        languageSlug
        title
        description
        snippet
        imageAlt
      }
      exactStudyQuestions: studyQuestions(locale: $locale, languageSlug: $languageSlug) {
        documentId: id
        languageSlug
        value: text
        order
      }
      broadStudyQuestions: studyQuestions(locale: $locale) {
        documentId: id
        languageSlug
        value: text
        order
      }
      englishStudyQuestions: studyQuestions(locale: "en") {
        documentId: id
        languageSlug
        value: text
        order
      }
    }
  }
`

const SELECTED_DUB_PROJECTION_QUERY = `
  query SelectedDubWatchVideoRouteSnapshot(
    $locale: String!
    $languageSlug: String
    $videoSlug: String!
  ) {
    videoBySlug(slug: $videoSlug) {
      documentId: id
      slug
      noIndex
      label
      images {
        documentId: id
        url
        thumbnail
        mobileCinematicHigh
        mobileCinematicLow
      }
      primaryLanguage {
        coreId
        bcp47
      }
      parents {
        parent {
          documentId: id
          slug
          noIndex
          label
          images {
            documentId: id
            url
            thumbnail
            mobileCinematicHigh
            mobileCinematicLow
          }
          children {
            child {
              documentId: id
              slug
              label
              images {
                documentId: id
                url
                thumbnail
                mobileCinematicHigh
                mobileCinematicLow
              }
              muxPlaybackId(languageSlug: $languageSlug)
            }
          }
          exactLocales: locales(locale: $locale, languageSlug: $languageSlug) {
            documentId: id
            languageSlug
            title
          }
          broadLocales: locales(locale: $locale) {
            documentId: id
            languageSlug
            title
          }
          englishLocales: locales(locale: "en") {
            documentId: id
            languageSlug
            title
          }
        }
      }
      children {
        child {
          documentId: id
          slug
          label
          images {
            documentId: id
            url
            thumbnail
            mobileCinematicHigh
            mobileCinematicLow
          }
          durationSeconds
          muxPlaybackId(languageSlug: $languageSlug)
          exactLocales: locales(locale: $locale, languageSlug: $languageSlug) {
            documentId: id
            languageSlug
            title
          }
          broadLocales: locales(locale: $locale) {
            documentId: id
            languageSlug
            title
          }
          englishLocales: locales(locale: "en") {
            documentId: id
            languageSlug
            title
          }
        }
      }
      bibleCitations {
        documentId: id
        chapterStart
        chapterEnd
        verseStart
        verseEnd
        order
        osisId
        bibleBook {
          documentId: id
          name
        }
      }
      exactLocales: locales(locale: $locale, languageSlug: $languageSlug) {
        documentId: id
        languageSlug
        title
        description
        snippet
        imageAlt
      }
      broadLocales: locales(locale: $locale) {
        documentId: id
        languageSlug
        title
        description
        snippet
        imageAlt
      }
      englishLocales: locales(locale: "en") {
        documentId: id
        languageSlug
        title
        description
        snippet
        imageAlt
      }
      exactStudyQuestions: studyQuestions(locale: $locale, languageSlug: $languageSlug) {
        documentId: id
        languageSlug
        value: text
        order
      }
      broadStudyQuestions: studyQuestions(locale: $locale) {
        documentId: id
        languageSlug
        value: text
        order
      }
      englishStudyQuestions: studyQuestions(locale: "en") {
        documentId: id
        languageSlug
        value: text
        order
      }
      playableDubLanguageCount
      preferredVariant: preferredPlayableDub(languageSlug: $languageSlug) {
        documentId: id
        slug
        published
        hls
        duration
        language {
          coreId
          bcp47
          slug
          name
        }
      }
    }
  }
`

function parseArgs(argv: readonly string[]): Args | Error {
  const getValue = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    if (index === -1) return null
    return argv[index + 1] ?? null
  }

  const slug = getValue("--slug")
  if (!slug) {
    return new Error(
      "Usage: probe:watch-video-snapshot --slug <videoSlug> [--language-slug english] [--locale en] [--runs 7] [--warmup 1] [--url <adminGraphqlUrl>] [--bearer <token>] [--json <path>] [--expect-byte-reduction-pct <number>]",
    )
  }

  const runs = parsePositiveInt(getValue("--runs"), DEFAULT_RUNS, "--runs")
  if (runs instanceof Error) return runs
  const warmup = parseNonNegativeInt(
    getValue("--warmup"),
    DEFAULT_WARMUP,
    "--warmup",
  )
  if (warmup instanceof Error) return warmup

  const explicitBearer = getValue("--bearer")
  const envBearer = process.env.WEB_ADMIN_API_KEYS?.split(",")[0]?.trim()
  const bearer = explicitBearer ?? envBearer ?? null
  const expectByteReductionPct = getValue("--expect-byte-reduction-pct")

  return {
    url: getValue("--url") ?? process.env.ADMIN_GRAPHQL_URL ?? "",
    bearer,
    slug,
    languageSlug: getValue("--language-slug") ?? "english",
    locale: getValue("--locale") ?? "en",
    runs,
    warmup,
    jsonOut: getValue("--json"),
    expectByteReductionPct:
      expectByteReductionPct == null ? null : Number(expectByteReductionPct),
  }
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  flag: string,
): number | Error {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    return new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function parseNonNegativeInt(
  value: string | null,
  fallback: number,
  flag: string,
): number | Error {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return new Error(`${flag} must be a non-negative integer`)
  }
  return parsed
}

async function probe(
  args: Args,
  name: ProbeName,
  query: string,
  run: number,
): Promise<ProbeSample> {
  const variables = {
    locale: args.locale,
    languageSlug: args.languageSlug,
    videoSlug: args.slug,
  }
  const started = performance.now()
  const response = await fetch(args.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(args.bearer ? { authorization: `Bearer ${args.bearer}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = await response.text()
  const durationMs = performance.now() - started
  const bytes = Buffer.byteLength(body)
  const graphqlErrors = countGraphqlErrors(body)

  return {
    name,
    run,
    ok: response.ok && graphqlErrors === 0,
    status: response.status,
    durationMs,
    bytes,
    graphqlErrors,
  }
}

function countGraphqlErrors(body: string): number {
  try {
    const parsed = JSON.parse(body) as { errors?: unknown[] }
    return Array.isArray(parsed.errors) ? parsed.errors.length : 0
  } catch {
    return 1
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  )
  return sorted[index] ?? 0
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function summarize(samples: readonly ProbeSample[], name: ProbeName) {
  const selected = samples.filter((sample) => sample.name === name)
  const ok = selected.filter((sample) => sample.ok)
  const durations = ok.map((sample) => sample.durationMs)
  const bytes = ok.map((sample) => sample.bytes)
  return {
    name,
    runs: selected.length,
    okRuns: ok.length,
    bytesMedian: median(bytes),
    bytesMean: mean(bytes),
    durationMedianMs: median(durations),
    durationMeanMs: mean(durations),
    durationP95Ms: percentile(durations, 95),
    graphqlErrors: selected.reduce(
      (sum, sample) => sum + sample.graphqlErrors,
      0,
    ),
  } satisfies ProbeSummary
}

function reductionPct(before: number, after: number): number {
  if (before <= 0) return 0
  return ((before - after) / before) * 100
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`
}

function formatBytes(value: number): string {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MiB`
  if (value > 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${Math.round(value)} B`
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed instanceof Error) {
    console.error(parsed.message)
    process.exit(2)
  }
  if (!parsed.url) {
    console.error("ADMIN_GRAPHQL_URL is required via env or --url")
    process.exit(2)
  }

  console.log(
    [
      "Watch video snapshot probe",
      `  endpoint: ${parsed.url}`,
      `  slug: ${parsed.slug}`,
      `  locale: ${parsed.locale}`,
      `  languageSlug: ${parsed.languageSlug ?? "(null)"}`,
      `  warmup: ${parsed.warmup}`,
      `  measured runs: ${parsed.runs}`,
    ].join("\n"),
  )

  for (let i = 0; i < parsed.warmup; i += 1) {
    await probe(parsed, "legacyFullDubs", LEGACY_FULL_DUBS_QUERY, i)
    await probe(
      parsed,
      "selectedDubProjection",
      SELECTED_DUB_PROJECTION_QUERY,
      i,
    )
  }

  const samples: ProbeSample[] = []
  for (let i = 1; i <= parsed.runs; i += 1) {
    samples.push(
      await probe(parsed, "legacyFullDubs", LEGACY_FULL_DUBS_QUERY, i),
    )
    samples.push(
      await probe(
        parsed,
        "selectedDubProjection",
        SELECTED_DUB_PROJECTION_QUERY,
        i,
      ),
    )
  }

  const legacy = summarize(samples, "legacyFullDubs")
  const selected = summarize(samples, "selectedDubProjection")
  const byteReduction = reductionPct(legacy.bytesMedian, selected.bytesMedian)
  const latencyReduction = reductionPct(
    legacy.durationMedianMs,
    selected.durationMedianMs,
  )

  console.log("\nSummary")
  for (const summary of [legacy, selected]) {
    console.log(
      [
        `  ${summary.name}`,
        `    ok: ${summary.okRuns}/${summary.runs}`,
        `    bytes median/mean: ${formatBytes(summary.bytesMedian)} / ${formatBytes(summary.bytesMean)}`,
        `    latency median/mean/p95: ${formatMs(summary.durationMedianMs)} / ${formatMs(summary.durationMeanMs)} / ${formatMs(summary.durationP95Ms)}`,
        `    GraphQL errors: ${summary.graphqlErrors}`,
      ].join("\n"),
    )
  }

  console.log(
    [
      "\nDelta selectedDubProjection vs legacyFullDubs",
      `  byte reduction: ${byteReduction.toFixed(1)}%`,
      `  median latency reduction: ${latencyReduction.toFixed(1)}%`,
    ].join("\n"),
  )

  if (parsed.jsonOut) {
    writeFileSync(
      parsed.jsonOut,
      JSON.stringify(
        {
          endpoint: parsed.url,
          slug: parsed.slug,
          locale: parsed.locale,
          languageSlug: parsed.languageSlug,
          summaries: {
            legacyFullDubs: legacy,
            selectedDubProjection: selected,
          },
          delta: { byteReduction, latencyReduction },
          samples,
        },
        null,
        2,
      ),
    )
    console.log(`\nJSON report written to ${parsed.jsonOut}`)
  }

  const hasErrors = samples.some((sample) => !sample.ok)
  const expectedReduction = parsed.expectByteReductionPct
  const reductionFailed =
    expectedReduction != null && byteReduction < expectedReduction
  if (hasErrors || reductionFailed) {
    if (hasErrors) {
      console.error(
        "\nProbe failed: one or more requests had HTTP/GraphQL errors",
      )
    }
    if (reductionFailed) {
      console.error(
        `\nProbe failed: byte reduction ${byteReduction.toFixed(1)}% is below expected ${expectedReduction!.toFixed(1)}%`,
      )
    }
    process.exit(1)
  }
}

void main()
