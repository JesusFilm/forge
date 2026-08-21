import { describe, expect, it, vi } from "vitest"
import {
  createUserPlaylistGraphqlRuntime,
  UserPlaylistGraphqlRuntimeConfigurationError,
} from "./user-playlist-runtime"

const key = Buffer.alloc(32, 7).toString("base64url")
const ring = JSON.stringify([{ id: "v1", key, active: true }])
const complete = {
  capabilityLookupKeys: ring,
  capabilityEncryptionKeys: ring,
  reportIntentKeys: ring,
  reportDetailKeys: ring,
  reportIpKeys: ring,
  termsVersion: "terms-1",
  privacyVersion: "privacy-1",
  communityGuidelinesVersion: "guidelines-1",
}

describe("User Playlist lazy GraphQL runtime", () => {
  it("does not parse optional crypto config until a playlist surface is used", () => {
    const runtime = createUserPlaylistGraphqlRuntime({} as never, {}, null)
    expect(runtime).toBeDefined()
    expect(() => runtime.playlist()).toThrow(
      UserPlaylistGraphqlRuntimeConfigurationError,
    )
  })

  it("allows public-read runtime construction without authoring policy versions", () => {
    const runtime = createUserPlaylistGraphqlRuntime(
      {} as never,
      {
        capabilityLookupKeys: ring,
        capabilityEncryptionKeys: ring,
      },
      null,
    )
    expect(runtime.playlist()).toBeDefined()
  })

  it("builds isolated owner, report, and moderation services from valid keyrings", () => {
    const runtime = createUserPlaylistGraphqlRuntime({} as never, complete, {
      eval: vi.fn(),
    } as never)
    expect(runtime.playlist()).toBeDefined()
    expect(runtime.report()).toBeDefined()
    expect(runtime.moderation()).toBeDefined()
  })

  it("rejects malformed and non-canonical key material", () => {
    const runtime = createUserPlaylistGraphqlRuntime(
      {} as never,
      {
        ...complete,
        capabilityLookupKeys: '[{"id":"v1","key":"@@","active":true}]',
      },
      null,
    )
    expect(() => runtime.playlist()).toThrow(
      UserPlaylistGraphqlRuntimeConfigurationError,
    )
  })
})
