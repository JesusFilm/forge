import { pathToFileURL } from "node:url"
import { prisma } from "@/db/client"
import { TypesenseClient } from "@/services/typesense-client"
import { TypesenseWatchSearchService } from "@/services/typesense-watch-search.service"
import {
  type WatchSearchInput,
  type WatchSearchResponse,
  WatchSearchService,
} from "@/services/watch-search.service"

const DEFAULT_RUNS = 5

export type WatchSearchBenchmarkCase = {
  name: string
  input: WatchSearchInput
}

export const WATCH_SEARCH_BENCHMARK_CASES: WatchSearchBenchmarkCase[] = [
  {
    name: "french-communion",
    input: {
      query: "communion",
      displayLanguageSlug: "french",
      targetLanguageSlug: "french",
      queryLanguageSlug: "french",
    },
  },
  {
    name: "english-exact-title",
    input: {
      query: "JESUS",
      displayLanguageSlug: "english",
      targetLanguageSlug: "english",
      queryLanguageSlug: "english",
    },
  },
  {
    name: "english-generic-care",
    input: {
      query: "a community caring for each other",
      displayLanguageSlug: "english",
      targetLanguageSlug: "english",
      queryLanguageSlug: "english",
    },
  },
  {
    name: "spanish-forgiveness",
    input: {
      query: "como perdonar a alguien que me hizo dano",
      displayLanguageSlug: "spanish-castilian",
      targetLanguageSlug: "spanish-castilian",
      queryLanguageSlug: "spanish-castilian",
    },
  },
  {
    name: "french-grief",
    input: {
      query: "trouver de l'espoir apres la mort d'un proche",
      displayLanguageSlug: "french",
      targetLanguageSlug: "french",
      queryLanguageSlug: "french",
    },
  },
]

export function percentile(
  values: readonly number[],
  quantile: number,
): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  )
  return sorted[index] ?? 0
}

export function resultOverlap(
  left: WatchSearchResponse,
  right: WatchSearchResponse,
  limit = 10,
): number {
  const leftIds = new Set(
    left.results.slice(0, limit).map((result) => result.id),
  )
  const rightIds = new Set(
    right.results.slice(0, limit).map((result) => result.id),
  )
  const union = new Set([...leftIds, ...rightIds])
  if (union.size === 0) return 1
  const intersection = [...leftIds].filter((id) => rightIds.has(id)).length
  return intersection / union.size
}

type SearchBackend = {
  search(input: WatchSearchInput): Promise<WatchSearchResponse>
}

async function timedSearch(backend: SearchBackend, input: WatchSearchInput) {
  const startedAt = performance.now()
  const response = await backend.search(input)
  return { response, wallMs: performance.now() - startedAt }
}

export async function benchmarkWatchSearchBackends({
  postgres,
  typesense,
  cases = WATCH_SEARCH_BENCHMARK_CASES,
  runs = DEFAULT_RUNS,
}: {
  postgres: SearchBackend
  typesense: SearchBackend
  cases?: WatchSearchBenchmarkCase[]
  runs?: number
}) {
  if (!Number.isInteger(runs) || runs <= 0) {
    throw new Error("Benchmark runs must be a positive integer")
  }
  const allPostgres: number[] = []
  const allTypesense: number[] = []
  const results = []

  for (const benchmarkCase of cases) {
    await timedSearch(postgres, benchmarkCase.input)
    await timedSearch(typesense, benchmarkCase.input)

    const postgresRuns = []
    const typesenseRuns = []
    let latestPostgres: WatchSearchResponse | null = null
    let latestTypesense: WatchSearchResponse | null = null
    for (let run = 0; run < runs; run += 1) {
      const first = run % 2 === 0 ? postgres : typesense
      const second = run % 2 === 0 ? typesense : postgres
      const firstResult = await timedSearch(first, benchmarkCase.input)
      const secondResult = await timedSearch(second, benchmarkCase.input)
      const postgresResult = run % 2 === 0 ? firstResult : secondResult
      const typesenseResult = run % 2 === 0 ? secondResult : firstResult
      postgresRuns.push(postgresResult.wallMs)
      typesenseRuns.push(typesenseResult.wallMs)
      latestPostgres = postgresResult.response
      latestTypesense = typesenseResult.response
    }
    allPostgres.push(...postgresRuns)
    allTypesense.push(...typesenseRuns)
    results.push({
      name: benchmarkCase.name,
      postgres: summarizeRuns(postgresRuns, latestPostgres!),
      typesense: summarizeRuns(typesenseRuns, latestTypesense!),
      top10Jaccard: resultOverlap(latestPostgres!, latestTypesense!),
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    runsPerCase: runs,
    cases: results,
    aggregate: {
      postgres: summarizeLatencies(allPostgres),
      typesense: summarizeLatencies(allTypesense),
    },
  }
}

function summarizeLatencies(values: readonly number[]) {
  if (values.length === 0) {
    return { samples: 0, p50Ms: 0, p95Ms: 0, minMs: 0, maxMs: 0 }
  }
  return {
    samples: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  }
}

function summarizeRuns(
  values: readonly number[],
  response: WatchSearchResponse,
) {
  return {
    ...summarizeLatencies(values),
    resultCount: response.results.length,
    degraded: response.degraded,
    topResults: response.results.slice(0, 5).map((result) => ({
      id: result.id,
      slug: result.slug,
      title: result.title,
      evidence: result.evidence.kind,
      availability: result.availability.kind,
    })),
  }
}

async function main() {
  const host = process.env.TYPESENSE_HOST
  const apiKey = process.env.TYPESENSE_API_KEY
  if (!host || !apiKey) {
    throw new Error("TYPESENSE_HOST and TYPESENSE_API_KEY are required")
  }
  const runs = Number(process.env.WATCH_SEARCH_BENCHMARK_RUNS ?? DEFAULT_RUNS)
  const report = await benchmarkWatchSearchBackends({
    postgres: new WatchSearchService(prisma),
    typesense: new TypesenseWatchSearchService(
      prisma,
      new TypesenseClient({ host, apiKey, timeoutMs: 2_000 }),
    ),
    runs,
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((error) => {
      process.stderr.write(
        `[watch-search-benchmark] ${error instanceof Error ? error.stack : String(error)}\n`,
      )
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
