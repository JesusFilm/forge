import { describe, expect, it, vi } from "vitest"
import {
  isRecommendationAssignmentCapabilityCurrent,
  lockRecommendationAssignmentCapabilityFence,
} from "./assignment-capability"

const now = new Date("2026-08-25T00:00:00.000Z")

function personalizedAssignment() {
  return {
    profileId: "profile-1",
    privacyGeneration: 4,
    state: "ACTIVE" as const,
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    profile: {
      state: "ACTIVE" as const,
      tokenDigest: "a".repeat(64),
      privacyGeneration: 4,
      expiresAt: new Date("2027-02-21T00:00:00.000Z"),
    },
  }
}

describe("isRecommendationAssignmentCapabilityCurrent", () => {
  it("preserves non-profile capabilities for their normal lifetime", () => {
    expect(
      isRecommendationAssignmentCapabilityCurrent({ profileId: null }, now),
    ).toBe(true)
    expect(isRecommendationAssignmentCapabilityCurrent(null, now)).toBe(true)
  })

  it("accepts only the active matching personalized privacy generation", () => {
    expect(
      isRecommendationAssignmentCapabilityCurrent(
        personalizedAssignment(),
        now,
      ),
    ).toBe(true)
    expect(
      isRecommendationAssignmentCapabilityCurrent(
        { ...personalizedAssignment(), state: "FENCED" },
        now,
      ),
    ).toBe(false)
    expect(
      isRecommendationAssignmentCapabilityCurrent(
        {
          ...personalizedAssignment(),
          profile: {
            ...personalizedAssignment().profile,
            privacyGeneration: 5,
          },
        },
        now,
      ),
    ).toBe(false)
    expect(
      isRecommendationAssignmentCapabilityCurrent(
        {
          ...personalizedAssignment(),
          profile: {
            ...personalizedAssignment().profile,
            state: "TOMBSTONED",
            tokenDigest: null,
          },
        },
        now,
      ),
    ).toBe(false)
  })

  it("locks the exact assignment and profile generation before personalized evidence commits", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: "profile-1" }])
      .mockResolvedValueOnce([{ id: "assignment-1" }])

    await expect(
      lockRecommendationAssignmentCapabilityFence(
        { $queryRaw: queryRaw } as never,
        { id: "assignment-1", ...personalizedAssignment() },
        now,
      ),
    ).resolves.toBe(true)
    const profileQuery = queryRaw.mock.calls[0]?.[0] as { strings: string[] }
    const assignmentQuery = queryRaw.mock.calls[1]?.[0] as {
      strings: string[]
    }
    expect(profileQuery.strings.join(" ")).toMatch(
      /FROM recommendation_profile[\s\S]*FOR SHARE/,
    )
    expect(assignmentQuery.strings.join(" ")).toMatch(
      /FROM recommendation_experiment_assignment[\s\S]*FOR SHARE/,
    )

    queryRaw.mockResolvedValueOnce([])
    await expect(
      lockRecommendationAssignmentCapabilityFence(
        { $queryRaw: queryRaw } as never,
        { id: "assignment-1", ...personalizedAssignment() },
        now,
      ),
    ).resolves.toBe(false)
    expect(queryRaw).toHaveBeenCalledTimes(3)
  })
})
