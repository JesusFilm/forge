import { describe, expect, it } from "vitest"

import {
  CONSUMER_LINK_REQUIRES_VERIFIED_EMAIL,
  refuseUnverifiedConsumerLink,
} from "./account-linking-guard"

const CONSUMERS = new Set(["google", "facebook", "apple"])

function deps(overrides: {
  user?: { emailVerified?: boolean | null } | null
  accounts?: unknown[]
}) {
  return {
    consumerProviders: CONSUMERS,
    findUser: async () =>
      overrides.user === undefined ? null : overrides.user,
    findAccounts: async () => overrides.accounts ?? [],
  }
}

describe("refuseUnverifiedConsumerLink", () => {
  it("refuses a consumer provider linking onto an unverified existing user", async () => {
    await expect(
      refuseUnverifiedConsumerLink(
        { providerId: "google", userId: "u1" },
        deps({
          user: { emailVerified: false },
          accounts: [{ providerId: "credential" }],
        }),
      ),
    ).rejects.toMatchObject({
      body: { code: CONSUMER_LINK_REQUIRES_VERIFIED_EMAIL },
    })
  })

  it("allows a consumer provider onto a verified existing user", async () => {
    await expect(
      refuseUnverifiedConsumerLink(
        { providerId: "apple", userId: "u1" },
        deps({
          user: { emailVerified: true },
          accounts: [{ providerId: "credential" }],
        }),
      ),
    ).resolves.toBeUndefined()
  })

  it("allows a fresh consumer sign-up (user has no account rows yet)", async () => {
    await expect(
      refuseUnverifiedConsumerLink(
        { providerId: "google", userId: "u-new" },
        deps({ user: { emailVerified: false }, accounts: [] }),
      ),
    ).resolves.toBeUndefined()
  })

  it("ignores non-consumer providers — the jfp self-RP and credentials", async () => {
    for (const providerId of ["jfp", "credential", "okta", "firebase"]) {
      await expect(
        refuseUnverifiedConsumerLink(
          { providerId, userId: "u1" },
          deps({
            user: { emailVerified: false },
            accounts: [{ providerId: "credential" }],
          }),
        ),
      ).resolves.toBeUndefined()
    }
  })

  it("fails closed when the user row cannot be read", async () => {
    await expect(
      refuseUnverifiedConsumerLink(
        { providerId: "google", userId: "missing" },
        deps({ user: null, accounts: [] }),
      ),
    ).rejects.toMatchObject({
      body: { code: CONSUMER_LINK_REQUIRES_VERIFIED_EMAIL },
    })
  })
})
