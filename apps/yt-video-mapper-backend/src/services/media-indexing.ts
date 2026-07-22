import { createHash } from "node:crypto"
import { isIP } from "node:net"
import {
  CatalogRunStatus as PrismaCatalogRunStatus,
  MediaSourceType as PrismaMediaSourceType,
  Prisma,
  SignatureType as PrismaSignatureType,
  type CatalogVariant,
  type IndexRun,
  type PrismaClient,
} from "../generated/prisma/index.js"
import { env } from "../config/env.js"
import {
  DeterministicOfficialMediaSignatureExtractor,
  OFFICIAL_MEDIA_SIGNATURE_ALGORITHM_VERSION,
  type MediaSignatureDraft,
  type MediaSignatureType,
  type OfficialMediaSample,
  type OfficialMediaSignatureExtractor,
  type OfficialMediaSignatureVariant,
} from "./media-signature-extraction.js"
import { FfmpegVisualFrameExtractor } from "./ffmpeg-visual-frame-extraction.js"
import { OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION } from "./visual-fingerprint.js"

const MAX_FAILURE_SUMMARIES = 10

export type MediaIndexRunStatus = "running" | "completed" | "failed"

export type MediaIndexRunRecord = {
  id: string
  status: MediaIndexRunStatus
  algorithmVersion: string
  cursorVariantId: string | null
  variantsAttempted: number
  variantsIndexed: number
  variantsFailed: number
  failureSummary: MediaIndexFailureSummary | null
  startedAt: Date
  completedAt: Date | null
}

export type MediaIndexFailureSummary = {
  code: string
  message: string
  cursorVariantId: string | null
  failedCount?: number
  failures?: MediaIndexVariantFailureSummary[]
  truncatedFailureCount?: number
}

export type MediaIndexVariantFailureSummary = {
  coreId: string
  videoVariantId: string
  catalogVariantId: string
  code: string
  message: string
}

export type IndexableCatalogVariant = OfficialMediaSignatureVariant & {
  id: string
  mediaSourceUrl: string
}

export type InMemoryCatalogVariant = Omit<
  IndexableCatalogVariant,
  "mediaSourceUrl"
> & {
  indexable: boolean
  mediaSourceUrl: string | null
}

export type StoredMediaSignatureInput = MediaSignatureDraft & {
  sourceMediaUrl: string | null
}

export type MediaIndexRepository = {
  createIndexRun(input: {
    algorithmVersion: string
    cursorVariantId: string | null
    startedAt: Date
  }): Promise<MediaIndexRunRecord>
  updateIndexRun(
    id: string,
    patch: Partial<
      Pick<
        MediaIndexRunRecord,
        | "status"
        | "cursorVariantId"
        | "variantsAttempted"
        | "variantsIndexed"
        | "variantsFailed"
        | "failureSummary"
        | "completedAt"
      >
    >,
  ): Promise<MediaIndexRunRecord>
  listIndexableVariants(input: {
    afterVariantId: string | null
    limit: number
  }): Promise<IndexableCatalogVariant[]>
  listIndexedVariantKeys(input: {
    variants: IndexableCatalogVariant[]
    algorithmVersion: string
  }): Promise<Set<string>>
  upsertMediaSignatures(signatures: StoredMediaSignatureInput[]): Promise<void>
}

export type OfficialMediaFetchResult = OfficialMediaSample

export type OfficialMediaFetcher = {
  fetch(input: {
    url: string
    maxBytes: number
  }): Promise<OfficialMediaFetchResult>
}

export type MediaFetchLike = (
  url: string,
  init: {
    method: "GET"
    headers: Record<string, string>
    redirect?: "error"
    signal?: AbortSignal
  },
) => Promise<{
  ok: boolean
  status: number
  headers?: {
    get(name: string): string | null
  }
  body?: ReadableStream<Uint8Array> | null
  arrayBuffer?: () => Promise<ArrayBuffer>
}>

export type MediaIndexingInput = {
  resumeAfterVariantId?: string | null
}

export type MediaIndexingOptions = {
  repository: MediaIndexRepository
  fetcher?: OfficialMediaFetcher
  extractor?: OfficialMediaSignatureExtractor
  algorithmVersion?: string
  pageSize?: number
  concurrency?: number
  maxMediaBytes?: number
  now?: () => Date
}

export class MediaIndexingSafeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "MediaIndexingSafeError"
  }
}

export class FetchOfficialMediaFetcher implements OfficialMediaFetcher {
  private readonly fetchImpl: MediaFetchLike
  private readonly timeoutMs: number
  private readonly allowedHosts: Set<string>

  constructor(
    fetchImpl?: MediaFetchLike,
    timeoutMs = env.MEDIA_INDEX_FETCH_TIMEOUT_MS,
    allowedHosts = parseAllowedHosts(env.MEDIA_INDEX_ALLOWED_HOSTS),
  ) {
    const globalFetch = globalThis.fetch as unknown as
      | MediaFetchLike
      | undefined
    const resolvedFetch = fetchImpl ?? globalFetch
    if (!resolvedFetch) {
      throw new MediaIndexingSafeError(
        "media_fetch_unavailable",
        "Fetch is not available for official media indexing",
      )
    }
    this.fetchImpl = resolvedFetch
    this.timeoutMs = timeoutMs
    this.allowedHosts = allowedHosts
  }

  async fetch({
    url,
    maxBytes,
  }: {
    url: string
    maxBytes: number
  }): Promise<OfficialMediaFetchResult> {
    const mediaUrl = assertFetchableMediaUrl(url, this.allowedHosts)
    let response: Awaited<ReturnType<MediaFetchLike>>
    try {
      response = await this.fetchImpl(mediaUrl.href, {
        method: "GET",
        headers: {
          range: `bytes=0-${maxBytes - 1}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new MediaIndexingSafeError(
        "media_fetch_failed",
        safeErrorMessage(error),
      )
    }

    if (!response.ok) {
      throw new MediaIndexingSafeError(
        "media_fetch_http_error",
        `Official media request failed with status ${response.status}`,
      )
    }

    const bytes = await readBoundedResponseBytes(response, maxBytes)
    if (bytes.byteLength === 0) {
      throw new MediaIndexingSafeError(
        "media_fetch_empty",
        "Official media response was empty",
      )
    }

    const contentLength = parseIntegerHeader(
      response.headers?.get("content-length"),
    )
    const complete =
      response.status === 200 &&
      contentLength != null &&
      contentLength <= maxBytes &&
      bytes.byteLength === contentLength

    return {
      bytes,
      contentType: response.headers?.get("content-type") ?? undefined,
      sourceMediaHash: sourceMediaHash(bytes, complete) ?? undefined,
      rangeStart: 0,
      rangeEnd: bytes.byteLength > 0 ? bytes.byteLength - 1 : undefined,
      complete,
    }
  }
}

export class MediaIndexingService {
  private readonly fetcher: OfficialMediaFetcher
  private readonly extractor: OfficialMediaSignatureExtractor
  private readonly algorithmVersion: string
  private readonly pageSize: number
  private readonly concurrency: number
  private readonly maxMediaBytes: number
  private readonly now: () => Date

  constructor(private readonly options: MediaIndexingOptions) {
    this.algorithmVersion =
      options.algorithmVersion ?? OFFICIAL_MEDIA_SIGNATURE_ALGORITHM_VERSION
    this.fetcher = options.fetcher ?? new FetchOfficialMediaFetcher()
    this.extractor =
      options.extractor ??
      createDefaultOfficialMediaSignatureExtractor(this.algorithmVersion)
    this.pageSize = options.pageSize ?? env.MEDIA_INDEX_PAGE_SIZE
    this.concurrency = options.concurrency ?? env.MEDIA_INDEX_CONCURRENCY
    if (
      !Number.isInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > 4
    ) {
      throw new MediaIndexingSafeError(
        "invalid_media_index_concurrency",
        "Media index concurrency must be an integer between 1 and 4",
      )
    }
    this.maxMediaBytes =
      options.maxMediaBytes ?? env.MEDIA_INDEX_MAX_FETCH_BYTES
    this.now = options.now ?? (() => new Date())
  }

  async indexCatalog(
    input: MediaIndexingInput = {},
  ): Promise<MediaIndexRunRecord> {
    let cursorVariantId = input.resumeAfterVariantId ?? null
    let variantsAttempted = 0
    let variantsIndexed = 0
    let variantsFailed = 0
    const failures: MediaIndexVariantFailureSummary[] = []
    let run = await this.options.repository.createIndexRun({
      algorithmVersion: this.algorithmVersion,
      cursorVariantId,
      startedAt: this.now(),
    })

    try {
      while (true) {
        const variants = await this.options.repository.listIndexableVariants({
          afterVariantId: cursorVariantId,
          limit: this.pageSize,
        })
        if (variants.length === 0) break
        const indexedVariantKeys =
          await this.options.repository.listIndexedVariantKeys({
            variants,
            algorithmVersion: this.algorithmVersion,
          })

        for (
          let batchStart = 0;
          batchStart < variants.length;
          batchStart += this.concurrency
        ) {
          const batch = variants.slice(
            batchStart,
            batchStart + this.concurrency,
          )
          const outcomes = await Promise.allSettled(
            batch.map(async (variant) => {
              const variantKey = mediaSignatureVariantKey(variant)
              if (indexedVariantKeys.has(variantKey)) return false

              await this.indexVariant(variant)
              return true
            }),
          )

          for (const [index, outcome] of outcomes.entries()) {
            const variant = batch[index]!
            variantsAttempted += 1

            if (outcome.status === "fulfilled") {
              if (outcome.value) {
                indexedVariantKeys.add(mediaSignatureVariantKey(variant))
                variantsIndexed += 1
              }
            } else {
              variantsFailed += 1
              appendFailure(
                failures,
                summarizeVariantFailure(outcome.reason, variant),
              )
            }

            cursorVariantId = variant.id
          }

          run = await this.options.repository.updateIndexRun(run.id, {
            cursorVariantId,
            variantsAttempted,
            variantsIndexed,
            variantsFailed,
            failureSummary: failureSummaryFromFailures(
              failures,
              cursorVariantId,
              variantsFailed,
            ),
          })
        }
      }

      return await this.options.repository.updateIndexRun(run.id, {
        status: "completed",
        completedAt: this.now(),
        cursorVariantId,
        variantsAttempted,
        variantsIndexed,
        variantsFailed,
        failureSummary: failureSummaryFromFailures(
          failures,
          cursorVariantId,
          variantsFailed,
        ),
      })
    } catch (error) {
      const durableFailures = failures.slice(
        0,
        Math.min(failures.length, run.variantsFailed),
      )
      return await this.options.repository.updateIndexRun(run.id, {
        status: "failed",
        completedAt: this.now(),
        failureSummary: runFailureSummary(
          error,
          run.cursorVariantId,
          durableFailures,
          run.variantsFailed,
        ),
      })
    }
  }

  private async indexVariant(variant: IndexableCatalogVariant): Promise<void> {
    const mediaSample =
      this.algorithmVersion === OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION
        ? undefined
        : await this.fetcher.fetch({
            url: variant.mediaSourceUrl,
            maxBytes: this.maxMediaBytes,
          })
    const signatures = await this.extractor.extract({
      variant,
      mediaSample,
      sourceMediaUrl: variant.mediaSourceUrl,
      algorithmVersion: this.algorithmVersion,
    })

    if (signatures.length === 0) {
      throw new MediaIndexingSafeError(
        "no_signatures_generated",
        "No media signatures were generated for the catalog variant",
      )
    }

    await this.options.repository.upsertMediaSignatures(
      signatures.map((signature) => ({
        ...signature,
        sourceMediaUrl: sanitizeSourceMediaUrl(variant.mediaSourceUrl),
        sourceMediaHash:
          signature.sourceMediaHash ?? mediaSample?.sourceMediaHash ?? null,
      })),
    )
  }
}

function createDefaultOfficialMediaSignatureExtractor(
  algorithmVersion: string,
): OfficialMediaSignatureExtractor {
  return algorithmVersion === OFFICIAL_MEDIA_SIGNATURE_V2_ALGORITHM_VERSION
    ? new DeterministicOfficialMediaSignatureExtractor({
        visualFrameExtractor: new FfmpegVisualFrameExtractor(),
      })
    : new DeterministicOfficialMediaSignatureExtractor()
}

export class PrismaMediaIndexRepository implements MediaIndexRepository {
  constructor(private readonly db: PrismaClient) {}

  async createIndexRun({
    algorithmVersion,
    cursorVariantId,
    startedAt,
  }: {
    algorithmVersion: string
    cursorVariantId: string | null
    startedAt: Date
  }): Promise<MediaIndexRunRecord> {
    const run = await this.db.indexRun.create({
      data: {
        status: PrismaCatalogRunStatus.RUNNING,
        algorithmVersion,
        cursorVariantId,
        startedAt,
      },
    })

    return fromPrismaIndexRun(run)
  }

  async updateIndexRun(
    id: string,
    patch: Parameters<MediaIndexRepository["updateIndexRun"]>[1],
  ): Promise<MediaIndexRunRecord> {
    const run = await this.db.indexRun.update({
      where: { id },
      data: {
        status: patch.status ? toPrismaRunStatus(patch.status) : undefined,
        cursorVariantId:
          patch.cursorVariantId === undefined
            ? undefined
            : patch.cursorVariantId,
        variantsAttempted: patch.variantsAttempted,
        variantsIndexed: patch.variantsIndexed,
        variantsFailed: patch.variantsFailed,
        failureSummary:
          patch.failureSummary === undefined
            ? undefined
            : (patch.failureSummary as Prisma.InputJsonValue),
        completedAt: patch.completedAt,
      },
    })

    return fromPrismaIndexRun(run)
  }

  async listIndexableVariants({
    afterVariantId,
    limit,
  }: {
    afterVariantId: string | null
    limit: number
  }): Promise<IndexableCatalogVariant[]> {
    const variants = await this.db.catalogVariant.findMany({
      where: {
        id: afterVariantId ? { gt: afterVariantId } : undefined,
        indexable: true,
        mediaSourceUrl: { not: null },
        NOT: { mediaSourceUrl: "" },
      },
      orderBy: { id: "asc" },
      take: limit,
    })

    return variants.map(fromPrismaCatalogVariant)
  }

  async listIndexedVariantKeys({
    variants,
    algorithmVersion,
  }: {
    variants: IndexableCatalogVariant[]
    algorithmVersion: string
  }): Promise<Set<string>> {
    if (variants.length === 0) return new Set()

    const signatures = await this.db.mediaSignature.findMany({
      where: {
        algorithmVersion,
        OR: variants.map((variant) => ({
          coreId: variant.coreId,
          videoVariantId: variant.videoVariantId,
        })),
      },
      select: {
        coreId: true,
        videoVariantId: true,
      },
      distinct: ["coreId", "videoVariantId"],
    })

    return new Set(signatures.map(mediaSignatureVariantKey))
  }

  async upsertMediaSignatures(
    signatures: StoredMediaSignatureInput[],
  ): Promise<void> {
    await this.db.$transaction(
      signatures.map((signature) =>
        this.db.mediaSignature.upsert({
          where: {
            coreId_videoVariantId_signatureType_algorithmVersion_offsetMilliseconds:
              {
                coreId: signature.coreId,
                videoVariantId: signature.videoVariantId,
                signatureType: toPrismaSignatureType(signature.signatureType),
                algorithmVersion: signature.algorithmVersion,
                offsetMilliseconds: signature.offsetMilliseconds,
              },
          },
          create: {
            coreId: signature.coreId,
            videoVariantId: signature.videoVariantId,
            signatureType: toPrismaSignatureType(signature.signatureType),
            algorithmVersion: signature.algorithmVersion,
            offsetMilliseconds: signature.offsetMilliseconds,
            durationMilliseconds: signature.durationMilliseconds,
            signature: signature.signature as Prisma.InputJsonValue,
            sourceMediaUrl: signature.sourceMediaUrl,
            sourceMediaHash: signature.sourceMediaHash,
          },
          update: {
            durationMilliseconds: signature.durationMilliseconds,
            signature: signature.signature as Prisma.InputJsonValue,
            sourceMediaUrl: signature.sourceMediaUrl,
            sourceMediaHash: signature.sourceMediaHash,
          },
        }),
      ),
    )
  }
}

export class InMemoryMediaIndexRepository implements MediaIndexRepository {
  readonly variants = new Map<string, InMemoryCatalogVariant>()
  readonly runs = new Map<string, MediaIndexRunRecord>()
  readonly signatures = new Map<string, StoredMediaSignatureInput>()
  private nextRunNumber = 1

  constructor(variants: InMemoryCatalogVariant[] = []) {
    for (const variant of variants) {
      this.variants.set(variant.id, cloneVariant(variant))
    }
  }

  async createIndexRun({
    algorithmVersion,
    cursorVariantId,
    startedAt,
  }: {
    algorithmVersion: string
    cursorVariantId: string | null
    startedAt: Date
  }): Promise<MediaIndexRunRecord> {
    const run: MediaIndexRunRecord = {
      id: `index-run-${this.nextRunNumber++}`,
      status: "running",
      algorithmVersion,
      cursorVariantId,
      variantsAttempted: 0,
      variantsIndexed: 0,
      variantsFailed: 0,
      failureSummary: null,
      startedAt,
      completedAt: null,
    }
    this.runs.set(run.id, cloneRun(run))
    return cloneRun(run)
  }

  async updateIndexRun(
    id: string,
    patch: Parameters<MediaIndexRepository["updateIndexRun"]>[1],
  ): Promise<MediaIndexRunRecord> {
    const run = this.runs.get(id)
    if (!run) {
      throw new MediaIndexingSafeError(
        "index_run_not_found",
        `IndexRun not found: ${id}`,
      )
    }

    const updated = {
      ...run,
      ...patch,
    }
    this.runs.set(id, cloneRun(updated))
    return cloneRun(updated)
  }

  async listIndexableVariants({
    afterVariantId,
    limit,
  }: {
    afterVariantId: string | null
    limit: number
  }): Promise<IndexableCatalogVariant[]> {
    return [...this.variants.values()]
      .filter(
        (variant) =>
          variant.indexable &&
          variant.mediaSourceUrl != null &&
          variant.id > (afterVariantId ?? ""),
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit)
      .map((variant) => ({
        ...variant,
        mediaSourceUrl: variant.mediaSourceUrl!,
      }))
  }

  async listIndexedVariantKeys({
    variants,
    algorithmVersion,
  }: {
    variants: IndexableCatalogVariant[]
    algorithmVersion: string
  }): Promise<Set<string>> {
    const requestedKeys = new Set(variants.map(mediaSignatureVariantKey))
    return new Set(
      [...this.signatures.values()]
        .filter(
          (signature) =>
            signature.algorithmVersion === algorithmVersion &&
            requestedKeys.has(mediaSignatureVariantKey(signature)),
        )
        .map(mediaSignatureVariantKey),
    )
  }

  async upsertMediaSignatures(
    signatures: StoredMediaSignatureInput[],
  ): Promise<void> {
    for (const signature of signatures) {
      this.signatures.set(signatureKey(signature), cloneSignature(signature))
    }
  }
}

function fromPrismaIndexRun(run: IndexRun): MediaIndexRunRecord {
  return {
    id: run.id,
    status: fromPrismaRunStatus(run.status),
    algorithmVersion: run.algorithmVersion,
    cursorVariantId: run.cursorVariantId,
    variantsAttempted: run.variantsAttempted,
    variantsIndexed: run.variantsIndexed,
    variantsFailed: run.variantsFailed,
    failureSummary: run.failureSummary as MediaIndexFailureSummary | null,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  }
}

function fromPrismaCatalogVariant(
  variant: CatalogVariant,
): IndexableCatalogVariant {
  if (!variant.mediaSourceUrl) {
    throw new MediaIndexingSafeError(
      "catalog_variant_media_source_missing",
      "Indexable catalog variant is missing a media source URL",
    )
  }

  return {
    id: variant.id,
    coreId: variant.coreId,
    videoVariantId: variant.videoVariantId,
    mediaSourceType: fromPrismaMediaSourceType(variant.mediaSourceType),
    mediaSourceUrl: variant.mediaSourceUrl,
    durationSeconds: variant.durationSeconds,
    lengthInMilliseconds: variant.lengthInMilliseconds,
    downloadQuality: variant.downloadQuality,
    downloadWidth: variant.downloadWidth,
    downloadHeight: variant.downloadHeight,
    languageSlug: variant.languageSlug,
    locale: variant.locale,
    editionName: variant.editionName,
  }
}

function toPrismaRunStatus(
  status: MediaIndexRunStatus,
): PrismaCatalogRunStatus {
  const map = {
    running: PrismaCatalogRunStatus.RUNNING,
    completed: PrismaCatalogRunStatus.COMPLETED,
    failed: PrismaCatalogRunStatus.FAILED,
  } satisfies Record<MediaIndexRunStatus, PrismaCatalogRunStatus>

  return map[status]
}

function fromPrismaRunStatus(
  status: PrismaCatalogRunStatus,
): MediaIndexRunStatus {
  const map = {
    [PrismaCatalogRunStatus.RUNNING]: "running",
    [PrismaCatalogRunStatus.COMPLETED]: "completed",
    [PrismaCatalogRunStatus.FAILED]: "failed",
  } satisfies Record<PrismaCatalogRunStatus, MediaIndexRunStatus>

  return map[status]
}

function fromPrismaMediaSourceType(
  sourceType: PrismaMediaSourceType,
): IndexableCatalogVariant["mediaSourceType"] {
  const map = {
    [PrismaMediaSourceType.DOWNLOAD]: "DOWNLOAD",
    [PrismaMediaSourceType.HLS]: "HLS",
    [PrismaMediaSourceType.DASH]: "DASH",
    [PrismaMediaSourceType.NONE]: "NONE",
  } satisfies Record<
    PrismaMediaSourceType,
    IndexableCatalogVariant["mediaSourceType"]
  >

  return map[sourceType]
}

function toPrismaSignatureType(
  signatureType: MediaSignatureType,
): PrismaSignatureType {
  const map = {
    VISUAL_FRAME: PrismaSignatureType.VISUAL_FRAME,
    AUDIO_FINGERPRINT: PrismaSignatureType.AUDIO_FINGERPRINT,
    TEXT_SEGMENT: PrismaSignatureType.TEXT_SEGMENT,
    STRUCTURAL_HINT: PrismaSignatureType.STRUCTURAL_HINT,
  } satisfies Record<MediaSignatureType, PrismaSignatureType>

  return map[signatureType]
}

function failureSummaryFromFailures(
  failures: MediaIndexVariantFailureSummary[],
  cursorVariantId: string | null,
  failedCount: number,
): MediaIndexFailureSummary | null {
  if (failedCount === 0) return null

  return {
    code: "variant_index_failures",
    message: "Some catalog variants failed to index",
    cursorVariantId,
    failedCount,
    failures,
    ...truncatedFailureField(failures, failedCount),
  }
}

function runFailureSummary(
  error: unknown,
  cursorVariantId: string | null,
  failures: MediaIndexVariantFailureSummary[],
  failedCount: number,
): MediaIndexFailureSummary {
  return {
    code: "media_index_failed",
    message: safeErrorMessage(error),
    cursorVariantId,
    ...(failures.length > 0
      ? {
          failures,
          failedCount,
          ...truncatedFailureField(failures, failedCount),
        }
      : {}),
  }
}

function summarizeVariantFailure(
  error: unknown,
  variant: IndexableCatalogVariant,
): MediaIndexVariantFailureSummary {
  return {
    coreId: safeIdentifier(variant.coreId),
    videoVariantId: safeIdentifier(variant.videoVariantId),
    catalogVariantId: safeIdentifier(variant.id),
    code:
      error instanceof MediaIndexingSafeError
        ? error.code
        : "variant_index_failed",
    message: safeErrorMessage(error),
  }
}

function appendFailure(
  failures: MediaIndexVariantFailureSummary[],
  failure: MediaIndexVariantFailureSummary,
) {
  if (failures.length < MAX_FAILURE_SUMMARIES) {
    failures.push(failure)
  }
}

function truncatedFailureField(
  failures: MediaIndexVariantFailureSummary[],
  failedCount: number,
): Partial<Pick<MediaIndexFailureSummary, "truncatedFailureCount">> {
  const truncated = failedCount - failures.length
  return truncated > 0 ? { truncatedFailureCount: truncated } : {}
}

function safeIdentifier(value: string): string {
  return value.slice(0, 120)
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(
      /\b(token|access_token|api_key|key|secret|signature|sig|x-amz-[a-z-]+)=([^&\s]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 300)
}

function parseAllowedHosts(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  )
}

function assertFetchableMediaUrl(
  rawUrl: string,
  allowedHosts: Set<string>,
): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new MediaIndexingSafeError(
      "media_url_invalid",
      "Official media URL is malformed",
    )
  }

  if (url.protocol !== "https:") {
    throw new MediaIndexingSafeError(
      "media_url_invalid_protocol",
      "Official media URL must use HTTPS",
    )
  }

  const hostname = normalizeHostname(url.hostname)
  if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
    throw new MediaIndexingSafeError(
      "media_url_host_not_allowed",
      "Official media URL host is not allowlisted",
    )
  }

  if (isLocalHostname(hostname) || isPrivateIpHostname(hostname)) {
    throw new MediaIndexingSafeError(
      "media_url_private_host",
      "Official media URL host is local or private",
    )
  }

  return url
}

function sanitizeSourceMediaUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "https:") return null
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "")
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost")
}

function isPrivateIpHostname(hostname: string): boolean {
  const ipv4Mapped = ipv4FromMappedIpv6(hostname)
  const ipVersion = isIP(ipv4Mapped ?? hostname)
  if (ipVersion === 0) return false
  if (ipVersion === 4) return isPrivateIpv4(ipv4Mapped ?? hostname)

  return (
    hostname === "::" ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  )
}

function ipv4FromMappedIpv6(hostname: string): string | null {
  const match = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (!match) return null

  const high = Number.parseInt(match[1]!, 16)
  const low = Number.parseInt(match[2]!, 16)
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
}

function isPrivateIpv4(hostname: string): boolean {
  const [first, second] = hostname.split(".").map((part) => Number(part))
  if (first === 10 || first === 127 || first === 0) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 100 && second >= 64 && second <= 127) return true
  if (first >= 224) return true
  return false
}

function parseIntegerHeader(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function readBoundedResponseBytes(
  response: Awaited<ReturnType<MediaFetchLike>>,
  maxBytes: number,
): Promise<Uint8Array> {
  if (response.body) {
    return readBoundedStream(response.body, maxBytes)
  }

  if (!response.arrayBuffer) {
    return new Uint8Array()
  }

  const responseBytes = new Uint8Array(await response.arrayBuffer())
  return responseBytes.byteLength > maxBytes
    ? responseBytes.slice(0, maxBytes)
    : responseBytes
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let done = false

  try {
    while (totalBytes < maxBytes) {
      const next = await reader.read()
      if (next.done) {
        done = true
        break
      }

      const remainingBytes = maxBytes - totalBytes
      const chunk =
        next.value.byteLength > remainingBytes
          ? next.value.slice(0, remainingBytes)
          : next.value
      chunks.push(chunk)
      totalBytes += chunk.byteLength

      if (next.value.byteLength >= remainingBytes) break
    }
  } finally {
    if (!done) {
      await reader.cancel().catch(() => undefined)
    }
  }

  return concatChunks(chunks, totalBytes)
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }

  return output
}

function sourceMediaHash(bytes: Uint8Array, complete: boolean): string | null {
  if (bytes.byteLength === 0) return null
  const digest = createHash("sha256").update(bytes).digest("hex")
  return complete
    ? `sha256:full:${digest}`
    : `sha256:bytes=0-${bytes.byteLength - 1}:${digest}`
}

function signatureKey(signature: StoredMediaSignatureInput): string {
  return [
    signature.coreId,
    signature.videoVariantId,
    signature.signatureType,
    signature.algorithmVersion,
    signature.offsetMilliseconds,
  ].join(":")
}

function mediaSignatureVariantKey(input: {
  coreId: string
  videoVariantId: string
}): string {
  return `${input.coreId}:${input.videoVariantId}`
}

function cloneRun(run: MediaIndexRunRecord): MediaIndexRunRecord {
  return {
    ...run,
    startedAt: new Date(run.startedAt),
    completedAt: run.completedAt ? new Date(run.completedAt) : null,
    failureSummary: run.failureSummary
      ? JSON.parse(JSON.stringify(run.failureSummary))
      : null,
  }
}

function cloneVariant(variant: InMemoryCatalogVariant): InMemoryCatalogVariant {
  return { ...variant }
}

function cloneSignature(
  signature: StoredMediaSignatureInput,
): StoredMediaSignatureInput {
  return {
    ...signature,
    signature: JSON.parse(JSON.stringify(signature.signature)) as Record<
      string,
      unknown
    >,
  }
}
