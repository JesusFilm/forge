import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { PrecomputedCatalogError, readPrecomputedCatalog } from "./catalog"
import { PrecomputedRecommendationError } from "./contract"
import { canonicalGaCaptureJson, gaCaptureSha256 } from "./ga-capture-artifact"

const WATCH_HOSTS = ["jesusfilm.org", "www.jesusfilm.org"] as const
const WATCH_PATH_REGEX = "^/watch(/.*)?$"
const WATCH_REFERRER_REGEX =
  "^https?://(www\\.)?jesusfilm\\.org/watch(/[^?#]*)?([?#].*)?$"
const SNAPSHOT_PAGE_SIZE = 500
const hex = /^[a-f0-9]{64}$/u

export type DestinationIdentity = {
  generationId: string
  generationInputDigest: string
  sourceSetDigest: string
  inputCutoff: string
  selectedCorpusDigest: string
  candidatePoolDigest: string
  routeMappingDigest: string
  sourcePatternTableDigest: string
  querySpecDigest: string
  propertyId: "320198532"
  propertyTimeZone: "America/New_York"
  qualificationPolicy: "referrer_navigation_v1"
  requestedStart: string
  requestedEnd: string
  usableStart: string
  usableEnd: string
  requestedCoverageDigest: string
  usableCoverageDigest: string
}

function fail(): never {
  throw new PrecomputedRecommendationError(
    "conflict",
    "GA import destination catalog identity unavailable",
  )
}
function catalogFailure(cause: unknown): never {
  if (cause instanceof PrecomputedCatalogError) fail()
  throw cause
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex")
const escapedRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
const routePatterns = (video: {
  slug: string
  watchRouteIdentity: { parentSlugs: string[] }
}) => {
  const child = escapedRegex(video.slug)
  return [
    `/watch/${child}\\.html(?:/[a-z0-9-]+\\.html)?`,
    ...video.watchRouteIdentity.parentSlugs.map(
      (parent) =>
        `/watch/${escapedRegex(parent)}\\.html/${child}(?:\\.html)?(?:/[a-z0-9-]+\\.html)?`,
    ),
  ]
}
const exactFilter = (fieldName: string, value: string) => ({
  filter: {
    fieldName,
    stringFilter: { matchType: "EXACT", value, caseSensitive: true },
  },
})
function watchFilter(kind: "startPaths" | "referrerPairs") {
  return {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: "hostName",
            inListFilter: { values: WATCH_HOSTS, caseSensitive: true },
          },
        },
        {
          filter: {
            fieldName: "pagePath",
            stringFilter: {
              matchType: "FULL_REGEXP",
              value: WATCH_PATH_REGEX,
              caseSensitive: true,
            },
          },
        },
        exactFilter("eventName", "videostarts"),
        ...(kind === "referrerPairs"
          ? [
              {
                filter: {
                  fieldName: "pageReferrer",
                  stringFilter: {
                    matchType: "FULL_REGEXP",
                    value: WATCH_REFERRER_REGEX,
                    caseSensitive: true,
                  },
                },
              },
            ]
          : []),
      ],
    },
  }
}
function querySpec(usableStart: string, usableEnd: string) {
  const report = (
    kind: "startPaths" | "referrerPairs",
    dimensions: string[],
  ) => ({
    dateRanges: [{ startDate: usableStart, endDate: usableEnd }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: [{ name: "eventCount" }],
    dimensionFilter: watchFilter(kind),
    orderBys: dimensions.map((dimensionName) => ({
      dimension: { dimensionName },
    })),
    limit: String(SNAPSHOT_PAGE_SIZE),
    returnPropertyQuota: true,
  })
  return {
    version: "ga_watch_capture_query_v1",
    propertyId: "320198532",
    reports: [
      report("startPaths", ["pagePath", "customEvent:mediacomponentid"]),
      report("referrerPairs", [
        "pageReferrer",
        "pagePath",
        "customEvent:mediacomponentid",
      ]),
    ],
  }
}

async function selectedChunkDigest(
  prisma: PrismaClient,
  authorizationHeader: string,
  cutoff: string,
  video: {
    id: string
    transcriptSelection: {
      selected: Array<{
        transcriptId: string
        language: string
        totalChunks: number
      }>
    }
  },
): Promise<string> {
  const selected = new Map(
    video.transcriptSelection.selected.map((item) => [item.transcriptId, item]),
  )
  if (selected.size !== video.transcriptSelection.selected.length) fail()
  const hash = createHash("sha256")
  const indices = new Map<string, Set<number>>()
  let cursor: string | undefined
  let lastId: string | undefined
  let count = 0
  for (;;) {
    const page = await readPrecomputedCatalog(
      prisma,
      {
        action: "chunks",
        cutoff,
        videoId: video.id,
        afterChunkId: cursor,
        limit: 50,
      },
      authorizationHeader,
    ).catch(catalogFailure)
    if (page.action !== "chunks") fail()
    for (const chunk of page.chunks) {
      if (lastId && chunk.id <= lastId) fail()
      const transcript = selected.get(chunk.transcriptId)
      if (
        !transcript ||
        transcript.language !== chunk.language ||
        chunk.chunkIndex < 0 ||
        chunk.chunkIndex >= transcript.totalChunks
      )
        fail()
      const seen = indices.get(chunk.transcriptId) ?? new Set<number>()
      if (seen.has(chunk.chunkIndex)) fail()
      seen.add(chunk.chunkIndex)
      indices.set(chunk.transcriptId, seen)
      lastId = chunk.id
      count++
      hash.update(
        JSON.stringify([
          chunk.id,
          chunk.transcriptId,
          chunk.language,
          chunk.chunkIndex,
          chunk.text,
        ]),
      )
    }
    if (!page.nextCursor) break
    if (page.nextCursor === cursor || (lastId && page.nextCursor < lastId))
      fail()
    cursor = page.nextCursor
    if (count > 100_000) fail()
  }
  if (
    selected.size !== indices.size ||
    [...selected].some(
      ([id, item]) => indices.get(id)?.size !== item.totalChunks,
    )
  )
    fail()
  return hash.digest("hex")
}

/** Reconstruct, never accept caller-authored catalog/query hashes. */
export async function deriveGaImportDestinationIdentity(
  prisma: PrismaClient,
  authorizationHeader: string,
  generation: {
    id: string
    inputDigest: string
    sourceSetDigest: string
    inputCutoff: Date
    expectedSourceCount: number
  },
  intent: {
    candidatePoolDigest: string
    requestedStart: string
    requestedEnd: string
    usableStart: string
    usableEnd: string
    requestedCoverageDigest: string
    usableCoverageDigest: string
  },
): Promise<DestinationIdentity> {
  if (!hex.test(intent.candidatePoolDigest)) fail()
  const cutoff = generation.inputCutoff.toISOString()
  const videos: Array<{
    id: string
    slug: string
    watchRouteIdentity: {
      basis: string
      parentSlugs: string[]
      truncated: boolean
    }
    transcriptSelection: {
      selected: Array<{
        transcriptId: string
        language: string
        totalChunks: number
      }>
    }
  }> = []
  let afterVideoId: string | undefined
  for (;;) {
    const page = await readPrecomputedCatalog(
      prisma,
      { action: "catalog", cutoff, afterVideoId, limit: 100 },
      authorizationHeader,
    ).catch(catalogFailure)
    if (page.action !== "catalog") fail()
    videos.push(...page.videos)
    if (videos.length > 20_000) fail()
    if (!page.nextCursor) break
    if (page.nextCursor === afterVideoId) fail()
    afterVideoId = page.nextCursor
  }
  const ids = videos.map((video) => video.id)
  if (
    videos.length !== generation.expectedSourceCount ||
    new Set(ids).size !== ids.length ||
    sha(JSON.stringify([...ids].sort())) !== generation.sourceSetDigest ||
    videos.some(
      (video) =>
        video.watchRouteIdentity.basis !== "current_catalog_cutoff_fenced" ||
        video.watchRouteIdentity.truncated,
    )
  )
    fail()
  videos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const corpus = createHash("sha256")
  for (const video of videos) {
    const chunkDigest = await selectedChunkDigest(
      prisma,
      authorizationHeader,
      cutoff,
      video,
    )
    corpus.update(
      JSON.stringify([
        video.id,
        video.transcriptSelection ?? null,
        chunkDigest,
      ]),
    )
  }
  const routeMappingDigest = sha(
    JSON.stringify(
      videos.map((video) => ({
        id: video.id,
        slug: video.slug,
        watchRouteIdentity: video.watchRouteIdentity,
      })),
    ),
  )
  const patterns = [...new Set(videos.flatMap(routePatterns))]
  if (patterns.length > 20_000) fail()
  return {
    generationId: generation.id,
    generationInputDigest: generation.inputDigest,
    sourceSetDigest: generation.sourceSetDigest,
    inputCutoff: cutoff,
    selectedCorpusDigest: corpus.digest("hex"),
    candidatePoolDigest: intent.candidatePoolDigest,
    routeMappingDigest,
    sourcePatternTableDigest: gaCaptureSha256(
      canonicalGaCaptureJson({
        version: "ga_watch_source_patterns_v1",
        routeMappingDigest,
        patterns,
      }),
    ),
    querySpecDigest: gaCaptureSha256(
      canonicalGaCaptureJson(querySpec(intent.usableStart, intent.usableEnd)),
    ),
    propertyId: "320198532",
    propertyTimeZone: "America/New_York",
    qualificationPolicy: "referrer_navigation_v1",
    requestedStart: intent.requestedStart,
    requestedEnd: intent.requestedEnd,
    usableStart: intent.usableStart,
    usableEnd: intent.usableEnd,
    requestedCoverageDigest: intent.requestedCoverageDigest,
    usableCoverageDigest: intent.usableCoverageDigest,
  }
}
