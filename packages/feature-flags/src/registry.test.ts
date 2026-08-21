import { describe, expect, it } from "vitest"

import { featureFlags, resolveUserPlaylistFeatureControls } from "./registry"

describe("user playlist feature controls", () => {
  it("registers independent authoring and anonymous-public-read flags off by default", () => {
    expect(featureFlags.userPlaylistAuthoring).toMatchObject({
      key: "forge.userPlaylist.authoring",
      defaultValue: false,
    })
    expect(featureFlags.userPlaylistPublicRead).toMatchObject({
      key: "forge.userPlaylist.publicRead",
      defaultValue: false,
    })
  })

  it("keeps both surfaces off when configuration is absent", () => {
    expect(resolveUserPlaylistFeatureControls({})).toEqual({
      authoringEnabled: false,
      anonymousPublicReadEnabled: false,
      emergencyPublicReadDisabled: false,
      malformed: false,
    })
  })

  it("controls authoring and anonymous public reads independently", () => {
    expect(
      resolveUserPlaylistFeatureControls({ authoringEnabled: "true" }),
    ).toMatchObject({
      authoringEnabled: true,
      anonymousPublicReadEnabled: false,
    })
    expect(
      resolveUserPlaylistFeatureControls({ anonymousPublicReadEnabled: true }),
    ).toMatchObject({
      authoringEnabled: false,
      anonymousPublicReadEnabled: true,
    })
  })

  it("fails closed on malformed controls and lets the emergency switch override public read", () => {
    expect(
      resolveUserPlaylistFeatureControls({
        authoringEnabled: "enable",
        anonymousPublicReadEnabled: "true",
        emergencyPublicReadDisabled: "disable",
      }),
    ).toEqual({
      authoringEnabled: false,
      anonymousPublicReadEnabled: false,
      emergencyPublicReadDisabled: true,
      malformed: true,
    })
    expect(
      resolveUserPlaylistFeatureControls({
        authoringEnabled: "true",
        anonymousPublicReadEnabled: "true",
        emergencyPublicReadDisabled: "true",
      }),
    ).toEqual({
      authoringEnabled: true,
      anonymousPublicReadEnabled: false,
      emergencyPublicReadDisabled: true,
      malformed: false,
    })
  })
})
