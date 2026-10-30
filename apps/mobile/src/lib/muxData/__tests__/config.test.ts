jest.mock("../../../env", () => ({ env: {} }))

import { env } from "../../../env"
import { MUX_PLAYER_NAMES, resolveMuxDataConfig } from "../config"

const mockEnv = env as { EXPO_PUBLIC_MUX_DATA_ENV_KEY?: string }

function withKey(value: string | undefined) {
  mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY = value
  return resolveMuxDataConfig()
}

describe("resolveMuxDataConfig (KTD3)", () => {
  afterEach(() => {
    delete mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY
  })

  it("returns a config with a valid lowercase alphanumeric key", () => {
    expect(withKey("k0abc123def456")).toEqual({
      envKey: "k0abc123def456",
      playerNames: MUX_PLAYER_NAMES,
    })
  })

  it("returns null when the key is missing", () => {
    expect(withKey(undefined)).toBeNull()
  })

  // mux-embed and the Android SDK send an empty key to inferred.litix.io.
  it("returns null for an empty or blank key", () => {
    expect(withKey("")).toBeNull()
    expect(withKey("   ")).toBeNull()
  })

  // A malformed key still sends beacons, to img.litix.io.
  it.each([
    ["uppercase letters", "K0ABC123"],
    ["a dash", "k0abc-123"],
    ["an inner space", "k0abc 123"],
    ["an underscore", "k0abc_123"],
  ])("returns null for a key with %s", (_shape, key) => {
    expect(withKey(key)).toBeNull()
  })

  it("trims outer spaces and accepts the key", () => {
    expect(withKey("  k0abc123 \n")?.envKey).toBe("k0abc123")
  })

  it("keeps every player name under the forge-mobile prefix (R18)", () => {
    for (const name of Object.values(MUX_PLAYER_NAMES)) {
      expect(name).toMatch(/^forge-mobile-/)
    }
  })

  // player_name is the dashboard join key, so the values never change after
  // the first production view (KTD6).
  it("pins the player name values", () => {
    expect(MUX_PLAYER_NAMES).toEqual({
      watch: "forge-mobile-watch",
      experience: "forge-mobile-experience",
      explore: "forge-mobile-explore",
    })
  })
})
