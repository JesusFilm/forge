import { randomBytes } from "node:crypto"

import { PrismaClient } from "../../generated/prisma/index.js"
import { describe, expect, it } from "vitest"

import { createPostgresSessionStore, tokenHash } from "./portal-sessions.js"

const databaseUrl = process.env.DATABASE_URL
const randomToken = () => randomBytes(32).toString("base64url")

describe.skipIf(!databaseUrl)("portal sessions in isolated PostgreSQL", () => {
  it("atomically consumes OAuth state and expires and revokes sessions", async () => {
    const store = createPostgresSessionStore(databaseUrl!)
    const db = new PrismaClient({ datasourceUrl: databaseUrl })
    try {
      const state = randomToken()
      const browser = randomToken()
      await store.createState(state, browser)
      expect(await store.consumeState(state, "wrong")).toBe(false)
      expect(await store.consumeState(state, browser)).toBe(true)
      expect(await store.consumeState(state, browser)).toBe(false)

      const token = randomToken()
      expect(await store.getSession(token)).toBeNull()
      await store.createSession(token, { id: 42, login: "engineer" })
      expect(await store.getSession(token)).toEqual({
        id: 42,
        login: "engineer",
      })
      await db.$executeRaw`UPDATE portal_private.sessions SET expires_at = now() - interval '1 second' WHERE token_hash = ${tokenHash(token)}`
      expect(await store.getSession(token)).toBeNull()
      await store.revokeSession(token)
      expect(await store.getSession(token)).toBeNull()
    } finally {
      await store.close()
      await db.$disconnect()
    }
  })
})
