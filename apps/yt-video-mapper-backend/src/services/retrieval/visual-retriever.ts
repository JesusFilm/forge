import {
  jaccardScore,
  retrievalSignalKey,
  type RetrievalSignal,
  type TimecodedStringSignature,
} from "./types.js"
import {
  isVisualFingerprintHash,
  visualFingerprintSimilarity,
} from "../visual-fingerprint.js"

export type VisualRetrievalInput = {
  uploadFrameHashes: string[]
  officialFrameSignatures: TimecodedStringSignature[]
  minimumScore?: number
}

export function retrieveVisualCandidates({
  uploadFrameHashes,
  officialFrameSignatures,
  minimumScore,
}: VisualRetrievalInput): RetrievalSignal[] {
  const byVariant = new Map<string, TimecodedStringSignature[]>()

  for (const signature of officialFrameSignatures) {
    const key = retrievalSignalKey(signature)
    const existing = byVariant.get(key) ?? []
    existing.push(signature)
    byVariant.set(key, existing)
  }

  return Array.from(byVariant.values())
    .map((signatures) => {
      const first = signatures[0]
      const score = visualScore(
        uploadFrameHashes,
        signatures.map((signature) => signature.value),
      )

      return {
        coreId: first.coreId,
        videoVariantId: first.videoVariantId,
        visualScore: score,
      }
    })
    .filter(
      (candidate) =>
        candidate.visualScore >=
        (minimumScore ?? defaultMinimumScore(uploadFrameHashes)),
    )
    .sort((left, right) => right.visualScore - left.visualScore)
}

function visualScore(uploadHashes: string[], officialHashes: string[]): number {
  const uploadVisualHashes = uploadHashes.filter(isVisualFingerprintHash)
  const officialVisualHashes = officialHashes.filter(isVisualFingerprintHash)

  if (uploadVisualHashes.length > 0 && officialVisualHashes.length > 0) {
    const total = uploadVisualHashes.reduce(
      (sum, uploadHash) =>
        sum +
        Math.max(
          ...officialVisualHashes.map((officialHash) =>
            visualFingerprintSimilarity(uploadHash, officialHash),
          ),
        ),
      0,
    )

    return total / uploadVisualHashes.length
  }

  return jaccardScore(uploadHashes, officialHashes)
}

function defaultMinimumScore(uploadHashes: string[]): number {
  return uploadHashes.some(isVisualFingerprintHash) ? 0.75 : 0.05
}
