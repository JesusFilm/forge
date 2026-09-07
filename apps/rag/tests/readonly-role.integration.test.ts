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

  it("isolates the reader without removing the owner's write privileges", async () => {
    if (!admin || !adminUrl) throw new Error("DATABASE_URL is required")

    const readerUrl = await provisionReadonlyRole(adminUrl, loginRole, password)
    await expect(
      verifyReadonlyRole(readerUrl, loginRole),
    ).resolves.toBeUndefined()

    const sourceKey = "__forge_rag_writer_privilege_probe__"

    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ WRITE")
      await tx.$executeRawUnsafe(`
        CREATE TABLE public.__forge_rag_writer_privilege_probe (
          id integer PRIMARY KEY,
          value text NOT NULL
        )
      `)
      await tx.$executeRawUnsafe(`
        CREATE TEMPORARY TABLE __forge_rag_writer_temporary_probe (
          id integer PRIMARY KEY
        )
      `)
      await tx.$executeRawUnsafe(`
        INSERT INTO public.__forge_rag_writer_privilege_probe (id, value)
        VALUES (1, 'created')
      `)
      await tx.$executeRawUnsafe(`
        UPDATE public.__forge_rag_writer_privilege_probe
        SET value = 'updated'
        WHERE id = 1
      `)
      await tx.$executeRawUnsafe(`
        DELETE FROM public.__forge_rag_writer_privilege_probe
        WHERE id = 1
      `)
      await tx.$executeRaw`
        INSERT INTO sources (key, name)
        VALUES (${sourceKey}, 'writer privilege probe')
      `
      await tx.$executeRaw`
        UPDATE sources
        SET name = 'updated writer privilege probe'
        WHERE key = ${sourceKey}
      `
      await tx.$executeRaw`
        DELETE FROM sources
        WHERE key = ${sourceKey}
      `
      await tx.$executeRawUnsafe(
        "DROP TABLE public.__forge_rag_writer_privilege_probe",
      )
    })

    const [residue] = await admin.$queryRaw<
      Array<{ source_count: bigint; table_name: string | null }>
    >`
      SELECT
        (SELECT count(*) FROM sources WHERE key = ${sourceKey}) AS source_count,
        to_regclass('public.__forge_rag_writer_privilege_probe')::text AS table_name
    `

    expect(residue).toEqual({ source_count: 0n, table_name: null })
  })
})
