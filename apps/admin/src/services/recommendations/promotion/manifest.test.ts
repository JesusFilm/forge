import { describe, expect, it } from "vitest"
import {
  HYBRID_PERSONALIZED_MANIFEST,
  HYBRID_PERSONALIZED_MANIFEST_ID,
  isExactHybridPersonalizedManifest,
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
