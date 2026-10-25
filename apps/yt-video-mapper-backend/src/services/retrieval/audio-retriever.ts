import {
  jaccardScore,
  retrievalSignalKey,
  type RetrievalSignal,
  type TimecodedStringSignature,
} from "./types.js"

export type AudioRetrievalInput = {
  uploadAudioFingerprints: string[]
  officialAudioSignatures: TimecodedStringSignature[]
  minimumScore?: number
}

export function retrieveAudioCandidates({
  uploadAudioFingerprints,
  officialAudioSignatures,
  minimumScore = 0.05,
}: AudioRetrievalInput): RetrievalSignal[] {
  const byVariant = new Map<string, TimecodedStringSignature[]>()

  for (const signature of officialAudioSignatures) {
    const key = retrievalSignalKey(signature)
    const existing = byVariant.get(key) ?? []
    existing.push(signature)
    byVariant.set(key, existing)
  }

  return Array.from(byVariant.values())
    .map((signatures) => {
      const first = signatures[0]
      const score = jaccardScore(
        uploadAudioFingerprints,
        signatures.map((signature) => signature.value),
      )

      return {
        coreId: first.coreId,
        videoVariantId: first.videoVariantId,
        audioScore: score,
      }
    })
    .filter((candidate) => candidate.audioScore >= minimumScore)
    .sort((left, right) => right.audioScore - left.audioScore)
}
