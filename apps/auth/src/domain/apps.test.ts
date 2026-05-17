import { describe, expect, it } from "vitest"

import { ADMIN_APP_SEED } from "./apps"

describe("first-party app seeds", () => {
  it("registers admin clients for RP-initiated logout", () => {
    for (const environment of ADMIN_APP_SEED.environments) {
      expect(environment.postLogoutRedirectUris).toEqual([
        environment.allowedOrigins[0] + "/api/auth/login",
      ])
    }
  })
})
