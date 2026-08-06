import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"

import { z } from "zod"

const DEFAULT_RUNS = 100

const LaneStatusSchema = z.object({
  lane: z.string(),
  status: z.enum(["fulfilled", "degraded", "skipped"]),
  startedOffsetMs: z.number().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  resultCount: z.number().int().nonnegative(),
  reason: z.string().nullable(),
  detail: z.string().nullable(),
})

const PROBE_CASES = [
  { query: "JESUS", locale: "en", languageSlug: "english" },
  { query: "Who is Jesus?", locale: "en", languageSlug: "english" },
  {
    query: "finding hope when life feels heavy",
    locale: "en",
    languageSlug: "english",
  },
  {
    query: "forgiveness after failure",
    locale: "en",
    languageSlug: "english",
  },
  { query: "耶稣是谁？", locale: "zh-Hans", languageSlug: "mandarin-china" },
  { query: "พระเยซูคือใคร", locale: "th", languageSlug: "thai" },
  {
    query: "من هو يسوع؟",
    locale: "ar",
    languageSlug: "arabic-modern-standard",
  },
  { query: "Кто такой Иисус?", locale: "ru", languageSlug: "russian" },
  { query: "walking wih jesus", locale: "en", languageSlug: "english" },
  { query: "woman at the well", locale: "en", languageSlug: "english" },
] as const

const InternalResponseSchema = z.object({
  requestId: z.string(),
  degraded: z.boolean(),
  latencyMs: z.number().nonnegative(),
  laneStatuses: z.array(LaneStatusSchema),
})

const GraphqlResponseSchema = z.object({
  data: z.object({
    watchSearch: z.object({
      requestId: z.string(),
      degraded: z.boolean(),
      latencyMs: z.number().nonnegative(),
      laneStatuses: z.array(LaneStatusSchema),
    }),
  }),
})

export type ProductionProbeSample = {
  clientRequestId: string
  roundTripMs: number
  serverMs: number
  degraded: boolean
  surfaceFirstSeen: boolean
  laneStatuses: z.infer<typeof LaneStatusSchema>[]
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)] ?? 0
}

function latencySummary(samples: readonly ProductionProbeSample[]) {
  return {
    samples: samples.length,
    server: {
      p50Ms: percentile(
        samples.map((sample) => sample.serverMs),
        0.5,
      ),
      p95Ms: percentile(
        samples.map((sample) => sample.serverMs),
        0.95,
      ),
    },
    roundTrip: {
      p50Ms: percentile(
        samples.map((sample) => sample.roundTripMs),
        0.5,
      ),
      p95Ms: percentile(
        samples.map((sample) => sample.roundTripMs),
        0.95,
      ),
    },
  }
}

export function summarizeProductionProbe(
  samples: readonly ProductionProbeSample[],
) {
  const cacheDetails = new Map<string, number>()
  const laneSamples = new Map<string, Array<z.infer<typeof LaneStatusSchema>>>()
  for (const sample of samples) {
    for (const lane of sample.laneStatuses) {
      const entries = laneSamples.get(lane.lane) ?? []
      entries.push(lane)
      laneSamples.set(lane.lane, entries)
      if (lane.lane === "semantic_embedding") {
        const detail = lane.detail ?? lane.reason ?? "uncategorized"
        cacheDetails.set(detail, (cacheDetails.get(detail) ?? 0) + 1)
      }
    }
  }
  return {
    ...latencySummary(samples),
    accepted: samples.length,
    degraded: samples.filter((sample) => sample.degraded).length,
    surfaceFirstSeen: latencySummary(
      samples.filter((sample) => sample.surfaceFirstSeen),
    ),
    repeat: latencySummary(
      samples.filter((sample) => !sample.surfaceFirstSeen),
    ),
    embeddingCache: Object.fromEntries([...cacheDetails].sort()),
    lanes: Object.fromEntries(
      [...laneSamples]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([lane, entries]) => [
          lane,
          {
            samples: entries.length,
            p50Ms: percentile(
              entries.map((entry) => entry.elapsedMs),
              0.5,
            ),
            p95Ms: percentile(
              entries.map((entry) => entry.elapsedMs),
              0.95,
            ),
            degraded: entries.filter((entry) => entry.status === "degraded")
              .length,
            skipped: entries.filter((entry) => entry.status === "skipped")
              .length,
          },
        ]),
    ),
    clientRequestIds: samples.map((sample) => sample.clientRequestId),
  }
}

export function buildGraphqlRequest({
  query,
  languageSlug,
  clientRequestId,
}: {
  query: string
  languageSlug: string
  clientRequestId: string
}) {
  return {
    query: `query WatchSearchProductionProbe($input: WatchSearchInput!) {
  watchSearch(input: $input) {
    requestId
    degraded
    latencyMs
    laneStatuses {
      lane
      status
      startedOffsetMs
      elapsedMs
      resultCount
      reason
      detail
    }
  }
}`,
    variables: {
      input: {
        query,
        mode: "MODERN",
        clientRequestId,
        targetLanguageSlug: languageSlug,
        queryLanguageSlug: languageSlug,
        displayLanguageSlug: languageSlug,
        routeLanguageSlug: languageSlug,
        limit: 10,
        resultTypes: ["VIDEO"],
      },
    },
  }
}

export function buildInternalRequest({
  query,
  locale,
  languageSlug,
  clientRequestId,
}: {
  query: string
  locale: string
  languageSlug: string
  clientRequestId: string
}) {
  return {
    query,
    locale,
    languageSlug,
    clientRequestId,
    mode: "modern",
    contentType: "video",
    limit: 10,
  }
}

async function postJson({
  url,
  bearer,
  body,
}: {
  url: string
  bearer?: string
  body: unknown
}): Promise<{ payload: unknown; elapsedMs: number }> {
  const startedAt = performance.now()
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const elapsedMs = performance.now() - startedAt
  const payload = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(`probe request failed with HTTP ${response.status}`)
  }
  return { payload, elapsedMs }
}

function requestId(runId: string, lane: "server" | "graphql", index: number) {
  return `wsprobe-${lane}-${String(index + 1).padStart(3, "0")}-${runId}`
}

async function runServerProbe({
  url,
  bearer,
  runs,
  runId,
}: {
  url: string
  bearer: string
  runs: number
  runId: string
}): Promise<ProductionProbeSample[]> {
  const samples: ProductionProbeSample[] = []
  for (let index = 0; index < runs; index++) {
    const probeCase = PROBE_CASES[index % PROBE_CASES.length]!
    const clientRequestId = requestId(runId, "server", index)
    const response = await postJson({
      url,
      bearer,
      body: buildInternalRequest({ ...probeCase, clientRequestId }),
    })
    const parsed = InternalResponseSchema.parse(response.payload)
    samples.push({
      clientRequestId,
      roundTripMs: response.elapsedMs,
      serverMs: parsed.latencyMs,
      degraded: parsed.degraded,
      surfaceFirstSeen: index < PROBE_CASES.length,
      laneStatuses: parsed.laneStatuses,
    })
  }
  return samples
}

async function runGraphqlProbe({
  url,
  bearer,
  runs,
  runId,
}: {
  url: string
  bearer?: string
  runs: number
  runId: string
}): Promise<ProductionProbeSample[]> {
  const samples: ProductionProbeSample[] = []
  for (let index = 0; index < runs; index++) {
    const probeCase = PROBE_CASES[index % PROBE_CASES.length]!
    const clientRequestId = requestId(runId, "graphql", index)
    const response = await postJson({
      url,
      bearer,
      body: buildGraphqlRequest({ ...probeCase, clientRequestId }),
    })
    const parsed = GraphqlResponseSchema.parse(response.payload)
    samples.push({
      clientRequestId,
      roundTripMs: response.elapsedMs,
      serverMs: parsed.data.watchSearch.latencyMs,
      degraded: parsed.data.watchSearch.degraded,
      surfaceFirstSeen: index < PROBE_CASES.length,
      laneStatuses: parsed.data.watchSearch.laneStatuses,
    })
  }
  return samples
}

async function main() {
  const adminUrl = process.env.WATCH_SEARCH_PROBE_ADMIN_URL
  const adminBearer = process.env.WATCH_SEARCH_PROBE_ADMIN_BEARER
  const graphqlUrl = process.env.WATCH_SEARCH_PROBE_GRAPHQL_URL
  const graphqlBearer = process.env.WATCH_SEARCH_PROBE_GRAPHQL_BEARER
  if (!adminUrl || !adminBearer || !graphqlUrl) {
    throw new Error(
      "WATCH_SEARCH_PROBE_ADMIN_URL, WATCH_SEARCH_PROBE_ADMIN_BEARER, and WATCH_SEARCH_PROBE_GRAPHQL_URL are required",
    )
  }
  const runs = Number(process.env.WATCH_SEARCH_PROBE_RUNS ?? DEFAULT_RUNS)
  if (!Number.isInteger(runs) || runs < 1 || runs > 1_000) {
    throw new Error("WATCH_SEARCH_PROBE_RUNS must be an integer from 1 to 1000")
  }
  const runId = randomUUID().replaceAll("-", "").slice(0, 12)
  const server = await runServerProbe({
    url: adminUrl,
    bearer: adminBearer,
    runs,
    runId,
  })
  const graphql = await runGraphqlProbe({
    url: graphqlUrl,
    bearer: graphqlBearer,
    runs,
    runId,
  })
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        revision:
          process.env.RAILWAY_GIT_COMMIT_SHA ??
          process.env.GIT_COMMIT_SHA ??
          null,
        backendMode: "modern",
        runsPerSurface: runs,
        analyticsCorrelationPrefix: `wsprobe-*-*-${runId}`,
        server: summarizeProductionProbe(server),
        graphql: summarizeProductionProbe(graphql),
      },
      null,
      2,
    )}\n`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `[watch-search-production-probe] ${error instanceof Error ? error.stack : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
