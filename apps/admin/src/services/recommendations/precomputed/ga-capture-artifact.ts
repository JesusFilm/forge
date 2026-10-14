import { createHash } from "node:crypto"
import { open, stat } from "node:fs/promises"
import { gunzipSync } from "node:zlib"
import { z } from "zod"
import { gaHistoricalQualification } from "./contract"
import { GaCaptureError } from "./ga-capture-error"

export const GA_CAPTURE_MAX_BYTES = 256 * 1024 * 1024
export const GA_CAPTURE_MAX_HEADER_BYTES = 4 * 1024 * 1024
export const GA_CAPTURE_MAX_COMPRESSED_PAGE_BYTES = 4 * 1024 * 1024
export const GA_CAPTURE_MAX_RAW_PAGE_BYTES = 8 * 1024 * 1024
export const GA_CAPTURE_MAX_RAW_INDEX_BYTES = 16 * 1024 * 1024
export const GA_CAPTURE_MAX_TOTAL_RAW_BYTES = 1024 * 1024 * 1024
export const GA_CAPTURE_MAX_BLOCKS = 20_000
export const GA_CAPTURE_CONTENT_TYPE = "application/vnd.forge.ga-capture-v1"

const hex = z.string().regex(/^[a-f0-9]{64}$/u)
const count = z.number().int().nonnegative().safe()
const id = z.string().min(1).max(191)
const timestamp = z.string().datetime({ offset: true })
const block = z
  .object({
    kind: z.enum(["start_page", "referrer_page", "locator_index"]),
    pageOffset: count.nullable(),
    rowCount: count.nullable(),
    compressedBytes: count,
    compressedSha256: hex,
    rawBytes: count,
    rawSha256: hex,
  })
  .strict()
export const gaCaptureHeaderSchema = z
  .object({
    version: z.literal("ga_watch_capture_v1"),
    generationId: id,
    generationInputDigest: hex,
    sourceSetDigest: hex,
    inputCutoff: timestamp,
    selectedCorpusDigest: hex,
    candidatePoolDigest: hex,
    routeMappingDigest: hex,
    querySpecDigest: hex,
    sourcePatternTableDigest: hex,
    propertyId: z.literal("320198532"),
    propertyTimeZone: z.literal("America/New_York"),
    requestedStart: z.iso.date(),
    requestedEnd: z.iso.date(),
    usableStart: z.iso.date(),
    usableEnd: z.iso.date(),
    sourceAvailability: gaHistoricalQualification.shape.sourceAvailability,
    baseQualification: gaHistoricalQualification,
    baseQualificationDigest: hex,
    requestedCoverageDigest: hex,
    usableCoverageDigest: hex,
    captureStartedAt: timestamp,
    captureCompletedAt: timestamp,
    verification: z.literal("two_matching_passes"),
    startRows: count,
    referrerRows: count,
    startPages: count,
    referrerPages: count,
    startContentDigest: hex,
    referrerContentDigest: hex,
    physicalHttpAttempts: count,
    physicalSucceededCalls: count,
    blocks: z.array(block).min(3).max(GA_CAPTURE_MAX_BLOCKS),
  })
  .strict()
export type GaCaptureHeader = z.infer<typeof gaCaptureHeaderSchema>
export const gaCaptureSnapshotRefSchema = gaCaptureHeaderSchema
  .omit({ blocks: true, baseQualification: true })
  .extend({
    storageKey: z
      .string()
      .regex(/^precomputed-ga\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}\.bin$/u),
    artifactSha256: hex,
    artifactBytes: count.min(13).max(GA_CAPTURE_MAX_BYTES),
    headerSha256: hex,
  })
  .strict()
export type GaCaptureSnapshotRef = z.infer<typeof gaCaptureSnapshotRefSchema>
export const sealedGaCaptureQualificationSchema =
  gaHistoricalQualification.extend({
    snapshotRef: gaCaptureSnapshotRefSchema,
  })

/** A v3 generation can enter review or serving only after capture binding. */
export function hasSealedGaCapture(
  qualification: unknown,
  generation?: {
    id: string
    inputDigest: string
    sourceSetDigest: string
    inputCutoff: Date
  },
): boolean {
  const sealed = sealedGaCaptureQualificationSchema.safeParse(qualification)
  if (!sealed.success) return false
  if (!generation) return true
  const reference = sealed.data.snapshotRef
  return (
    reference.generationId === generation.id &&
    reference.generationInputDigest === generation.inputDigest &&
    reference.sourceSetDigest === generation.sourceSetDigest &&
    reference.inputCutoff === generation.inputCutoff.toISOString()
  )
}

const startRow = z
  .object({
    pagePath: z.string().max(2_000),
    mediaComponentId: z.string().max(1_000),
    starts: count,
    rowIdentityDigest: hex,
  })
  .strict()
const referrerRow = z
  .object({
    sourcePath: z.string().max(2_000).nullable(),
    targetPath: z.string().max(2_000).nullable(),
    pagePath: z.string().max(2_000),
    sourcePatternIds: z.array(count).max(20_000),
    status: z.enum([
      "candidate",
      "homepage",
      "self",
      "cross_host",
      "malformed",
      "out_of_watch",
    ]),
    mediaComponentId: z.string().max(1_000),
    starts: count,
    rowIdentityDigest: hex,
  })
  .strict()
const locator = z
  .object({
    sourcePatterns: z.array(z.string().min(1).max(4_096)).max(20_000),
    pagesBySourcePattern: z.array(z.array(count).max(20_000)).max(20_000),
  })
  .strict()

export function canonicalGaCaptureJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalGaCaptureJson).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalGaCaptureJson(item)}`,
      )
      .join(",")}}`
  return JSON.stringify(value)
}

export function gaCaptureSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new GaCaptureError(`Invalid GA capture ${message}`)
}

function contentDigest(
  kind: "start_page" | "referrer_page",
  pages: Array<{ pageOffset: number; rowCount: number; rawSha256: string }>,
) {
  return gaCaptureSha256(
    canonicalGaCaptureJson({ version: "ga_watch_content_v1", kind, pages }),
  )
}

/** One full verification at upload/seal, never on each source claim. */
export async function verifyGaCaptureFile(
  path: string,
  expectedSha256: string,
  expectedBytes: number,
): Promise<{
  header: GaCaptureHeader
  headerSha256: string
  artifactSha256: string
  artifactBytes: number
}> {
  assert(hex.safeParse(expectedSha256).success, "declared hash")
  assert(
    Number.isSafeInteger(expectedBytes) &&
      expectedBytes >= 13 &&
      expectedBytes <= GA_CAPTURE_MAX_BYTES,
    "declared size",
  )
  const metadata = await stat(path)
  assert(metadata.isFile() && metadata.size === expectedBytes, "file size")
  const file = await open(path, "r")
  let position = 0
  const fullHash = createHash("sha256")
  async function take(length: number): Promise<Buffer> {
    assert(
      Number.isSafeInteger(length) &&
        length >= 0 &&
        position + length <= expectedBytes,
      "block bounds",
    )
    const bytes = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = await file.read(
        bytes,
        offset,
        length - offset,
        position + offset,
      )
      assert(read.bytesRead > 0, "truncated file")
      offset += read.bytesRead
    }
    position += length
    fullHash.update(bytes)
    return bytes
  }
  try {
    const prefix = await take(12)
    assert(prefix.subarray(0, 8).toString("ascii") === "FORGEGA1", "magic")
    const headerLength = prefix.readUInt32BE(8)
    assert(
      headerLength > 0 && headerLength <= GA_CAPTURE_MAX_HEADER_BYTES,
      "header size",
    )
    const headerBytes = await take(headerLength)
    const rawHeader = JSON.parse(headerBytes.toString("utf8")) as unknown
    assert(
      canonicalGaCaptureJson(rawHeader) === headerBytes.toString("utf8"),
      "noncanonical header",
    )
    const header = gaCaptureHeaderSchema.parse(rawHeader)
    assert(
      header.blocks.reduce((total, block) => total + block.rawBytes, 0) <=
        GA_CAPTURE_MAX_TOTAL_RAW_BYTES,
      "aggregate raw size",
    )
    const availability = header.sourceAvailability
    assert(
      canonicalGaCaptureJson(availability) ===
        canonicalGaCaptureJson(header.baseQualification.sourceAvailability) &&
        header.baseQualificationDigest ===
          gaCaptureSha256(canonicalGaCaptureJson(header.baseQualification)) &&
        availability.requestedStart === header.requestedStart &&
        availability.requestedEnd === header.requestedEnd &&
        availability.usableStart === header.usableStart &&
        availability.usableEnd === header.usableEnd &&
        header.captureStartedAt <= header.captureCompletedAt &&
        header.physicalSucceededCalls <= header.physicalHttpAttempts,
      "qualification/header identity",
    )
    const pageSummaries = {
      start_page: [] as Array<{
        pageOffset: number
        rowCount: number
        rawSha256: string
      }>,
      referrer_page: [] as Array<{
        pageOffset: number
        rowCount: number
        rawSha256: string
      }>,
    }
    const referrerPagePatterns = new Map<number, Set<number>>()
    let startEvents = 0
    let startsWithMediaComponentId = 0
    let referrerEvents = 0
    const addEvents = (sum: number, count: number) => {
      const total = sum + count
      assert(Number.isSafeInteger(total), "aggregate count overflow")
      return total
    }
    let index: z.infer<typeof locator> | null = null
    let phase: "start_page" | "referrer_page" | "locator_index" = "start_page"
    for (const block of header.blocks) {
      assert(
        block.compressedBytes > 0 &&
          block.compressedBytes <= GA_CAPTURE_MAX_COMPRESSED_PAGE_BYTES &&
          block.rawBytes <=
            (block.kind === "locator_index"
              ? GA_CAPTURE_MAX_RAW_INDEX_BYTES
              : GA_CAPTURE_MAX_RAW_PAGE_BYTES),
        "block size",
      )
      if (block.kind === "start_page")
        assert(phase === "start_page", "block order")
      else if (block.kind === "referrer_page") {
        assert(phase !== "locator_index", "block order")
        phase = "referrer_page"
      } else {
        assert(phase === "referrer_page" && index === null, "index order")
        phase = "locator_index"
      }
      const compressed = await take(block.compressedBytes)
      assert(
        gaCaptureSha256(compressed) === block.compressedSha256 &&
          compressed.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) &&
          compressed.readUInt32LE(4) === 0,
        "compressed block digest/gzip",
      )
      const raw = gunzipSync(compressed, {
        maxOutputLength: block.rawBytes + 1,
      })
      assert(
        raw.length === block.rawBytes &&
          gaCaptureSha256(raw) === block.rawSha256,
        "raw block digest/size",
      )
      const rawValue = JSON.parse(raw.toString("utf8")) as unknown
      assert(
        canonicalGaCaptureJson(rawValue) === raw.toString("utf8"),
        "noncanonical block",
      )
      if (block.kind === "locator_index") {
        assert(
          block.pageOffset === null && block.rowCount === null,
          "index metadata",
        )
        index = locator.parse(rawValue)
        continue
      }
      assert(
        block.pageOffset !== null && block.rowCount !== null,
        "page metadata",
      )
      const rows = z
        .array(block.kind === "start_page" ? startRow : referrerRow)
        .max(500)
        .parse(rawValue)
      assert(rows.length === block.rowCount, "page row count")
      const summaries = pageSummaries[block.kind]
      const expectedOffset = summaries.reduce((n, item) => n + item.rowCount, 0)
      assert(block.pageOffset === expectedOffset, "page offset")
      summaries.push({
        pageOffset: block.pageOffset,
        rowCount: block.rowCount,
        rawSha256: block.rawSha256,
      })
      if (block.kind === "start_page") {
        for (const row of rows as z.infer<typeof startRow>[]) {
          startEvents = addEvents(startEvents, row.starts)
          if (
            row.mediaComponentId !== "" &&
            row.mediaComponentId !== "(not set)"
          )
            startsWithMediaComponentId = addEvents(
              startsWithMediaComponentId,
              row.starts,
            )
        }
      } else {
        const patterns = new Set<number>()
        for (const row of rows as z.infer<typeof referrerRow>[]) {
          referrerEvents = addEvents(referrerEvents, row.starts)
          assert(
            row.sourcePatternIds.every(
              (value, index, all) => index === 0 || value > all[index - 1]!,
            ),
            "source pattern IDs",
          )
          for (const pattern of row.sourcePatternIds) patterns.add(pattern)
        }
        referrerPagePatterns.set(block.pageOffset, patterns)
      }
    }
    assert(position === expectedBytes, "trailing bytes")
    assert(index !== null, "missing locator index")
    assert(
      startEvents === header.baseQualification.watchScope.includedEvents &&
        startEvents ===
          header.baseQualification.mediaComponentIdCoverage.inScopeEvents &&
        startsWithMediaComponentId ===
          header.baseQualification.mediaComponentIdCoverage
            .withMediaComponentIdEvents &&
        referrerEvents <= startEvents,
      "qualification aggregate counts",
    )
    assert(
      pageSummaries.start_page.length === header.startPages &&
        pageSummaries.referrer_page.length === header.referrerPages &&
        pageSummaries.start_page.reduce((n, page) => n + page.rowCount, 0) ===
          header.startRows &&
        pageSummaries.referrer_page.reduce(
          (n, page) => n + page.rowCount,
          0,
        ) === header.referrerRows &&
        header.startContentDigest ===
          contentDigest("start_page", pageSummaries.start_page) &&
        header.referrerContentDigest ===
          contentDigest("referrer_page", pageSummaries.referrer_page),
      "report counts/digest",
    )
    assert(
      index.sourcePatterns.length === index.pagesBySourcePattern.length &&
        new Set(index.sourcePatterns).size === index.sourcePatterns.length &&
        gaCaptureSha256(
          canonicalGaCaptureJson({
            version: "ga_watch_source_patterns_v1",
            routeMappingDigest: header.routeMappingDigest,
            patterns: index.sourcePatterns,
          }),
        ) === header.sourcePatternTableDigest,
      "source pattern table",
    )
    for (const [patternId, postings] of index.pagesBySourcePattern.entries()) {
      const expected = [...referrerPagePatterns.entries()]
        .filter(([, patterns]) => patterns.has(patternId))
        .map(([offset]) => offset)
      assert(
        canonicalGaCaptureJson(postings) === canonicalGaCaptureJson(expected),
        "locator postings",
      )
    }
    for (const patterns of referrerPagePatterns.values())
      for (const patternId of patterns)
        assert(patternId < index.sourcePatterns.length, "pattern ID range")
    const artifactSha256 = fullHash.digest("hex")
    assert(artifactSha256 === expectedSha256, "artifact digest")
    return {
      header,
      headerSha256: gaCaptureSha256(headerBytes),
      artifactSha256,
      artifactBytes: expectedBytes,
    }
  } finally {
    await file.close()
  }
}
