import { createHash } from "node:crypto"

import { z } from "zod"

const key = z.string().trim().min(1).max(500)
const count = z.number().int().nonnegative().safe()
const definitionSchema = z
  .object({
    provider: z.enum(["bigquery", "fixture"]),
    queryId: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
    rangeStart: z.iso.date(),
    rangeEnd: z.iso.date(),
    identity: z.enum(["canonical_id", "core_id", "slug", "verified_alias"]),
    aliases: z.record(key, key).optional(),
    botFiltering: z.enum(["unknown", "verified_excluded"]),
    measurement: z.enum(["observed_events", "qualified_engagement"]),
    overlap: z.enum(["unknown", "verified_disjoint"]),
  })
  .strict()
const engagement = z
  .object({
    videoKey: key,
    views: count,
    engagedViews: count,
    exposures: count.nullable(),
  })
  .strict()
const transition = z
  .object({
    sourceKey: key,
    targetKey: key,
    transitions: count,
  })
  .strict()
const MAX_PAGE_ROWS = 100

export type HistoricalAnalyticsReader = {
  /** Server-side aggregate definitions only. No SQL or credential tool is exposed to the model. */
  describe(): Promise<z.input<typeof definitionSchema>>
  /** Read-only, bounded aggregate pages. No individual-level records are admitted. */
  readPage(input: {
    kind: "engagement" | "transitions"
    after?: string
    limit: typeof MAX_PAGE_ROWS
    rangeStart: string
    rangeEnd: string
    cutoff: string
    videoKeys: string[]
    sourceKey: string
    targetKeys: string[]
  }): Promise<{
    rows: unknown[]
    nextCursor: string | null
    totalRows: number
    /** Provider job identity. All pages of one query use the same identity. */
    queryExecutionId: string
    jobComplete: boolean
    /** Query-level usage repeated on continuation pages, never a page delta. */
    bytesProcessed: number | null
  }>
}

export class HistoricalAnalyticsError extends Error {
  constructor(
    readonly code:
      | "analytics_unavailable"
      | "analytics_incomplete"
      | "analytics_mapping_unverified",
  ) {
    super(code)
  }
}

type CatalogIdentity = {
  id: string
  coreId: string
  slug: string
}
export type HistoricalDefinition = z.output<typeof definitionSchema>

type Signal = z.output<typeof engagement>
type Transition = z.output<typeof transition>

export type HistoricalProvenance = {
  provider: "bigquery" | "fixture"
  status: "complete"
  queryId: string
  rangeStart: string
  rangeEnd: string
  cutoff: string
  identity: "canonical_id" | "core_id" | "slug" | "verified_alias"
  botFiltering: "unknown" | "verified_excluded"
  measurement: "observed_events" | "qualified_engagement"
  overlap: "unknown" | "verified_disjoint"
  rowCount: number
  catalogCandidates: number
  inspectedCandidates: number
  unmappedCandidates: number
  mappedRows: number
  unmappedRows: number
  pageCount: number
  queryExecutionCount: number
  queryUsageDigest: string
  resultDigest: string
  unmappedDigest: string | null
  bytesProcessed: number | null
  costQualification: "usage_only" | "unavailable"
}

export type HistoricalSnapshot = {
  provenance: HistoricalProvenance
  /** Internal query accounting; job identifiers never enter prompts or saved rows. */
  queryUsage: ReadonlyMap<string, number | null>
  definitionsForModel: Pick<
    HistoricalProvenance,
    | "provider"
    | "queryId"
    | "rangeStart"
    | "rangeEnd"
    | "identity"
    | "botFiltering"
    | "measurement"
    | "overlap"
  > & {
    engagement: string
    transitions: string
  }
  signal(videoId: string): Signal | null
  transition(sourceVideoId: string, targetVideoId: string): number | null
}
export type HistoricalProvenancePart = Pick<
  HistoricalSnapshot,
  "provenance" | "queryUsage"
>

export async function readHistoricalDefinition(
  reader: HistoricalAnalyticsReader,
  cutoff: string,
): Promise<HistoricalDefinition> {
  let definition: HistoricalDefinition
  try {
    definition = definitionSchema.parse(await reader.describe())
  } catch {
    throw new HistoricalAnalyticsError("analytics_unavailable")
  }
  if (
    definition.rangeStart > definition.rangeEnd ||
    definition.rangeEnd > cutoff.slice(0, 10) ||
    (definition.identity === "verified_alias" && !definition.aliases)
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  return definition
}

export function mergeHistoricalProvenance(
  snapshots: readonly HistoricalProvenancePart[],
): HistoricalProvenance {
  if (snapshots.length === 0)
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const parts = snapshots.map((snapshot) => snapshot.provenance)
  const first = parts[0]
  if (
    parts.some(
      (part) =>
        part.queryId !== first.queryId ||
        part.rangeStart !== first.rangeStart ||
        part.rangeEnd !== first.rangeEnd ||
        part.cutoff !== first.cutoff ||
        part.provider !== first.provider,
    )
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const usage = new Map<string, number | null>()
  for (const snapshot of snapshots) {
    for (const [executionId, bytes] of snapshot.queryUsage) {
      const prior = usage.get(executionId)
      if (prior !== undefined && prior !== bytes)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      usage.set(executionId, bytes)
    }
  }
  const unknownUsage = [...usage.values()].some((bytes) => bytes === null)
  return {
    ...first,
    rowCount: parts.reduce((sum, part) => sum + part.rowCount, 0),
    catalogCandidates: parts.reduce(
      (sum, part) => sum + part.catalogCandidates,
      0,
    ),
    inspectedCandidates: parts.reduce(
      (sum, part) => sum + part.inspectedCandidates,
      0,
    ),
    unmappedCandidates: parts.reduce(
      (sum, part) => sum + part.unmappedCandidates,
      0,
    ),
    mappedRows: parts.reduce((sum, part) => sum + part.mappedRows, 0),
    unmappedRows: parts.reduce((sum, part) => sum + part.unmappedRows, 0),
    pageCount: parts.reduce((sum, part) => sum + part.pageCount, 0),
    queryExecutionCount: usage.size,
    queryUsageDigest: createHash("sha256")
      .update(JSON.stringify([...usage].sort(([a], [b]) => a.localeCompare(b))))
      .digest("hex"),
    resultDigest: createHash("sha256")
      .update(JSON.stringify(parts.map((part) => part.resultDigest)))
      .digest("hex"),
    unmappedDigest: parts.some((part) => part.unmappedDigest)
      ? createHash("sha256")
          .update(JSON.stringify(parts.map((part) => part.unmappedDigest)))
          .digest("hex")
      : null,
    bytesProcessed: unknownUsage
      ? null
      : [...usage.values()].reduce<number>(
          (sum, bytes) => sum + (bytes ?? 0),
          0,
        ),
    costQualification: unknownUsage ? "unavailable" : "usage_only",
  }
}

/** The catalog is authoritative: unknown and ambiguous legacy identities stay unmapped. */
export async function readHistoricalSnapshot(input: {
  reader: HistoricalAnalyticsReader
  definition: HistoricalDefinition
  catalog: readonly CatalogIdentity[]
  sourceVideoId: string
  selectedVideoIds: readonly string[]
  includeSourceEngagement: boolean
  cutoff: string
}): Promise<HistoricalSnapshot> {
  const definition = input.definition
  const selected = new Set(input.selectedVideoIds)
  const source = input.catalog.find((video) => video.id === input.sourceVideoId)
  if (
    !source ||
    input.selectedVideoIds.some(
      (id) =>
        id === source.id || !input.catalog.some((video) => video.id === id),
    )
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")

  const aliasesByVideo = new Map<string, string[]>()
  if (definition.identity === "verified_alias") {
    for (const [alias, videoId] of Object.entries(definition.aliases ?? {})) {
      const aliases = aliasesByVideo.get(videoId) ?? []
      aliases.push(alias)
      aliasesByVideo.set(videoId, aliases)
    }
  }
  const keyFor = (video: CatalogIdentity) =>
    definition.identity === "canonical_id"
      ? [video.id]
      : definition.identity === "core_id"
        ? [video.coreId]
        : definition.identity === "slug"
          ? [video.slug]
          : (aliasesByVideo.get(video.id) ?? [])
  const identities = new Map<string, string | null>()
  for (const video of input.catalog) {
    const value =
      definition.identity === "canonical_id"
        ? video.id
        : definition.identity === "core_id"
          ? video.coreId
          : definition.identity === "slug"
            ? video.slug
            : null
    if (value) identities.set(value, identities.has(value) ? null : video.id)
  }
  if (definition.identity === "verified_alias") {
    const known = new Set(input.catalog.map((video) => video.id))
    for (const [alias, videoId] of Object.entries(definition.aliases ?? {}))
      identities.set(alias, known.has(videoId) ? videoId : null)
  }
  const sourceKeys = keyFor(source)
  // Multiple verified aliases might represent overlapping events. Until the
  // live warehouse schema proves a disjoint identity basis, do not sum them.
  if (sourceKeys.length !== 1 || identities.get(sourceKeys[0]) !== source.id)
    throw new HistoricalAnalyticsError("analytics_mapping_unverified")
  const queryableSelected = new Set(
    input.catalog
      .filter(
        (video) =>
          selected.has(video.id) &&
          keyFor(video).length === 1 &&
          identities.get(keyFor(video)[0]) === video.id,
      )
      .map((video) => video.id),
  )
  const videoKeys = input.catalog.flatMap((video) =>
    queryableSelected.has(video.id) ||
    (input.includeSourceEngagement && video.id === source.id)
      ? keyFor(video)
      : [],
  )
  const targetKeys = input.catalog.flatMap((video) =>
    queryableSelected.has(video.id) ? keyFor(video) : [],
  )
  if (videoKeys.length > 100 || targetKeys.length > 100)
    throw new HistoricalAnalyticsError("analytics_incomplete")

  const engagementByVideo = new Map<string, Signal>()
  const transitionsByPair = new Map<string, number>()
  const resultHash = createHash("sha256")
  const unmappedHash = createHash("sha256")
  let rowCount = 0
  let mappedRows = 0
  let unmappedRows = 0
  let pageCount = 0
  const queryUsage = new Map<string, number | null>()
  for (const kind of ["engagement", "transitions"] as const) {
    if (
      (kind === "engagement" && videoKeys.length === 0) ||
      (kind === "transitions" && targetKeys.length === 0)
    )
      continue
    const seenCursors = new Set<string>()
    let queryExecutionId: string | undefined
    let after: string | undefined
    let observedRows = 0
    let expectedRows: number | undefined
    while (true) {
      let page: Awaited<ReturnType<HistoricalAnalyticsReader["readPage"]>>
      try {
        page = await input.reader.readPage({
          kind,
          after,
          limit: MAX_PAGE_ROWS,
          rangeStart: definition.rangeStart,
          rangeEnd: definition.rangeEnd,
          cutoff: input.cutoff,
          videoKeys: kind === "engagement" ? videoKeys : [],
          sourceKey: sourceKeys[0],
          targetKeys: kind === "transitions" ? targetKeys : [],
        })
      } catch (error) {
        if (error instanceof HistoricalAnalyticsError) throw error
        throw new HistoricalAnalyticsError("analytics_unavailable")
      }
      if (
        !Array.isArray(page.rows) ||
        page.rows.length > MAX_PAGE_ROWS ||
        page.jobComplete !== true ||
        typeof page.queryExecutionId !== "string" ||
        !/^[a-zA-Z0-9_.:-]{1,200}$/.test(page.queryExecutionId) ||
        (queryExecutionId !== undefined &&
          page.queryExecutionId !== queryExecutionId) ||
        !Number.isSafeInteger(page.totalRows) ||
        page.totalRows < 0 ||
        (expectedRows !== undefined && expectedRows !== page.totalRows) ||
        (page.bytesProcessed !== null &&
          (!Number.isSafeInteger(page.bytesProcessed) ||
            page.bytesProcessed < 0)) ||
        (page.nextCursor !== null &&
          (typeof page.nextCursor !== "string" ||
            page.nextCursor.length === 0 ||
            page.nextCursor.length > 200 ||
            page.rows.length === 0 ||
            seenCursors.has(page.nextCursor)))
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      expectedRows = page.totalRows
      queryExecutionId = page.queryExecutionId
      observedRows += page.rows.length
      if (observedRows > expectedRows)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      pageCount++
      const priorUsage = queryUsage.get(page.queryExecutionId)
      if (priorUsage !== undefined && priorUsage !== page.bytesProcessed)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      queryUsage.set(page.queryExecutionId, page.bytesProcessed)
      for (const raw of page.rows) {
        let row: Signal | Transition
        try {
          row = (kind === "engagement" ? engagement : transition).parse(raw)
        } catch {
          throw new HistoricalAnalyticsError("analytics_incomplete")
        }
        rowCount++
        if (kind === "engagement") {
          const signal = row as Signal
          if (signal.engagedViews > signal.views)
            throw new HistoricalAnalyticsError("analytics_incomplete")
          const canonical = identities.get(signal.videoKey)
          if (!canonical) {
            unmappedRows++
            const redacted = {
              kind,
              mapped: false,
              views: signal.views,
              engagedViews: signal.engagedViews,
              exposures: signal.exposures,
            }
            resultHash.update(JSON.stringify(redacted))
            unmappedHash.update(JSON.stringify(redacted))
            continue
          }
          if (!videoKeys.includes(signal.videoKey))
            throw new HistoricalAnalyticsError("analytics_incomplete")
          if (engagementByVideo.has(canonical))
            throw new HistoricalAnalyticsError("analytics_incomplete")
          mappedRows++
          resultHash.update(
            JSON.stringify({
              kind,
              videoId: canonical,
              views: signal.views,
              engagedViews: signal.engagedViews,
              exposures: signal.exposures,
            }),
          )
          engagementByVideo.set(canonical, {
            ...signal,
            videoKey: canonical,
          })
        } else {
          const transitionRow = row as Transition
          const source = identities.get(transitionRow.sourceKey)
          const target = identities.get(transitionRow.targetKey)
          if (!source || !target) {
            unmappedRows++
            const redacted = {
              kind,
              mapped: false,
              transitions: transitionRow.transitions,
            }
            resultHash.update(JSON.stringify(redacted))
            unmappedHash.update(JSON.stringify(redacted))
            continue
          }
          if (
            transitionRow.sourceKey !== sourceKeys[0] ||
            !targetKeys.includes(transitionRow.targetKey)
          )
            throw new HistoricalAnalyticsError("analytics_incomplete")
          const pair = JSON.stringify([source, target])
          if (transitionsByPair.has(pair))
            throw new HistoricalAnalyticsError("analytics_incomplete")
          mappedRows++
          resultHash.update(
            JSON.stringify({
              kind,
              sourceVideoId: source,
              targetVideoId: target,
              transitions: transitionRow.transitions,
            }),
          )
          transitionsByPair.set(pair, transitionRow.transitions)
        }
      }
      if (!page.nextCursor) {
        if (observedRows !== expectedRows)
          throw new HistoricalAnalyticsError("analytics_incomplete")
        break
      }
      seenCursors.add(page.nextCursor)
      after = page.nextCursor
    }
  }

  const unknownUsage = [...queryUsage.values()].some((bytes) => bytes === null)
  const bytesProcessed = unknownUsage
    ? null
    : [...queryUsage.values()].reduce<number>(
        (sum, bytes) => sum + (bytes ?? 0),
        0,
      )
  const provenance: HistoricalProvenance = {
    provider: definition.provider,
    status: "complete",
    queryId: definition.queryId,
    rangeStart: definition.rangeStart,
    rangeEnd: definition.rangeEnd,
    cutoff: input.cutoff,
    identity: definition.identity,
    botFiltering: definition.botFiltering,
    measurement: definition.measurement,
    overlap: definition.overlap,
    rowCount,
    catalogCandidates: input.includeSourceEngagement
      ? 0
      : input.catalog.length - 1,
    inspectedCandidates: queryableSelected.size,
    unmappedCandidates: selected.size - queryableSelected.size,
    mappedRows,
    unmappedRows,
    pageCount,
    queryExecutionCount: queryUsage.size,
    queryUsageDigest: createHash("sha256")
      .update(
        JSON.stringify([...queryUsage].sort(([a], [b]) => a.localeCompare(b))),
      )
      .digest("hex"),
    resultDigest: resultHash.digest("hex"),
    unmappedDigest: unmappedRows ? unmappedHash.digest("hex") : null,
    bytesProcessed,
    costQualification: bytesProcessed === null ? "unavailable" : "usage_only",
  }
  return {
    provenance,
    queryUsage,
    definitionsForModel: {
      provider: provenance.provider,
      queryId: provenance.queryId,
      rangeStart: provenance.rangeStart,
      rangeEnd: provenance.rangeEnd,
      identity: provenance.identity,
      botFiltering: provenance.botFiltering,
      measurement: provenance.measurement,
      overlap: provenance.overlap,
      engagement:
        "Per-video views, engaged views, and nullable exposures aggregated across the full declared date range.",
      transitions:
        "Source-to-candidate video transitions aggregated across the full declared date range.",
    },
    signal(videoId) {
      return engagementByVideo.get(videoId) ?? null
    },
    transition(sourceVideoId, targetVideoId) {
      return (
        transitionsByPair.get(JSON.stringify([sourceVideoId, targetVideoId])) ??
        null
      )
    },
  }
}
