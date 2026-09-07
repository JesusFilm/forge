import { PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, describe, expect, it } from "vitest"

import { provisionReadonlyRole } from "../scripts/provision-readonly.js"
import { verifyReadonlyRole } from "../scripts/verify-readonly.js"

const adminUrl = process.env.DATABASE_URL
const loginRole = "forge_rag_readonly_test"
const password = "b".repeat(64)
const admin = adminUrl ? new PrismaClient({ datasourceUrl: adminUrl }) : null

describe.skipIf(!adminUrl)("read-only PostgreSQL role", () => {
  afterAll(async () => {
    if (!admin) return
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${loginRole}"`)
    await admin.$disconnect()
  })

  it("provisions a login that can read and cannot execute DDL or DML", async () => {
    const readerUrl = await provisionReadonlyRole(
      adminUrl as string,
      loginRole,
      password,
    )
    await expect(
      verifyReadonlyRole(readerUrl, loginRole),
    ).resolves.toBeUndefined()
  })
})
