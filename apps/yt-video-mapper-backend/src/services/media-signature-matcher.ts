import {
  SignatureType as PrismaSignatureType,
  type PrismaClient,
} from "../generated/prisma/index.js"
import type { PublicMatchCandidate } from "../domain/match.js"
import { fuseRankedCandidates } from "./fusion-scorer.js"
import {
  OFFICIAL_MEDIA_SIGNATURE_ALGORITHM_VERSION,
  type MediaSignatureType,
} from "./media-signature-extraction.js"
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

export type MatchableCatalogVariant = {
  durationSeconds: number | null
  lengthInMilliseconds: bigint | null
  languageSlug: string | null
  locale: string | null
}

export type MatchableMediaSignature = {
  coreId: string
  videoVariantId: string
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
    const signatures = await this.repository.listSignatures({
      algorithmVersion:
        this.options.algorithmVersion ??
        signals.algorithmVersion ??
        OFFICIAL_MEDIA_SIGNATURE_ALGORITHM_VERSION,
    })

    const visualSignals = retrieveSourceAnchorSignals(signals, signatures)
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
      { limit },
    )
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
}

export class InMemoryMediaSignatureMatchRepository implements MediaSignatureMatchRepository {
  constructor(private readonly signatures: MatchableMediaSignature[] = []) {}

  async listSignatures(): Promise<MatchableMediaSignature[]> {
    return this.signatures.map((signature) => ({ ...signature }))
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
): RetrievalSignal[] {
  const uploadHashes = uniqueStrings([
    ...(uploadSignals.sampledByteHashes ?? []),
    ...uploadSignals.visualHashes,
  ])
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
