import { createHash } from "node:crypto"

import { z } from "zod"

const key = z.string().trim().min(1).max(500)
const count = z.number().int().nonnegative().safe()
const HISTORICAL_WATCH_SCOPE_VERSION = "jesusfilm-watch-v1" as const
const transitionFailureCodes = {
  totals_only: "analytics_transition_totals_only",
  missing_session_identity: "analytics_transition_missing_session_identity",
  missing_event_order: "analytics_transition_missing_event_order",
  missing_video_identity: "analytics_transition_missing_video_identity",
  unverified_definition: "analytics_transition_unverified_definition",
} as const
export type HistoricalAnalyticsFailureCode =
  | "analytics_unavailable"
  | "analytics_incomplete"
  | "analytics_mapping_unverified"
  | (typeof transitionFailureCodes)[keyof typeof transitionFailureCodes]
const signalQuality = z
  .object({
    botBasis: z.enum([
      "unverified",
      "verified_export_filter",
      "verified_query_filter",
    ]),
    overlapIdentity: z.enum([
      "unknown",
      "event_id",
      "verified_disjoint_export",
    ]),
  })
  .strict()
const qualification = z
  .object({
    sourceTable: z
      .string()
      .max(191)
      .regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){2}$/),
    observedStart: z.iso.date(),
    observedEnd: z.iso.date(),
    watchScope: z
      .object({
        version: z.literal(HISTORICAL_WATCH_SCOPE_VERSION),
        hosts: z.tuple([
          z.literal("jesusfilm.org"),
          z.literal("www.jesusfilm.org"),
        ]),
        pathRule: z.literal("watch-route-and-children"),
        totalEvents: count,
        includedEvents: count,
        missingUrlEvents: count,
        malformedUrlEvents: count,
        excludedHostEvents: count,
        excludedPathEvents: count,
      })
      .strict(),
    videoIdCoverage: z
      .object({
        eventName: z.literal("videostarts"),
        inScopeEvents: count,
        withIdEvents: count,
        mappedEvents: count.nullable(),
      })
      .strict(),
    engagement: signalQuality.extend({
      definitionVersion: z.literal("watch-videostarts-v1"),
    }),
    transitions: z.discriminatedUnion("status", [
      signalQuality.extend({
        status: z.literal("available"),
        definitionVersion: z.literal("consecutive-videostarts-v1"),
        /** Includes non-Watch starts as barriers; only endpoints are Watch videos. */
        continuity: z.literal("all_video_starts"),
        sessionIdentity: z.literal("verified"),
        ordering: z.literal("timestamp_and_sequence"),
      }),
      z
        .object({
          status: z.literal("unavailable"),
          reason: z.enum([
            "totals_only",
            "missing_session_identity",
            "missing_event_order",
            "missing_video_identity",
            "unverified_definition",
          ]),
        })
        .strict(),
    ]),
  })
  .strict()
const legacyDefinitionSchema = z
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
    qualification,
  })
  .strict()
const gaQualification = z
  .object({
    evidenceKind: z.literal("referrer_navigation_v1"),
    sourceResource: z.literal("properties/320198532"),
    sourceAvailability: z
      .object({
        coverage: z.literal("partial_source_history"),
        requestedStart: z.iso.date(),
        requestedEnd: z.iso.date(),
        truncationType: z.literal("DATA_TRUNCATION_TYPE_PROPERTY"),
        truncationDate: z.iso.date(),
        unavailablePrefixStart: z.iso.date(),
        unavailablePrefixEnd: z.iso.date(),
        usableStart: z.iso.date(),
        usableEnd: z.iso.date(),
        observedFirstMonth: z
          .string()
          .regex(/^\d{6}$/u)
          .nullable(),
        observedLastMonth: z
          .string()
          .regex(/^\d{6}$/u)
          .nullable(),
      })
      .strict(),
    watchScope: z
      .object({
        version: z.literal(HISTORICAL_WATCH_SCOPE_VERSION),
        hosts: z.tuple([
          z.literal("jesusfilm.org"),
          z.literal("www.jesusfilm.org"),
        ]),
        pathRule: z.literal("watch-route-and-children"),
        eventName: z.literal("videostarts"),
        includedEvents: count,
        totalEvents: z.null(),
        missingUrlEvents: z.null(),
        malformedUrlEvents: z.null(),
        excludedHostEvents: z.null(),
        excludedPathEvents: z.null(),
      })
      .strict(),
    mediaComponentIdCoverage: z
      .object({
        sourceDimension: z.literal("customEvent:mediacomponentid"),
        inScopeEvents: count,
        withMediaComponentIdEvents: count,
        canonicalVideoMappedEvents: z.null(),
      })
      .strict(),
    engagement: signalQuality.extend({
      definitionVersion: z.literal("watch-videostarts-v1"),
      exposures: z.literal("unavailable"),
    }),
    transitions: z
      .object({
        status: z.literal("unavailable"),
        reason: z.literal("missing_session_identity"),
      })
      .strict(),
    navigation: signalQuality.extend({
      status: z.literal("available"),
      definitionVersion: z.literal("watch-referrer-v1"),
      basis: z.literal("same_event_page_referrer_to_page_path"),
      interpretation: z.literal("navigation_not_playback_sequence"),
    }),
    mapping: z
      .object({
        basis: z.literal("current_catalog_cutoff_fenced"),
        historicalOwnership: z.literal("unverified"),
      })
      .strict(),
  })
  .strict()
const gaDefinitionSchema = z
  .object({
    provider: z.literal("ga_data_api"),
    queryId: z.literal("watch-referrer-navigation-v1"),
    rangeStart: z.iso.date(),
    rangeEnd: z.iso.date(),
    identity: z.literal("current_catalog_watch_path"),
    botFiltering: z.literal("unknown"),
    measurement: z.literal("observed_events"),
    overlap: z.literal("unknown"),
    qualification: gaQualification,
  })
  .strict()
const definitionSchema = z.union([legacyDefinitionSchema, gaDefinitionSchema])
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
  evidenceKind?: "referrer_navigation_v1"
  /**
   * Server-side aggregate definitions only. A future warehouse reader must
   * establish Watch URL scope and ordered-transition provenance from event
   * rows before claiming this qualification; this contract is not a filter.
   * No SQL or credential tool is exposed to the model.
   */
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
  readNavigationSnapshot?(input: {
    definition: z.output<typeof gaDefinitionSchema>
    catalog: readonly (CatalogIdentity & {
      watchRouteIdentity?: {
        basis: "current_catalog_cutoff_fenced"
        parentSlugs: string[]
        playableAudioLanguageSlugs: string[]
        truncated: boolean
      }
    })[]
    routeCatalog: readonly (CatalogIdentity & {
      watchRouteIdentity?: {
        basis: "current_catalog_cutoff_fenced"
        parentSlugs: string[]
        playableAudioLanguageSlugs: string[]
        truncated: boolean
      }
    })[]
    sourceVideoId: string
    selectedVideoIds: readonly string[]
    includeSourceEngagement: boolean
    cutoff: string
  }): Promise<HistoricalSnapshot>
}

export class HistoricalAnalyticsError extends Error {
  constructor(readonly code: HistoricalAnalyticsFailureCode) {
    super(code)
  }
}

type CatalogIdentity = {
  id: string
  coreId: string
  slug: string
}
export type HistoricalDefinition = z.output<typeof definitionSchema>

type LegacySignal = z.output<typeof engagement>
type Signal =
  | LegacySignal
  | {
      videoKey: string
      views: number
      engagedViews: null
      exposures: null
    }
type Transition = z.output<typeof transition>

export type HistoricalProvenance = {
  provider: "bigquery" | "fixture" | "ga_data_api"
  status: "complete"
  queryId: string
  rangeStart: string
  rangeEnd: string
  cutoff: string
  identity:
    | "canonical_id"
    | "core_id"
    | "slug"
    | "verified_alias"
    | "current_catalog_watch_path"
  botFiltering: "unknown" | "verified_excluded"
  measurement: "observed_events" | "qualified_engagement"
  overlap: "unknown" | "verified_disjoint"
  qualification:
    | z.output<typeof qualification>
    | z.output<typeof gaQualification>
  navigationCoverage?: {
    candidateEvents: number
    qualifiedEvents: number
    homeEvents: number
    selfEvents: number
    crossHostEvents: number
    malformedEvents: number
    unmappedEvents: number
    ambiguousEvents: number
  }
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
    | "qualification"
  > & {
    engagement: string
    transitions: string
    navigation?: string
  }
  signal(videoId: string): Signal | null
  transition(sourceVideoId: string, targetVideoId: string): number | null
  navigation?(sourceVideoId: string, targetVideoId: string): number | null
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
  } catch (error) {
    if (error instanceof HistoricalAnalyticsError) throw error
    throw new HistoricalAnalyticsError("analytics_unavailable")
  }
  if (
    definition.rangeStart > definition.rangeEnd ||
    definition.rangeEnd > cutoff.slice(0, 10) ||
    (definition.provider !== "ga_data_api" &&
      definition.identity === "verified_alias" &&
      !definition.aliases)
  )
    throw new HistoricalAnalyticsError("analytics_unavailable")
  if (definition.provider === "ga_data_api") {
    const availability = definition.qualification.sourceAvailability
    const nextDay = new Date(`${availability.truncationDate}T00:00:00.000Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const observedFirstMonth = availability.observedFirstMonth
    const observedLastMonth = availability.observedLastMonth
    if (
      definition.rangeStart !== availability.usableStart ||
      definition.rangeEnd !== availability.usableEnd ||
      availability.requestedStart > availability.truncationDate ||
      availability.truncationDate !== availability.unavailablePrefixEnd ||
      availability.unavailablePrefixStart !== availability.requestedStart ||
      availability.usableStart !== nextDay.toISOString().slice(0, 10) ||
      availability.usableEnd !== availability.requestedEnd ||
      (observedFirstMonth === null) !== (observedLastMonth === null) ||
      (observedFirstMonth !== null &&
        observedLastMonth !== null &&
        (observedFirstMonth > observedLastMonth ||
          observedFirstMonth <
            availability.usableStart.replaceAll("-", "").slice(0, 6) ||
          observedLastMonth >
            availability.usableEnd.replaceAll("-", "").slice(0, 6))) ||
      definition.qualification.mediaComponentIdCoverage
        .withMediaComponentIdEvents >
        definition.qualification.watchScope.includedEvents ||
      definition.qualification.mediaComponentIdCoverage.inScopeEvents !==
        definition.qualification.watchScope.includedEvents
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    return definition
  }
  const quality = definition.qualification
  if (
    quality.observedStart > definition.rangeStart ||
    quality.observedEnd < definition.rangeEnd ||
    quality.observedStart > quality.observedEnd ||
    quality.watchScope.totalEvents !==
      quality.watchScope.includedEvents +
        quality.watchScope.missingUrlEvents +
        quality.watchScope.malformedUrlEvents +
        quality.watchScope.excludedHostEvents +
        quality.watchScope.excludedPathEvents ||
    quality.videoIdCoverage.inScopeEvents > quality.watchScope.includedEvents ||
    quality.videoIdCoverage.withIdEvents >
      quality.videoIdCoverage.inScopeEvents ||
    (quality.videoIdCoverage.mappedEvents !== null &&
      quality.videoIdCoverage.mappedEvents >
        quality.videoIdCoverage.withIdEvents)
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  if (quality.transitions.status === "unavailable")
    throw new HistoricalAnalyticsError(
      transitionFailureCodes[quality.transitions.reason],
    )
  if (
    (definition.botFiltering === "verified_excluded" &&
      (quality.engagement.botBasis === "unverified" ||
        quality.transitions.botBasis === "unverified")) ||
    (definition.overlap === "verified_disjoint" &&
      (quality.engagement.overlapIdentity === "unknown" ||
        quality.transitions.overlapIdentity === "unknown"))
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
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
        part.provider !== first.provider ||
        JSON.stringify(part.qualification) !==
          JSON.stringify(first.qualification),
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
  const navigationCoverage =
    first.provider === "ga_data_api"
      ? (Object.fromEntries(
          Object.keys(first.navigationCoverage ?? {}).map((key) => [
            key,
            parts.reduce(
              (sum, part) =>
                sum +
                (part.navigationCoverage?.[
                  key as keyof NonNullable<
                    HistoricalProvenance["navigationCoverage"]
                  >
                ] ?? 0),
              0,
            ),
          ]),
        ) as HistoricalProvenance["navigationCoverage"])
      : undefined
  return {
    ...first,
    ...(navigationCoverage ? { navigationCoverage } : {}),
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
  routeCatalog?: readonly CatalogIdentity[]
  sourceVideoId: string
  selectedVideoIds: readonly string[]
  includeSourceEngagement: boolean
  cutoff: string
}): Promise<HistoricalSnapshot> {
  const definition = input.definition
  if (definition.provider === "ga_data_api") {
    if (!input.reader.readNavigationSnapshot)
      throw new HistoricalAnalyticsError("analytics_unavailable")
    return input.reader.readNavigationSnapshot({
      ...input,
      definition,
      routeCatalog: input.routeCatalog ?? input.catalog,
    })
  }
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

  const engagementByVideo = new Map<string, LegacySignal>()
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
        let row: LegacySignal | Transition
        try {
          row = (kind === "engagement" ? engagement : transition).parse(raw)
        } catch {
          throw new HistoricalAnalyticsError("analytics_incomplete")
        }
        rowCount++
        if (kind === "engagement") {
          const signal = row as LegacySignal
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
    qualification: definition.qualification,
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
      qualification: provenance.qualification,
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
