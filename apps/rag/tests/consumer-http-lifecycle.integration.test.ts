import { PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, describe, expect, it, vi } from "vitest"
import { PostgresConsumerAccess } from "../src/adapters/postgres/consumer-access.js"
import { PostgresConsumerAuthenticator } from "../src/adapters/postgres/consumer-auth.js"
import { createConsumerRoutes } from "../src/serving/http/portal-consumers.js"
import { createApp } from "../src/serving/http/app.js"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for HTTP lifecycle integration")
const db = new PrismaClient({ datasourceUrl: databaseUrl })
const access = new PostgresConsumerAccess(db)
const suffix = crypto.randomUUID().slice(0, 8)
afterAll(() => db.$disconnect())

describe("consumer HTTP lifecycle backed by PostgreSQL", () => {
  it("rolls back issuance when admission changes before commit", async () => {
    const name = "admission-race-" + suffix
    await expect(
      access.create({
        name,
        actorGithubUserId: "4701",
        allowedSourceKeys: [],
        admissionSha: "e".repeat(40),
        verifyCurrentAdmission: async () => null,
      }),
    ).rejects.toMatchObject({ code: "forbidden" })
    const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM consumer_private.consumers WHERE name = ${name}
    `
    expect(row.count).toBe(0n)
    // The same name remains available: owner, verifier and audit inserts rolled back.
    const retry = await access.create({
      name,
      actorGithubUserId: "4701",
      allowedSourceKeys: [],
    })
    expect(retry.consumer.name).toBe(name)
  })

  it("creates through HTTP, intersects scope and immediately enforces rotation and state", async () => {
    const writerUrl = process.env.RAG_CONSUMER_WRITER_DATABASE_URL
    const readerUrl = process.env.RAG_CONSUMER_AUTH_DATABASE_URL
    const writer = writerUrl
      ? new PrismaClient({ datasourceUrl: writerUrl })
      : db
    const reader = readerUrl
      ? new PrismaClient({ datasourceUrl: readerUrl })
      : db
    try {
      let admitted = true
      const owner = { id: 4801, login: "synthetic-owner" }
      const other = { id: 4802, login: "synthetic-other" }
      const search = vi.fn(async () => [])
      const app = createApp({
        retriever: { search },
        tokens: new Map(),
        consumerAuth: new PostgresConsumerAuthenticator(reader),
      })
      app.route(
        "/portal/consumers",
        createConsumerRoutes({
          consumers: new PostgresConsumerAccess(writer),
          admission: {
            current: async () => ({
              sha: "f".repeat(40),
              allowlist: { users: admitted ? [owner, other] : [other] },
            }),
            eligible: async () => true,
            exchange: async () => owner,
          },
          authorize: async (token) =>
            token === "owner-session"
              ? owner
              : token === "other-session"
                ? other
                : null,
          origin: "https://rag.example",
          allowedSourceKeys: ["synthetic-source"],
        }),
      )
      const headers = {
        Cookie: "__Host-rag_portal=owner-session",
        Origin: "https://rag.example",
        "Content-Type": "application/json",
      }
      const mutate = (path: string, body: unknown, cookie = headers.Cookie) =>
        app.request(path, {
          method: "POST",
          headers: { ...headers, Cookie: cookie },
          body: JSON.stringify(body),
        })
      const name = "http-lifecycle-" + suffix
      expect(
        (
          await mutate("/portal/consumers", {
            name,
            ownerGithubUserId: other.id,
          })
        ).status,
      ).toBe(400)
      const response = await mutate("/portal/consumers", { name })
      expect(response.status).toBe(201)
      expect(response.headers.get("cache-control")).toBe("no-store")
      const issued: { consumerId: string; secret: string } =
        await response.json()
      const path = "/portal/consumers/" + issued.consumerId
      const requestSearch = (
        secret: string,
        sources = ["synthetic-source", "ungranted-source"],
      ) =>
        app.request("/v1/search", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + secret,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: "synthetic-query",
            policy: { allowedSourceKeys: sources },
          }),
        })
      expect((await requestSearch(issued.secret)).status).toBe(200)
      expect(search).toHaveBeenLastCalledWith(
        "synthetic-query",
        expect.objectContaining({ allowedSourceKeys: ["synthetic-source"] }),
      )
      search.mockClear()
      expect(
        await (await requestSearch(issued.secret, ["ungranted-source"])).json(),
      ).toEqual({ results: [] })
      expect(search).not.toHaveBeenCalled()
      const outsider = await app.request("/portal/consumers", {
        headers: { Cookie: "__Host-rag_portal=other-session" },
      })
      const directory: {
        consumers: Array<{
          consumerId: string
          owned: boolean
          credentialVersion?: number
        }>
      } = await outsider.json()
      expect(
        directory.consumers.find((row) => row.consumerId === issued.consumerId),
      ).toMatchObject({ owned: false })
      expect(
        directory.consumers.find((row) => row.consumerId === issued.consumerId)
          ?.credentialVersion,
      ).toBeUndefined()
      expect(
        (
          await mutate(
            path + "/rotate",
            { expectedVersion: 1 },
            "__Host-rag_portal=other-session",
          )
        ).status,
      ).toBe(403)
      const rotated = await mutate(path + "/rotate", { expectedVersion: 1 })
      expect(rotated.status).toBe(200)
      const replacement: { secret: string } = await rotated.json()
      expect((await requestSearch(issued.secret)).status).toBe(401)
      expect((await requestSearch(replacement.secret)).status).toBe(200)
      expect(
        (await mutate(path + "/rotate", { expectedVersion: 1 })).status,
      ).toBe(409)
      expect(
        (await mutate(path + "/state", { state: "suspended" })).status,
      ).toBe(200)
      expect((await requestSearch(replacement.secret)).status).toBe(401)
      expect((await mutate(path + "/state", { state: "active" })).status).toBe(
        200,
      )
      expect((await requestSearch(replacement.secret)).status).toBe(200)
      admitted = false
      expect(
        (await mutate(path + "/rotate", { expectedVersion: 2 })).status,
      ).toBe(401)
      admitted = true
      expect((await mutate(path + "/state", { state: "revoked" })).status).toBe(
        200,
      )
      expect((await requestSearch(replacement.secret)).status).toBe(401)
      expect((await mutate(path + "/state", { state: "active" })).status).toBe(
        403,
      )
      expect(
        (await mutate(path + "/rotate", { expectedVersion: 2 })).status,
      ).toBe(403)
      const [denials] = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM consumer_private.lifecycle_audit
        WHERE consumer_id = ${issued.consumerId}::uuid AND action = 'denied'
      `
      expect(denials.count).toBe(4n)
    } finally {
      await Promise.all([
        writer !== db ? writer.$disconnect() : undefined,
        reader !== db ? reader.$disconnect() : undefined,
      ])
    }
  })
})
