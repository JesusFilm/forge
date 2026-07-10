import {
  jaccardScore,
  retrievalSignalKey,
  type RetrievalSignal,
  type TimecodedStringSignature,
} from "./types.js"

export type TextRetrievalInput = {
  uploadTranscriptText: string
  officialTextSignatures: TimecodedStringSignature[]
  minimumScore?: number
}

export function retrieveTextCandidates({
  uploadTranscriptText,
  officialTextSignatures,
  minimumScore = 0.05,
}: TextRetrievalInput): RetrievalSignal[] {
  const uploadTokens = tokenize(uploadTranscriptText)
  const byVariant = new Map<string, TimecodedStringSignature[]>()

  for (const signature of officialTextSignatures) {
    const key = retrievalSignalKey(signature)
    const existing = byVariant.get(key) ?? []
    existing.push(signature)
    byVariant.set(key, existing)
  }

  return Array.from(byVariant.values())
    .map((signatures) => {
      const first = signatures[0]
      const score = jaccardScore(
        uploadTokens,
        signatures.flatMap((signature) => tokenize(signature.value)),
      )

      return {
        coreId: first.coreId,
        videoVariantId: first.videoVariantId,
        textScore: score,
      }
    })
    .filter((candidate) => candidate.textScore >= minimumScore)
    .sort((left, right) => right.textScore - left.textScore)
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
}
