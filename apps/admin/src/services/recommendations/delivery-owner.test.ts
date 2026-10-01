import { beforeEach, describe, expect, it, vi } from "vitest"
import { adaptSemanticCandidates } from "./candidate"
import { loadBoundedCowatchNominations } from "./cowatch/live.service"
import { composeMmrSlate } from "./composition/mmr"
import {
  COWATCH_DURABLE_LINEAGE_VERSION,
  COWATCH_FEATURE_VERSION,
  COWATCH_PROJECTION_VERSION,
} from "./cowatch/graph"
import { MMR_CONFIG } from "./composition/policy"
import { RecommendationInternalStateError } from "./errors"
import { applyMmrComposition, runCandidatePlatform } from "./orchestration"
import {
  lockOwnerProfileForIssuance,
  lockOwnerReleaseForIssuance,
  readActiveOwnerRelease,
} from "./promotion/owner-authority"
import {
  COWATCH_MMR_GENERATOR_SET_VERSION,
  COWATCH_OWNER_LIVE_MODE,
  OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
  OWNER_APPROVED_COWATCH_MMR_MANIFEST,
  OWNER_RELEASE_POLICY_VERSION,
  INCUMBENT_HYBRID_MANIFEST_ID,
} from "./promotion/manifest"
import {
  composeDeliveryOwnerCowatch,
  type OwnerDeliveryAuthority,
  type OwnerCompositionInput,
} from "./delivery-owner.service"
import {
  makeHarness,
  personalizedInput,
  profileCandidateResult,
  semanticCandidates,
} from "./delivery.service.test-helpers"

vi.mock("./promotion/owner-authority", () => ({
  lockOwnerProfileForIssuance: vi.fn(),
  lockOwnerReleaseForIssuance: vi.fn(),
  readActiveOwnerRelease: vi.fn(),
  directDeliveryAuthorityDigest: (value: unknown) => JSON.stringify(value),
}))
vi.mock("./cowatch/live.service", () => ({
  loadBoundedCowatchNominations: vi.fn(),
}))
vi.mock("./viewing-mode.service", () => ({
  loadViewingModeAffinity: vi.fn(async () => null),
  lockViewingModeAuthority: vi.fn(),
}))

const authority: OwnerDeliveryAuthority = {
  privacyGeneration: 7,
  release: {
    releaseId: "owner-release",
    pointerGeneration: 4,
    manifestId: OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
    manifestDigest: "a".repeat(64),
    graphGenerationId: "b".repeat(64),
    bindingDigest: "c".repeat(64),
    validUntil: new Date("2026-08-20T02:00:00Z"),
    dependencyExpiresAt: new Date("2026-08-25T00:00:00Z"),
    binding: {
      policyVersion: OWNER_RELEASE_POLICY_VERSION,
      mode: COWATCH_OWNER_LIVE_MODE,
      publishedAt: "2026-08-19T02:00:00Z",
      ownerInfluenceFloorGeneration: 1,
      population: OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration.population,
      fallbackManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
      sourceWindow: {
        version: "episode-event-window-v1",
        windowStart: "2026-08-12T00:00:00Z",
        windowEnd: "2026-08-19T00:00:00Z",
        evaluationAsOf: "2026-08-19T01:00:00Z",
      },
      lineageVersion: COWATCH_DURABLE_LINEAGE_VERSION,
      projectionVersion: COWATCH_PROJECTION_VERSION,
      featureVersion: COWATCH_FEATURE_VERSION,
      composerVersion: "source-interest-theme-mmr-v1",
      compositionConfig: MMR_CONFIG,
      compositionConfigDigest: "d".repeat(64),
    },
  },
}
const request = () => ({
  ...personalizedInput(),
  clientDeliveryContract: "cowatch-mmr-v1",
})
function composed(input: OwnerCompositionInput) {
  const co = adaptSemanticCandidates(semanticCandidates(1), input.context)
    .nominations[0]!
  const nomination = {
    ...co,
    nominationKey: "owner-co-watch",
    targetMediaId: "owner-co-target",
    canonicalIdentity: {
      ...co.canonicalIdentity,
      videoId: "owner-co-target",
      videoCoreId: "owner-co-target",
    },
    source: {
      ...co.source,
      generator: "directional-cowatch",
      generatorVersion: COWATCH_OWNER_LIVE_MODE,
      score: 1,
      evidence: {
        generation: authority.release.graphGenerationId,
        interestOrdinal: 1,
      },
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
    status: "composed" as const,
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
}
function setup(candidateTraceFormat?: "legacy" | "compact") {
  const resolveOwnerAuthority = vi.fn(
    async (): Promise<OwnerDeliveryAuthority | null> => authority,
  )
  const composeOwnerCowatch = vi.fn<
    NonNullable<
      import("./delivery.types").DeliveryDependencies["composeOwnerCowatch"]
    >
  >(async (input) => composed(input))
  const h = makeHarness({
    candidateTraceFormat,
    profileComparison: true,
    owner: { resolveOwnerAuthority, composeOwnerCowatch },
  })
  h.retrieve.mockResolvedValue(semanticCandidates(6))
  h.retrieveProfile.mockResolvedValue({
    ...profileCandidateResult,
    projection: { ...profileCandidateResult.projection, scope: "durable" },
  })
  return { ...h, resolveOwnerAuthority, composeOwnerCowatch }
}

describe("owner-approved direct delivery", () => {
  it("carries the real owner composer failure flags into the incumbent trace without recomputation", async () => {
    const h = setup("compact")
    vi.mocked(readActiveOwnerRelease).mockResolvedValue(authority.release)
    const context = {
      surface: "watch-below-player-v1",
      purpose: "watch",
      locale: "en",
      audioLanguageSlug: "english",
    } as const
    const base = adaptSemanticCandidates(semanticCandidates(1), context)
      .nominations[0]!
    vi.mocked(loadBoundedCowatchNominations).mockResolvedValue({
      nominations: [
        {
          ...base,
          nominationKey: "graph-missing-theme",
          targetMediaId: "graph-missing-theme",
          canonicalIdentity: {
            videoId: "graph-missing-theme",
            videoCoreId: "graph-missing-theme",
            videoTitle: "Distinct graph fixture",
            embeddingText: null,
          },
          presentation: {
            ...base.presentation,
            videoTitle: "Distinct graph fixture",
            themes: [],
          },
          source: {
            ...base.source,
            generator: "directional-cowatch",
            generatorVersion: COWATCH_OWNER_LIVE_MODE,
            rank: 1,
            score: 1,
            evidence: { generation: authority.release.graphGenerationId },
          },
        },
      ],
      fallbackReason: null,
    })
    h.composeOwnerCowatch.mockImplementation((input) =>
      composeDeliveryOwnerCowatch(h.prisma as never, input),
    )
    const result = await h.service.deliver(request())
    expect(result).toMatchObject({
      result: "fallback",
      reason: "composition_required_input_unavailable",
    })
    const attempted = await h.composeOwnerCowatch.mock.results[0]!.value
    expect(attempted).toMatchObject({
      status: "fallback",
      compositionInputDiagnostic: {
        missingSource: false,
        missingInterest: false,
        missingTheme: true,
        missingHistory: false,
        selectedCount: 6,
        themedSelectedCount: 5,
      },
    })
    const payload = h.tx.recommendationCandidateRun.create.mock.calls[0]![0]
      .data.tracePayload as {
      stages: Array<{
        stage: string
        sourceGenerator: string
        sourceEvidence: Array<{ evidence: unknown }>
      }>
    }
    const rejected = payload.stages.find(
      (row) =>
        row.stage === "rejected" &&
        row.sourceGenerator === "directional-cowatch",
    )!
    expect(rejected.sourceEvidence[0]!.evidence).toEqual(
      attempted.status === "fallback"
        ? attempted.compositionInputDiagnostic
        : null,
    )
    expect(
      result.items.every(
        (item) => item.candidateGenerator !== "directional-cowatch",
      ),
    ).toBe(true)
    expect(lockOwnerReleaseForIssuance).not.toHaveBeenCalled()
  })
  it.each(["legacy", "compact"] as const)(
    "persists exact failed-composition aggregates in the existing %s rejection only",
    async (format) => {
      const diagnostic = {
        version: "composition-input-availability-v1" as const,
        missingSource: false,
        missingInterest: false,
        missingTheme: true,
        missingHistory: false,
        candidateCount: 31,
        selectedCount: 6,
        themedSelectedCount: 4,
      }
      const reason = "composition_required_input_unavailable"
      const baseline = setup(format)
      baseline.composeOwnerCowatch.mockResolvedValue({
        status: "fallback",
        reason,
      })
      const before = await baseline.service.deliver(request())
      const h = setup(format)
      const unexpectedExtraField = {
        ...diagnostic,
        privateMediaId: "discarded",
      }
      h.composeOwnerCowatch.mockResolvedValue({
        status: "fallback",
        reason,
        compositionInputDiagnostic: unexpectedExtraField,
      })
      const result = await h.service.deliver(request())
      expect(result).toEqual(before)
      const rows = (value: ReturnType<typeof setup>) =>
        format === "legacy"
          ? value.evidenceWrites[0]!
          : (
              value.tx.recommendationCandidateRun.create.mock.calls[0]![0].data
                .tracePayload as { stages: Array<Record<string, unknown>> }
            ).stages
      const evidence = rows(h)
      expect(evidence).toHaveLength(rows(baseline).length)
      expect(
        rows(baseline).find(
          (row) =>
            row.sourceGenerator === "directional-cowatch" &&
            row.stage === "rejected",
        )?.sourceEvidence,
      ).toEqual([])
      const rejected = evidence.filter(
        (row) =>
          row.sourceGenerator === "directional-cowatch" &&
          row.stage === "rejected",
      )
      expect(rejected).toEqual([
        expect.objectContaining({
          targetMediaId: null,
          reasonCodes: [reason],
          sourceEvidence: [
            {
              generator: "mmr-composition-inputs",
              generatorVersion: diagnostic.version,
              rank: 0,
              score: 0,
              evidence: diagnostic,
              rejectionReason: reason,
            },
          ],
        }),
      ])
      expect([...h.requests.values()][0]).toMatchObject({
        ownerReleaseId: null,
        ownerReleaseGeneration: null,
        experimentAssignmentId: null,
      })
      expect(result.personalization?.executionMode).toBe("hybrid_personalized")
      expect(JSON.stringify(result)).not.toContain(
        "composition-input-availability",
      )
      expect(lockOwnerReleaseForIssuance).not.toHaveBeenCalled()
    },
  )
  beforeEach(() => {
    vi.mocked(lockOwnerProfileForIssuance).mockReset()
    vi.mocked(lockOwnerReleaseForIssuance).mockReset()
  })
  it("composes without assignment, stores exact release influence, and fences before persistence", async () => {
    const h = setup()
    const result = await h.service.deliver(request())
    expect(result).toMatchObject({
      result: "served",
      personalization: {
        executionMode: "cowatch_mmr_personalized",
        effectiveManifestId: OWNER_APPROVED_COWATCH_MMR_MANIFEST_ID,
      },
    })
    expect(
      result.items.some(
        (item) => item.candidateGenerator === "directional-cowatch",
      ),
    ).toBe(true)
    expect(h.assignProfileExperiment).not.toHaveBeenCalled()
    expect(h.assignExperiment).not.toHaveBeenCalled()
    expect([...h.requests.values()]).toEqual([
      expect.objectContaining({
        ownerReleaseId: "owner-release",
        ownerReleaseGeneration: 4,
        experimentAssignmentId: null,
      }),
    ])
    expect(lockOwnerReleaseForIssuance).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        expected: authority.release,
        privacyGeneration: 7,
        profileProjectionId: "projection-2",
        consentReceiptDigest: request().consentReceiptDigest,
      }),
    )
    for (const [claims] of h.signDeliveryCapability.mock.calls)
      expect(claims).not.toHaveProperty("assignmentId")
  })
  it.each([null, undefined, "unknown-parser"])(
    "keeps unsupported capability %s on compatible incumbent",
    async (clientDeliveryContract) => {
      const h = setup()
      const result = await h.service.deliver({
        ...request(),
        clientDeliveryContract,
      })
      expect(result.personalization?.executionMode).toBe("hybrid_personalized")
      expect(
        result.items.every(
          (item) => item.candidateGenerator !== "directional-cowatch",
        ),
      ).toBe(true)
      expect(h.resolveOwnerAuthority).not.toHaveBeenCalled()
      expect(h.composeOwnerCowatch).not.toHaveBeenCalled()
      expect(lockOwnerReleaseForIssuance).not.toHaveBeenCalled()
    },
  )
  it.each([{ locale: "fr" }, { audioLanguageSlug: "french" }])(
    "does not admit out-of-scope locale/audio %j",
    async (change) => {
      const h = setup()
      await h.service.deliver({ ...request(), ...change })
      expect(h.resolveOwnerAuthority).not.toHaveBeenCalled()
      expect(h.composeOwnerCowatch).not.toHaveBeenCalled()
    },
  )
  it.each(["session", "cold", "empty-interest"])(
    "does not admit %s profiles",
    async (scope) => {
      const h = setup()
      h.retrieveProfile.mockResolvedValue(
        scope === "cold"
          ? null
          : {
              ...profileCandidateResult,
              projection: {
                ...profileCandidateResult.projection,
                scope: scope === "session" ? "session" : "durable",
                interestCount: scope === "empty-interest" ? 0 : 1,
              },
            },
      )
      await h.service.deliver(request())
      expect(h.resolveOwnerAuthority).not.toHaveBeenCalled()
      expect(h.composeOwnerCowatch).not.toHaveBeenCalled()
    },
  )
  it("returns ordinary incumbent for absent authority without invented release provenance", async () => {
    const h = setup()
    h.resolveOwnerAuthority.mockResolvedValue(null)
    const result = await h.service.deliver(request())
    expect(result.personalization?.executionMode).toBe("hybrid_personalized")
    expect(h.composeOwnerCowatch).not.toHaveBeenCalled()
    expect([...h.requests.values()][0]).toMatchObject({
      ownerReleaseId: null,
      ownerReleaseGeneration: null,
    })
  })
  it.each([
    "cowatch_supported_edges_sparse",
    "cowatch_unplayable",
    "composition_required_input_unavailable",
    "owner_authority_unavailable",
    "owner_deadline",
  ])("discards bundle on %s and preserves exact incumbent", async (reason) => {
    const h = setup()
    h.composeOwnerCowatch.mockResolvedValue({ status: "fallback", reason })
    const result = await h.service.deliver(request())
    expect(result).toMatchObject({
      result: "fallback",
      reason,
      personalization: {
        executionMode: "hybrid_personalized",
        effectiveManifestId: INCUMBENT_HYBRID_MANIFEST_ID,
        reason: "cowatch_mmr_incumbent_fallback",
      },
    })
    expect(
      result.items.every(
        (item) => item.candidateGenerator !== "directional-cowatch",
      ),
    ).toBe(true)
    expect([...h.requests.values()][0]).toMatchObject({
      ownerReleaseId: null,
      ownerReleaseGeneration: null,
      experimentAssignmentId: null,
    })
    expect(lockOwnerReleaseForIssuance).not.toHaveBeenCalled()
    expect(lockOwnerProfileForIssuance).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({
        privacyGeneration: authority.privacyGeneration,
        profileProjectionId: "projection-2",
        consentReceiptDigest: request().consentReceiptDigest,
      }),
    )
    expect(h.assignProfileExperiment).not.toHaveBeenCalled()
  })
  it.each([
    "owner_release_profile_fenced",
    "owner_release_profile_lineage_fenced",
  ])(
    "refuses prepared personalized fallback when its final fence reports %s",
    async (code) => {
      const h = setup()
      h.composeOwnerCowatch.mockResolvedValue({
        status: "fallback",
        reason: "owner_authority_unavailable",
      })
      vi.mocked(lockOwnerProfileForIssuance).mockRejectedValue(
        new RecommendationInternalStateError(code),
      )
      const result = await h.service.deliver(request())
      expect(result).toMatchObject({
        result: "unavailable",
        reason: "persistence_unavailable",
        items: [],
      })
      expect(h.tx.recommendationRequest.create).not.toHaveBeenCalled()
      expect(lockOwnerReleaseForIssuance).not.toHaveBeenCalled()
    },
  )
  it("contains source errors and does not emit partial graph results", async () => {
    const h = setup()
    h.composeOwnerCowatch.mockRejectedValue(new Error("private source detail"))
    const result = await h.service.deliver(request())
    expect(result).toMatchObject({
      result: "fallback",
      reason: "owner_source_unavailable",
    })
    expect(JSON.stringify(result)).not.toContain("private source detail")
    expect(
      result.items.every(
        (item) => item.candidateGenerator !== "directional-cowatch",
      ),
    ).toBe(true)
  })
  it("aborts issuance when privacy/source/release changed after preparation", async () => {
    const h = setup()
    vi.mocked(lockOwnerReleaseForIssuance).mockRejectedValue(
      new RecommendationInternalStateError("owner_release_fenced"),
    )
    const result = await h.service.deliver(request())
    expect(result).toMatchObject({
      result: "unavailable",
      reason: "persistence_unavailable",
      items: [],
    })
    expect(h.tx.recommendationRequest.create).not.toHaveBeenCalled()
  })
})
