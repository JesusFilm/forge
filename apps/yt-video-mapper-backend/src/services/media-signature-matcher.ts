import {
  Prisma,
  SignatureType as PrismaSignatureType,
  type PrismaClient,
} from "../generated/prisma/index.js"
import type { PublicMatchCandidate } from "../domain/match.js"
import { fuseRankedCandidates } from "./fusion-scorer.js"
import {
  OFFICIAL_MEDIA_SIGNATURE_ALGORITHM_VERSION,
  type MediaSignatureType,
} from "./media-signature-extraction.js"
import {
  isVisualFingerprintHash,
  isVisualMediaSignatureAlgorithmVersion,
  visualFingerprintSimilarity,
} from "./visual-fingerprint.js"
import type { Matcher } from "./match-job.service.js"
import { retrieveAudioCandidates } from "./retrieval/audio-retriever.js"
import { retrieveTextCandidates } from "./retrieval/text-retriever.js"
import {
  retrievalSignalKey,
  type RetrievalSignal,
  type TimecodedStringSignature,
} from "./retrieval/types.js"
import { retrieveVisualCandidates } from "./retrieval/visual-retriever.js"
import type { UploadSignals } from "./upload-signal-extraction.js"

const MINIMUM_DURATION_SCORE = 0.85
const VARIANT_EVIDENCE_FALLBACK_THRESHOLD = 0.65
const VISUAL_HASH_BAND_HEX_LENGTH = 2

export type MatchableCatalogVariant = {
  durationSeconds: number | null
  lengthInMilliseconds: bigint | null
  languageSlug: string | null
  locale: string | null
}

export type MatchableMediaSignature = {
  coreId: string
  videoVariantId: string
  algorithmVersion?: string
  signatureType: MediaSignatureType
  offsetMilliseconds: number
  durationMilliseconds: number | null
  signature: unknown
  catalogVariant: MatchableCatalogVariant
}

export type MediaSignatureMatchRepository = {
  listSignatures(input: {
    algorithmVersion: string
  }): Promise<MatchableMediaSignature[]>
  listVisualCandidateSignatures?(input: {
    algorithmVersion: string
    uploadVisualHashes: string[]
    limit: number
  }): Promise<MatchableMediaSignature[]>
}

export type MediaSignatureMatcherOptions = {
  algorithmVersion?: string
}

export class MediaSignatureMatcher implements Matcher {
  constructor(
    private readonly repository: MediaSignatureMatchRepository,
    private readonly options: MediaSignatureMatcherOptions = {},
  ) {}

  async match(
    signals: UploadSignals,
    { limit }: { limit: number },
  ): Promise<PublicMatchCandidate[]> {
    const algorithmVersion =
      this.options.algorithmVersion ??
      signals.algorithmVersion ??
      OFFICIAL_MEDIA_SIGNATURE_ALGORITHM_VERSION
    if (
      isVisualMediaSignatureAlgorithmVersion(algorithmVersion) &&
      !hasVisualSourceEvidence(signals)
    ) {
      return []
    }

    const signatures = await this.listSignaturesForMatch({
      algorithmVersion,
      signals,
      limit,
    })

    const visualSignals = retrieveSourceAnchorSignals(
      signals,
      signatures,
      algorithmVersion,
    )
    const audioSignals = retrieveAudioSignals(signals, signatures)
    const textSignals = retrieveTextSignals(signals, signatures)
    const durationSignals = retrieveDurationSignals(signals, signatures)
    const anchoredVariantSignals = applySourceAnchors(visualSignals, [
      ...audioSignals,
      ...textSignals,
    ])
    const fallbackVisualSignals = sourceAnchorFallbackSignals(
      visualSignals,
      anchoredVariantSignals,
    )

    return fuseRankedCandidates(
      [...fallbackVisualSignals, ...anchoredVariantSignals, ...durationSignals],
      {
        limit,
        capVisualOnlyVariantConfidence:
          isVisualMediaSignatureAlgorithmVersion(algorithmVersion),
      },
    )
  }

  private async listSignaturesForMatch({
    algorithmVersion,
    signals,
    limit,
  }: {
    algorithmVersion: string
    signals: UploadSignals
    limit: number
  }): Promise<MatchableMediaSignature[]> {
    const uploadVisualHashes = sourceAnchorUploadHashes(
      signals,
      algorithmVersion,
    )
    if (isVisualMediaSignatureAlgorithmVersion(algorithmVersion)) {
      if (uploadVisualHashes.length === 0) return []
      if (this.repository.listVisualCandidateSignatures) {
        return await this.repository.listVisualCandidateSignatures({
          algorithmVersion,
          uploadVisualHashes,
          limit: Math.max(50, limit * 50),
        })
      }
      return []
    }

    return await this.repository.listSignatures({ algorithmVersion })
  }
}

export class PrismaMediaSignatureMatchRepository implements MediaSignatureMatchRepository {
  constructor(private readonly db: PrismaClient) {}

  async listSignatures({
    algorithmVersion,
  }: {
    algorithmVersion: string
  }): Promise<MatchableMediaSignature[]> {
    const signatures = await this.db.mediaSignature.findMany({
      where: {
        algorithmVersion,
        catalogVariant: {
          is: {
            indexable: true,
            deletedAt: null,
          },
        },
      },
      select: {
        coreId: true,
        videoVariantId: true,
        signatureType: true,
        offsetMilliseconds: true,
        durationMilliseconds: true,
        signature: true,
        catalogVariant: {
          select: {
            durationSeconds: true,
            lengthInMilliseconds: true,
            languageSlug: true,
            locale: true,
          },
        },
      },
    })

    return signatures.map((signature) => ({
      coreId: signature.coreId,
      videoVariantId: signature.videoVariantId,
      signatureType: fromPrismaSignatureType(signature.signatureType),
      offsetMilliseconds: signature.offsetMilliseconds,
      durationMilliseconds: signature.durationMilliseconds,
      signature: signature.signature,
      catalogVariant: signature.catalogVariant,
    }))
  }

  async listVisualCandidateSignatures({
    algorithmVersion,
    uploadVisualHashes,
    limit,
  }: {
    algorithmVersion: string
    uploadVisualHashes: string[]
    limit: number
  }): Promise<MatchableMediaSignature[]> {
    const bandConditions = visualHashBandConditions(uploadVisualHashes)
    const bandScoreTerms = visualHashBandScoreTerms(uploadVisualHashes)
    if (bandConditions.length === 0) return []

    const scanLimit = Math.max(limit, limit * 20)
    const rows = await this.db.$queryRaw<RawVisualCandidateSignature[]>(
      Prisma.sql`
        SELECT
          ms.core_id AS "coreId",
          ms.video_variant_id AS "videoVariantId",
          ms.signature_type::text AS "signatureType",
          ms.offset_milliseconds AS "offsetMilliseconds",
          ms.duration_milliseconds AS "durationMilliseconds",
          ms.signature AS "signature",
          cv.duration_seconds AS "durationSeconds",
          cv.length_in_milliseconds AS "lengthInMilliseconds",
          cv.language_slug AS "languageSlug",
          cv.locale AS "locale"
        FROM mapper_media_signature ms
        INNER JOIN mapper_catalog_variant cv
          ON cv.core_id = ms.core_id
         AND cv.video_variant_id = ms.video_variant_id
        WHERE ms.algorithm_version = ${algorithmVersion}
          AND ms.signature_type = 'visual_frame'::signature_type
          AND cv.indexable = true
          AND cv.deleted_at IS NULL
          AND ms.signature->>'phash' IS NOT NULL
          AND (${Prisma.join(bandConditions, " OR ")})
        ORDER BY
          (${Prisma.join(bandScoreTerms, " + ")}) DESC,
          ms.core_id ASC,
          ms.video_variant_id ASC,
          ms.offset_milliseconds ASC
        LIMIT ${scanLimit}
      `,
    )

    return rankVisualCandidateSignatures(
      rows.map(fromRawVisualCandidateSignature),
      uploadVisualHashes,
      limit,
    )
  }
}

export class InMemoryMediaSignatureMatchRepository implements MediaSignatureMatchRepository {
  constructor(private readonly signatures: MatchableMediaSignature[] = []) {}

  async listSignatures({
    algorithmVersion,
  }: {
    algorithmVersion: string
  }): Promise<MatchableMediaSignature[]> {
    return this.signatures
      .filter((signature) =>
        signatureMatchesAlgorithm(signature, algorithmVersion),
      )
      .map(cloneMatchableSignature)
  }

  async listVisualCandidateSignatures({
    algorithmVersion,
    uploadVisualHashes,
    limit,
  }: {
    algorithmVersion: string
    uploadVisualHashes: string[]
    limit: number
  }): Promise<MatchableMediaSignature[]> {
    return rankVisualCandidateSignatures(
      this.signatures.filter(
        (signature) =>
          signature.signatureType === "VISUAL_FRAME" &&
          signatureMatchesAlgorithm(signature, algorithmVersion),
      ),
      uploadVisualHashes,
      limit,
    )
  }
}

function sourceAnchorFallbackSignals(
  sourceSignals: RetrievalSignal[],
  anchoredVariantSignals: RetrievalSignal[],
): RetrievalSignal[] {
  const coreIdsWithVariantEvidence = new Set(
    anchoredVariantSignals
      .filter(
        (signal) =>
          signal.visualScore !== undefined &&
          ((signal.audioScore ?? 0) >= VARIANT_EVIDENCE_FALLBACK_THRESHOLD ||
            (signal.textScore ?? 0) >= VARIANT_EVIDENCE_FALLBACK_THRESHOLD),
      )
      .map((signal) => signal.coreId),
  )

  return sourceSignals.filter(
    (signal) => !coreIdsWithVariantEvidence.has(signal.coreId),
  )
}

function retrieveSourceAnchorSignals(
  uploadSignals: UploadSignals,
  officialSignatures: MatchableMediaSignature[],
  algorithmVersion: string,
): RetrievalSignal[] {
  const uploadHashes = sourceAnchorUploadHashes(uploadSignals, algorithmVersion)
  if (uploadHashes.length === 0) return []

  const officialSourceAnchors = officialSignatures.flatMap((signature) =>
    sourceAnchorSignature(signature),
  )
  if (officialSourceAnchors.length === 0) return []

  return retrieveVisualCandidates({
    uploadFrameHashes: uploadHashes,
    officialFrameSignatures: officialSourceAnchors,
  })
}

function retrieveAudioSignals(
  uploadSignals: UploadSignals,
  officialSignatures: MatchableMediaSignature[],
): RetrievalSignal[] {
  if (uploadSignals.audioFingerprints.length === 0) return []

  const officialAudioSignatures = officialSignatures.flatMap((signature) =>
    timecodedStringSignature(signature, audioSignatureValue),
  )
  if (officialAudioSignatures.length === 0) return []

  return retrieveAudioCandidates({
    uploadAudioFingerprints: uploadSignals.audioFingerprints,
    officialAudioSignatures,
  })
}

function retrieveTextSignals(
  uploadSignals: UploadSignals,
  officialSignatures: MatchableMediaSignature[],
): RetrievalSignal[] {
  if (!uploadSignals.transcriptText) return []

  const officialTextSignatures = officialSignatures.flatMap((signature) =>
    timecodedStringSignature(signature, textSignatureValue),
  )
  if (officialTextSignatures.length === 0) return []

  return retrieveTextCandidates({
    uploadTranscriptText: uploadSignals.transcriptText,
    officialTextSignatures,
  })
}

function retrieveDurationSignals(
  uploadSignals: UploadSignals,
  officialSignatures: MatchableMediaSignature[],
): RetrievalSignal[] {
  if (!uploadSignals.durationMilliseconds) return []

  const byVariant = new Map<string, RetrievalSignal>()
  for (const signature of officialSignatures) {
    const officialDuration = officialDurationMilliseconds(signature)
    if (!officialDuration) continue

    const score = durationScore(
      uploadSignals.durationMilliseconds,
      officialDuration,
    )
    if (score < MINIMUM_DURATION_SCORE) continue

    const signal = {
      coreId: signature.coreId,
      videoVariantId: signature.videoVariantId,
      durationScore: score,
    }
    const key = retrievalSignalKey(signal)
    const existing = byVariant.get(key)
    if (!existing || (existing.durationScore ?? 0) < score) {
      byVariant.set(key, signal)
    }
  }

  return [...byVariant.values()].sort(
    (left, right) => (right.durationScore ?? 0) - (left.durationScore ?? 0),
  )
}

function applySourceAnchors(
  sourceSignals: RetrievalSignal[],
  variantSignals: RetrievalSignal[],
): RetrievalSignal[] {
  const sourceAnchorByCoreId = new Map<string, number>()
  for (const signal of sourceSignals) {
    const score = signal.visualScore ?? 0
    const existing = sourceAnchorByCoreId.get(signal.coreId) ?? 0
    sourceAnchorByCoreId.set(signal.coreId, Math.max(score, existing))
  }

  return variantSignals.map((signal) => {
    const sourceAnchor = sourceAnchorByCoreId.get(signal.coreId)
    return sourceAnchor === undefined
      ? signal
      : { ...signal, visualScore: sourceAnchor }
  })
}

function sourceAnchorSignature(
  signature: MatchableMediaSignature,
): TimecodedStringSignature[] {
  if (
    signature.signatureType !== "STRUCTURAL_HINT" &&
    signature.signatureType !== "VISUAL_FRAME"
  ) {
    return []
  }

  return timecodedStringSignature(signature, sourceAnchorSignatureValue)
}

function timecodedStringSignature(
  signature: MatchableMediaSignature,
  valueExtractor: (signature: MatchableMediaSignature) => string | undefined,
): TimecodedStringSignature[] {
  const value = valueExtractor(signature)
  if (!value) return []

  return [
    {
      coreId: signature.coreId,
      videoVariantId: signature.videoVariantId,
      offsetMilliseconds: signature.offsetMilliseconds,
      value,
    },
  ]
}

function sourceAnchorSignatureValue(
  signature: MatchableMediaSignature,
): string | undefined {
  const payload = asRecord(signature.signature)
  if (!payload) return undefined

  const byteSample = asRecord(payload.byteSample)
  return (
    stringField(payload, "phash") ??
    stringField(byteSample, "sha256") ??
    stringField(payload, "sha256") ??
    stringField(payload, "hash") ??
    stringField(payload, "value")
  )
}

function audioSignatureValue(
  signature: MatchableMediaSignature,
): string | undefined {
  if (signature.signatureType !== "AUDIO_FINGERPRINT") return undefined

  const payload = asRecord(signature.signature)
  return (
    stringField(payload, "fingerprint") ??
    stringField(payload, "hash") ??
    stringField(payload, "value")
  )
}

function textSignatureValue(
  signature: MatchableMediaSignature,
): string | undefined {
  if (signature.signatureType !== "TEXT_SEGMENT") return undefined

  const payload = asRecord(signature.signature)
  return stringField(payload, "text") ?? stringField(payload, "value")
}

function officialDurationMilliseconds(
  signature: MatchableMediaSignature,
): number | undefined {
  if (signature.durationMilliseconds != null) {
    return signature.durationMilliseconds
  }

  const lengthInMilliseconds = signature.catalogVariant.lengthInMilliseconds
  if (lengthInMilliseconds != null) {
    const asNumber = Number(lengthInMilliseconds)
    if (Number.isSafeInteger(asNumber) && asNumber > 0) return asNumber
  }

  const durationSeconds = signature.catalogVariant.durationSeconds
  return durationSeconds != null && durationSeconds > 0
    ? durationSeconds * 1_000
    : undefined
}

function durationScore(
  uploadDurationMilliseconds: number,
  officialDurationMilliseconds: number,
): number {
  const difference = Math.abs(
    uploadDurationMilliseconds - officialDurationMilliseconds,
  )
  if (difference <= 1_000) return 1

  const longest = Math.max(
    uploadDurationMilliseconds,
    officialDurationMilliseconds,
  )
  if (longest <= 0) return 0

  return Math.max(0, 1 - difference / longest)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringField(
  record: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const value = record?.[field]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

function sourceAnchorUploadHashes(
  uploadSignals: UploadSignals,
  algorithmVersion: string,
): string[] {
  if (isVisualMediaSignatureAlgorithmVersion(algorithmVersion)) {
    return uniqueStrings(uploadSignals.visualHashes)
  }

  return uniqueStrings([
    ...(uploadSignals.sampledByteHashes ?? []),
    ...uploadSignals.visualHashes,
  ])
}

function hasVisualSourceEvidence(uploadSignals: UploadSignals): boolean {
  return uploadSignals.visualHashes.some(isVisualFingerprintHash)
}

function rankVisualCandidateSignatures(
  signatures: MatchableMediaSignature[],
  uploadVisualHashes: string[],
  limit: number,
): MatchableMediaSignature[] {
  const uploadHashes = uploadVisualHashes.filter(isVisualFingerprintHash)
  if (uploadHashes.length === 0) return []

  return signatures
    .map((signature) => ({
      signature,
      score: visualCandidateScore(signature, uploadHashes),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.signature.coreId.localeCompare(right.signature.coreId) ||
        left.signature.videoVariantId.localeCompare(
          right.signature.videoVariantId,
        ),
    )
    .slice(0, limit)
    .map((candidate) => cloneMatchableSignature(candidate.signature))
}

function visualCandidateScore(
  signature: MatchableMediaSignature,
  uploadVisualHashes: string[],
): number {
  const value = sourceAnchorSignatureValue(signature)
  if (!value || !isVisualFingerprintHash(value)) return 0

  return Math.max(
    ...uploadVisualHashes.map((uploadHash) =>
      visualFingerprintSimilarity(uploadHash, value),
    ),
  )
}

function visualHashBandConditions(uploadVisualHashes: string[]): Prisma.Sql[] {
  return visualHashBandsByIndex(uploadVisualHashes).flatMap((values, index) => {
    if (values.size === 0) return []
    const start = index * VISUAL_HASH_BAND_HEX_LENGTH + 1
    const startLiteral = Prisma.raw(String(start))
    const lengthLiteral = Prisma.raw(String(VISUAL_HASH_BAND_HEX_LENGTH))
    return [
      Prisma.sql`substring(ms.signature->>'phash' from ${startLiteral} for ${lengthLiteral}) IN (${Prisma.join([...values])})`,
    ]
  })
}

function visualHashBandScoreTerms(uploadVisualHashes: string[]): Prisma.Sql[] {
  return visualHashBandsByIndex(uploadVisualHashes).flatMap((values, index) => {
    if (values.size === 0) return []
    const start = index * VISUAL_HASH_BAND_HEX_LENGTH + 1
    const startLiteral = Prisma.raw(String(start))
    const lengthLiteral = Prisma.raw(String(VISUAL_HASH_BAND_HEX_LENGTH))
    return [
      Prisma.sql`CASE WHEN substring(ms.signature->>'phash' from ${startLiteral} for ${lengthLiteral}) IN (${Prisma.join([...values])}) THEN 1 ELSE 0 END`,
    ]
  })
}

function visualHashBandsByIndex(uploadVisualHashes: string[]): Set<string>[] {
  const bandCount = 16 / VISUAL_HASH_BAND_HEX_LENGTH
  const bandValuesByIndex = Array.from(
    { length: bandCount },
    () => new Set<string>(),
  )

  for (const hash of uploadVisualHashes) {
    if (!isVisualFingerprintHash(hash)) continue
    const normalized = hash.toLowerCase()
    for (let index = 0; index < bandCount; index += 1) {
      const start = index * VISUAL_HASH_BAND_HEX_LENGTH
      bandValuesByIndex[index]?.add(
        normalized.slice(start, start + VISUAL_HASH_BAND_HEX_LENGTH),
      )
    }
  }

  return bandValuesByIndex
}

function signatureMatchesAlgorithm(
  signature: MatchableMediaSignature,
  algorithmVersion: string,
): boolean {
  return (
    signature.algorithmVersion === undefined ||
    signature.algorithmVersion === algorithmVersion
  )
}

function cloneMatchableSignature(
  signature: MatchableMediaSignature,
): MatchableMediaSignature {
  return {
    ...signature,
    catalogVariant: { ...signature.catalogVariant },
  }
}

type RawVisualCandidateSignature = {
  coreId: string
  videoVariantId: string
  signatureType: string
  offsetMilliseconds: number
  durationMilliseconds: number | null
  signature: unknown
  durationSeconds: number | null
  lengthInMilliseconds: bigint | null
  languageSlug: string | null
  locale: string | null
}

function fromRawVisualCandidateSignature(
  row: RawVisualCandidateSignature,
): MatchableMediaSignature {
  return {
    coreId: row.coreId,
    videoVariantId: row.videoVariantId,
    signatureType: fromDatabaseSignatureType(row.signatureType),
    offsetMilliseconds: row.offsetMilliseconds,
    durationMilliseconds: row.durationMilliseconds,
    signature: row.signature,
    catalogVariant: {
      durationSeconds: row.durationSeconds,
      lengthInMilliseconds: row.lengthInMilliseconds,
      languageSlug: row.languageSlug,
      locale: row.locale,
    },
  }
}

function fromDatabaseSignatureType(signatureType: string): MediaSignatureType {
  const map = {
    visual_frame: "VISUAL_FRAME",
    audio_fingerprint: "AUDIO_FINGERPRINT",
    text_segment: "TEXT_SEGMENT",
    structural_hint: "STRUCTURAL_HINT",
  } satisfies Record<string, MediaSignatureType>

  return (
    map[signatureType as keyof typeof map] ??
    (signatureType as MediaSignatureType)
  )
}

function fromPrismaSignatureType(
  signatureType: PrismaSignatureType,
): MediaSignatureType {
  const map = {
    [PrismaSignatureType.VISUAL_FRAME]: "VISUAL_FRAME",
    [PrismaSignatureType.AUDIO_FINGERPRINT]: "AUDIO_FINGERPRINT",
    [PrismaSignatureType.TEXT_SEGMENT]: "TEXT_SEGMENT",
    [PrismaSignatureType.STRUCTURAL_HINT]: "STRUCTURAL_HINT",
  } satisfies Record<PrismaSignatureType, MediaSignatureType>

  return map[signatureType]
}
