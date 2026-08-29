import { beforeEach, describe, expect, it } from "vitest"
import {
  createCandidateGenerationTestHarness,
  currentBindings,
  operatorAcceptanceReport,
  operatorQualificationAudit,
} from "./typesense-watch-search-candidate-generation.test-support"

describe("Typesense Watch search Candidate promotion", () => {
  type Harness = ReturnType<typeof createCandidateGenerationTestHarness>
  let db: Harness["db"]
  let service: Harness["service"]
  let ready: Harness["ready"]

  beforeEach(() => {
    const harness = createCandidateGenerationTestHarness()
    db = harness.db
    service = harness.service
    ready = harness.ready
  })

  it("keeps operator acceptance distinct while authorizing exact serving", async () => {
    await ready("candidate-1")
    const decisionId = "candidate-launch-2026-08-16"
    await service.recordQualification({
      qualificationAudit: operatorQualificationAudit,
      generationId: "candidate-1",
      status: "OPERATOR_ACCEPTED",
      applicationRevision: "admin-app-sha-1",
      rankingRevision: "title-and-brand-v2",
      transcriptCollection: "watch_search_transcripts_active",
      transcriptProjectionRevision: 17n,
      qrelsRevision: `none:operator-accepted:${decisionId}`,
      currentBindings,
      evidence: operatorAcceptanceReport({ currentBindings }),
    })

    expect(db.qualifications).toEqual([
      expect.objectContaining({ status: "OPERATOR_ACCEPTED" }),
    ])
    await expect(
      service.resolveGeneration({
        generationId: "candidate-1",
        applicationRevision: "admin-app-sha-1",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        requireQualified: true,
        currentBindings,
        qrelsRevision: `none:operator-accepted:${decisionId}`,
        rankingRevision: "title-and-brand-v2",
      }),
    ).resolves.toMatchObject({ generationId: "candidate-1" })
    await expect(
      service.pinServingGeneration({
        qualificationAudit: operatorQualificationAudit,
        generationId: "candidate-1",
        applicationRevision: "admin-app-sha-1",
        expectedPointerVersion: 0,
        currentBindings,
        qrelsRevision: `none:operator-accepted:${decisionId}`,
        rankingRevision: "title-and-brand-v2",
      }),
    ).rejects.toThrow(/exact passed qualification/i)
    await service.pinServingGeneration({
      qualificationAudit: operatorQualificationAudit,
      qualificationStatus: "OPERATOR_ACCEPTED",
      generationId: "candidate-1",
      applicationRevision: "admin-app-sha-1",
      expectedPointerVersion: 0,
      currentBindings,
      qrelsRevision: `none:operator-accepted:${decisionId}`,
      rankingRevision: "title-and-brand-v2",
    })
    expect(db.pointers.get("SERVING")?.generationId).toBe("candidate-1")
  })

  it("rejects mutated operator acceptance audit bytes and stale identity", async () => {
    await ready("candidate-1")
    const decisionId = "candidate-launch-2026-08-16"
    await expect(
      service.recordQualification({
        qualificationAudit: operatorQualificationAudit,
        generationId: "candidate-1",
        status: "OPERATOR_ACCEPTED",
        applicationRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v2",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        qrelsRevision: `none:operator-accepted:${decisionId}`,
        currentBindings,
        evidence: operatorAcceptanceReport({
          currentBindings,
          auditPatch: { evidenceBundleByteLength: 4097 },
        }),
      }),
    ).rejects.toThrow(/exact reviewed bundle/i)
    await expect(
      service.recordQualification({
        qualificationAudit: operatorQualificationAudit,
        generationId: "candidate-1",
        status: "OPERATOR_ACCEPTED",
        applicationRevision: "admin-app-sha-1",
        rankingRevision: "title-and-brand-v2",
        transcriptCollection: "watch_search_transcripts_active",
        transcriptProjectionRevision: 17n,
        qrelsRevision: `none:operator-accepted:${decisionId}`,
        currentBindings,
        evidence: operatorAcceptanceReport({
          currentBindings,
          identityPatch: { generationId: "candidate-stale" },
        }),
      }),
    ).rejects.toThrow(/exact reviewed bundle/i)
    expect(db.qualifications).toHaveLength(0)
  })
})
