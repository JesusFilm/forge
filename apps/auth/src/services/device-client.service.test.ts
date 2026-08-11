import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DEVICE_GRANT_TYPE,
  isDeviceGrantEnabled,
  resolveDeviceClient,
} from "./device-client.service"

function prismaWith(client: unknown) {
  return {
    oauthClient: { findUnique: vi.fn(async () => client) },
  } as never
}

const seededTvClient = {
  clientId: "jfp_tv_production",
  name: "Jesus Film TV (production)",
  scopes: ["openid", "web:watch-events:write"],
  redirectUris: ["https://auth.jesusfilm.org/device/callback"],
  grantTypes: ["authorization_code", "refresh_token", DEVICE_GRANT_TYPE],
  disabled: false,
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("resolveDeviceClient", () => {
  it("uses the RFC 8628 grant type URN verbatim", () => {
    // A typo here fails open in the worst way: no client matches, and device
    // sign-in is dead with a generic invalid_client.
    expect(DEVICE_GRANT_TYPE).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    )
  })

  it("admits a seeded client that declares the device grant", async () => {
    await expect(
      resolveDeviceClient(prismaWith(seededTvClient), "jfp_tv_production"),
    ).resolves.toMatchObject({
      clientId: "jfp_tv_production",
      scopes: ["openid", "web:watch-events:write"],
    })
  })

  it("refuses a client that does not declare the device grant", async () => {
    // The gate that keeps dynamically-registered clients out. This provider has
    // allowDynamicClientRegistration AND allowUnauthenticatedClientRegistration
    // enabled, so anyone can create a client — but only the first-party seeder
    // writes this grant type.
    await expect(
      resolveDeviceClient(
        prismaWith({
          ...seededTvClient,
          grantTypes: ["authorization_code", "refresh_token"],
        }),
        "jfp_web_production",
      ),
    ).resolves.toBeNull()
  })

  it("refuses a disabled client even when it declares the grant", async () => {
    await expect(
      resolveDeviceClient(
        prismaWith({ ...seededTvClient, disabled: true }),
        "jfp_tv_production",
      ),
    ).resolves.toBeNull()
  })

  it("refuses an unknown client", async () => {
    await expect(
      resolveDeviceClient(prismaWith(null), "nope"),
    ).resolves.toBeNull()
  })
})

describe("isDeviceGrantEnabled", () => {
  it("is enabled when unset, so a new environment is not silently dead", () => {
    vi.stubEnv("AUTH_DEVICE_GRANT_ENABLED", "")
    expect(isDeviceGrantEnabled()).toBe(true)
  })

  it("is disabled only by an explicit false", () => {
    vi.stubEnv("AUTH_DEVICE_GRANT_ENABLED", "false")
    expect(isDeviceGrantEnabled()).toBe(false)
  })

  it("stays enabled for any other value, including truthy-looking typos", () => {
    for (const value of ["true", "1", "0", "FALSE", "no", "off"]) {
      vi.stubEnv("AUTH_DEVICE_GRANT_ENABLED", value)
      expect(isDeviceGrantEnabled()).toBe(true)
    }
  })
})
