import { expect, it } from "vitest"
import {
  STUDIO_RENDER_PROFILE,
  STUDIO_RENDER_PROFILE_V1,
  STUDIO_RENDER_PROFILE_V2,
  STUDIO_RENDER_PROFILE_V3,
  studioRenderExecutionProfileSchema,
  studioRenderAdmissionSchema,
  studioRenderLegacyAdmissionSchema,
} from "./render"

it("reads exact historical and current profiles without upgrading historical bounds", () => {
  expect(
    studioRenderExecutionProfileSchema.parse(STUDIO_RENDER_PROFILE_V1),
  ).toEqual(STUDIO_RENDER_PROFILE_V1)
  expect(STUDIO_RENDER_PROFILE_V1.preparationMs).toBe(90000)
  expect(STUDIO_RENDER_PROFILE_V1.jobMs).toBe(900000)
  expect(
    studioRenderExecutionProfileSchema.parse(STUDIO_RENDER_PROFILE_V2),
  ).toEqual(STUDIO_RENDER_PROFILE_V2)
  expect(STUDIO_RENDER_PROFILE_V2.jobMs).toBe(1200000)
  expect(
    studioRenderAdmissionSchema.shape.profileId.safeParse(
      STUDIO_RENDER_PROFILE_V2.id,
    ).success,
  ).toBe(false)
  expect(
    studioRenderExecutionProfileSchema.parse(STUDIO_RENDER_PROFILE),
  ).toEqual(STUDIO_RENDER_PROFILE)
  for (const profile of [
    STUDIO_RENDER_PROFILE_V1,
    STUDIO_RENDER_PROFILE_V2,
    STUDIO_RENDER_PROFILE_V3,
    STUDIO_RENDER_PROFILE,
  ]) {
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

it("admits the parallel profile while retaining exact v3 history", () => {
  expect(
    studioRenderExecutionProfileSchema.parse(STUDIO_RENDER_PROFILE_V3),
  ).toEqual(STUDIO_RENDER_PROFILE_V3)
  expect(STUDIO_RENDER_PROFILE_V3.cpu).toBe(2)
  expect(STUDIO_RENDER_PROFILE_V3.memoryBytes).toBe(2147483648)
  expect(STUDIO_RENDER_PROFILE_V3.childPids).toBe(96)
  for (const old of [
    STUDIO_RENDER_PROFILE_V1,
    STUDIO_RENDER_PROFILE_V2,
    STUDIO_RENDER_PROFILE_V3,
  ]) {
    expect(
      studioRenderAdmissionSchema.shape.profileId.safeParse(old.id).success,
    ).toBe(false)
  }
  expect(STUDIO_RENDER_PROFILE.cpu).toBe(24)
  expect(STUDIO_RENDER_PROFILE.memoryBytes).toBe(34359738368)
  expect(STUDIO_RENDER_PROFILE.aggregatePids).toBe(4096)
  expect(STUDIO_RENDER_PROFILE.childPids).toBe(4096)
  for (const key of [
    "swapBytes",
    "outputBytes",
    "jobMs",
    "preparationMs",
    "requestMs",
    "leaseMs",
  ] as const) {
    expect(STUDIO_RENDER_PROFILE[key]).toBe(STUDIO_RENDER_PROFILE_V3[key])
  }
})

it("keeps serial HTTP admission on v3 and rejects parallel assignments there", () => {
  expect(
    studioRenderLegacyAdmissionSchema.shape.profileId.parse(
      STUDIO_RENDER_PROFILE_V3.id,
    ),
  ).toBe(STUDIO_RENDER_PROFILE_V3.id)
  expect(
    studioRenderLegacyAdmissionSchema.shape.profileId.safeParse(
      STUDIO_RENDER_PROFILE.id,
    ).success,
  ).toBe(false)
})
