import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CandidateGenerationCompatibilityError,
  CandidateGenerationConflictError,
  CandidateGenerationLeaseError,
  CandidateGenerationValidationError,
} from "./typesense-watch-search-candidate-generation"
import { WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES } from "./typesense-watch-search-candidate-qualification"
import {
  createCandidateGenerationTestHarness,
  currentAliasTargets,
  currentBindings,
  generationInput,
  passingQualificationReport,
  qualificationAudit,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
} from "./typesense-watch-search-candidate-generation.test-support"

describe("TypesenseWatchSearchCandidateGenerationService", () => {
  type Harness = ReturnType<typeof createCandidateGenerationTestHarness>
  let db: Harness["db"]
  let typesense: Harness["typesense"]
  let service: Harness["service"]
  let ready: Harness["ready"]
  let setNow: Harness["setNow"]

  beforeEach(() => {
    const harness = createCandidateGenerationTestHarness()
    db = harness.db
    typesense = harness.typesense
    service = harness.service
    ready = harness.ready
    setNow = harness.setNow
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

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
        indexContractRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
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
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-2",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 17n,
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationCompatibilityError)
    expect(db.generations.get("candidate-1")?.state).toBe("READY")

    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_replaced",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v2",
        transcriptChunkingVersion: "mastra-v2",
        transcriptProjectionRevision: 18n,
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationCompatibilityError)
    expect(db.generations.get("candidate-1")?.state).toBe("INVALIDATED")
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("event=candidate_transcript_identity_mismatch"),
    )
    warning.mockRestore()
  })

  it("acquires, renews, expires, releases, and enforces leases without waiting", async () => {
    await ready()
    const identity = {
      resourceKey: "watch-search-candidate-comparison",
      kind: "COMPARISON" as const,
      holderToken: "holder-a",
      ttlMs: 30_000,
      generationId: "candidate-1",
      indexContractRevision: "admin-app-sha-1",
      transcriptCollection: "watch_search_transcripts_active",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
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
      service.assertTranscriptNotLeased(
        "watch_search_transcripts_active",
        "semantic-transcript-pgvector-v1",
        "mastra-v1",
      ),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)

    await expect(
      service.renewLease({
        resourceKey: identity.resourceKey,
        holderToken: "holder-a",
        ttlMs: 60_000,
      }),
    ).resolves.toBe(true)
    setNow(new Date("2026-08-10T00:02:00.000Z"))
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
        indexContractRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
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
      indexContractRevision: "admin-app-sha-1",
      transcriptCollection: "watch_search_transcripts_active",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
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
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
      transcriptProjectionRevision: 17n,
      expiresAt: new Date("2026-08-10T00:00:30.000Z"),
    })

    await expect(
      service.assertCurrentPublicationAllowed({ rebuildTranscripts: false }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)
    await expect(
      service.assertCurrentPublicationAllowed({ rebuildTranscripts: true }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)

    setNow(new Date("2026-08-10T00:01:00.000Z"))
    await expect(
      service.assertCurrentPublicationAllowed({ rebuildTranscripts: false }),
    ).resolves.toBe(undefined)
    await expect(
      service.assertCurrentPublicationAllowed({ rebuildTranscripts: true }),
    ).resolves.toBe(undefined)
  })

  it("blocks current publication while a candidate is serving", async () => {
    db.pointers.set("SERVING", {
      kind: "SERVING",
      generationId: "candidate-1",
      version: 1,
    })

    await expect(
      service.assertCurrentPublicationAllowed({ rebuildTranscripts: false }),
    ).rejects.toThrow(/serving candidate generation candidate-1/)
    await expect(
      service.assertCurrentPublicationAllowed({ rebuildTranscripts: true }),
    ).rejects.toThrow(/serving candidate generation candidate-1/)
  })

  it("blocks transcript rebuilds while a live candidate can reference them", async () => {
    await ready()
    await expect(
      service.assertCurrentPublicationAllowed({ rebuildTranscripts: true }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)
    await expect(
      service.assertCurrentPublicationAllowed({ rebuildTranscripts: false }),
    ).resolves.toBe(undefined)
  })

  it("pins qualification and serving to one exact generation while evaluation advances", async () => {
    await ready("candidate-1")
    await service.recordQualification({
      qualificationAudit,
      generationId: "candidate-1",
      status: "PASSED",
      indexContractRevision: "admin-app-sha-1",
      rankingRevision: "title-and-brand-v2",
      transcriptCollection: "watch_search_transcripts_active",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
      transcriptProjectionRevision: 17n,
      qrelsRevision: "qrels-reviewed-1",
      currentBindings,
      evidence: passingQualificationReport({ currentBindings }),
    })
    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 17n,
        requireQualified: true,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v2",
      }),
    ).resolves.toMatchObject({ generationId: "candidate-1" })
    db.prisma.$queryRaw.mockResolvedValueOnce([{ acquired: false }])
    await expect(
      service.pinServingGeneration({
        qualificationAudit,
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-1",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationLeaseError)
    expect(db.pointers.get("SERVING")?.generationId).toBeNull()
    await expect(
      service.pinServingGeneration({
        qualificationAudit,
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-1",
        expectedPointerVersion: 0,
        currentBindings: ["new-current-binding"],
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    await expect(
      service.pinServingGeneration({
        qualificationAudit,
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-1",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: "stale-qrels",
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    await service.pinServingGeneration({
      qualificationAudit,
      generationId: "candidate-1",
      indexContractRevision: "admin-app-sha-1",
      expectedPointerVersion: 0,
      currentBindings,
      qrelsRevision: "qrels-reviewed-1",
      rankingRevision: "title-and-brand-v2",
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
        qualificationAudit,
        generationId: "candidate-2",
        indexContractRevision: "admin-app-sha-1",
        expectedPointerVersion: 1,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
  })

  it("rejects self-asserted passing evidence", async () => {
    await ready()
    await expect(
      service.recordQualification({
        qualificationAudit,
        generationId: "candidate-1",
        status: "PASSED",
        indexContractRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v2",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 17n,
        qrelsRevision: "qrels-reviewed-1",
        currentBindings: ["watch_catalog_current"],
        evidence: { p95NonRegression: true },
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
  })

  it("rejects qualification audit fields that do not match the stored report", async () => {
    await ready()
    const currentBindings = ["watch_catalog_current"]
    await expect(
      service.recordQualification({
        qualificationAudit,
        generationId: "candidate-1",
        status: "PASSED",
        indexContractRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v2",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 17n,
        qrelsRevision: "qrels-reviewed-1",
        currentBindings,
        evidence: {
          ...passingQualificationReport({ currentBindings }),
          audit: {
            ...qualificationAudit,
            reviewerIdentity: "different-reviewer@example.org",
          },
        },
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    expect(db.qualifications).toHaveLength(0)
  })

  it.each([
    ["reviewer identity", { reviewerIdentity: "other@example.org" }],
    ["operator identity", { operatorIdentity: "other@example.org" }],
    ["evidence digest", { evidenceBundleSha256: `sha256:${"b".repeat(64)}` }],
  ])(
    "rejects serving when the %s changed after recording",
    async (_name, patch) => {
      await ready()
      const currentBindings = ["watch_catalog_current"]
      await service.recordQualification({
        qualificationAudit,
        generationId: "candidate-1",
        status: "PASSED",
        indexContractRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v2",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 17n,
        qrelsRevision: "qrels-reviewed-1",
        currentBindings,
        evidence: passingQualificationReport({ currentBindings }),
      })

      await expect(
        service.pinServingGeneration({
          qualificationAudit: { ...qualificationAudit, ...patch },
          generationId: "candidate-1",
          indexContractRevision: "admin-app-sha-1",
          expectedPointerVersion: 0,
          currentBindings,
          qrelsRevision: "qrels-reviewed-1",
          rankingRevision: "title-and-brand-v2",
        }),
      ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
      expect(db.pointers.get("SERVING")?.generationId).toBeNull()
    },
  )

  it.each(WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES)(
    "rejects a passing report when %s did not pass",
    async (gate) => {
      await ready()
      const currentBindings = ["watch_catalog_current"]
      await expect(
        service.recordQualification({
          qualificationAudit,
          generationId: "candidate-1",
          status: "PASSED",
          indexContractRevision: "admin-app-sha-1",
          rankingRevision: "title-and-brand-v2",
          transcriptCollection: "watch_search_transcripts_active",
          contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
          transcriptChunkingVersion: "mastra-v1",
          transcriptProjectionRevision: 17n,
          qrelsRevision: "qrels-reviewed-1",
          currentBindings,
          evidence: passingQualificationReport({
            currentBindings,
            evidencePatch: { [gate]: "FAIL" },
          }),
        }),
      ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    },
  )

  it.each(WATCH_SEARCH_CANDIDATE_REQUIRED_EVIDENCE_GATES)(
    "rejects a passing report when %s has no artifact",
    async (gate) => {
      await ready()
      const currentBindings = ["watch_catalog_current"]
      await expect(
        service.recordQualification({
          qualificationAudit,
          generationId: "candidate-1",
          status: "PASSED",
          indexContractRevision: "admin-app-sha-1",
          rankingRevision: "title-and-brand-v2",
          transcriptCollection: "watch_search_transcripts_active",
          contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
          transcriptChunkingVersion: "mastra-v1",
          transcriptProjectionRevision: 17n,
          qrelsRevision: "qrels-reviewed-1",
          currentBindings,
          evidence: passingQualificationReport({
            currentBindings,
            artifactPatch: { [gate]: " " },
          }),
        }),
      ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    },
  )

  it("rejects qualification evidence relabeled to another ranking revision", async () => {
    await ready()
    const currentBindings = ["watch_catalog_current"]
    await expect(
      service.recordQualification({
        qualificationAudit,
        generationId: "candidate-1",
        status: "PASSED",
        indexContractRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v2",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 17n,
        qrelsRevision: "qrels-reviewed-1",
        currentBindings,
        evidence: passingQualificationReport({
          currentBindings,
          identityPatch: { rankingRevision: "previous-ranker-v1" },
        }),
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
      indexContractRevision: "admin-app-sha-1",
      transcriptCollection: "watch_search_transcripts_active",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
      transcriptProjectionRevision: 17n,
      qrelsRevision: "qrels-reviewed-1",
      currentBindings,
      evidence: {
        schemaVersion: "watch-search-candidate-qualification/v1",
        identity: { indexContractRevision: "admin-app-sha-1" },
      },
    })

    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 17n,
        requireQualified: true,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)

    await expect(
      service.pinServingGeneration({
        qualificationAudit,
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-1",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    expect(db.pointers.get("SERVING")?.generationId).toBeNull()
  })

  it("rejects stale application identity and Current bindings while the publication lock is held", async () => {
    await ready()
    await service.recordQualification({
      qualificationAudit,
      generationId: "candidate-1",
      status: "PASSED",
      indexContractRevision: "admin-app-sha-1",
      rankingRevision: "title-and-brand-v2",
      transcriptCollection: "watch_search_transcripts_active",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
      transcriptProjectionRevision: 17n,
      qrelsRevision: "qrels-reviewed-1",
      currentBindings,
      evidence: passingQualificationReport({ currentBindings }),
    })

    await expect(
      service.pinServingGeneration({
        qualificationAudit,
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-stale",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationCompatibilityError)

    typesense.getAlias.mockImplementation(async (alias: string) => ({
      name: alias,
      collection_name:
        alias === TYPESENSE_WATCH_LEXICAL_ALIAS
          ? "watch_lexical_republished"
          : currentAliasTargets.get(alias)!,
    }))
    await expect(
      service.pinServingGeneration({
        qualificationAudit,
        generationId: "candidate-1",
        indexContractRevision: "admin-app-sha-1",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: "qrels-reviewed-1",
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toBeInstanceOf(CandidateGenerationValidationError)
    expect(typesense.getAlias).toHaveBeenCalledTimes(4)
    expect(db.prisma.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
      typesense.getAlias.mock.invocationCallOrder[0]!,
    )
    expect(
      db.prisma.watchSearchCandidatePointer.updateMany,
    ).not.toHaveBeenCalled()
    expect(db.pointers.get("SERVING")?.generationId).toBeNull()
  })

  it("rejects qualification evidence relabeled to another qrels revision", async () => {
    await ready()
    await expect(
      service.recordQualification({
        qualificationAudit,
        generationId: "candidate-1",
        status: "PASSED",
        indexContractRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v2",
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 17n,
        qrelsRevision: "qrels-reviewed-2",
        currentBindings: ["watch_catalog_current"],
        evidence: passingQualificationReport({
          currentBindings: ["watch_catalog_current"],
          identityPatch: { qrelsRevision: "qrels-reviewed-1" },
        }),
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
