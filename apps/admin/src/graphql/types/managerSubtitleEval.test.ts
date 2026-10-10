import { describe, expect, it, vi } from "vitest"

import { schema } from "@/graphql/schema"
import { mintSubtitleReviewAssertion } from "@/auth/subtitle-review-assertion"
import { reviewerRequestBodyDigest } from "@/services/subtitle-eval.service"

describe("Manager subtitle evaluation GraphQL contract", () => {
  it("registers the minimum corpus, run, worker, and reviewer operations", () => {
    const queries = schema.getQueryType()!.getFields()
    const mutations = schema.getMutationType()!.getFields()

    expect(Object.keys(queries)).toEqual(
      expect.arrayContaining([
        "managerSubtitleEvalCorpusVersion",
        "managerSubtitleEvalRun",
        "managerSubtitleEvalRuns",
        "managerSubtitleEvalStaleRuns",
        "managerSubtitleEvalComparison",
        "managerSubtitleEvalReferenceIssues",
        "managerSubtitleEvalReviewerAssignments",
        "managerSubtitleEvalReviewerAssignment",
        "managerSubtitleEvalOperatorReviewerCandidates",
        "managerSubtitleEvalOperatorAssignments",
        "managerSubtitleEvalOperatorAssignment",
        "managerSubtitleEvalVideoContext",
      ]),
    )
    expect(Object.keys(mutations)).toEqual(
      expect.arrayContaining([
        "importManagerSubtitleEvalCorpus",
        "approveManagerSubtitleEvalCorpus",
        "createManagerSubtitleEvalRun",
        "claimManagerSubtitleEvalCell",
        "finalizeManagerSubtitleEvalCell",
        "failManagerSubtitleEvalCell",
        "claimManagerSubtitleEvalRecovery",
        "recoverManagerSubtitleEvalRun",
        "claimManagerSubtitleEvalMachineRecovery",
        "recoverManagerSubtitleEvalMachineRun",
        "finalizeManagerSubtitleEvalRun",
        "createManagerSubtitleEvalAssignment",
        "submitManagerSubtitleEvalReview",
        "createManagerSubtitleEvalComparison",
        "dispositionManagerSubtitleEvalReferenceIssue",
        "assignManagerSubtitleEvalSpecialist",
        "appendManagerSubtitleEvalNarrative",
      ]),
    )
  })

  it("does not expose client-writable spend ceilings", () => {
    const input = schema.getType("ManagerSubtitleEvalCreateRunInput") as {
      getFields(): Record<string, unknown>
    }
    expect(Object.keys(input.getFields()).join(" ")).not.toMatch(
      /maxPerRun|maxRolling|budget|estimatedSpend/i,
    )
  })

  it("makes assignment replay caller-stable without accepting presentation entropy", () => {
    const input = schema.getType(
      "ManagerSubtitleEvalCreateAssignmentInput",
    ) as { getFields(): Record<string, unknown> }
    expect(Object.keys(input.getFields())).toContain("idempotencyKey")
    expect(Object.keys(input.getFields())).not.toContain("presentationSeed")
    const specialist = schema.getType(
      "ManagerSubtitleEvalAssignSpecialistInput",
    ) as { getFields(): Record<string, unknown> }
    expect(Object.keys(specialist.getFields())).not.toContain(
      "presentationSeed",
    )
  })

  it("requires typed blind per-track assessments without ambiguous aggregate scores", () => {
    const input = schema.getType("ManagerSubtitleEvalSubmitReviewInput") as {
      getFields(): Record<string, { type: unknown }>
    }
    const fields = input.getFields()
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["trackAssessments", "questionableTrack"]),
    )
    expect(Object.keys(fields).join(" ")).not.toMatch(
      /meaningAccuracyScore|naturalnessScore|timingReadabilityScore|issueCodes|criticalMeaningLoss/,
    )
    expect(String(fields.trackAssessments?.type)).toMatch(/!$/)
    const track = schema.getType(
      "ManagerSubtitleEvalBlindTrackAssessmentInput",
    ) as { getFields(): Record<string, unknown> }
    expect(Object.keys(track.getFields())).toEqual(
      expect.arrayContaining([
        "meaningAccuracyScore",
        "naturalnessScore",
        "timingReadabilityScore",
        "issueCodes",
        "criticalMeaningLoss",
      ]),
    )
  })

  it("bounds operator reviewer and assignment projections without human text", () => {
    const candidates = schema
      .getQueryType()!
      .getFields().managerSubtitleEvalOperatorReviewerCandidates
    expect(candidates.args.map((arg) => arg.name).sort()).toEqual([
      "after",
      "limit",
      "specialistDimension",
      "targetLanguageId",
      "targetLanguageSlug",
    ])
    const detail = schema.getType("ManagerSubtitleEvalOperatorAssignment") as {
      getFields(): Record<string, unknown>
    }
    const fields = Object.keys(detail.getFields())
    expect(fields).toEqual(
      expect.arrayContaining([
        "sourceTrack",
        "referenceTrack",
        "candidateTrack",
        "machineAssessment",
        "reviews",
        "reviewerDisplayName",
        "referenceTrackLabel",
        "candidateTrackLabel",
      ]),
    )
    expect(fields.join(" ")).not.toMatch(/objectKey|presentationSeed/i)
  })

  it("takes reviewer detail authority only from the verified assertion", () => {
    const field = schema
      .getQueryType()!
      .getFields().managerSubtitleEvalReviewerAssignment
    expect(field.args.map((arg) => arg.name).sort()).toEqual([
      "assertion",
      "assignmentId",
    ])
    const queue = schema
      .getQueryType()!
      .getFields().managerSubtitleEvalReviewerAssignments
    expect(queue.args.map((arg) => arg.name)).toContain("assertion")
    expect(queue.args.map((arg) => arg.name)).not.toContain("actorId")
  })

  it("keeps reviewer projections digest-only and omits storage keys and subtitle text", () => {
    const track = schema.getType("ManagerSubtitleEvalReviewerTrack") as {
      getFields(): Record<string, unknown>
    }
    const assignment = schema.getType(
      "ManagerSubtitleEvalReviewerAssignment",
    ) as { getFields(): Record<string, unknown> }
    const reviewerContract = `${Object.keys(track.getFields()).join(" ")} ${Object.keys(assignment.getFields()).join(" ")}`
    expect(reviewerContract).toMatch(/trackA|trackB/i)
    expect(reviewerContract).not.toMatch(
      /reference|candidate|human|\bAI\b|model|prompt|risk|objectKey|storageObjectKey|sha|digest|hash|byteLength|fingerprint|presentationSeed/i,
    )
  })

  it("exposes named machine provenance only inside the nullable post-submit receipt", () => {
    const assignment = schema.getType(
      "ManagerSubtitleEvalReviewerAssignment",
    ) as { getFields(): Record<string, unknown> }
    const receipt = schema.getType("ManagerSubtitleEvalPostSubmitReceipt") as {
      getFields(): Record<string, { type: unknown }>
    }
    expect(Object.keys(assignment.getFields())).toContain("postSubmitReceipt")
    expect(Object.keys(assignment.getFields())).toEqual(
      expect.arrayContaining([
        "clipStartSeconds",
        "clipEndSeconds",
        "editionIdentity",
      ]),
    )
    expect(Object.keys(receipt.getFields()).sort()).toEqual([
      "assessmentDigest",
      "candidateTrackLabel",
      "machineAdvisoryRiskFlags",
      "referenceTrackLabel",
      "resolvedModel",
      "reviewId",
      "submittedAt",
    ])
    for (const name of [
      "assessmentDigest",
      "candidateTrackLabel",
      "machineAdvisoryRiskFlags",
      "referenceTrackLabel",
      "reviewId",
      "submittedAt",
    ]) {
      expect(String(receipt.getFields()[name]?.type)).toMatch(/!$/)
    }
    expect(String(receipt.getFields().resolvedModel?.type)).not.toMatch(/!$/)
    const machineInput = schema.getType(
      "ManagerSubtitleEvalMachineAssessmentInput",
    ) as { getFields(): Record<string, { type: unknown }> }
    expect(String(machineInput.getFields().advisoryRiskFlags?.type)).toMatch(
      /\[String!?\]/,
    )
  })

  it("returns null for cross-assignment or newly revoked reviewer detail", async () => {
    const field = schema
      .getQueryType()!
      .getFields().managerSubtitleEvalReviewerAssignment
    const assertion = await mintSubtitleReviewAssertion({
      actorId: "reviewer-1",
      assignmentId: "assignment-1",
      method: "GET",
      bodyDigest: reviewerRequestBodyDigest(""),
      requestId: "request-1",
    })
    const service = { getReviewerAssignment: vi.fn() }
    await expect(
      field.resolve?.(
        {},
        { assignmentId: "assignment-other", assertion },
        {
          user: { id: null, role: "MANAGER_BACKEND" },
          services: { subtitleEval: service },
        },
        {} as never,
      ),
    ).resolves.toBeNull()
    expect(service.getReviewerAssignment).not.toHaveBeenCalled()

    service.getReviewerAssignment.mockRejectedValueOnce(
      new Error("reviewer membership revoked"),
    )
    await expect(
      field.resolve?.(
        {},
        { assignmentId: "assignment-1", assertion },
        {
          user: { id: null, role: "MANAGER_BACKEND" },
          services: { subtitleEval: service },
        },
        {} as never,
      ),
    ).resolves.toBeNull()
  })

  it("keeps frozen-edition video context on the Manager backend boundary", async () => {
    const field = schema
      .getQueryType()!
      .getFields().managerSubtitleEvalVideoContext
    expect(field.args.map((arg) => arg.name).sort()).toEqual([
      "editionIdentity",
      "videoId",
    ])
    const contextType = schema.getType("ManagerSubtitleEvalVideoContext") as {
      getFields(): Record<string, unknown>
    }
    expect(Object.keys(contextType.getFields()).sort()).toEqual([
      "durationSeconds",
      "muxAssetId",
      "playbackId",
    ])
    const getVideoContext = vi.fn().mockResolvedValue({
      muxAssetId: "muxAssetExact",
      playbackId: "muxPlaybackExact",
      durationSeconds: 61,
    })
    await expect(
      field.resolve?.(
        {},
        { videoId: "video-core-1", editionIdentity: "edition-core-1" },
        {
          user: { id: null, role: "MANAGER_BACKEND" },
          services: { subtitleEval: { getVideoContext } },
        },
        {} as never,
      ),
    ).resolves.toMatchObject({ playbackId: "muxPlaybackExact" })
    expect(getVideoContext).toHaveBeenCalledWith({
      user: { id: null, role: "MANAGER_BACKEND" },
      videoId: "video-core-1",
      editionIdentity: "edition-core-1",
    })

    expect(() =>
      field.resolve?.(
        {},
        { videoId: "video-core-1", editionIdentity: "edition-core-1" },
        {
          user: { id: "operator-1", role: "VIEWER", managerRole: "OPERATOR" },
          services: { subtitleEval: { getVideoContext } },
        },
        {} as never,
      ),
    ).toThrow()
  })

  it("projects complete terminal evidence", () => {
    const terminal = schema.getType("ManagerSubtitleEvalTerminalReport") as {
      getFields(): Record<string, unknown>
    }
    const fields = Object.keys(terminal.getFields())
    expect(fields).toContain("artifactInventory")
    expect(fields).toContain("partialFailures")
  })

  it("delegates fail/requeue fencing to the ledger service", async () => {
    const failRunCell = vi.fn().mockResolvedValue({
      id: "run-cell-1",
      status: "QUEUED",
      errorCode: "provider_timeout",
    })
    const field = schema
      .getMutationType()!
      .getFields().failManagerSubtitleEvalCell

    await expect(
      field.resolve?.(
        {},
        {
          input: {
            runCellId: "run-cell-1",
            leaseGeneration: 2,
            leaseToken: "lease-token",
            errorCode: "provider_timeout",
            retryable: true,
            providerCalls: [],
          },
        },
        {
          user: { id: null, role: "MANAGER_BACKEND" },
          services: { subtitleEval: { failRunCell } },
        },
        {} as never,
      ),
    ).resolves.toEqual({
      id: "run-cell-1",
      status: "QUEUED",
      digest: "provider_timeout",
      replayed: false,
    })
  })
})
