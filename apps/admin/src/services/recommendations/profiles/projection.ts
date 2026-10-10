export const PROFILE_PROJECTION_VERSION =
  "multi-interest-profile-projection-v1" as const
export const PROFILE_CLUSTERING_VERSION =
  "deterministic-farthest-first-medoids-v1" as const
export const PROFILE_INTEREST_CLUSTER_LIMIT = 4
export const PROFILE_PROJECTION_CONTRIBUTION_LIMIT = 64
export const PROFILE_CLUSTER_SEPARATION_FLOOR = 0.35

export type ProfileEmbeddingEvidence = Readonly<{
  sourceId: string
  targetMediaId: string
  embedding: readonly number[]
  weight: number
  occurredAt: Date
}>

export type ProfileDeclaredSignal = Readonly<{
  key: string
  weight: number
}>

export type ProfileInterestProjection = Readonly<{
  ordinal: number
  medoidMediaId: string
  medoidSourceId: string
  vector: number[]
  weight: number
  supportCount: number
  stability: number
  sourceIds: string[]
}>

export type MultiInterestProjection = Readonly<{
  durableInterests: ProfileInterestProjection[]
  sessionIntent: ProfileInterestProjection | null
  explicitPreferences: ProfileDeclaredSignal[]
  negativeEvidence: ProfileDeclaredSignal[]
  contributionCount: number
  cohortQuality: number
}>

/**
 * Deterministic robust profile derivation.
 *
 * Durable evidence is clustered around observed medoids, never collapsed into
 * one averaged viewer vector. Session selections are derived independently and
 * cannot rewrite the durable clusters. The implementation is intentionally
 * dimension-agnostic for focused tests; publication enforces 1536 dimensions.
 */
export function buildMultiInterestProjection(input: {
  durableEvidence: readonly ProfileEmbeddingEvidence[]
  sessionSelections: readonly ProfileEmbeddingEvidence[]
  explicitPreferences: readonly ProfileDeclaredSignal[]
  negativeEvidence: readonly ProfileDeclaredSignal[]
}): MultiInterestProjection {
  const durableEvidence = sanitizeEvidence(input.durableEvidence)
  const sessionSelections = sanitizeEvidence(input.sessionSelections)
  const durableInterests = clusterMedoids(durableEvidence)
  const sessionCluster = clusterMedoids(sessionSelections, 1)[0] ?? null
  const contributionCount = Math.min(
    PROFILE_PROJECTION_CONTRIBUTION_LIMIT,
    durableEvidence.length + sessionSelections.length,
  )
  const supportedDurable = durableInterests.filter(
    (interest) => interest.supportCount > 0,
  ).length
  const cohortQuality = boundedRate(
    supportedDurable === 0
      ? sessionCluster == null
        ? 0
        : 0.5
      : supportedDurable / Math.max(1, durableInterests.length),
  )

  return {
    durableInterests,
    sessionIntent: sessionCluster,
    explicitPreferences: sanitizeDeclaredSignals(input.explicitPreferences),
    negativeEvidence: sanitizeDeclaredSignals(input.negativeEvidence),
    contributionCount,
    cohortQuality,
  }
}

function clusterMedoids(
  evidence: readonly ProfileEmbeddingEvidence[],
  limit = PROFILE_INTEREST_CLUSTER_LIMIT,
): ProfileInterestProjection[] {
  if (evidence.length === 0) return []
  const medoids: ProfileEmbeddingEvidence[] = [
    [...evidence].sort(compareEvidencePriority)[0]!,
  ]
  while (medoids.length < Math.min(limit, evidence.length)) {
    const candidate = [...evidence]
      .filter(
        (row) => !medoids.some((medoid) => medoid.sourceId === row.sourceId),
      )
      .map((row) => ({
        row,
        distance: Math.min(
          ...medoids.map((medoid) =>
            cosineDistance(row.embedding, medoid.embedding),
          ),
        ),
      }))
      .sort(
        (left, right) =>
          right.distance - left.distance ||
          compareEvidencePriority(left.row, right.row),
      )[0]
    if (!candidate || candidate.distance < PROFILE_CLUSTER_SEPARATION_FLOOR) {
      break
    }
    medoids.push(candidate.row)
  }

  const members = medoids.map(() => [] as ProfileEmbeddingEvidence[])
  for (const row of evidence) {
    let selected = 0
    let selectedDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < medoids.length; index += 1) {
      const distance = cosineDistance(row.embedding, medoids[index]!.embedding)
      if (
        distance < selectedDistance ||
        (distance === selectedDistance &&
          medoids[index]!.targetMediaId < medoids[selected]!.targetMediaId)
      ) {
        selected = index
        selectedDistance = distance
      }
    }
    members[selected]!.push(row)
  }

  return members
    .filter((cluster) => cluster.length > 0)
    .map((cluster) => {
      const medoid = chooseMedoid(cluster)
      const averageDistance =
        cluster.reduce(
          (sum, row) => sum + cosineDistance(row.embedding, medoid.embedding),
          0,
        ) / cluster.length
      return {
        ordinal: 0,
        medoidMediaId: medoid.targetMediaId,
        medoidSourceId: medoid.sourceId,
        vector: [...medoid.embedding],
        weight: boundedRate(
          cluster.reduce((sum, row) => sum + row.weight, 0) / cluster.length,
        ),
        supportCount: cluster.length,
        stability: boundedRate(1 - averageDistance),
        sourceIds: cluster.map((row) => row.sourceId).sort(),
      }
    })
    .sort(
      (left, right) =>
        left.medoidMediaId.localeCompare(right.medoidMediaId) ||
        left.medoidSourceId.localeCompare(right.medoidSourceId),
    )
    .map((interest, ordinal) => ({ ...interest, ordinal }))
}

function chooseMedoid(
  cluster: readonly ProfileEmbeddingEvidence[],
): ProfileEmbeddingEvidence {
  return [...cluster]
    .map((candidate) => ({
      candidate,
      cost: cluster.reduce(
        (sum, row) =>
          sum + cosineDistance(candidate.embedding, row.embedding) * row.weight,
        0,
      ),
    }))
    .sort(
      (left, right) =>
        left.cost - right.cost ||
        compareEvidencePriority(left.candidate, right.candidate),
    )[0]!.candidate
}

function sanitizeEvidence(
  input: readonly ProfileEmbeddingEvidence[],
): ProfileEmbeddingEvidence[] {
  const dimension = input.find((row) => row.embedding.length > 0)?.embedding
    .length
  if (!dimension) return []
  const bySource = new Map<string, ProfileEmbeddingEvidence>()
  for (const row of [...input].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId),
  )) {
    if (
      bySource.size >= PROFILE_PROJECTION_CONTRIBUTION_LIMIT ||
      !row.sourceId ||
      !row.targetMediaId ||
      row.embedding.length !== dimension ||
      row.embedding.some((entry) => !Number.isFinite(entry)) ||
      vectorMagnitude(row.embedding) === 0
    ) {
      continue
    }
    if (!bySource.has(row.sourceId)) {
      bySource.set(row.sourceId, {
        ...row,
        sourceId: row.sourceId.slice(0, 191),
        targetMediaId: row.targetMediaId.slice(0, 191),
        embedding: normalizeVector(row.embedding),
        weight: boundedRate(row.weight),
      })
    }
  }
  return [...bySource.values()]
}

function sanitizeDeclaredSignals(
  signals: readonly ProfileDeclaredSignal[],
): ProfileDeclaredSignal[] {
  return [...signals]
    .filter((signal) => signal.key.length > 0 && Number.isFinite(signal.weight))
    .sort((left, right) => left.key.localeCompare(right.key))
    .slice(0, 16)
    .map((signal) => ({
      key: signal.key.slice(0, 128),
      weight: Math.max(-1, Math.min(1, signal.weight)),
    }))
}

function compareEvidencePriority(
  left: ProfileEmbeddingEvidence,
  right: ProfileEmbeddingEvidence,
): number {
  return (
    right.weight - left.weight ||
    right.occurredAt.getTime() - left.occurredAt.getTime() ||
    left.targetMediaId.localeCompare(right.targetMediaId) ||
    left.sourceId.localeCompare(right.sourceId)
  )
}

function cosineDistance(
  left: readonly number[],
  right: readonly number[],
): number {
  let dot = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!
  }
  return Math.max(0, Math.min(2, 1 - dot))
}

function normalizeVector(vector: readonly number[]): number[] {
  const magnitude = vectorMagnitude(vector)
  return vector.map((entry) => entry / magnitude)
}

function vectorMagnitude(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0))
}

function boundedRate(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
