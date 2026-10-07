import { createHash, randomUUID } from "node:crypto"
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from "node:fs/promises"
import { basename, join } from "node:path"

import { z } from "zod"

import {
  GaCaptureError,
  gaCaptureCanonicalJson,
  gaCaptureContentDigest,
  gaCaptureDigest,
  MAX_GA_CAPTURE_STAGED_PAGE_BYTES,
  MAX_GA_CAPTURE_TOTAL_RAW_BYTES,
  readStagedGaWatchCapturePage,
  sealGaWatchCaptureArtifact,
  writeGaWatchCapturePage,
  type GaCapturePageFile,
  type GaCapturePageKind,
  type GaCaptureHeader,
  type GaCaptureLocatorIndex,
  openGaWatchCaptureArtifact,
} from "./ga-watch-capture-artifact"
import {
  createGaWatchHistoryReader,
  gaWatchCaptureQuerySpec,
  gaWatchRouteMappingDigest,
  readGaNavigationSnapshot,
  routePatterns,
  type GaWatchSnapshotPageSource,
} from "./ga-watch-history"
import {
  HistoricalAnalyticsError,
  readHistoricalDefinition,
  type HistoricalAnalyticsReader,
} from "./historical-analytics"
import type { WatchRouteCatalogVideo } from "./watch-route-identity"

type OpenedArtifact = Awaited<ReturnType<typeof openGaWatchCaptureArtifact>>
type StartRow = {
  pagePath: string
  mediaComponentId: string
  starts: number
  rowIdentityDigest: string
}
type ReferrerRow = {
  sourcePath: string | null
  targetPath: string | null
  pagePath: string
  sourcePatternIds: number[]
  status:
    | "candidate"
    | "homepage"
    | "self"
    | "cross_host"
    | "malformed"
    | "out_of_watch"
  mediaComponentId: string
  starts: number
  rowIdentityDigest: string
}

function validPatternIds(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (id: unknown, index: number) =>
        Number.isSafeInteger(id) &&
        (id as number) >= 0 &&
        (index === 0 || (id as number) > value[index - 1]),
    )
  )
}

function validRows<T extends StartRow | ReferrerRow>(
  rows: unknown[],
  kind: GaCapturePageKind,
): T[] {
  for (const row of rows) {
    if (typeof row !== "object" || row === null)
      throw new HistoricalAnalyticsError("analytics_incomplete")
    const item = row as Record<string, unknown>
    const expectedKeys =
      kind === "start_page"
        ? ["mediaComponentId", "pagePath", "rowIdentityDigest", "starts"]
        : [
            "mediaComponentId",
            "pagePath",
            "rowIdentityDigest",
            "sourcePath",
            "sourcePatternIds",
            "starts",
            "status",
            "targetPath",
          ]
    if (
      Object.keys(item).sort().join("|") !== expectedKeys.join("|") ||
      typeof item.pagePath !== "string" ||
      /[?#]/u.test(item.pagePath) ||
      item.pagePath.length > 2_000 ||
      typeof item.mediaComponentId !== "string" ||
      !Number.isSafeInteger(item.starts) ||
      (item.starts as number) < 0 ||
      typeof item.rowIdentityDigest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(item.rowIdentityDigest) ||
      (kind === "referrer_page" &&
        ((typeof item.sourcePath !== "string" && item.sourcePath !== null) ||
          (typeof item.targetPath !== "string" && item.targetPath !== null) ||
          !validPatternIds(item.sourcePatternIds) ||
          ![
            "candidate",
            "homepage",
            "self",
            "cross_host",
            "malformed",
            "out_of_watch",
          ].includes(String(item.status))))
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
  }
  return rows as T[]
}

function virtualPage<T>(
  rows: T[],
  offset: number,
  limit: number,
  total: number,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    offset > total
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  return {
    status: "unqualified" as const,
    rows,
    rowCount: total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  }
}

/** A sealed reader has no transport or credential capability. */
export async function createSealedGaWatchHistoryReader(input: {
  artifact: OpenedArtifact
  artifactSha256: string
}): Promise<HistoricalAnalyticsReader> {
  const { artifact, artifactSha256 } = input
  const header = artifact.header
  const index = await artifact.readLocatorIndex()
  if (
    !Array.isArray(index.sourcePatterns) ||
    !Array.isArray(index.pagesBySourcePattern) ||
    index.sourcePatterns.length !== index.pagesBySourcePattern.length ||
    gaCaptureDigest({
      version: "ga_watch_source_patterns_v1",
      routeMappingDigest: header.routeMappingDigest,
      patterns: index.sourcePatterns,
    }) !== header.sourcePatternTableDigest ||
    gaCaptureDigest(header.baseQualification) !== header.baseQualificationDigest
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const patternIds = new Map(
    index.sourcePatterns.map((pattern, id) => [pattern, id]),
  )
  const referrerBlocks = header.blocks.filter(
    (block) => block.kind === "referrer_page",
  )
  const startBlocks = header.blocks.filter(
    (block) => block.kind === "start_page",
  )
  const referrerPages = new Set(
    referrerBlocks.map((block) => block.pageOffset!),
  )
  const expectedPostingLists = index.sourcePatterns.map(() => new Set<number>())
  const startPagesByPath = new Map<string, Set<number>>()
  let indexedPathBytes = 0
  for (const block of referrerBlocks) {
    const rows = validRows<ReferrerRow>(
      await artifact.readPage(block),
      "referrer_page",
    )
    if (rows.length !== block.rowCount)
      throw new HistoricalAnalyticsError("analytics_incomplete")
    for (const row of rows) {
      const ids = row.sourcePatternIds
      if (
        ids.some(
          (id, position) =>
            !Number.isSafeInteger(id) ||
            id < 0 ||
            id >= index.sourcePatterns.length ||
            (position > 0 && id <= ids[position - 1]!),
        )
      )
        throw new HistoricalAnalyticsError("analytics_incomplete")
      for (const id of ids) expectedPostingLists[id]!.add(block.pageOffset!)
    }
  }
  const expectedIndex: GaCaptureLocatorIndex = {
    sourcePatterns: index.sourcePatterns,
    pagesBySourcePattern: expectedPostingLists.map((list) =>
      [...list].sort((a, b) => a - b),
    ),
  }
  if (
    gaCaptureCanonicalJson(expectedIndex) !== gaCaptureCanonicalJson(index) ||
    index.pagesBySourcePattern.some((pages) =>
      pages.some((page) => !referrerPages.has(page)),
    )
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  for (const block of startBlocks) {
    const rows = validRows<StartRow>(
      await artifact.readPage(block),
      "start_page",
    )
    if (rows.length !== block.rowCount)
      throw new HistoricalAnalyticsError("analytics_incomplete")
    for (const row of rows) {
      let pages = startPagesByPath.get(row.pagePath)
      if (!pages) {
        indexedPathBytes += Buffer.byteLength(row.pagePath, "utf8") + 64
        if (indexedPathBytes > 64 * 1024 * 1024)
          throw new GaCaptureError("ga_capture_start_index_cap")
        pages = new Set<number>()
        startPagesByPath.set(row.pagePath, pages)
      }
      pages.add(block.pageOffset!)
    }
  }
  const startPageCache = new Map<string, Set<number>>()
  const pageSource: GaWatchSnapshotPageSource = {
    artifactSha256,
    async readStarts({ offset, limit, targetRouteRegex }) {
      const regex = new RegExp(targetRouteRegex, "u")
      let relevantOffsets = startPageCache.get(targetRouteRegex)
      if (!relevantOffsets) {
        relevantOffsets = new Set<number>()
        for (const [path, pages] of startPagesByPath)
          if (regex.test(path))
            for (const page of pages) relevantOffsets.add(page)
        startPageCache.set(targetRouteRegex, relevantOffsets)
        if (startPageCache.size > 32)
          startPageCache.delete(startPageCache.keys().next().value!)
      }
      const selected: StartRow[] = []
      let total = 0
      for (const block of startBlocks) {
        if (!relevantOffsets.has(block.pageOffset!)) continue
        const rows = validRows<StartRow>(
          await artifact.readPage(block),
          "start_page",
        )
        for (const row of rows) {
          if (!regex.test(row.pagePath)) continue
          if (total >= offset && selected.length < limit) selected.push(row)
          total += 1
        }
      }
      return virtualPage(selected, offset, limit, total)
    },
    async readReferrers({ offset, limit, sourcePatterns, targetRouteRegex }) {
      const ids = new Set<number>()
      for (const pattern of sourcePatterns) {
        const id = patternIds.get(pattern)
        if (id === undefined)
          throw new HistoricalAnalyticsError("analytics_mapping_unverified")
        ids.add(id)
      }
      const relevantOffsets = new Set(
        [...ids].flatMap((id) => index.pagesBySourcePattern[id]!),
      )
      const regex = new RegExp(targetRouteRegex, "u")
      const selected: ReferrerRow[] = []
      let total = 0
      for (const block of referrerBlocks) {
        if (!relevantOffsets.has(block.pageOffset!)) continue
        const rows = validRows<ReferrerRow>(
          await artifact.readPage(block),
          "referrer_page",
        )
        for (const row of rows) {
          if (
            !row.sourcePatternIds.some((id) => ids.has(id)) ||
            !regex.test(row.pagePath)
          )
            continue
          if (total >= offset && selected.length < limit) selected.push(row)
          total += 1
        }
      }
      return virtualPage(selected, offset, limit, total)
    },
  }
  return {
    evidenceKind: "referrer_navigation_v1",
    async describe() {
      return {
        provider: "ga_data_api",
        queryId: "watch-referrer-navigation-v1",
        rangeStart: header.usableStart,
        rangeEnd: header.usableEnd,
        identity: "current_catalog_watch_path",
        botFiltering: "unknown",
        measurement: "observed_events",
        overlap: "unknown",
        qualification: header.baseQualification,
      } as Awaited<ReturnType<HistoricalAnalyticsReader["describe"]>>
    },
    async readNavigationSnapshot(snapshot) {
      const routeCatalog = snapshot.routeCatalog.filter(
        (video): video is typeof video & WatchRouteCatalogVideo =>
          video.watchRouteIdentity?.basis === "current_catalog_cutoff_fenced",
      )
      if (
        routeCatalog.length !== snapshot.routeCatalog.length ||
        snapshot.cutoff !== header.inputCutoff ||
        gaWatchRouteMappingDigest(routeCatalog) !== header.routeMappingDigest ||
        gaCaptureDigest({
          version: "ga_watch_source_patterns_v1",
          routeMappingDigest: header.routeMappingDigest,
          patterns: [...new Set(routeCatalog.flatMap(routePatterns))],
        }) !== header.sourcePatternTableDigest
      )
        throw new HistoricalAnalyticsError("analytics_mapping_unverified")
      return readGaNavigationSnapshot({
        ...snapshot,
        propertyId: header.propertyId,
        serviceAccountEmail: "",
        rangeStart: header.requestedStart,
        rangeEnd: header.requestedEnd,
        pageSource,
      })
    },
    async readPage(): Promise<never> {
      throw new HistoricalAnalyticsError(
        "analytics_transition_missing_session_identity",
      )
    },
  }
}

type LiveReader = ReturnType<typeof createGaWatchHistoryReader>
export type GaWatchCaptureBinding = {
  generationId: string
  generationInputDigest: string
  sourceSetDigest: string
  inputCutoff: string
  selectedCorpusDigest: string
  candidatePoolDigest: string
  routeCatalog: readonly WatchRouteCatalogVideo[]
  propertyId: string
  requestedStart: string
  requestedEnd: string
}
export type GaCaptureCallCounts = {
  pending: number
  succeeded: number
  failed: number
}
type Preflight = {
  definition: Awaited<ReturnType<typeof readHistoricalDefinition>>
  requestedCoverageDigest: string
  usableCoverageDigest: string
  propertyTimeZone: string
}
type ReportJournal = {
  expectedTotal: number | null
  complete: boolean
  pages: GaCapturePageFile[]
}
type CaptureJournal = {
  version: "ga_watch_capture_journal_v1"
  bindingDigest: string
  captureStartedAt: string
  preflight: Preflight
  starts: ReportJournal
  referrers: ReportJournal
  sealed?: {
    artifactSha256: string
    artifactBytes: number
  }
}
const MAX_CAPTURE_ROWS_PER_REPORT = 250_000
const MAX_CAPTURE_PAGES = 19_999

function captureBindingDigest(binding: GaWatchCaptureBinding): string {
  return gaCaptureDigest({
    ...binding,
    routeCatalog: binding.routeCatalog.map((video) => ({
      id: video.id,
      slug: video.slug,
      watchRouteIdentity: video.watchRouteIdentity,
    })),
  })
}

async function writeJournal(directory: string, journal: CaptureJournal) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, "journal.json")
  const temporary = join(directory, `journal.${randomUUID()}.tmp`)
  const handle = await open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(gaCaptureCanonicalJson(journal))
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, path)
    const directoryHandle = await open(directory, "r")
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function qualifyCapture(
  binding: GaWatchCaptureBinding,
  createReader: (
    rangeStart: string,
    rangeEnd: string,
    stage: "qualification" | "snapshot_page",
  ) => LiveReader,
): Promise<Preflight> {
  const requested = createReader(
    binding.requestedStart,
    binding.requestedEnd,
    "qualification",
  )
  const definition = await readHistoricalDefinition(
    requested,
    binding.inputCutoff,
  )
  if (definition.provider !== "ga_data_api")
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const requestedCoverage = await requested.inspectCoverage()
  const usableCoverage = await createReader(
    definition.rangeStart,
    definition.rangeEnd,
    "qualification",
  ).inspectCoverage()
  if (
    requestedCoverage.propertyTimeZone !== usableCoverage.propertyTimeZone ||
    usableCoverage.reportLimitations.length > 0 ||
    usableCoverage.rangeStart !== definition.rangeStart ||
    usableCoverage.rangeEnd !== definition.rangeEnd
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  return {
    definition,
    requestedCoverageDigest: requestedCoverage.resultDigest,
    usableCoverageDigest: usableCoverage.resultDigest,
    propertyTimeZone: usableCoverage.propertyTimeZone,
  }
}

function normalizedRows(
  kind: GaCapturePageKind,
  rows:
    | Awaited<ReturnType<LiveReader["readWatchStartsPage"]>>["rows"]
    | Awaited<ReturnType<LiveReader["readWatchReferrerPage"]>>["rows"],
): StartRow[] | ReferrerRow[] {
  if (kind === "start_page")
    return rows.map((row) => {
      if (!("pagePath" in row) || row.pagePath === undefined)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      return {
        pagePath: row.pagePath,
        mediaComponentId: row.mediaComponentId,
        starts: row.starts,
        rowIdentityDigest: row.rowIdentityDigest,
      }
    })
  return rows.map((row) => {
    if (
      !("sourcePath" in row) ||
      !("targetPath" in row) ||
      !("status" in row) ||
      !("pagePath" in row) ||
      !("sourcePatternIds" in row) ||
      row.pagePath === undefined ||
      row.sourcePatternIds === undefined
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    return {
      sourcePath: row.sourcePath,
      targetPath: row.targetPath,
      pagePath: row.pagePath,
      sourcePatternIds: row.sourcePatternIds,
      status: row.status,
      mediaComponentId: row.mediaComponentId,
      starts: row.starts,
      rowIdentityDigest: row.rowIdentityDigest,
    }
  })
}

async function captureReport(input: {
  kind: GaCapturePageKind
  directory: string
  journal: CaptureJournal
  reader: LiveReader
  sourcePatterns: string[]
  persist: () => Promise<void>
  maxStagedPageBytes: number
}): Promise<void> {
  const report =
    input.kind === "start_page" ? input.journal.starts : input.journal.referrers
  const seen = new Set<string>()
  const committedBytes = () =>
    [...input.journal.starts.pages, ...input.journal.referrers.pages].reduce(
      (sum, page) => sum + page.compressedBytes,
      0,
    )
  const committedRawBytes = () =>
    [...input.journal.starts.pages, ...input.journal.referrers.pages].reduce(
      (sum, page) => sum + page.rawBytes,
      0,
    )
  if (committedBytes() > input.maxStagedPageBytes)
    throw new GaCaptureError("ga_capture_staging_cap")
  if (committedRawBytes() > MAX_GA_CAPTURE_TOTAL_RAW_BYTES)
    throw new GaCaptureError("ga_capture_raw_total_cap")
  let offset = 0
  for (const page of report.pages) {
    if (
      page.kind !== input.kind ||
      page.pageOffset !== offset ||
      page.path !== join(input.directory, `${input.kind}-${offset}.gz`)
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    const rows = validRows<StartRow | ReferrerRow>(
      await readStagedGaWatchCapturePage(page),
      input.kind,
    )
    for (const row of rows) {
      if (seen.has(row.rowIdentityDigest))
        throw new HistoricalAnalyticsError("analytics_incomplete")
      seen.add(row.rowIdentityDigest)
    }
    offset += rows.length
  }
  if (
    offset > MAX_CAPTURE_ROWS_PER_REPORT ||
    report.pages.length > MAX_CAPTURE_PAGES ||
    (report.expectedTotal !== null && offset > report.expectedTotal) ||
    (report.complete && report.expectedTotal !== offset)
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  if (report.complete) return
  while (true) {
    if (
      offset > MAX_CAPTURE_ROWS_PER_REPORT ||
      report.pages.length >= MAX_CAPTURE_PAGES
    )
      throw new GaCaptureError("ga_capture_report_cap")
    const page =
      input.kind === "start_page"
        ? await input.reader.readWatchStartsPage({ offset, limit: 500 })
        : await input.reader.readWatchReferrerPage({
            offset,
            limit: 500,
            captureSourcePatterns: input.sourcePatterns,
          })
    if (page.rowCount > MAX_CAPTURE_ROWS_PER_REPORT)
      throw new GaCaptureError("ga_capture_report_cap")
    if (
      page.status !== "unqualified" ||
      page.reportLimitations.length > 0 ||
      (report.expectedTotal !== null &&
        page.rowCount !== report.expectedTotal) ||
      !Number.isSafeInteger(page.rowCount) ||
      page.rows.length !== Math.min(500, page.rowCount - offset) ||
      (page.nextOffset !== null &&
        page.nextOffset !== offset + page.rows.length)
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    const rows = validRows<StartRow | ReferrerRow>(
      normalizedRows(input.kind, page.rows),
      input.kind,
    )
    for (const row of rows) {
      if (seen.has(row.rowIdentityDigest))
        throw new HistoricalAnalyticsError("analytics_incomplete")
      seen.add(row.rowIdentityDigest)
    }
    const saved = await writeGaWatchCapturePage({
      directory: input.directory,
      kind: input.kind,
      pageOffset: offset,
      rowCount: rows.length,
      rows,
      remainingCompressedBytes: input.maxStagedPageBytes - committedBytes(),
      remainingRawBytes: MAX_GA_CAPTURE_TOTAL_RAW_BYTES - committedRawBytes(),
    })
    report.expectedTotal = page.rowCount
    report.pages.push(saved)
    offset += rows.length
    report.complete = page.nextOffset === null
    await input.persist()
    if (report.complete) {
      if (offset !== report.expectedTotal)
        throw new HistoricalAnalyticsError("analytics_incomplete")
      return
    }
    if (rows.length === 0)
      throw new HistoricalAnalyticsError("analytics_incomplete")
  }
}

async function verifyReport(input: {
  kind: GaCapturePageKind
  report: ReportJournal
  reader: LiveReader
  sourcePatterns: string[]
}): Promise<void> {
  let offset = 0
  const seen = new Set<string>()
  for (const saved of input.report.pages) {
    const page =
      input.kind === "start_page"
        ? await input.reader.readWatchStartsPage({ offset, limit: 500 })
        : await input.reader.readWatchReferrerPage({
            offset,
            limit: 500,
            captureSourcePatterns: input.sourcePatterns,
          })
    const rows = validRows<StartRow | ReferrerRow>(
      normalizedRows(input.kind, page.rows),
      input.kind,
    )
    const rawSha256 = createHash("sha256")
      .update(gaCaptureCanonicalJson(rows))
      .digest("hex")
    if (
      page.status !== "unqualified" ||
      page.reportLimitations.length > 0 ||
      page.rowCount !== input.report.expectedTotal ||
      saved.pageOffset !== offset ||
      saved.rowCount !== rows.length ||
      saved.rawSha256 !== rawSha256 ||
      page.nextOffset !==
        (offset + rows.length < page.rowCount ? offset + rows.length : null)
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
    for (const row of rows) {
      if (seen.has(row.rowIdentityDigest))
        throw new HistoricalAnalyticsError("analytics_incomplete")
      seen.add(row.rowIdentityDigest)
    }
    offset += rows.length
  }
  if (offset !== input.report.expectedTotal)
    throw new HistoricalAnalyticsError("analytics_incomplete")
}

async function reconcileCaptureTotals(journal: CaptureJournal): Promise<void> {
  const nonnegative = z.number().int().nonnegative().safe()
  const checked = z
    .object({
      watchScope: z.object({ includedEvents: nonnegative }),
      mediaComponentIdCoverage: z.object({
        inScopeEvents: nonnegative,
        withMediaComponentIdEvents: nonnegative,
      }),
    })
    .safeParse(journal.preflight.definition.qualification)
  if (!checked.success)
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const add = (sum: number, value: number) => {
    const next = sum + value
    if (!Number.isSafeInteger(next))
      throw new HistoricalAnalyticsError("analytics_incomplete")
    return next
  }
  let starts = 0
  let identifiedStarts = 0
  let referrerStarts = 0
  for (const page of journal.starts.pages)
    for (const row of validRows<StartRow>(
      await readStagedGaWatchCapturePage(page),
      "start_page",
    )) {
      starts = add(starts, row.starts)
      if (row.mediaComponentId !== "" && row.mediaComponentId !== "(not set)")
        identifiedStarts = add(identifiedStarts, row.starts)
    }
  for (const page of journal.referrers.pages)
    for (const row of validRows<ReferrerRow>(
      await readStagedGaWatchCapturePage(page),
      "referrer_page",
    ))
      referrerStarts = add(referrerStarts, row.starts)
  if (
    starts !== checked.data.watchScope.includedEvents ||
    starts !== checked.data.mediaComponentIdCoverage.inScopeEvents ||
    identifiedStarts !==
      checked.data.mediaComponentIdCoverage.withMediaComponentIdEvents ||
    referrerStarts > starts
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
}

/** Complete, repeat-verified global aggregate capture before any model call. */
export async function captureGaWatchAggregates(input: {
  directory: string
  binding: GaWatchCaptureBinding
  createReader: (
    rangeStart: string,
    rangeEnd: string,
    stage: "qualification" | "snapshot_page",
  ) => LiveReader
  historyCallCounts: () => Promise<GaCaptureCallCounts>
  /** Test/diagnostic seam; production never exceeds the configured staging cap. */
  maxStagedPageBytes?: number
}): Promise<Awaited<ReturnType<typeof sealGaWatchCaptureArtifact>>> {
  const { directory, binding } = input
  const maxStagedPageBytes =
    input.maxStagedPageBytes ?? MAX_GA_CAPTURE_STAGED_PAGE_BYTES
  if (
    !Number.isSafeInteger(maxStagedPageBytes) ||
    maxStagedPageBytes < 1 ||
    maxStagedPageBytes > MAX_GA_CAPTURE_STAGED_PAGE_BYTES
  )
    throw new GaCaptureError("ga_capture_invalid_staging_cap")
  const bindingDigest = captureBindingDigest(binding)
  const path = join(directory, "journal.json")
  let journal: CaptureJournal
  try {
    journal = JSON.parse(await readFile(path, "utf8")) as CaptureJournal
    if (
      journal.version !== "ga_watch_capture_journal_v1" ||
      journal.bindingDigest !== bindingDigest
    )
      throw new HistoricalAnalyticsError("analytics_incomplete")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    journal = {
      version: "ga_watch_capture_journal_v1",
      bindingDigest,
      captureStartedAt: new Date().toISOString(),
      preflight: await qualifyCapture(binding, input.createReader),
      starts: { expectedTotal: null, complete: false, pages: [] },
      referrers: { expectedTotal: null, complete: false, pages: [] },
    }
    await writeJournal(directory, journal)
  }
  if (journal.sealed) {
    const artifact = await openGaWatchCaptureArtifact({
      path: join(directory, "artifact.bin"),
      expectedSha256: journal.sealed.artifactSha256,
      expectedBytes: journal.sealed.artifactBytes,
    })
    assertGaCaptureHeaderBinding(artifact.header, binding)
    return {
      path: join(directory, "artifact.bin"),
      header: artifact.header,
      headerSha256: artifact.headerSha256,
      ...journal.sealed,
    }
  }
  const committedPageFiles = new Set(
    [...journal.starts.pages, ...journal.referrers.pages].map((page) =>
      basename(page.path),
    ),
  )
  for (const name of await readdir(directory)) {
    if (
      name.endsWith(".tmp") ||
      name === "artifact.bin" ||
      name === "locator_index.gz" ||
      (/^(?:start_page|referrer_page)-\d+\.gz$/u.test(name) &&
        !committedPageFiles.has(name))
    )
      await unlink(join(directory, name))
  }
  const definition = journal.preflight.definition
  if (definition.provider !== "ga_data_api")
    throw new HistoricalAnalyticsError("analytics_unavailable")
  const routeMappingDigest = gaWatchRouteMappingDigest(binding.routeCatalog)
  const sourcePatterns = [
    ...new Set(binding.routeCatalog.flatMap(routePatterns)),
  ]
  const read = input.createReader(
    definition.rangeStart,
    definition.rangeEnd,
    "snapshot_page",
  )
  const persist = () => writeJournal(directory, journal)
  await captureReport({
    kind: "start_page",
    directory,
    journal,
    reader: read,
    sourcePatterns,
    persist,
    maxStagedPageBytes,
  })
  const indexedPaths = new Set<string>()
  let indexedPathBytes = 0
  for (const page of journal.starts.pages)
    for (const row of validRows<StartRow>(
      await readStagedGaWatchCapturePage(page),
      "start_page",
    )) {
      if (indexedPaths.has(row.pagePath)) continue
      indexedPaths.add(row.pagePath)
      indexedPathBytes += Buffer.byteLength(row.pagePath, "utf8") + 64
      if (indexedPathBytes > 64 * 1024 * 1024)
        throw new GaCaptureError("ga_capture_start_index_cap")
    }
  await captureReport({
    kind: "referrer_page",
    directory,
    journal,
    reader: read,
    sourcePatterns,
    persist,
    maxStagedPageBytes,
  })
  const verificationReader = input.createReader(
    definition.rangeStart,
    definition.rangeEnd,
    "snapshot_page",
  )
  await verifyReport({
    kind: "start_page",
    report: journal.starts,
    reader: verificationReader,
    sourcePatterns,
  })
  await verifyReport({
    kind: "referrer_page",
    report: journal.referrers,
    reader: verificationReader,
    sourcePatterns,
  })
  const postflight = await qualifyCapture(binding, input.createReader)
  if (
    gaCaptureCanonicalJson(postflight) !==
    gaCaptureCanonicalJson(journal.preflight)
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  await reconcileCaptureTotals(journal)
  const counts = await input.historyCallCounts()
  if (
    counts.pending !== 0 ||
    ![counts.succeeded, counts.failed].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
  const pages = [...journal.starts.pages, ...journal.referrers.pages]
  const postings = sourcePatterns.map(() => new Set<number>())
  for (const page of journal.referrers.pages) {
    const rows = validRows<ReferrerRow>(
      await readStagedGaWatchCapturePage(page),
      "referrer_page",
    )
    for (const row of rows)
      for (const id of row.sourcePatternIds) {
        if (!Number.isSafeInteger(id) || id < 0 || id >= sourcePatterns.length)
          throw new HistoricalAnalyticsError("analytics_incomplete")
        postings[id]!.add(page.pageOffset!)
      }
  }
  const locatorIndex: GaCaptureLocatorIndex = {
    sourcePatterns,
    pagesBySourcePattern: postings.map((pages) =>
      [...pages].sort((a, b) => a - b),
    ),
  }
  const header: Omit<GaCaptureHeader, "blocks"> = {
    version: "ga_watch_capture_v1",
    generationId: binding.generationId,
    generationInputDigest: binding.generationInputDigest,
    sourceSetDigest: binding.sourceSetDigest,
    inputCutoff: binding.inputCutoff,
    selectedCorpusDigest: binding.selectedCorpusDigest,
    candidatePoolDigest: binding.candidatePoolDigest,
    routeMappingDigest,
    querySpecDigest: gaCaptureDigest(
      gaWatchCaptureQuerySpec({
        propertyId: binding.propertyId,
        rangeStart: definition.rangeStart,
        rangeEnd: definition.rangeEnd,
      }),
    ),
    sourcePatternTableDigest: gaCaptureDigest({
      version: "ga_watch_source_patterns_v1",
      routeMappingDigest,
      patterns: sourcePatterns,
    }),
    propertyId: binding.propertyId,
    propertyTimeZone: journal.preflight.propertyTimeZone,
    requestedStart: binding.requestedStart,
    requestedEnd: binding.requestedEnd,
    usableStart: definition.rangeStart,
    usableEnd: definition.rangeEnd,
    sourceAvailability: definition.qualification.sourceAvailability,
    baseQualification: definition.qualification,
    baseQualificationDigest: gaCaptureDigest(definition.qualification),
    requestedCoverageDigest: journal.preflight.requestedCoverageDigest,
    usableCoverageDigest: journal.preflight.usableCoverageDigest,
    captureStartedAt: journal.captureStartedAt,
    captureCompletedAt: new Date().toISOString(),
    verification: "two_matching_passes",
    startRows: journal.starts.expectedTotal!,
    referrerRows: journal.referrers.expectedTotal!,
    startPages: journal.starts.pages.length,
    referrerPages: journal.referrers.pages.length,
    startContentDigest: gaCaptureContentDigest(
      "start_page",
      journal.starts.pages,
    ),
    referrerContentDigest: gaCaptureContentDigest(
      "referrer_page",
      journal.referrers.pages,
    ),
    physicalHttpAttempts: counts.succeeded + counts.failed,
    physicalSucceededCalls: counts.succeeded,
  }
  const sealed = await sealGaWatchCaptureArtifact({
    directory,
    header,
    pages,
    locatorIndex,
  })
  journal.sealed = {
    artifactSha256: sealed.artifactSha256,
    artifactBytes: sealed.artifactBytes,
  }
  await writeJournal(directory, journal)
  return sealed
}

export function assertGaCaptureHeaderBinding(
  header: GaCaptureHeader,
  binding: GaWatchCaptureBinding,
): void {
  if (
    header.generationId !== binding.generationId ||
    header.generationInputDigest !== binding.generationInputDigest ||
    header.sourceSetDigest !== binding.sourceSetDigest ||
    header.inputCutoff !== binding.inputCutoff ||
    header.selectedCorpusDigest !== binding.selectedCorpusDigest ||
    header.candidatePoolDigest !== binding.candidatePoolDigest ||
    header.routeMappingDigest !==
      gaWatchRouteMappingDigest(binding.routeCatalog) ||
    header.propertyId !== binding.propertyId ||
    header.requestedStart !== binding.requestedStart ||
    header.requestedEnd !== binding.requestedEnd ||
    header.querySpecDigest !==
      gaCaptureDigest(
        gaWatchCaptureQuerySpec({
          propertyId: binding.propertyId,
          rangeStart: header.usableStart,
          rangeEnd: header.usableEnd,
        }),
      )
  )
    throw new HistoricalAnalyticsError("analytics_incomplete")
}
