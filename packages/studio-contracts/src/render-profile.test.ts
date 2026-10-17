import { expect, it } from "vitest"
import {
  STUDIO_RENDER_PROFILE,
  STUDIO_RENDER_PROFILE_V1,
  studioRenderExecutionProfileSchema,
  studioRenderAdmissionSchema,
} from "./render"

it("reads exact historical and current profiles without upgrading historical bounds", () => {
  expect(
    studioRenderExecutionProfileSchema.parse(STUDIO_RENDER_PROFILE_V1),
  ).toEqual(STUDIO_RENDER_PROFILE_V1)
  expect(STUDIO_RENDER_PROFILE_V1.preparationMs).toBe(90000)
  expect(STUDIO_RENDER_PROFILE_V1.jobMs).toBe(900000)
  expect(
    studioRenderExecutionProfileSchema.parse(STUDIO_RENDER_PROFILE),
  ).toEqual(STUDIO_RENDER_PROFILE)
  for (const profile of [STUDIO_RENDER_PROFILE_V1, STUDIO_RENDER_PROFILE]) {
    expect(
      studioRenderExecutionProfileSchema.safeParse({
        ...profile,
        preparationMs: profile.preparationMs + 1,
      }).success,
    ).toBe(false)
    expect(
      studioRenderExecutionProfileSchema.safeParse({ ...profile, extra: 1 })
        .success,
    ).toBe(false)
    expect(
      studioRenderExecutionProfileSchema.safeParse({ id: profile.id }).success,
    ).toBe(false)
  }
})

it("admits only the current profile and keeps physical resource bounds unchanged", () => {
  expect(
    studioRenderAdmissionSchema.shape.profileId.safeParse(
      STUDIO_RENDER_PROFILE_V1.id,
    ).success,
  ).toBe(false)
  for (const key of [
    "cpu",
    "memoryBytes",
    "swapBytes",
    "aggregatePids",
    "childPids",
    "outputBytes",
  ] as const)
    expect(STUDIO_RENDER_PROFILE[key]).toBe(STUDIO_RENDER_PROFILE_V1[key])
  expect(STUDIO_RENDER_PROFILE.preparationMs).toBe(180000)
  expect(STUDIO_RENDER_PROFILE.jobMs).toBe(1200000)
  expect(STUDIO_RENDER_PROFILE.leaseMs).toBeGreaterThan(
    STUDIO_RENDER_PROFILE.requestMs,
  )
})
