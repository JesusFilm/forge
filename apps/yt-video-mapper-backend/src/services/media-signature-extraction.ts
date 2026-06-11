import { createHash } from "node:crypto"

export const OFFICIAL_MEDIA_SIGNATURE_ALGORITHM_VERSION =
  "official-media-signature-v1"

export type MediaSignatureType =
  | "VISUAL_FRAME"
  | "AUDIO_FINGERPRINT"
  | "TEXT_SEGMENT"
  | "STRUCTURAL_HINT"

export type OfficialMediaSignatureVariant = {
  coreId: string
  videoVariantId: string
  mediaSourceType: "DOWNLOAD" | "HLS" | "DASH" | "NONE"
  durationSeconds: number | null
  lengthInMilliseconds: bigint | null
  downloadQuality: string | null
  downloadWidth: number | null
  downloadHeight: number | null
  languageSlug: string | null
  locale: string | null
  editionName: string | null
}

export type OfficialMediaSample = {
  bytes: Uint8Array
  contentType?: string
  sourceMediaHash?: string
  rangeStart?: number
  rangeEnd?: number
  complete?: boolean
}

export type OfficialTextSegment = {
  offsetMilliseconds: number
  durationMilliseconds?: number
  text: string
  languageSlug?: string | null
}

export type MediaSignatureDraft = {
  coreId: string
  videoVariantId: string
  signatureType: MediaSignatureType
  algorithmVersion: string
  offsetMilliseconds: number
  durationMilliseconds: number | null
  signature: Record<string, unknown>
  sourceMediaHash: string | null
}

export type OfficialMediaSignatureExtractionInput = {
  variant: OfficialMediaSignatureVariant
  mediaSample?: OfficialMediaSample
  textSegments?: OfficialTextSegment[]
  algorithmVersion?: string
}

export type OfficialMediaSignatureExtractor = {
  extract(
    input: OfficialMediaSignatureExtractionInput,
  ): Promise<MediaSignatureDraft[]>
}

export class DeterministicOfficialMediaSignatureExtractor implements OfficialMediaSignatureExtractor {
  async extract({
    variant,
    mediaSample,
    textSegments = [],
    algorithmVersion = OFFICIAL_MEDIA_SIGNATURE_ALGORITHM_VERSION,
  }: OfficialMediaSignatureExtractionInput): Promise<MediaSignatureDraft[]> {
    const signatures: MediaSignatureDraft[] = []
    const durationMilliseconds = durationFromVariant(variant)
    const structuralPayload = buildStructuralPayload({
      variant,
      mediaSample,
      durationMilliseconds,
    })

    if (Object.keys(structuralPayload).length > 1) {
      signatures.push({
        coreId: variant.coreId,
        videoVariantId: variant.videoVariantId,
        signatureType: "STRUCTURAL_HINT",
        algorithmVersion,
        offsetMilliseconds: 0,
        durationMilliseconds,
        signature: structuralPayload,
        sourceMediaHash: mediaSample?.sourceMediaHash ?? null,
      })
    }

    for (const segment of textSegments) {
      const normalizedText = normalizeText(segment.text)
      if (!normalizedText) continue

      signatures.push({
        coreId: variant.coreId,
        videoVariantId: variant.videoVariantId,
        signatureType: "TEXT_SEGMENT",
        algorithmVersion,
        offsetMilliseconds: segment.offsetMilliseconds,
        durationMilliseconds: segment.durationMilliseconds ?? null,
        signature: {
          kind: "text_segment_v1",
          text: normalizedText,
          tokenCount: tokenize(normalizedText).length,
          languageSlug: segment.languageSlug ?? variant.languageSlug,
        },
        sourceMediaHash: mediaSample?.sourceMediaHash ?? null,
      })
    }

    return signatures
  }
}

function buildStructuralPayload({
  variant,
  mediaSample,
  durationMilliseconds,
}: {
  variant: OfficialMediaSignatureVariant
  mediaSample?: OfficialMediaSample
  durationMilliseconds: number | null
}): Record<string, unknown> {
  return compactRecord({
    kind: "structural_hint_v1",
    durationMilliseconds,
    mediaSourceType: variant.mediaSourceType,
    downloadQuality: variant.downloadQuality,
    width: variant.downloadWidth,
    height: variant.downloadHeight,
    locale: variant.locale,
    languageSlug: variant.languageSlug,
    editionName: variant.editionName,
    byteSample: mediaSample ? byteSamplePayload(mediaSample) : null,
  })
}

function byteSamplePayload(mediaSample: OfficialMediaSample) {
  if (mediaSample.bytes.byteLength === 0) return null

  return compactRecord({
    byteLength: mediaSample.bytes.byteLength,
    sha256: sha256Hex(mediaSample.bytes),
    contentType: mediaSample.contentType,
    rangeStart: mediaSample.rangeStart,
    rangeEnd: mediaSample.rangeEnd,
    complete: mediaSample.complete,
  })
}

export function durationFromVariant(
  variant: Pick<
    OfficialMediaSignatureVariant,
    "lengthInMilliseconds" | "durationSeconds"
  >,
): number | null {
  if (variant.lengthInMilliseconds != null) {
    const asNumber = Number(variant.lengthInMilliseconds)
    if (Number.isSafeInteger(asNumber) && asNumber > 0) return asNumber
  }

  if (
    variant.durationSeconds != null &&
    Number.isInteger(variant.durationSeconds) &&
    variant.durationSeconds > 0
  ) {
    return variant.durationSeconds * 1_000
  }

  return null
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== null && entry !== undefined,
    ),
  )
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 1_000)
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
