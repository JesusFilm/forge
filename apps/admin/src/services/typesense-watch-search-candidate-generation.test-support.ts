import { vi } from "vitest"
import { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import { WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES } from "./typesense-watch-search-candidate-qualification"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "./typesense-watch-search-schema"

export { TYPESENSE_WATCH_LEXICAL_ALIAS } from "./typesense-watch-search-schema"

// The in-memory Prisma double intentionally accepts the delegates' heterogeneous shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>

function matchesGeneration(row: Row, where: Row): boolean {
  return (
    (!where.id || row.id === where.id) &&
    (!where.state ||
      row.state === where.state ||
      (where.state.in as string[] | undefined)?.includes(row.state)) &&
    (where.version === undefined || row.version === where.version) &&
    (!where.OR ||
      where.OR.some(
        (condition: Row) =>
          (condition.transcriptCollection?.not !== undefined &&
            row.transcriptCollection !== condition.transcriptCollection.not) ||
          (condition.transcriptProjectionRevision?.not !== undefined &&
            row.transcriptProjectionRevision !==
              condition.transcriptProjectionRevision.not),
      ))
  )
}

function applyData(row: Row, data: Row): Row {
  const next = { ...row }
  for (const [key, value] of Object.entries(data)) {
    next[key] =
      typeof value === "object" && value !== null && "increment" in value
        ? row[key] + value.increment
        : value
  }
  return next
}

function matchesEvidence(row: Row, filter: Row): boolean {
  const path = filter.path as string[]
  const value = path.reduce((current: unknown, key) => {
    return current && typeof current === "object"
      ? (current as Row)[key]
      : undefined
  }, row.evidence)
  return value === filter.equals
}

export function memoryPrisma() {
  const generations = new Map<string, Row>()
  const pointers = new Map<string, Row>([
    ["EVALUATION", { kind: "EVALUATION", generationId: null, version: 0 }],
    ["SERVING", { kind: "SERVING", generationId: null, version: 0 }],
  ])
  const qualifications: Row[] = []
  const leases = new Map<string, Row>()

  const prisma: Row = {
    watchSearchCandidateGeneration: {
      create: vi.fn(async ({ data }: Row) => {
        const row = {
          ...data,
          state: data.state ?? "BUILDING",
          version: 0,
          documentCounts: {},
          capacityEvidence: {},
          deletionProgress: {},
          validatedAt: null,
          invalidatedAt: null,
          invalidationReason: null,
          retiredAt: null,
        }
        generations.set(row.id, row)
        return row
      }),
      findUnique: vi.fn(async ({ where }: Row) => {
        const row = generations.get(where.id)
        return row ? { ...row } : null
      }),
      findFirst: vi.fn(async ({ where }: Row) =>
        [...generations.values()].find((row) =>
          (where.state.in as string[]).includes(row.state),
        ),
      ),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        let count = 0
        for (const [id, row] of generations) {
          if (!matchesGeneration(row, where)) continue
          generations.set(id, applyData(row, data))
          count += 1
        }
        return { count }
      }),
    },
    watchSearchCandidatePointer: {
      findUnique: vi.fn(async ({ where, include }: Row) => {
        const pointer = pointers.get(where.kind)
        if (!pointer) return null
        return include?.generation
          ? {
              ...pointer,
              generation: pointer.generationId
                ? generations.get(pointer.generationId)
                : null,
            }
          : { ...pointer }
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const pointer = pointers.get(where.kind)
        if (
          !pointer ||
          pointer.version !== where.version ||
          (where.generationId !== undefined &&
            pointer.generationId !== where.generationId)
        )
          return { count: 0 }
        pointers.set(where.kind, applyData(pointer, data))
        return { count: 1 }
      }),
    },
    watchSearchCandidateQualification: {
      create: vi.fn(async ({ data }: Row) => {
        const row = {
          id: `qualification-${qualifications.length + 1}`,
          ...data,
        }
        qualifications.push(row)
        return row
      }),
      findFirst: vi.fn(async ({ where }: Row) =>
        qualifications.find(
          (row) =>
            row.generationId === where.generationId &&
            (typeof where.status === "object"
              ? where.status.in.includes(row.status)
              : row.status === where.status) &&
            row.applicationRevision === where.applicationRevision &&
            row.transcriptCollection === where.transcriptCollection &&
            row.transcriptProjectionRevision ===
              where.transcriptProjectionRevision &&
            (where.qrelsRevision === undefined ||
              row.qrelsRevision === where.qrelsRevision) &&
            (where.currentBindings === undefined ||
              JSON.stringify(row.currentBindings) ===
                JSON.stringify(where.currentBindings.equals)) &&
            (where.evidence === undefined ||
              matchesEvidence(row, where.evidence)) &&
            (where.AND === undefined ||
              where.AND.every((condition: Row) =>
                matchesEvidence(row, condition.evidence),
              )),
        ),
      ),
    },
    watchSearchCandidateLease: {
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const lease = leases.get(where.resourceKey)
        if (!lease) return { count: 0 }
        const renewable = where.holderToken
          ? lease.holderToken === where.holderToken &&
            lease.expiresAt > where.expiresAt.gt
          : lease.expiresAt <= where.OR[0].expiresAt.lte ||
            lease.holderToken === where.OR[1].holderToken
        if (!renewable) return { count: 0 }
        leases.set(where.resourceKey, applyData(lease, data))
        return { count: 1 }
      }),
      create: vi.fn(async ({ data }: Row) => {
        if (leases.has(data.resourceKey)) throw { code: "P2002" }
        leases.set(data.resourceKey, data)
        return data
      }),
      findUnique: vi.fn(async ({ where }: Row) =>
        leases.get(where.resourceKey),
      ),
      findFirst: vi.fn(async ({ where }: Row) =>
        [...leases.values()].find(
          (lease) =>
            lease.expiresAt > where.expiresAt.gt &&
            (where.generationId === undefined ||
              lease.generationId === where.generationId) &&
            (where.transcriptCollection === undefined ||
              lease.transcriptCollection === where.transcriptCollection) &&
            (where.transcriptProjectionRevision === undefined ||
              lease.transcriptProjectionRevision ===
                where.transcriptProjectionRevision),
        ),
      ),
      deleteMany: vi.fn(async ({ where }: Row) => {
        const lease = leases.get(where.resourceKey)
        if (!lease || lease.holderToken !== where.holderToken)
          return { count: 0 }
        leases.delete(where.resourceKey)
        return { count: 1 }
      }),
    },
  }
  prisma.$transaction = vi.fn(async (operation: (tx: Row) => unknown) =>
    operation(prisma),
  )
  prisma.$queryRaw = vi.fn(async () => [{ acquired: true }])

  return { prisma, generations, pointers, qualifications, leases }
}

export const generationInput = (id = "candidate-1") => ({
  id,
  applicationRevision: "admin-app-sha-1",
  sourceEpoch: "catalog-revision-42",
  sourceDigests: { catalog: "sha256:catalog" },
  transcriptProjectionRevision: 17n,
  members: {
    catalog: {
      collection: `${id}_catalog`,
      ownership: "OWNED" as const,
      fields: [{ name: "id", type: "string" }],
    },
    availability: {
      collection: `${id}_availability`,
      ownership: "OWNED" as const,
      fields: [{ name: "id", type: "string" }],
    },
    lexical: {
      collection: `${id}_lexical`,
      ownership: "OWNED" as const,
      fields: [{ name: "title", type: "string", locale: "zh" }],
    },
    transcript: {
      collection: "watch_search_transcripts_active",
      ownership: "SHARED" as const,
      fields: [{ name: "embedding", type: "float[]", num_dim: 1536 }],
    },
  },
})

export const qualificationAudit = {
  reviewerIdentity: "reviewer@example.org",
  operatorIdentity: "operator@example.org",
  evidenceBundleSha256: `sha256:${"a".repeat(64)}`,
}

export const operatorQualificationAudit = {
  reviewerIdentity: "user:nisal",
  operatorIdentity: `typesense-operator:sha256:${"c".repeat(64)}`,
  evidenceBundleSha256: `sha256:${"d".repeat(64)}`,
  evidenceBundleByteLength: 4096,
}

export const currentBindings = [
  "watch_catalog_current",
  "watch_availability_current",
  "watch_lexical_current",
  "watch_transcripts_current",
] as const

export const currentAliasTargets = new Map<string, string>([
  [TYPESENSE_WATCH_CATALOG_ALIAS, currentBindings[0]],
  [TYPESENSE_WATCH_AVAILABILITY_ALIAS, currentBindings[1]],
  [TYPESENSE_WATCH_LEXICAL_ALIAS, currentBindings[2]],
  [TYPESENSE_WATCH_TRANSCRIPT_ALIAS, currentBindings[3]],
])

export function schemaClient() {
  return {
    getCollectionSchema: vi.fn(async (collection: string) => {
      if (collection.endsWith("_catalog")) {
        return { name: collection, fields: [{ name: "id", type: "string" }] }
      }
      if (collection.endsWith("_availability")) {
        return { name: collection, fields: [{ name: "id", type: "string" }] }
      }
      if (collection.endsWith("_lexical")) {
        return {
          name: collection,
          fields: [{ name: "title", type: "string", locale: "zh" }],
        }
      }
      if (collection === "watch_search_transcripts_active") {
        return {
          name: collection,
          fields: [{ name: "embedding", type: "float[]", num_dim: 1536 }],
        }
      }
      throw new Error(`unexpected collection ${collection}`)
    }),
    getAlias: vi.fn(async (alias: string) => {
      const collectionName = currentAliasTargets.get(alias)
      if (!collectionName) throw new Error(`unexpected alias ${alias}`)
      return { name: alias, collection_name: collectionName }
    }),
  }
}
export function passingQualificationReport(input: {
  generationId?: string
  currentBindings: readonly string[]
  qrelsRevision?: string
  identityPatch?: Row
  evidencePatch?: Row
  artifactPatch?: Row
}) {
  const evidence = Object.fromEntries(
    WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES.map((gate) => [
      gate,
      "PASS",
    ]),
  )
  const artifacts = Object.fromEntries(
    WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES.map((gate) => [
      gate,
      `s3://reviewed/${gate}.json`,
    ]),
  )
  return {
    schemaVersion: "watch-search-candidate-qualification/v2",
    status: "QUALIFIED",
    reasons: [],
    identity: {
      generationId: input.generationId ?? "candidate-1",
      applicationRevision: "admin-app-sha-1",
      rankingRevision: "title-and-brand-v1",
      transcriptCollection: "watch_search_transcripts_active",
      transcriptProjectionRevision: "17",
      qrelsRevision: input.qrelsRevision ?? "qrels-reviewed-1",
      currentBindings: input.currentBindings,
      ...input.identityPatch,
    },
    evidence: {
      ...evidence,
      ...input.evidencePatch,
      artifacts: { ...artifacts, ...input.artifactPatch },
    },
    audit: qualificationAudit,
  }
}

export function operatorAcceptanceReport(input: {
  currentBindings: readonly string[]
  identityPatch?: Row
  auditPatch?: Row
}) {
  const decisionId = "candidate-launch-2026-08-16"
  return {
    schemaVersion: "watch-search-candidate-operator-acceptance/v1",
    decisionId,
    status: "OPERATOR_ACCEPTED",
    identity: {
      generationId: "candidate-1",
      applicationRevision: "admin-app-sha-1",
      rankingRevision: "title-and-brand-v1",
      transcriptCollection: "watch_search_transcripts_active",
      transcriptProjectionRevision: "17",
      qrelsRevision: `none:operator-accepted:${decisionId}`,
      currentBindings: input.currentBindings,
      candidateBindings: {
        catalog: "candidate-1_catalog",
        availability: "candidate-1_availability",
        lexical: "candidate-1_lexical",
        transcript: "watch_search_transcripts_active",
      },
      ...input.identityPatch,
    },
    measurements: {
      relevance: {
        cases: 104,
        usefulOrExcellentPercent: 43.3,
        unacceptablePercent: 13.5,
      },
      latency: { callerP95Ms: 2689, adminP95Ms: 683 },
    },
    waivedGates: [
      {
        gate: "relevance",
        observed: "FAIL",
        reason: "Reviewer accepted stronger multilingual results.",
      },
    ],
    knownLimitations: ["The existing judge rubric underrates catalog intent."],
    acceptanceReason:
      "Manual comparison showed materially better native-language retrieval.",
    rawMastraOutputs: {
      development: { runId: "development-1", results: [{ score: 0.8 }] },
      heldOut: { runId: "held-out-1", results: [{ score: 0.7 }] },
    },
    userAcceptance: {
      acceptedAt: "2026-08-16T12:00:00.000Z",
      reviewerIdentity: "user:nisal",
      statement: "Ship the new Candidate and redo the baselines.",
    },
    reviewTrail: {
      pullRequest: {
        number: 1944,
        url: "https://github.com/JesusFilm/forge/pull/1944",
        mergedAt: "2026-08-16T11:30:00.000Z",
        mergeCommitSha: "a".repeat(40),
      },
      commits: [{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }],
    },
    audit: { ...operatorQualificationAudit, ...input.auditPatch },
  }
}

export function createCandidateGenerationTestHarness() {
  const db = memoryPrisma()
  const typesense = schemaClient()
  let now = new Date("2026-08-10T00:00:00.000Z")
  const service = new TypesenseWatchSearchCandidateGenerationService(
    db.prisma as never,
    typesense,
    () => now,
  )

  return {
    db,
    typesense,
    service,
    ready: async (id = "candidate-1") => {
      await service.createBuildingGeneration(generationInput(id))
      return service.validateAndMarkReady({
        generationId: id,
        expectedVersion: 0,
        documentCounts: { catalog: 1_070, transcript: 280_107 },
        capacityEvidence: { residentMemoryBytes: 5_000_000_000 },
      })
    },
    setNow: (value: Date) => {
      now = value
    },
  }
}
