import { randomBytes } from "node:crypto"

import { PrismaClient } from "../../src/generated/prisma/index.js"
import { describe, expect, it } from "vitest"

import { grantPortalSessionRenewal } from "./portal-session-renewal-grant.js"

const administratorUrl = process.env.DATABASE_URL

describe.skipIf(!administratorUrl)("portal renewal role grant", () => {
  it("grants only expiry updates and stays safe to rerun", async () => {
    const administrator = new PrismaClient({ datasourceUrl: administratorUrl })
    const role = `rag_portal_renewal_${randomBytes(5).toString("hex")}`
    const sessionUrl = new URL(administratorUrl!)
    sessionUrl.username = role
    sessionUrl.password = "synthetic-only-test-password"
    try {
      await administrator.$executeRawUnsafe(
        `CREATE ROLE "${role}" LOGIN PASSWORD 'synthetic-only-test-password'`,
      )
      await administrator.$executeRawUnsafe(
        `GRANT USAGE ON SCHEMA portal_private TO "${role}"`,
      )
      await administrator.$executeRawUnsafe(
        `GRANT SELECT, INSERT, DELETE ON portal_private.oauth_states, portal_private.sessions TO "${role}"`,
      )
      expect(
        await grantPortalSessionRenewal(
          administratorUrl!,
          sessionUrl.toString(),
        ),
      ).toEqual({
        database: sessionUrl.pathname.slice(1),
        role,
        expiryUpdate: true,
      })
      await expect(
        grantPortalSessionRenewal(administratorUrl!, sessionUrl.toString()),
      ).resolves.toMatchObject({ role, expiryUpdate: true })
      await administrator.$executeRawUnsafe(
        `GRANT SELECT ON public._prisma_migrations TO "${role}"`,
      )
      await expect(
        grantPortalSessionRenewal(administratorUrl!, sessionUrl.toString()),
      ).rejects.toThrow("portal_session_role_not_restricted")
      await administrator.$executeRawUnsafe(
        `REVOKE SELECT ON public._prisma_migrations FROM "${role}"`,
      )
      await administrator.$executeRawUnsafe(
        `GRANT UPDATE (github_login) ON portal_private.sessions TO "${role}"`,
      )
      await expect(
        grantPortalSessionRenewal(administratorUrl!, sessionUrl.toString()),
      ).rejects.toThrow("portal_session_role_not_restricted")
    } finally {
      await administrator.$executeRawUnsafe(
        `REVOKE ALL ON public._prisma_migrations FROM "${role}"`,
      )
      await administrator.$executeRawUnsafe(
        `REVOKE ALL ON portal_private.oauth_states, portal_private.sessions FROM "${role}"`,
      )
      await administrator.$executeRawUnsafe(
        `REVOKE USAGE ON SCHEMA portal_private FROM "${role}"`,
      )
      await administrator.$executeRawUnsafe(`DROP ROLE IF EXISTS "${role}"`)
      await administrator.$disconnect()
    }
  })
})
