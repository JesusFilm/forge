import { describe, expect, it, vi } from "vitest"
import {
  INCUMBENT_HYBRID_MANIFEST,
  INCUMBENT_HYBRID_AA_MANIFEST,
  COWATCH_MMR_TRIAL_MANIFEST,
  recommendationManifestDigest,
} from "../promotion/manifest"
import { cowatchTrialBindingDigest } from "../cowatch/trial-authority.service"
import { parseStudyProtocol } from "./study-protocol"
import { calibrationMatchesProtocol } from "./study-authority"
import {
  readStudyDependencies,
  studyCowatchBinding,
  studyDependencyInterruption,
  studyManifestPairIsExact,
} from "./study-dependencies"

const start = "2026-10-05T00:00:00.000Z",
  end = "2026-10-07T00:00:00.000Z",
  horizon = "2026-10-08T06:00:00.000Z"
const identity = {
  experimentId: "trial-1",
  experimentGeneration: 1,
  protocolDigest: "f".repeat(64),
}
const protocol = () =>
  parseStudyProtocol({
    version: "profile-study-governance-v1",
    studyId: identity.experimentId,
    mode: "efficacy",
    comparison: "incumbent-cowatch-mmr",
    identity: "anonymous-profile-generation-v1",
    surface: "watch-below-player-v1",
    cohort: "human-en-english-durable-client-cowatch-mmr-v1",
    controlManifestId: INCUMBENT_HYBRID_MANIFEST.id,
    challengerManifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
    controlManifestDigest: recommendationManifestDigest(
      INCUMBENT_HYBRID_MANIFEST,
    ),
    challengerManifestDigest: recommendationManifestDigest(
      COWATCH_MMR_TRIAL_MANIFEST,
    ),
    incumbentExecution: "hybrid_personalized",
    controlExecution: "profile-viewing-mode-incumbent-v1",
    admissionBps: 1000,
    challengerProbability: 0.5,
    startsAt: start,
    endsAt: end,
    expiresAt: "2026-10-25T00:00:00.000Z",
    stoppingRule: "fixed-enrollment-window-v1",
    plannedAssignmentsPerArm: 500,
    minimumUsefulDelta: 0.01,
    evidenceMaxAgeHours: 24,
    calibrationEvaluationId: "calibration-result",
    cowatch: {
      mode: "frozen-source-controlled-trial-v1",
      graphGenerationId: "a".repeat(64),
      sourceWindow: {
        version: "episode-event-window-v1",
        windowStart: "2026-09-28T00:00:00.000Z",
        windowEnd: "2026-10-04T00:00:00.000Z",
        evaluationAsOf: "2026-10-04T00:00:00.000Z",
      },
      calibrationCompletedAt: "2026-10-03T06:00:00.000Z",
      trialValidUntil: horizon,
      earliestDependencyExpiresAt: "2026-10-10T00:00:00.000Z",
      shadowEvaluationId: "11111111-1111-4111-8111-111111111111",
      shadowDecisionId: "22222222-2222-4222-8222-222222222222",
    },
    composition: {
      protocolId: "33333333-3333-4333-8333-333333333333",
      manifestId: COWATCH_MMR_TRIAL_MANIFEST.id,
      composerVersion: "source-interest-theme-mmr-v1",
      configDigest: "b".repeat(64),
      evidenceDigest: "c".repeat(64),
      reviewDigest: "d".repeat(64),
      authorityRevision: 0,
      cowatchGenerationId: "a".repeat(64),
    },
  })
function harness() {
  const p = protocol(),
    binding = studyCowatchBinding(p, identity)!
  const authority = {
    bindingDigest: cowatchTrialBindingDigest(binding),
    ownerInfluenceFloorGeneration: 0,
    revokedAt: null as Date | null,
    qualifiedAt: new Date("2026-10-04T12:00:00Z"),
    dependencyExpiresAt: new Date("2026-10-10T00:00:00Z"),
    trialValidUntil: new Date(horizon),
  }
  const tx = {
    recommendationPromotionPointer: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ ownerInfluenceFloorGeneration: 0 }),
    },
    recommendationCowatchTrialAuthority: {
      findUnique: vi.fn().mockResolvedValue(authority),
    },
    recommendationCowatchGeneration: {
      findUnique: vi.fn().mockResolvedValue({
        expiresAt: authority.dependencyExpiresAt,
        invalidatedAt: null,
      }),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValue([{ validUntil: authority.dependencyExpiresAt }]),
  }
  return { p, authority, tx }
}
describe("exact study dependency authority", () => {
  it("rejects cached authority after the influence floor advances", async () => {
    const { p, tx } = harness()
    tx.recommendationPromotionPointer.findUnique.mockResolvedValue({
      ownerInfluenceFloorGeneration: 1,
    })
    expect(
      await readStudyDependencies(tx as never, p, identity, new Date(start)),
    ).toBeNull()
  })
  it("binds the complete incumbent and combined treatment policies", () => {
    const p = protocol()
    expect(
      studyManifestPairIsExact(
        p,
        INCUMBENT_HYBRID_MANIFEST,
        COWATCH_MMR_TRIAL_MANIFEST,
      ),
    ).toBe(true)
    expect(
      studyManifestPairIsExact(
        p,
        INCUMBENT_HYBRID_AA_MANIFEST,
        COWATCH_MMR_TRIAL_MANIFEST,
      ),
    ).toBe(false)
    expect(
      studyManifestPairIsExact(p, INCUMBENT_HYBRID_MANIFEST, {
        ...COWATCH_MMR_TRIAL_MANIFEST,
        configuration: {
          ...COWATCH_MMR_TRIAL_MANIFEST.configuration,
          graphPolicy: "another-policy",
        },
      }),
    ).toBe(false)
  })
  it("accepts current qualified bindings and stops new use at expiry or revocation", async () => {
    const { p, tx, authority } = harness()
    expect(
      await readStudyDependencies(tx as never, p, identity, new Date(start)),
    ).toMatchObject({
      validUntil: new Date(horizon),
      cowatch: { graphGenerationId: "a".repeat(64) },
    })
    expect(
      await readStudyDependencies(tx as never, p, identity, new Date(horizon)),
    ).toBeNull()
    tx.recommendationCowatchTrialAuthority.findUnique.mockResolvedValue({
      ...authority,
      revokedAt: new Date(start),
    })
    expect(
      await readStudyDependencies(tx as never, p, identity, new Date(start)),
    ).toBeNull()
  })
  it("distinguishes scheduled expiry from interruption during the retained trial", async () => {
    const { p, tx, authority } = harness()
    expect(
      await studyDependencyInterruption(tx as never, p, identity),
    ).toBeNull()
    tx.recommendationCowatchTrialAuthority.findUnique.mockResolvedValue({
      ...authority,
      revokedAt: new Date(end),
    })
    tx.recommendationCowatchGeneration.findUnique.mockResolvedValue(null)

    expect(await studyDependencyInterruption(tx as never, p, identity)).toBe(
      "cowatch_source_interrupted",
    )
    tx.recommendationCowatchTrialAuthority.findUnique.mockResolvedValue({
      ...authority,
      revokedAt: new Date("2026-10-09T00:00:00Z"),
    })
    expect(
      await studyDependencyInterruption(tx as never, p, identity),
    ).toBeNull()
    tx.recommendationCowatchTrialAuthority.findUnique.mockResolvedValue({
      ...authority,
      bindingDigest: "e".repeat(64),
    })
    expect(await studyDependencyInterruption(tx as never, p, identity)).toBe(
      "cowatch_source_interrupted",
    )
  })
  it("requires the actual incumbent calibration comparator and complete future coverage", () => {
    const p = protocol()
    const calibration = parseStudyProtocol({
      ...p,
      studyId: "calibration",
      mode: "calibration",
      comparison: "incumbent-aa",
      challengerManifestId: INCUMBENT_HYBRID_AA_MANIFEST.id,
      challengerManifestDigest: recommendationManifestDigest(
        INCUMBENT_HYBRID_AA_MANIFEST,
      ),
      startsAt: "2026-09-30T00:00:00.000Z",
      endsAt: "2026-10-02T00:00:00.000Z",
      minimumUsefulDelta: null,
      calibrationEvaluationId: null,
      cowatch: null,
      composition: null,
    })
    const authority = {
      study: { protocol: calibration },
      evaluation: { evaluatedAt: new Date(p.cowatch!.calibrationCompletedAt) },
      expiresAt: new Date(p.expiresAt),
    }
    expect(calibrationMatchesProtocol(authority, p)).toBe(true)
    // Earlier A/A is readable, but its enrollment population differs.
    expect(
      calibrationMatchesProtocol(
        {
          ...authority,
          study: {
            protocol: { ...calibration, cohort: "human-en-english-durable-v1" },
          },
        },
        p,
      ),
    ).toBe(false)
    expect(
      calibrationMatchesProtocol(
        { ...authority, expiresAt: new Date(horizon) },
        p,
      ),
    ).toBe(false)
    const semantic = parseStudyProtocol({
      ...calibration,
      comparison: "semantic-aa",
      cohort: "human-en-english-durable-v1",
      controlManifestId: "semantic-transcript-pgvector-v1",
      challengerManifestId: "semantic-experiment-aa-v1",
      controlExecution: "semantic_contextual",
    })
    expect(
      calibrationMatchesProtocol(
        { ...authority, study: { protocol: semantic } },
        p,
      ),
    ).toBe(false)
    expect(
      calibrationMatchesProtocol(
        { ...authority, evaluation: { evaluatedAt: new Date(start) } },
        p,
      ),
    ).toBe(false)
  })
})
