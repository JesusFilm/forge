export function buildSourceReferenceDigestVector(input: {
  corpusCells: ReadonlyArray<{
    id: string
    caseId: string
    targetLanguageId: string
    targetLanguageSlug: string
    sourceTrackIdentity: string
    referenceTrackIdentity: string
    sourceSnapshotDigest: string
    sourceSnapshotRawDigest: string
    sourceSnapshotClippedDigest: string | null
    referenceSnapshotDigest: string
    referenceSnapshotRawDigest: string
    referenceSnapshotClippedDigest: string | null
  }>
  runCells: ReadonlyArray<{
    caseId: string
    targetLanguageId: string
    targetLanguageSlug: string
  }>
}) {
  const selected = new Set(
    input.runCells.map(
      (cell) =>
        `${cell.caseId}\u0000${cell.targetLanguageId}\u0000${cell.targetLanguageSlug}`,
    ),
  )
  return input.corpusCells
    .filter((cell) =>
      selected.has(
        `${cell.caseId}\u0000${cell.targetLanguageId}\u0000${cell.targetLanguageSlug}`,
      ),
    )
    .map((cell) => ({
      caseId: cell.caseId,
      targetLanguageId: cell.targetLanguageId,
      targetLanguageSlug: cell.targetLanguageSlug,
      sourceTrackIdentity: cell.sourceTrackIdentity,
      referenceTrackIdentity: cell.referenceTrackIdentity,
      sourceSnapshot: {
        sha256: cell.sourceSnapshotDigest,
        rawSha256: cell.sourceSnapshotRawDigest,
        clippedSha256: cell.sourceSnapshotClippedDigest,
      },
      referenceSnapshot: {
        sha256: cell.referenceSnapshotDigest,
        rawSha256: cell.referenceSnapshotRawDigest,
        clippedSha256: cell.referenceSnapshotClippedDigest,
      },
    }))
    .sort((left, right) =>
      `${left.caseId}:${left.targetLanguageId}`.localeCompare(
        `${right.caseId}:${right.targetLanguageId}`,
      ),
    )
}
