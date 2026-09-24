import { createHash } from "node:crypto"

import { PrismaClient } from "../../generated/prisma/index.js"
import type { SessionStore } from "../../contracts/portal-sessions.js"

export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex")

export function createPostgresSessionStore(databaseUrl: string): SessionStore {
  const db = new PrismaClient({ datasourceUrl: databaseUrl })
  return {
    async createState(state, browser) {
      await db.$executeRaw`DELETE FROM portal_private.oauth_states WHERE expires_at <= now()`
      await db.$executeRaw`INSERT INTO portal_private.oauth_states (state_hash, browser_hash, expires_at) VALUES (${tokenHash(state)}, ${tokenHash(browser)}, now() + interval '10 minutes')`
    },
    async consumeState(state, browser) {
      const rows = await db.$queryRaw<
        { state_hash: string }[]
      >`DELETE FROM portal_private.oauth_states WHERE state_hash = ${tokenHash(state)} AND browser_hash = ${tokenHash(browser)} AND expires_at > now() RETURNING state_hash`
      return rows.length === 1
    },
    async createSession(token, identity) {
      await db.$executeRaw`DELETE FROM portal_private.sessions WHERE expires_at <= now()`
      await db.$executeRaw`INSERT INTO portal_private.sessions (token_hash, github_user_id, github_login, expires_at) VALUES (${tokenHash(token)}, ${BigInt(identity.id)}, ${identity.login}, now() + interval '2 hours')`
    },
    async getSession(token) {
      const rows = await db.$queryRaw<
        { github_user_id: bigint; github_login: string }[]
      >`SELECT github_user_id, github_login FROM portal_private.sessions WHERE token_hash = ${tokenHash(token)} AND expires_at > now() LIMIT 1`
      const row = rows[0]
      return row
        ? { id: Number(row.github_user_id), login: row.github_login }
        : null
    },
    async revokeSession(token) {
      await db.$executeRaw`DELETE FROM portal_private.sessions WHERE token_hash = ${tokenHash(token)}`
    },
    close: () => db.$disconnect(),
  }
}
