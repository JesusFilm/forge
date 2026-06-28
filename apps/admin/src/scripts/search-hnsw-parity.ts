import { performance } from "node:perf_hooks"

const DEFAULT_QUERIES = [
  "the bible project",
  "jesus",
  "hope when life is hard",
] as const
const MODES = ["semantic-only", "semantic-hnsw-prototype"] as const

type SearchMode = (typeof MODES)[number]

type SearchResult = {
  type: string
  id: string
  title: string
  snippet: string
  startSeconds: number | null
  score: number
}

type SearchResponse = {
  results: SearchResult[]
  searchMode: string
}

type RunResult = {
  query: string
  mode: SearchMode
  run: number
  clientMs: number
  searchMode: string
  resultCount: number
  distinctVideoCount: number
  signature: string[]
}

function parseQueries(
  args: Map<string, string>,
  positional: string[],
): string[] {
  if (positional.length > 0) return positional

  const inlineQueries = args.get("queries")
  if (inlineQueries) {
    return inlineQueries
      .split("|")
      .map((query) => query.trim())
      .filter(Boolean)
  }

  const envQueries = process.env.SEARCH_HNSW_PARITY_QUERIES?.split("|")
    .map((query) => query.trim())
    .filter(Boolean)
  return envQueries && envQueries.length > 0 ? envQueries : [...DEFAULT_QUERIES]
}

function parseArgs(argv: string[]): {
  url: string
  apiKey: string
  locale: string
  limit: number
  runs: number
  queries: string[]
} {
  const args = new Map<string, string>()
  const queryArgs: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--") continue
    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2)
      const value = inlineValue ?? argv[++i]
      if (!rawKey || value == null) {
        throw new Error(`Missing value for ${arg}`)
      }
      args.set(rawKey, value)
      continue
    }
    queryArgs.push(arg)
  }

  const url = args.get("url") ?? process.env.ADMIN_SEARCH_EVAL_SEARCH_URL ?? ""
  const apiKey =
    args.get("api-key") ?? process.env.ADMIN_SEARCH_EVAL_API_KEY ?? ""
  if (!url) {
    throw new Error(
      "Missing internal search URL. Set ADMIN_SEARCH_EVAL_SEARCH_URL or pass --url.",
    )
  }
  if (!apiKey) {
    throw new Error(
      "Missing internal search API key. Set ADMIN_SEARCH_EVAL_API_KEY or pass --api-key.",
    )
  }

  return {
    url,
    apiKey,
    locale: args.get("locale") ?? process.env.SEARCH_HNSW_PARITY_LOCALE ?? "en",
    limit: parsePositiveInt(args.get("limit"), 20, "limit"),
    runs: parsePositiveInt(args.get("runs"), 3, "runs"),
    queries: parseQueries(args, queryArgs),
  }
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw == null) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10
}

function signatureFor(response: SearchResponse): string[] {
  return response.results.map((result) =>
    [
      result.type,
      result.id,
      result.score.toFixed(6),
      result.title,
      result.snippet,
      result.startSeconds == null ? "null" : String(result.startSeconds),
    ].join("|"),
  )
}

function distinctVideoCount(response: SearchResponse): number {
  return new Set(
    response.results
      .filter((result) => result.type === "video")
      .map((result) => result.id),
  ).size
}

function sameSignature(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

async function runSearch(input: {
  url: string
  apiKey: string
  query: string
  locale: string
  limit: number
  mode: SearchMode
  run: number
}): Promise<RunResult> {
  const startedAt = performance.now()
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: input.query,
      locale: input.locale,
      limit: input.limit,
      mode: input.mode,
      contentType: "video",
    }),
  })
  const clientMs = elapsedMs(startedAt)
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      `Search failed for ${input.query} ${input.mode}: ${response.status} ${body.slice(0, 200)}`,
    )
  }

  const json = (await response.json()) as SearchResponse
  return {
    query: input.query,
    mode: input.mode,
    run: input.run,
    clientMs,
    searchMode: json.searchMode,
    resultCount: json.results.length,
    distinctVideoCount: distinctVideoCount(json),
    signature: signatureFor(json),
  }
}

function quantiles(values: number[]): {
  min: number
  median: number
  max: number
} {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    min: sorted[0] ?? 0,
    median:
      sorted.length % 2 === 0
        ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) * 5) /
          10
        : (sorted[middle] ?? 0),
    max: sorted.at(-1) ?? 0,
  }
}

function summarize(query: string, runs: RunResult[]) {
  const byMode = new Map<SearchMode, RunResult[]>()
  for (const mode of MODES) {
    byMode.set(
      mode,
      runs.filter((result) => result.query === query && result.mode === mode),
    )
  }

  const exactRuns = byMode.get("semantic-only") ?? []
  const hnswRuns = byMode.get("semantic-hnsw-prototype") ?? []
  const exactFirst = exactRuns[0]?.signature ?? []
  const hnswFirst = hnswRuns[0]?.signature ?? []
  const sharedTopIds = new Set(
    exactFirst.map((signature) => signature.split("|")[1]),
  )
  const hnswTopIds = hnswFirst.map((signature) => signature.split("|")[1])
  const topIdOverlap = hnswTopIds.filter((id) => sharedTopIds.has(id)).length

  return {
    query,
    modes: Object.fromEntries(
      MODES.map((mode) => {
        const modeRuns = byMode.get(mode) ?? []
        return [
          mode,
          {
            clientMs: quantiles(modeRuns.map((result) => result.clientMs)),
            resultCounts: modeRuns.map((result) => result.resultCount),
            distinctVideoCounts: modeRuns.map(
              (result) => result.distinctVideoCount,
            ),
            fullSignatureStable: modeRuns.every(
              (result) =>
                modeRuns[0] != null &&
                sameSignature(result.signature, modeRuns[0].signature),
            ),
          },
        ]
      }),
    ),
    hnswMatchesExactSignature: sameSignature(hnswFirst, exactFirst),
    topIdOverlap,
    comparedTopN: Math.max(exactFirst.length, hnswFirst.length),
    exactTop5: exactFirst.slice(0, 5),
    hnswTop5: hnswFirst.slice(0, 5),
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2))
  const runs: RunResult[] = []

  for (const query of config.queries) {
    for (let run = 1; run <= config.runs; run++) {
      for (const mode of MODES) {
        runs.push(
          await runSearch({
            ...config,
            query,
            mode,
            run,
          }),
        )
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        endpoint: config.url,
        locale: config.locale,
        limit: config.limit,
        runsPerMode: config.runs,
        summaries: config.queries.map((query) => summarize(query, runs)),
        runs,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
