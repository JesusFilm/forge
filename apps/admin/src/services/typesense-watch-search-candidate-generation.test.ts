import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CandidateGenerationCompatibilityError,
  CandidateGenerationConflictError,
  CandidateGenerationLeaseError,
  CandidateGenerationValidationError,
  TypesenseWatchSearchCandidateGenerationService,
} from "./typesense-watch-search-candidate-generation"

// The in-memory Prisma double intentionally accepts the delegates' heterogeneous shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

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

function memoryPrisma() {
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
            (where.generationId === undefined ||
              row.generationId === where.generationId) &&
            row.status === where.status &&
            row.applicationRevision === where.applicationRevision &&
            (where.transcriptCollection === undefined ||
              row.transcriptCollection === where.transcriptCollection) &&
            (where.transcriptProjectionRevision === undefined ||
              row.transcriptProjectionRevision ===
                where.transcriptProjectionRevision) &&
            (where.qrelsRevision === undefined ||
              row.qrelsRevision === where.qrelsRevision) &&
            (where.currentBindings === undefined ||
              JSON.stringify(row.currentBindings) ===
                JSON.stringify(where.currentBindings.equals)) &&
            (where.evidence === undefined ||
              row.evidence?.identity?.rankingRevision ===
                where.evidence.equals) &&
            (where.AND === undefined ||
              where.AND.every((condition: Row) => {
                const path = condition.evidence.path as string[]
                const value = path.reduce(
                  (current: unknown, key: string) =>
                    current && typeof current === "object"
                      ? (current as Row)[key]
                      : undefined,
                  row.evidence,
                )
                return (
                  JSON.stringify(value) ===
                  JSON.stringify(condition.evidence.equals)
                )
              })) &&
            (where.generation === undefined ||
              (() => {
                const generation = generations.get(row.generationId)
                const expected = where.generation.is
                return (
                  generation?.state === expected.state &&
                  generation?.applicationRevision ===
                    expected.applicationRevision
                )
              })()),
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

const generationInput = (
  id = "candidate-1",
  applicationRevision = "admin-app-sha-1",
) => ({
  id,
  applicationRevision,
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

function schemaClient() {
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
  }
}

describe("TypesenseWatchSearchCandidateGenerationService", () => {
  let db: ReturnType<typeof memoryPrisma>
  let typesense: ReturnType<typeof schemaClient>
  let now: Date
  let service: TypesenseWatchSearchCandidateGenerationService

  beforeEach(() => {
    db = memoryPrisma()
    typesense = schemaClient()
    now = new Date("2026-08-10T00:00:00.000Z")
    service = new TypesenseWatchSearchCandidateGenerationService(
      db.prisma as never,
      typesense,
      () => now,
    )
  })

  async function ready(
    id = "candidate-1",
    applicationRevision = "admin-app-sha-1",
  ) {
    await service.createBuildingGeneration(
      generationInput(id, applicationRevision),
    )
    return service.validateAndMarkReady({
      generationId: id,
      expectedVersion: 0,
      documentCounts: { catalog: 1_070, transcript: 280_107 },
      capacityEvidence: { residentMemoryBytes: 5_000_000_000 },
    })
  }

  async function publicationQualification(
    applicationRevision = "watch-search-candidate/v2",
    evidenceApplicationRevision = applicationRevision,
  ) {
    const generation = await ready("publication-candidate", applicationRevision)
    db.qualifications.push({
      id: "publication-qualification",
      generationId: generation.id,
      status: "PASSED",
      applicationRevision,
      evidence: {
        schemaVersion: "watch-search-candidate-qualification/v2",
        status: "QUALIFIED",
        reasons: [],
        identity: {
          generationId: generation.id,
          applicationRevision: evidenceApplicationRevision,
        },
      },
    })
  }

  it("creates the BUILDING owner before validation and publishes only a complete READY tuple", async () => {
    const building = await service.createBuildingGeneration(generationInput())
    expect(building).toMatchObject({ state: "BUILDING", version: 0 })
    expect(typesense.getCollectionSchema).not.toHaveBeenCalled()

    const readyGeneration = await service.validateAndMarkReady({
      generationId: "candidate-1",
      expectedVersion: 0,
      documentCounts: { catalog: 1_070, transcript: 280_107 },
      capacityEvidence: { residentMemoryBytes: 5_000_000_000 },
    })
    expect(readyGeneration).toMatchObject({ state: "READY", version: 1 })
    expect(typesense.getCollectionSchema).toHaveBeenCalledTimes(4)

    await expect(
      service.publishEvaluationGeneration({
        generationId: "candidate-1",
        expectedPointerVersion: 0,
      }),
    ).resolves.toMatchObject({
      kind: "EVALUATION",
      generationId: "candidate-1",
      version: 1,
    })
  })

  it.each([
    ["missing physical member", { collection: "" }],
    ["empty field manifest", { fields: [] }],
    ["shared member marked owned", { ownership: "OWNED" }],
  ])("rejects an invalid identity: %s", async (_label, transcriptPatch) => {
    const input = generationInput()
    Object.assign(input.members.transcript, transcriptPatch)

    await expect(
      service.createBuildingGeneration(input),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    expect(
      db.prisma.watchSearchCandidateGeneration.create,
    ).not.toHaveBeenCalled()
  })

  it("rejects mismatched Typesense schema fields without exposing a partial tuple", async () => {
    await service.createBuildingGeneration(generationInput())
    typesense.getCollectionSchema.mockImplementation(async (collection) => ({
      name: collection,
      fields: [{ name: "wrong", type: "string" }],
    }))

    await expect(
      service.validateAndMarkReady({
        generationId: "candidate-1",
        expectedVersion: 0,
        documentCounts: { catalog: 1 },
        capacityEvidence: { residentMemoryBytes: 1 },
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    expect(db.generations.get("candidate-1")?.state).toBe("BUILDING")
    expect(db.pointers.get("EVALUATION")?.generationId).toBeNull()
  })

  it("rejects unexpected stemming when the manifest relies on the exact-field default", async () => {
    await service.createBuildingGeneration(generationInput())
    typesense.getCollectionSchema.mockImplementation(async (collection) => {
      if (collection.endsWith("_lexical")) {
        return {
          name: collection,
          fields: [{ name: "title", type: "string", locale: "zh", stem: true }],
        }
      }
      return schemaClient().getCollectionSchema(collection)
    })

    await expect(
      service.validateAndMarkReady({
        generationId: "candidate-1",
        expectedVersion: 0,
        documentCounts: { catalog: 1 },
        capacityEvidence: { residentMemoryBytes: 1 },
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    expect(db.generations.get("candidate-1")?.state).toBe("BUILDING")
  })

  it("rejects stale lifecycle updates, illegal reactivation, and concurrent pointer races", async () => {
    await ready()

    await expect(
      service.transitionGeneration({
        generationId: "candidate-1",
        expectedState: "READY",
        expectedVersion: 1,
        nextState: "RETIRED",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)

    const results = await Promise.allSettled([
      service.publishEvaluationGeneration({
        generationId: "candidate-1",
        expectedPointerVersion: 0,
      }),
      service.publishEvaluationGeneration({
        generationId: "candidate-1",
        expectedPointerVersion: 0,
      }),
    ])
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1)

    const invalidated = await service.transitionGeneration({
      generationId: "candidate-1",
      expectedState: "READY",
      expectedVersion: 1,
      nextState: "INVALIDATED",
      reason: "source changed",
    })
    await expect(
      service.validateAndMarkReady({
        generationId: "candidate-1",
        expectedVersion: invalidated.version,
        documentCounts: {},
        capacityEvidence: {},
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationConflictError)
    expect(db.generations.get("candidate-1")?.invalidationReason).toBe(
      "source changed",
    )

    await expect(
      service.transitionGeneration({
        generationId: "candidate-1",
        expectedState: "INVALIDATED",
        expectedVersion: invalidated.version,
        nextState: "RETIRED",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)

    const retiring = await service.transitionGeneration({
      generationId: "candidate-1",
      expectedState: "INVALIDATED",
      expectedVersion: invalidated.version,
      nextState: "RETIRING",
    })
    await expect(
      service.transitionGeneration({
        generationId: "candidate-1",
        expectedState: "RETIRING",
        expectedVersion: retiring.version,
        nextState: "RETIRED",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    const progress = await service.recordDeletionProgress({
      generationId: "candidate-1",
      expectedVersion: retiring.version,
      deletedCollections: [
        "candidate-1_catalog",
        "candidate-1_availability",
        "candidate-1_lexical",
      ],
    })
    await expect(
      service.transitionGeneration({
        generationId: "candidate-1",
        expectedState: "RETIRING",
        expectedVersion: progress.version,
        nextState: "RETIRED",
      }),
    ).resolves.toMatchObject({ state: "RETIRED" })
  })

  it("resolves one immutable generation from stored manifests without schema discovery", async () => {
    await ready()
    typesense.getCollectionSchema.mockClear()

    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        applicationRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
      }),
    ).resolves.toMatchObject({
      generationId: "candidate-1",
      collections: { catalog: "candidate-1_catalog" },
    })
    expect(typesense.getCollectionSchema).not.toHaveBeenCalled()
  })

  it("invalidates stale transcript identities and rejects application incompatibility", async () => {
    await ready()

    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        applicationRevision: "admin-app-sha-2",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationCompatibilityError)
    expect(db.generations.get("candidate-1")?.state).toBe("READY")

    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        applicationRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_replaced",
        transcriptProjectionRevision: 18n,
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationCompatibilityError)
    expect(db.generations.get("candidate-1")?.state).toBe("INVALIDATED")
  })

  it("acquires, renews, expires, releases, and enforces leases without waiting", async () => {
    await ready()
    const identity = {
      resourceKey: "watch-search-candidate-comparison",
      kind: "COMPARISON" as const,
      holderToken: "holder-a",
      ttlMs: 30_000,
      generationId: "candidate-1",
      applicationRevision: "admin-app-sha-1",
      transcriptCollection: "watch_search_transcripts_active",
      transcriptProjectionRevision: 17n,
      currentBindings: ["watch_catalog_current", "watch_transcripts_current"],
    }

    await expect(service.acquireLease(identity)).resolves.toMatchObject({
      holderToken: "holder-a",
    })
    await expect(
      service.acquireLease({ ...identity, holderToken: "holder-b" }),
    ).resolves.toBeNull()
    await expect(
      service.assertGenerationNotLeased("candidate-1"),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)
    await expect(
      service.assertTranscriptNotLeased("watch_search_transcripts_active", 17n),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)

    await expect(
      service.renewLease({
        resourceKey: identity.resourceKey,
        holderToken: "holder-a",
        ttlMs: 60_000,
      }),
    ).resolves.toBe(true)
    now = new Date("2026-08-10T00:02:00.000Z")
    await expect(
      service.acquireLease({ ...identity, holderToken: "holder-b" }),
    ).resolves.toMatchObject({ holderToken: "holder-b" })
    await expect(
      service.releaseLease({
        resourceKey: identity.resourceKey,
        holderToken: "holder-b",
      }),
    ).resolves.toBe(true)
    await expect(
      service.assertGenerationNotLeased("candidate-1"),
    ).resolves.toBe(undefined)
  })

  it("refuses lease admission while current publication owns the lock", async () => {
    await ready()
    db.prisma.$queryRaw.mockResolvedValueOnce([{ acquired: false }])

    await expect(
      service.acquireLease({
        resourceKey: "watch-search-candidate-comparison",
        kind: "COMPARISON",
        holderToken: "holder-a",
        ttlMs: 30_000,
        generationId: "candidate-1",
        applicationRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        currentBindings: ["watch_catalog_current"],
      }),
    ).resolves.toBeNull()
    expect(db.leases.size).toBe(0)
  })

  it("refuses lease renewal while current publication owns the lock", async () => {
    await ready()
    const lease = {
      resourceKey: "watch-search-candidate-comparison",
      kind: "COMPARISON" as const,
      holderToken: "holder-a",
      ttlMs: 30_000,
      generationId: "candidate-1",
      applicationRevision: "admin-app-sha-1",
      transcriptCollection: "watch_search_transcripts_active",
      transcriptProjectionRevision: 17n,
      currentBindings: ["watch_catalog_current"],
    }
    await service.acquireLease(lease)
    const expiresAtBefore = db.leases.get(lease.resourceKey)?.expiresAt
    db.prisma.$queryRaw.mockResolvedValueOnce([{ acquired: false }])

    await expect(
      service.renewLease({
        resourceKey: lease.resourceKey,
        holderToken: lease.holderToken,
        ttlMs: 60_000,
      }),
    ).resolves.toBe(false)
    expect(db.leases.get(lease.resourceKey)?.expiresAt).toEqual(expiresAtBefore)
  })

  it("blocks current publication for live leases until they expire", async () => {
    db.leases.set("comparison", {
      resourceKey: "comparison",
      holderToken: "holder-a",
      generationId: "candidate-1",
      transcriptCollection: "watch_search_transcripts_active",
      transcriptProjectionRevision: 17n,
      expiresAt: new Date("2026-08-10T00:00:30.000Z"),
    })

    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: false,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)
    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: true,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)

    now = new Date("2026-08-10T00:01:00.000Z")
    await publicationQualification()
    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: false,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).resolves.toBe(undefined)
    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: true,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)
  })

  it("admits current publication only for an exact PASSED v2 qualification", async () => {
    await publicationQualification()

    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: false,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).resolves.toBe(undefined)
  })

  it("rejects absent or mismatched v2 qualification before publication", async () => {
    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: false,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)

    await publicationQualification(
      "watch-search-candidate/v2",
      "watch-search-candidate/v1",
    )
    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: false,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
  })

  it("blocks current publication while a candidate is serving", async () => {
    db.pointers.set("SERVING", {
      kind: "SERVING",
      generationId: "candidate-1",
      version: 1,
    })

    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: false,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).rejects.toThrow(/serving candidate generation candidate-1/)
    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: true,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).rejects.toThrow(/serving candidate generation candidate-1/)
  })

  it("blocks transcript rebuilds while a live candidate can reference them", async () => {
    await ready()
    await publicationQualification()
    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: true,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)
    await expect(
      service.assertCurrentPublicationAllowed({
        rebuildTranscripts: false,
        applicationRevision: "watch-search-candidate/v2",
      }),
    ).resolves.toBe(undefined)
  })

  it("pins qualification and serving to one exact generation while evaluation advances", async () => {
    await ready("candidate-1")
    const currentBindings = [
      "watch_catalog_current",
      "watch_transcripts_current",
    ]
    await service.recordQualification({
      generationId: "candidate-1",
      status: "PASSED",
      applicationRevision: "admin-app-sha-1",
      rankingRevision: "title-and-brand-v1",
      transcriptCollection: "watch_search_transcripts_active",
      transcriptProjectionRevision: 17n,
      qrelsRevision: "qrels-reviewed-1",
      currentBindings,
      evidence: {
        schemaVersion: "watch-search-candidate-qualification/v2",
        status: "QUALIFIED",
        reasons: [],
        identity: {
          generationId: "candidate-1",
          applicationRevision: "admin-app-sha-1",
          rankingRevision: "title-and-brand-v1",
          transcriptCollection: "watch_search_transcripts_active",
          transcriptProjectionRevision: "17",
          qrelsRevision: "qrels-reviewed-1",
          currentBindings,
        },
        evidence: {
          relevance: "PASS",
          fixedLoadResources: "PASS",
          currentInterference: "PASS",
          operatorReview: "PASS",
          artifacts: { report: "s3://reviewed/report.json" },
        },
      },
    })
    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        applicationRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        requireQualified: true,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v1",
      }),
    ).resolves.toMatchObject({ generationId: "candidate-1" })
    db.prisma.$queryRaw.mockResolvedValueOnce([{ acquired: false }])
    await expect(
      service.pinServingGeneration({
        generationId: "candidate-1",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v1",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)
    expect(db.pointers.get("SERVING")?.generationId).toBeNull()
    await expect(
      service.pinServingGeneration({
        generationId: "candidate-1",
        expectedPointerVersion: 0,
        currentBindings: ["new-current-binding"],
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v1",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    await expect(
      service.pinServingGeneration({
        generationId: "candidate-1",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: "stale-qrels",
        rankingRevision: "title-and-brand-v1",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    await service.pinServingGeneration({
      generationId: "candidate-1",
      expectedPointerVersion: 0,
      currentBindings,
      qrelsRevision: "qrels-reviewed-1",
      rankingRevision: "title-and-brand-v1",
    })

    await ready("candidate-2")
    await service.publishEvaluationGeneration({
      generationId: "candidate-2",
      expectedPointerVersion: 0,
    })

    expect(db.pointers.get("SERVING")?.generationId).toBe("candidate-1")
    expect(db.pointers.get("EVALUATION")?.generationId).toBe("candidate-2")
    await expect(
      service.pinServingGeneration({
        generationId: "candidate-2",
        expectedPointerVersion: 1,
        currentBindings: ["watch_catalog_current", "watch_transcripts_current"],
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v1",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
  })

  it("rejects self-asserted passing evidence", async () => {
    await ready()
    await expect(
      service.recordQualification({
        generationId: "candidate-1",
        status: "PASSED",
        applicationRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v1",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        qrelsRevision: "qrels-reviewed-1",
        currentBindings: ["watch_catalog_current"],
        evidence: { p95NonRegression: true },
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
  })

  it("rejects qualification evidence relabeled to another ranking revision", async () => {
    await ready()
    const currentBindings = ["watch_catalog_current"]
    await expect(
      service.recordQualification({
        generationId: "candidate-1",
        status: "PASSED",
        applicationRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v1",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        qrelsRevision: "qrels-reviewed-1",
        currentBindings,
        evidence: {
          schemaVersion: "watch-search-candidate-qualification/v2",
          status: "QUALIFIED",
          reasons: [],
          identity: {
            generationId: "candidate-1",
            applicationRevision: "admin-app-sha-1",
            rankingRevision: "previous-ranker-v1",
            transcriptCollection: "watch_search_transcripts_active",
            transcriptProjectionRevision: "17",
            qrelsRevision: "qrels-reviewed-1",
            currentBindings,
          },
          evidence: {
            relevance: "PASS",
            fixedLoadResources: "PASS",
            currentInterference: "PASS",
            operatorReview: "PASS",
            artifacts: { report: "s3://reviewed/report.json" },
          },
        },
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
  })

  it("does not let a qualification for the previous ranker authorize serving", async () => {
    await ready()
    const currentBindings = ["watch_catalog_current"]
    db.qualifications.push({
      id: "legacy-qualification",
      generationId: "candidate-1",
      status: "PASSED",
      applicationRevision: "admin-app-sha-1",
      transcriptCollection: "watch_search_transcripts_active",
      transcriptProjectionRevision: 17n,
      qrelsRevision: "qrels-reviewed-1",
      currentBindings,
      evidence: {
        schemaVersion: "watch-search-candidate-qualification/v1",
        identity: { applicationRevision: "admin-app-sha-1" },
      },
    })

    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        applicationRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        requireQualified: true,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v1",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)

    await expect(
      service.pinServingGeneration({
        generationId: "candidate-1",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v1",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    expect(db.pointers.get("SERVING")?.generationId).toBeNull()
  })

  it("rejects qualification evidence relabeled to another qrels revision", async () => {
    await ready()
    await expect(
      service.recordQualification({
        generationId: "candidate-1",
        status: "PASSED",
        applicationRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v1",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        qrelsRevision: "qrels-reviewed-2",
        currentBindings: ["watch_catalog_current"],
        evidence: {
          schemaVersion: "watch-search-candidate-qualification/v2",
          status: "QUALIFIED",
          reasons: [],
          identity: {
            generationId: "candidate-1",
            applicationRevision: "admin-app-sha-1",
            rankingRevision: "title-and-brand-v1",
            transcriptCollection: "watch_search_transcripts_active",
            transcriptProjectionRevision: "17",
            qrelsRevision: "qrels-reviewed-1",
            currentBindings: ["watch_catalog_current"],
          },
          evidence: {
            relevance: "PASS",
            fixedLoadResources: "PASS",
            currentInterference: "PASS",
            operatorReview: "PASS",
            artifacts: { report: "s3://reviewed/report.json" },
          },
        },
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    expect(db.qualifications).toHaveLength(0)
  })

  it("clears a pointer only with the exact generation and version", async () => {
    await ready()
    await service.publishEvaluationGeneration({
      generationId: "candidate-1",
      expectedPointerVersion: 0,
    })

    await expect(
      service.clearPointer("EVALUATION", {
        generationId: "candidate-1",
        expectedPointerVersion: 0,
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationConflictError)
    await expect(
      service.clearPointer("EVALUATION", {
        generationId: "candidate-1",
        expectedPointerVersion: 1,
      }),
    ).resolves.toMatchObject({ generationId: null, version: 2 })
  })

  it("atomically clears evaluation and makes a generation non-promotable for retirement", async () => {
    await ready("candidate-1")
    await service.publishEvaluationGeneration({
      generationId: "candidate-1",
      expectedPointerVersion: 0,
    })

    await expect(service.beginRetirement("candidate-1")).resolves.toMatchObject(
      {
        state: "RETIRING",
        version: 2,
      },
    )
    expect(db.pointers.get("EVALUATION")).toMatchObject({
      generationId: null,
      version: 2,
    })
    await expect(
      service.publishEvaluationGeneration({
        generationId: "candidate-1",
        expectedPointerVersion: 2,
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
  })

  it("refuses atomic retirement while the generation is serving", async () => {
    await ready("candidate-1")
    db.pointers.set("SERVING", {
      kind: "SERVING",
      generationId: "candidate-1",
      version: 1,
    })

    await expect(service.beginRetirement("candidate-1")).rejects.toBeInstanceOf(
      CandidateGenerationLeaseError,
    )
    expect(db.generations.get("candidate-1")?.state).toBe("READY")
  })
})
