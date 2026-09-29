import { describe, expect, it } from "vitest"
import {
  OWNER_APPROVED_COWATCH_MMR_MANIFEST,
  isExactOwnerApprovedCowatchMmrManifest,
  HYBRID_PERSONALIZED_MANIFEST,
  HYBRID_PERSONALIZED_MANIFEST_ID,
  isExactHybridPersonalizedManifest,
  INCUMBENT_HYBRID_MANIFEST,
  INCUMBENT_HYBRID_AA_MANIFEST,
  COWATCH_MMR_TRIAL_MANIFEST,
  isExactIncumbentHybridManifest,
  isExactIncumbentHybridAaManifest,
  isExactCowatchMmrTrialManifest,
  recommendationManifestDigest,
} from "./manifest"

describe("hybrid recommendation manifest", () => {
  it("pins both generators and every shared serving policy under a new identity", () => {
    expect(HYBRID_PERSONALIZED_MANIFEST_ID).not.toBe(
      "multi-interest-profile-pilot-v1",
    )
    expect(
      isExactHybridPersonalizedManifest(HYBRID_PERSONALIZED_MANIFEST),
    ).toBe(true)
  })

  it("rejects partially pinned or unsupported hybrid manifests", () => {
    expect(
      isExactHybridPersonalizedManifest({
        ...HYBRID_PERSONALIZED_MANIFEST,
        configuration: {
          ...HYBRID_PERSONALIZED_MANIFEST.configuration,
          composer: "unreviewed-composer-v2",
        },
      }),
    ).toBe(false)
    expect(
      isExactHybridPersonalizedManifest({
        ...HYBRID_PERSONALIZED_MANIFEST,
        configuration: {
          ...HYBRID_PERSONALIZED_MANIFEST.configuration,
          generators: [
            {
              generator: "multi-interest-profile",
              version: "multi-interest-profile-candidate-v1",
            },
          ],
        },
      }),
    ).toBe(false)
  })

  it("never reinterprets the legacy profile-only challenger as hybrid", () => {
    expect(
      isExactHybridPersonalizedManifest({
        ...HYBRID_PERSONALIZED_MANIFEST,
        id: "multi-interest-profile-pilot-v1",
        strategyVersion: "multi-interest-profile-pilot-v1",
        generator: "profile",
      }),
    ).toBe(false)
  })
})

describe("exact incumbent and combined trial manifest registry", () => {
  it("preserves profile and viewing mode identically in incumbent A/A", () => {
    expect(isExactIncumbentHybridManifest(INCUMBENT_HYBRID_MANIFEST)).toBe(true)
    expect(isExactIncumbentHybridAaManifest(INCUMBENT_HYBRID_AA_MANIFEST)).toBe(
      true,
    )
    const { behaviorallyEquivalentTo, ...configuration } =
      INCUMBENT_HYBRID_AA_MANIFEST.configuration
    expect(behaviorallyEquivalentTo).toBe(INCUMBENT_HYBRID_MANIFEST.id)
    expect(configuration).toEqual(INCUMBENT_HYBRID_MANIFEST.configuration)
    expect(isExactIncumbentHybridManifest(HYBRID_PERSONALIZED_MANIFEST)).toBe(
      false,
    )
    expect(isExactHybridPersonalizedManifest(INCUMBENT_HYBRID_MANIFEST)).toBe(
      false,
    )
  })
  it("pins combined treatment caps, fallback and composition without permitting arbitrary changes", () => {
    expect(isExactCowatchMmrTrialManifest(COWATCH_MMR_TRIAL_MANIFEST)).toBe(
      true,
    )
    expect(COWATCH_MMR_TRIAL_MANIFEST.configuration.nominationBudgets).toEqual({
      maximum: 64,
      semantic: 36,
      cowatch: 12,
      profile: "remaining-capacity",
      interleave: "semantic-profile-cowatch-v1",
    })
    expect(COWATCH_MMR_TRIAL_MANIFEST.configuration.effectAttribution).toBe(
      "combined-cowatch-and-mmr-only",
    )
    for (const change of [
      { viewingModeRanker: "disabled" },
      { graphPolicy: "refresh-on-request" },
      {
        nominationBudgets: {
          ...COWATCH_MMR_TRIAL_MANIFEST.configuration.nominationBudgets,
          cowatch: 13,
        },
      },
      {
        composition: {
          ...COWATCH_MMR_TRIAL_MANIFEST.configuration.composition,
          positionLimit: 8,
        },
      },
    ])
      expect(
        isExactCowatchMmrTrialManifest({
          ...COWATCH_MMR_TRIAL_MANIFEST,
          configuration: {
            ...COWATCH_MMR_TRIAL_MANIFEST.configuration,
            ...change,
          },
        }),
      ).toBe(false)
    expect(
      isExactCowatchMmrTrialManifest({
        ...COWATCH_MMR_TRIAL_MANIFEST,
        enabled: false,
      }),
    ).toBe(false)
    expect(recommendationManifestDigest(COWATCH_MMR_TRIAL_MANIFEST)).not.toBe(
      recommendationManifestDigest(INCUMBENT_HYBRID_MANIFEST),
    )
  })
})

describe("owner-approved live manifest", () => {
  it("keeps study identity separate and explicitly has no shadow qualification prerequisite", () => {
    expect(
      isExactOwnerApprovedCowatchMmrManifest(
        OWNER_APPROVED_COWATCH_MMR_MANIFEST,
      ),
    ).toBe(true)
    expect(
      isExactCowatchMmrTrialManifest(OWNER_APPROVED_COWATCH_MMR_MANIFEST),
    ).toBe(false)
    expect(
      isExactOwnerApprovedCowatchMmrManifest(COWATCH_MMR_TRIAL_MANIFEST),
    ).toBe(false)
    expect(OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration).toMatchObject({
      shadowDecisionRequired: null,
      shadowPopulation: null,
      usefulness: "not-measured-owner-authorized",
      graphMaximumAgeMs: 86_400_000,
      nominationBudgets: { maximum: 64, semantic: 36, cowatch: 12 },
    })
  })
  it("rejects scope, graph age and structural composer drift", () => {
    for (const configuration of [
      {
        ...OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration,
        graphMaximumAgeMs: 172_800_000,
      },
      {
        ...OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration,
        composer: "arbitrary",
      },
      {
        ...OWNER_APPROVED_COWATCH_MMR_MANIFEST.configuration,
        population: { locale: "all" },
      },
    ])
      expect(
        isExactOwnerApprovedCowatchMmrManifest({
          ...OWNER_APPROVED_COWATCH_MMR_MANIFEST,
          configuration,
        }),
      ).toBe(false)
  })
})
