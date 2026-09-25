import { PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, describe, expect, it } from "vitest"

import { PostgresConsumerAccess } from "../src/adapters/postgres/consumer-access.js"
import { PostgresConsumerAuthenticator } from "../src/adapters/postgres/consumer-auth.js"

const writerUrl = process.env.RAG_CONSUMER_WRITER_DATABASE_URL
const readerUrl = process.env.RAG_CONSUMER_AUTH_DATABASE_URL
const writer = writerUrl ? new PrismaClient({ datasourceUrl: writerUrl }) : null
const reader = readerUrl ? new PrismaClient({ datasourceUrl: readerUrl }) : null

afterAll(async () => {
  await Promise.all([writer?.$disconnect(), reader?.$disconnect()])
})

describe.skipIf(!writer || !reader)("restricted consumer roles", () => {
  it("issues through the writer and authenticates through the reader", async () => {
    if (!writer || !reader) throw new Error("restricted roles missing")
    const access = new PostgresConsumerAccess(writer)
    const auth = new PostgresConsumerAuthenticator(reader)
    await access.recordAllowlistRevision("d".repeat(40))
    const created = await access.create({
      name: "restricted-" + crypto.randomUUID().slice(0, 8),
      actorGithubUserId: "4501",
      allowedSourceKeys: [],
    })
    expect(await auth.authenticate(created.secret)).toEqual({
      consumerId: created.consumer.consumerId,
      allowedSourceKeys: [],
    })
    const replacement = await access.rotate({
      consumerId: created.consumer.consumerId,
      actorGithubUserId: "4501",
      expectedVersion: 1,
    })
    expect(await auth.authenticate(created.secret)).toBeNull()
    expect(await auth.authenticate(replacement.secret)).toMatchObject({
      consumerId: created.consumer.consumerId,
    })
  })
})
