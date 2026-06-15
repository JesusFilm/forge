import {
  jaccardScore,
  retrievalSignalKey,
  type RetrievalSignal,
  type TimecodedStringSignature,
} from "./types.js"

export type VisualRetrievalInput = {
  uploadFrameHashes: string[]
  officialFrameSignatures: TimecodedStringSignature[]
  minimumScore?: number
}

export function retrieveVisualCandidates({
  uploadFrameHashes,
  officialFrameSignatures,
  minimumScore = 0.05,
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
      const score = jaccardScore(
        uploadFrameHashes,
        signatures.map((signature) => signature.value),
      )

      return {
        coreId: first.coreId,
        videoVariantId: first.videoVariantId,
        visualScore: score,
      }
    })
    .filter((candidate) => candidate.visualScore >= minimumScore)
    .sort((left, right) => right.visualScore - left.visualScore)
}
