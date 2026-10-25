import { beforeEach, describe, expect, it, vi } from "vitest"
import { adaptSemanticCandidates } from "./candidate"
import { composeMmrSlate } from "./composition/mmr"
import { RecommendationInternalStateError } from "./errors"
import {
  lockActiveStudyAuthorityForIssuance,
  type ActiveStudyAuthority,
} from "./experiment/active-study-authority"
import type { ExperimentAssignmentContext } from "./experiment/assignment"
import { applyMmrComposition, runCandidatePlatform } from "./orchestration"
import {
  COWATCH_MMR_GENERATOR_SET_VERSION,
  COWATCH_MMR_TRIAL_MANIFEST_ID,
  INCUMBENT_HYBRID_MANIFEST_ID,
  INCUMBENT_HYBRID_AA_MANIFEST_ID,
} from "./promotion/manifest"
import {
  makeHarness,
  personalizedInput as legacyPersonalizedInput,
  profileCandidateResult,
  semanticCandidates,
} from "./delivery.service.test-helpers"
const personalizedInput = () => ({
  ...legacyPersonalizedInput(),
  clientDeliveryContract: "cowatch-mmr-v1",
})

vi.mock("./experiment/active-study-authority", () => ({
  lockActiveStudyAuthorityForIssuance: vi.fn(),
}))
vi.mock("./experiment/usefulness-routing", () => ({
  lockProfileUsefulnessAssignment: vi.fn(),
}))

const assignment: ExperimentAssignmentContext = {
  assignmentId: "assignment",
  experimentId: "experiment",
  experimentVersion: "study-v2",
  experimentGeneration: 1,
  arm: "challenger",
  effectiveManifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
  assignmentProbability: 0.5,
  configurationDigest: "a".repeat(64),
}
const authority: ActiveStudyAuthority = {
  execution: "cowatch_mmr",
  experimentId: "experiment",
  experimentGeneration: 1,
  protocolDigest: "a".repeat(64),
  challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
  validUntil: new Date("2026-08-25"),
  cowatch: null,
  composition: null,
}
function setup() {
  const resolveStudyAuthority = vi.fn(
    async (): Promise<ActiveStudyAuthority | null> => authority,
  )
  const composeCowatchTrial =
    vi.fn<
      NonNullable<
        import("./delivery.types").DeliveryDependencies["composeCowatchTrial"]
      >
    >()
  const h = makeHarness({
    profileComparison: true,
    study: { resolveStudyAuthority, composeCowatchTrial },
  })
  h.assignProfileExperiment.mockResolvedValue({
    assignment,
    bypassReason: null,
  })
  h.retrieve.mockResolvedValue(semanticCandidates(6))
  h.retrieveProfile.mockResolvedValue({
    ...profileCandidateResult,
    projection: { ...profileCandidateResult.projection, scope: "durable" },
  })
  return { ...h, resolveStudyAuthority, composeCowatchTrial }
}

describe("controlled live trial delivery", () => {
  beforeEach(() => {
    vi.mocked(lockActiveStudyAuthorityForIssuance).mockReset()
  })
  it.each([undefined, null, "unknown-parser"])(
    "keeps assigned older-client follow-up on the incumbent for capability %s",
    async (clientDeliveryContract) => {
      const h = setup()
      const response = await h.service.deliver({
        ...personalizedInput(),
        clientDeliveryContract,
      })
      expect(response).toMatchObject({
        result: "fallback",
        reason: "client_contract_unsupported",
        personalization: {
          executionMode: "hybrid_personalized",
          effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
          reason: "cowatch_mmr_incumbent_fallback",
        },
      })
      expect(h.composeCowatchTrial).not.toHaveBeenCalled()
      expect(h.assignProfileExperiment).toHaveBeenCalledWith(
        expect.objectContaining({ clientDeliveryContract }),
      )
      expect(h.tx.recommendationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          experimentAssignmentId: assignment.assignmentId,
          fallbackReason: "client_contract_unsupported",
        }),
      })
      expect(lockActiveStudyAuthorityForIssuance).toHaveBeenCalled()
      expect(
        response.items.every(
          (item) => item.candidateGenerator !== "directional-cowatch",
        ),
      ).toBe(true)
    },
  )
  it("does not issue when exact study authority is missing", async () => {
    const h = setup()
    h.resolveStudyAuthority.mockResolvedValue(null)
    const response = await h.service.deliver(personalizedInput())
    expect(response).toMatchObject({
      result: "unavailable",
      reason: "study_authority_unavailable",
    })
    expect(h.composeCowatchTrial).not.toHaveBeenCalled()
    expect(h.tx.recommendationRequest.create).not.toHaveBeenCalled()
  })
  it.each(["control", "challenger"] as const)(
    "records an assigned %s cold start as the actual incumbent fallback",
    async (arm) => {
      const h = setup()
      const assigned = {
        ...assignment,
        arm,
        effectiveManifestId:
          arm === "control"
            ? INCUMBENT_HYBRID_MANIFEST_ID
            : COWATCH_MMR_TRIAL_MANIFEST_ID,
      }
      h.assignProfileExperiment.mockResolvedValue({
        assignment: assigned,
        bypassReason: null,
      })
      h.resolveStudyAuthority.mockResolvedValue({
        ...authority,
        execution: arm === "control" ? "incumbent" : "cowatch_mmr",
      })
      h.retrieveProfile.mockResolvedValue(null)
      const response = await h.service.deliver(personalizedInput())
      expect(response).toMatchObject({
        result: "fallback",
        personalization: {
          lane: "semantic_fallback",
          executionMode: "semantic_fallback",
          effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
          reason:
            arm === "control"
              ? "incumbent_operational_fallback"
              : "cowatch_mmr_incumbent_fallback",
        },
      })
      expect(h.composeCowatchTrial).not.toHaveBeenCalled()
      expect(h.tx.recommendationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          experimentAssignmentId: assignment.assignmentId,
        }),
      })
    },
  )
  it.each(["cowatch_unplayable", "composition_required_input_unavailable"])(
    "preserves assignment and the actual incumbent on %s",
    async (reason) => {
      const h = setup()
      h.composeCowatchTrial.mockResolvedValue({ status: "fallback", reason })
      const response = await h.service.deliver(personalizedInput())
      expect(response).toMatchObject({
        result: "fallback",
        reason,
        personalization: {
          executionMode: "hybrid_personalized",
          effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
          reason: "cowatch_mmr_incumbent_fallback",
        },
      })
      expect(
        response.items.some(
          (item) => item.candidateGenerator === "multi-interest-profile",
        ),
      ).toBe(true)
      expect(h.tx.recommendationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          experimentAssignmentId: assignment.assignmentId,
          fallbackReason: reason,
        }),
      })
      expect(lockActiveStudyAuthorityForIssuance).toHaveBeenCalledWith(
        h.tx,
        expect.objectContaining({ assignment, expected: authority }),
      )
    },
  )
  it("uses the authorized MMR order and records its actual co-watch contributor", async () => {
    const h = setup()
    h.composeCowatchTrial.mockImplementation(async (input) => {
      const co = adaptSemanticCandidates(
        [semanticCandidates(1)[0]!],
        input.context,
      ).nominations[0]!
      const nomination = {
        ...co,
        nominationKey: "co-watch",
        targetMediaId: "co-target",
        canonicalIdentity: {
          ...co.canonicalIdentity,
          videoId: "co-target",
          videoCoreId: "co-target",
          videoTitle: "Co target",
        },
        source: {
          ...co.source,
          generator: "directional-cowatch",
          score: 1,
          evidence: { generation: "b".repeat(64), interestOrdinal: 1 },
        },
      }
      const platform = runCandidatePlatform({
        context: input.context,
        nominations: [
          nomination,
          ...input.profileNominations,
          ...input.semanticNominations,
        ],
        limit: 6,
        generatorVersion: COWATCH_MMR_GENERATOR_SET_VERSION,
      })
      return {
        status: "composed",
        viewingMode: null,
        platform: applyMmrComposition(
          platform,
          composeMmrSlate({
            ordered: platform.ordered,
            context: input.context,
            limit: 6,
          }),
        ),
      }
    })
    const response = await h.service.deliver(personalizedInput())
    expect(response.personalization).toMatchObject({
      executionMode: "cowatch_mmr_personalized",
      effectiveManifestId: COWATCH_MMR_TRIAL_MANIFEST_ID,
    })
    expect(
      response.items.some(
        (item) => item.candidateGenerator === "directional-cowatch",
      ),
    ).toBe(true)
    expect(h.tx.recommendationCandidateRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          generatorVersion: COWATCH_MMR_GENERATOR_SET_VERSION,
          composerVersion: "source-interest-theme-mmr-v1",
        }),
      }),
    )
  })
  it("refuses issuance when a privacy or study fence changes after composition", async () => {
    const h = setup()
    h.composeCowatchTrial.mockResolvedValue({
      status: "fallback",
      reason: "cowatch_unplayable",
    })
    vi.mocked(lockActiveStudyAuthorityForIssuance).mockRejectedValue(
      new RecommendationInternalStateError("active_study_authority_fenced"),
    )
    const response = await h.service.deliver(personalizedInput())
    expect(response).toMatchObject({
      result: "unavailable",
      reason: "persistence_unavailable",
      items: [],
    })
    expect(h.tx.recommendationRequest.create).not.toHaveBeenCalled()
  })
  it.each(["control", "challenger"] as const)(
    "runs the same incumbent and viewing policy for the A/A %s arm",
    async (arm) => {
      const h = setup()
      h.assignProfileExperiment.mockResolvedValue({
        assignment: {
          ...assignment,
          arm,
          effectiveManifestId:
            arm === "control"
              ? INCUMBENT_HYBRID_MANIFEST_ID
              : INCUMBENT_HYBRID_AA_MANIFEST_ID,
        },
        bypassReason: null,
      })
      h.resolveStudyAuthority.mockResolvedValue({
        ...authority,
        execution: "incumbent",
        challengerManifestId: INCUMBENT_HYBRID_AA_MANIFEST_ID,
      })
      const response = await h.service.deliver(personalizedInput())
      expect(response.personalization?.executionMode).toBe(
        "hybrid_personalized",
      )
      expect(h.loadViewingModeAffinity).toHaveBeenCalledOnce()
      expect(h.composeCowatchTrial).not.toHaveBeenCalled()
    },
  )
})
