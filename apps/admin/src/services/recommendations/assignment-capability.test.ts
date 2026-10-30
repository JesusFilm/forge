import { describe, expect, it, vi } from "vitest"
import {
  isRecommendationAssignmentCapabilityCurrent,
  lockRecommendationAssignmentCapabilityFence,
} from "./assignment-capability"

const now = new Date("2026-08-25T00:00:00.000Z")

describe("retired profile assignment capability", () => {
  it("keeps session and control assignments eligible", () => {
    expect(
      isRecommendationAssignmentCapabilityCurrent({ profileId: null }, now),
    ).toBe(true)
    expect(isRecommendationAssignmentCapabilityCurrent(null, now)).toBe(true)
  })

  it("fences every historical profile-linked assignment without reading the retired table", async () => {
    const tx = { $queryRaw: vi.fn() }
    const assignment = {
      id: "assignment-1",
      profileId: "profile-1",
      privacyGeneration: 4,
    }
    expect(isRecommendationAssignmentCapabilityCurrent(assignment, now)).toBe(
      false,
    )
    await expect(
      lockRecommendationAssignmentCapabilityFence(tx as never, assignment, now),
    ).resolves.toBe(false)
    await expect(
      lockRecommendationAssignmentCapabilityFence(
        tx as never,
        { id: "session", profileId: null },
        now,
      ),
    ).resolves.toBe(true)
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })
})
