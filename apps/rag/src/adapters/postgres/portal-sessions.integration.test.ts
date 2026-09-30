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
      const initial = await store.getExpiry(token)
      expect(initial).not.toBeNull()
      const createdAt = Date.now()
      expect(Date.parse(initial!.expiresAt) - createdAt).toBeGreaterThan(
        7 * 3600000,
      )
      expect(
        Date.parse(initial!.absoluteExpiresAt) - createdAt,
      ).toBeGreaterThan(23 * 3600000)
      expect(await store.getSession(token)).toEqual({
        id: 42,
        login: "engineer",
      })
      await db.$executeRaw`UPDATE portal_private.sessions SET expires_at = now() + interval '1 hour' WHERE token_hash = ${tokenHash(token)}`
      const renewed = await store.renewSession(token)
      expect(Date.parse(renewed!.expiresAt) - Date.now()).toBeGreaterThan(
        7 * 3600000,
      )
      expect(renewed!.absoluteExpiresAt).toBe(initial!.absoluteExpiresAt)
      await db.$executeRaw`UPDATE portal_private.sessions SET expires_at = now() + interval '1 hour', absolute_expires_at = now() + interval '2 hours' WHERE token_hash = ${tokenHash(token)}`
      const capped = await store.renewSession(token)
      expect(capped!.expiresAt).toBe(capped!.absoluteExpiresAt)
      await db.$executeRaw`UPDATE portal_private.sessions SET absolute_expires_at = now() - interval '1 second' WHERE token_hash = ${tokenHash(token)}`
      expect(await store.getSession(token)).toBeNull()
      expect(await store.renewSession(token)).toBeNull()
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

describe.skipIf(!process.env.RAG_PORTAL_SESSION_DATABASE_URL)(
  "restricted portal session role",
  () => {
    it("may renew only the expiry column and cannot read consumer data", async () => {
      const db = new PrismaClient({
        datasourceUrl: process.env.RAG_PORTAL_SESSION_DATABASE_URL,
      })
      try {
        const [grants] = await db.$queryRaw<
          {
            expiryUpdate: boolean
            identityUpdate: boolean
            consumerSchema: boolean
          }[]
        >`SELECT
          has_column_privilege(current_user, 'portal_private.sessions', 'expires_at', 'UPDATE') AS "expiryUpdate",
          has_column_privilege(current_user, 'portal_private.sessions', 'github_login', 'UPDATE') AS "identityUpdate",
          has_schema_privilege(current_user, 'consumer_private', 'USAGE') AS "consumerSchema"`
        expect(grants).toEqual({
          expiryUpdate: true,
          identityUpdate: false,
          consumerSchema: false,
        })
      } finally {
        await db.$disconnect()
      }
    })
  },
)
