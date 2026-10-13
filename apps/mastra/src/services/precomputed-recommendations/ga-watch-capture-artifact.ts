import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"

const MAGIC = Buffer.from("FORGEGA1", "ascii")
export const MAX_GA_CAPTURE_ARTIFACT_BYTES = 256 * 1024 * 1024
export const MAX_GA_CAPTURE_TOTAL_RAW_BYTES = 1024 * 1024 * 1024
/** Leaves room for the index, header, and assembled object on the staging volume. */
export const MAX_GA_CAPTURE_STAGED_PAGE_BYTES = 104 * 1024 * 1024
const MAX_HEADER_BYTES = 4 * 1024 * 1024
const MAX_COMPRESSED_PAGE_BYTES = 4 * 1024 * 1024
const MAX_RAW_PAGE_BYTES = 8 * 1024 * 1024
const MAX_INDEX_BYTES = 16 * 1024 * 1024
const MAX_BLOCKS = 20_000
const HEX = /^[a-f0-9]{64}$/u

/** Stable, sanitized failure codes for bounded capture and artifact checks. */
export class GaCaptureError extends Error {
  constructor(readonly code: `ga_capture_${string}`) {
    super(code)
  }
}

export type GaCapturePageKind = "start_page" | "referrer_page"
export type GaCaptureBlock = {
  kind: GaCapturePageKind | "locator_index"
  pageOffset: number | null
  rowCount: number | null
  compressedBytes: number
  compressedSha256: string
  rawBytes: number
  rawSha256: string
}
export type GaCaptureHeader = {
  version: "ga_watch_capture_v1"
  generationId: string
  generationInputDigest: string
  sourceSetDigest: string
  inputCutoff: string
  selectedCorpusDigest: string
  candidatePoolDigest: string
  routeMappingDigest: string
  querySpecDigest: string
  sourcePatternTableDigest: string
  propertyId: string
  propertyTimeZone: string
  requestedStart: string
  requestedEnd: string
  usableStart: string
  usableEnd: string
  sourceAvailability: unknown
  baseQualification: unknown
  baseQualificationDigest: string
  requestedCoverageDigest: string
  usableCoverageDigest: string
  captureStartedAt: string
  captureCompletedAt: string
  verification: "two_matching_passes"
  startRows: number
  referrerRows: number
  startPages: number
  referrerPages: number
  startContentDigest: string
  referrerContentDigest: string
  physicalHttpAttempts: number
  physicalSucceededCalls: number
  blocks: GaCaptureBlock[]
}
export type GaCapturePageFile = GaCaptureBlock & { path: string }
export type GaCaptureLocatorIndex = {
  sourcePatterns: string[]
  pagesBySourcePattern: number[][]
}

export function gaCaptureCanonicalJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical)
    if (input !== null && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, entry]) => [key, canonical(entry)]),
      )
    return input
  }
  return JSON.stringify(canonical(value))
}

export function gaCaptureDigest(value: unknown): string {
  return createHash("sha256")
    .update(gaCaptureCanonicalJson(value))
    .digest("hex")
}

function byteDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function atomicWrite(directory: string, name: string, bytes: Buffer) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const destination = join(directory, name)
  const temporary = join(directory, `${name}.${randomUUID()}.tmp`)
  const handle = await open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, destination)
    await syncDirectory(directory)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return destination
}

/** One already-minimized aggregate page, committed before advancing its offset. */
export async function writeGaWatchCapturePage(input: {
  directory: string
  kind: GaCapturePageKind
  pageOffset: number
  rowCount: number
  rows: unknown[]
  remainingCompressedBytes?: number
  remainingRawBytes?: number
}): Promise<GaCapturePageFile> {
  if (
    !validCount(input.pageOffset) ||
    !validCount(input.rowCount) ||
    input.rows.length > 500 ||
    input.rowCount !== input.rows.length
  )
    throw new GaCaptureError("ga_capture_invalid_page")
  const raw = Buffer.from(gaCaptureCanonicalJson(input.rows), "utf8")
  if (raw.length > MAX_RAW_PAGE_BYTES)
    throw new GaCaptureError("ga_capture_page_cap")
  if (
    input.remainingRawBytes !== undefined &&
    raw.length > input.remainingRawBytes
  )
    throw new GaCaptureError("ga_capture_raw_total_cap")
  const compressed = gzipSync(raw)
  if (compressed.length > MAX_COMPRESSED_PAGE_BYTES)
    throw new GaCaptureError("ga_capture_page_cap")
  if (
    input.remainingCompressedBytes !== undefined &&
    compressed.length > input.remainingCompressedBytes
  )
    throw new GaCaptureError("ga_capture_staging_cap")
  const path = await atomicWrite(
    input.directory,
    `${input.kind}-${input.pageOffset}.gz`,
    compressed,
  )
  return {
    kind: input.kind,
    pageOffset: input.pageOffset,
    rowCount: input.rowCount,
    compressedBytes: compressed.length,
    compressedSha256: byteDigest(compressed),
    rawBytes: raw.length,
    rawSha256: byteDigest(raw),
    path,
  }
}

function validateBlock(value: unknown): asserts value is GaCaptureBlock {
  if (typeof value !== "object" || value === null)
    throw new GaCaptureError("ga_capture_invalid_block")
  const block = value as Record<string, unknown>
  const maxCompressed =
    block.kind === "locator_index" ? MAX_INDEX_BYTES : MAX_COMPRESSED_PAGE_BYTES
  const maxRaw =
    block.kind === "locator_index" ? MAX_INDEX_BYTES : MAX_RAW_PAGE_BYTES
  if (
    !["start_page", "referrer_page", "locator_index"].includes(
      String(block.kind),
    ) ||
    (block.kind === "locator_index"
      ? block.pageOffset !== null || block.rowCount !== null
      : !validCount(block.pageOffset) || !validCount(block.rowCount)) ||
    !validCount(block.compressedBytes) ||
    block.compressedBytes === 0 ||
    block.compressedBytes > maxCompressed ||
    !validCount(block.rawBytes) ||
    block.rawBytes > maxRaw ||
    typeof block.compressedSha256 !== "string" ||
    !HEX.test(block.compressedSha256) ||
    typeof block.rawSha256 !== "string" ||
    !HEX.test(block.rawSha256)
  )
    throw new GaCaptureError("ga_capture_invalid_block")
}

function validateHeader(value: unknown): asserts value is GaCaptureHeader {
  if (typeof value !== "object" || value === null)
    throw new GaCaptureError("ga_capture_invalid_header")
  const header = value as Record<string, unknown>
  if (
    header.version !== "ga_watch_capture_v1" ||
    header.verification !== "two_matching_passes" ||
    !Array.isArray(header.blocks) ||
    header.blocks.length < 2 ||
    header.blocks.length > MAX_BLOCKS ||
    !header.blocks.every((block) => {
      try {
        validateBlock(block)
        return true
      } catch {
        return false
      }
    }) ||
    header.blocks.at(-1)?.kind !== "locator_index" ||
    [
      "generationInputDigest",
      "sourceSetDigest",
      "selectedCorpusDigest",
      "candidatePoolDigest",
      "routeMappingDigest",
      "querySpecDigest",
      "sourcePatternTableDigest",
      "baseQualificationDigest",
      "requestedCoverageDigest",
      "usableCoverageDigest",
      "startContentDigest",
      "referrerContentDigest",
    ].some(
      (field) => typeof header[field] !== "string" || !HEX.test(header[field]),
    ) ||
    [
      "startRows",
      "referrerRows",
      "startPages",
      "referrerPages",
      "physicalHttpAttempts",
      "physicalSucceededCalls",
    ].some((field) => !validCount(header[field])) ||
    Number(header.physicalSucceededCalls) > Number(header.physicalHttpAttempts)
  )
    throw new GaCaptureError("ga_capture_invalid_header")
  if (
    (header.blocks as GaCaptureBlock[]).reduce(
      (sum, block) => sum + block.rawBytes,
      0,
    ) > MAX_GA_CAPTURE_TOTAL_RAW_BYTES
  )
    throw new GaCaptureError("ga_capture_raw_total_cap")
}

export function gaCaptureContentDigest(
  kind: GaCapturePageKind,
  pages: readonly Pick<
    GaCaptureBlock,
    "pageOffset" | "rowCount" | "rawSha256"
  >[],
): string {
  return gaCaptureDigest({
    version: "ga_watch_content_v1",
    kind,
    pages: pages.map(({ pageOffset, rowCount, rawSha256 }) => ({
      pageOffset,
      rowCount,
      rawSha256,
    })),
  })
}

function validateBlockSequence(header: GaCaptureHeader): void {
  const starts = header.blocks.filter((block) => block.kind === "start_page")
  const referrers = header.blocks.filter(
    (block) => block.kind === "referrer_page",
  )
  if (
    header.blocks.length !== starts.length + referrers.length + 1 ||
    header.blocks.some((block, index) =>
      index < starts.length
        ? block.kind !== "start_page"
        : index < starts.length + referrers.length
          ? block.kind !== "referrer_page"
          : block.kind !== "locator_index",
    ) ||
    starts.length !== header.startPages ||
    referrers.length !== header.referrerPages ||
    starts.reduce((sum, block) => sum + block.rowCount!, 0) !==
      header.startRows ||
    referrers.reduce((sum, block) => sum + block.rowCount!, 0) !==
      header.referrerRows ||
    gaCaptureContentDigest("start_page", starts) !==
      header.startContentDigest ||
    gaCaptureContentDigest("referrer_page", referrers) !==
      header.referrerContentDigest
  )
    throw new GaCaptureError("ga_capture_invalid_sequence")
  for (const blocks of [starts, referrers]) {
    let expected = 0
    for (const block of blocks) {
      if (block.pageOffset !== expected)
        throw new GaCaptureError("ga_capture_invalid_sequence")
      expected += block.rowCount!
    }
  }
}

async function verifyCompressedBlock(
  path: string,
  block: GaCaptureBlock,
): Promise<Buffer> {
  const compressed = await readFile(path)
  if (
    compressed.length !== block.compressedBytes ||
    byteDigest(compressed) !== block.compressedSha256
  )
    throw new GaCaptureError("ga_capture_corrupt_block")
  const raw = gunzipSync(compressed, { maxOutputLength: block.rawBytes + 1 })
  if (raw.length !== block.rawBytes || byteDigest(raw) !== block.rawSha256)
    throw new GaCaptureError("ga_capture_corrupt_block")
  return raw
}

export async function readStagedGaWatchCapturePage(
  page: GaCapturePageFile,
): Promise<unknown[]> {
  validateBlock(page)
  const raw = await verifyCompressedBlock(page.path, page)
  const parsed: unknown = JSON.parse(raw.toString("utf8"))
  if (
    !Array.isArray(parsed) ||
    parsed.length !== page.rowCount ||
    gaCaptureCanonicalJson(parsed) !== raw.toString("utf8")
  )
    throw new GaCaptureError("ga_capture_invalid_page")
  return parsed
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

/** Seals committed pages as one bounded deterministic upload object. */
export async function sealGaWatchCaptureArtifact(input: {
  directory: string
  header: Omit<GaCaptureHeader, "blocks">
  pages: GaCapturePageFile[]
  locatorIndex: GaCaptureLocatorIndex
}): Promise<{
  path: string
  header: GaCaptureHeader
  headerSha256: string
  artifactSha256: string
  artifactBytes: number
}> {
  const indexRaw = Buffer.from(gaCaptureCanonicalJson(input.locatorIndex))
  if (indexRaw.length > MAX_INDEX_BYTES)
    throw new GaCaptureError("ga_capture_index_cap")
  const indexCompressed = gzipSync(indexRaw)
  if (indexCompressed.length > MAX_INDEX_BYTES)
    throw new GaCaptureError("ga_capture_index_cap")
  const indexPath = await atomicWrite(
    input.directory,
    "locator_index.gz",
    indexCompressed,
  )
  const indexBlock: GaCapturePageFile = {
    kind: "locator_index",
    pageOffset: null,
    rowCount: null,
    compressedBytes: indexCompressed.length,
    compressedSha256: byteDigest(indexCompressed),
    rawBytes: indexRaw.length,
    rawSha256: byteDigest(indexRaw),
    path: indexPath,
  }
  const pageFiles = [...input.pages, indexBlock]
  const blocks = pageFiles.map(({ path: _path, ...block }) => block)
  const header: GaCaptureHeader = { ...input.header, blocks }
  validateHeader(header)
  validateBlockSequence(header)
  const headerBytes = Buffer.from(gaCaptureCanonicalJson(header), "utf8")
  if (headerBytes.length > MAX_HEADER_BYTES)
    throw new GaCaptureError("ga_capture_header_cap")
  const totalBytes =
    12 +
    headerBytes.length +
    blocks.reduce((sum, block) => sum + block.compressedBytes, 0)
  if (totalBytes > MAX_GA_CAPTURE_ARTIFACT_BYTES)
    throw new GaCaptureError("ga_capture_artifact_cap")
  const length = Buffer.alloc(4)
  length.writeUInt32BE(headerBytes.length)
  const temporary = join(input.directory, `artifact.${randomUUID()}.tmp`)
  const destination = join(input.directory, "artifact.bin")
  const handle = await open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(Buffer.concat([MAGIC, length, headerBytes]))
    for (const page of pageFiles) {
      await verifyCompressedBlock(page.path, page)
      for await (const chunk of createReadStream(page.path))
        await handle.writeFile(chunk)
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, destination)
    await syncDirectory(input.directory)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  const actualBytes = (await stat(destination)).size
  if (actualBytes !== totalBytes)
    throw new GaCaptureError("ga_capture_artifact_length")
  return {
    path: destination,
    header,
    headerSha256: byteDigest(headerBytes),
    artifactSha256: await fileDigest(destination),
    artifactBytes: actualBytes,
  }
}

export async function openGaWatchCaptureArtifact(input: {
  path: string
  expectedSha256: string
  expectedBytes: number
}): Promise<{
  header: GaCaptureHeader
  headerSha256: string
  readPage: (
    page: Pick<GaCaptureBlock, "kind" | "pageOffset">,
  ) => Promise<unknown[]>
  readLocatorIndex: () => Promise<GaCaptureLocatorIndex>
}> {
  const size = (await stat(input.path)).size
  if (
    !validCount(size) ||
    size > MAX_GA_CAPTURE_ARTIFACT_BYTES ||
    size !== input.expectedBytes ||
    !HEX.test(input.expectedSha256) ||
    (await fileDigest(input.path)) !== input.expectedSha256
  )
    throw new GaCaptureError("ga_capture_artifact_mismatch")
  const handle = await open(input.path, "r")
  let header: GaCaptureHeader
  let headerLength: number
  let headerSha256: string
  try {
    const prefix = Buffer.alloc(12)
    const read = await handle.read(prefix, 0, 12, 0)
    if (read.bytesRead !== 12 || !prefix.subarray(0, 8).equals(MAGIC))
      throw new GaCaptureError("ga_capture_artifact_magic")
    headerLength = prefix.readUInt32BE(8)
    if (headerLength < 1 || headerLength > MAX_HEADER_BYTES)
      throw new GaCaptureError("ga_capture_header_cap")
    const bytes = Buffer.alloc(headerLength)
    if (
      (await handle.read(bytes, 0, headerLength, 12)).bytesRead !== headerLength
    )
      throw new GaCaptureError("ga_capture_artifact_length")
    headerSha256 = byteDigest(bytes)
    const parsed: unknown = JSON.parse(bytes.toString("utf8"))
    validateHeader(parsed)
    if (gaCaptureCanonicalJson(parsed) !== bytes.toString("utf8"))
      throw new GaCaptureError("ga_capture_noncanonical_header")
    header = parsed
    validateBlockSequence(header)
  } finally {
    await handle.close()
  }
  const positions = new Map<string, { block: GaCaptureBlock; offset: number }>()
  let offset = 12 + headerLength
  for (const block of header.blocks) {
    const key = `${block.kind}:${block.pageOffset ?? "index"}`
    if (positions.has(key))
      throw new GaCaptureError("ga_capture_duplicate_block")
    positions.set(key, { block, offset })
    offset += block.compressedBytes
  }
  if (offset !== size) throw new GaCaptureError("ga_capture_artifact_length")
  const readBlock = async (
    kind: GaCaptureBlock["kind"],
    pageOffset: number | null,
  ) => {
    const entry = positions.get(`${kind}:${pageOffset ?? "index"}`)
    if (!entry) throw new GaCaptureError("ga_capture_missing_block")
    const handle = await open(input.path, "r")
    try {
      const compressed = Buffer.alloc(entry.block.compressedBytes)
      if (
        (await handle.read(compressed, 0, compressed.length, entry.offset))
          .bytesRead !== compressed.length ||
        byteDigest(compressed) !== entry.block.compressedSha256
      )
        throw new GaCaptureError("ga_capture_corrupt_block")
      const raw = gunzipSync(compressed, {
        maxOutputLength: entry.block.rawBytes + 1,
      })
      if (
        raw.length !== entry.block.rawBytes ||
        byteDigest(raw) !== entry.block.rawSha256
      )
        throw new GaCaptureError("ga_capture_corrupt_block")
      const parsed: unknown = JSON.parse(raw.toString("utf8"))
      if (gaCaptureCanonicalJson(parsed) !== raw.toString("utf8"))
        throw new GaCaptureError("ga_capture_noncanonical_block")
      return parsed
    } finally {
      await handle.close()
    }
  }
  // Validate every compressed block on open, rather than lazily discovering a
  // damaged late page after model work has already begun.
  for (const block of header.blocks)
    await readBlock(block.kind, block.pageOffset)
  return {
    header,
    headerSha256,
    async readPage(page) {
      if (page.kind === "locator_index")
        throw new GaCaptureError("ga_capture_invalid_page")
      const rows = await readBlock(page.kind, page.pageOffset)
      if (!Array.isArray(rows))
        throw new GaCaptureError("ga_capture_invalid_page")
      return rows
    },
    async readLocatorIndex() {
      const index = await readBlock("locator_index", null)
      if (typeof index !== "object" || index === null)
        throw new GaCaptureError("ga_capture_invalid_index")
      return index as GaCaptureLocatorIndex
    },
  }
}
