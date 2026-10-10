import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createClient } from "redis"
import createHandler from "@fortedigital/nextjs-cache-handler/redis-strings"

const enabled =
  process.env.RECOMMENDATION_REDIS_TEST === "1" &&
  Boolean(process.env.REDIS_URL)

describe.skipIf(!enabled)("Redis cache cleanup integration", () => {
  const prefix = `test:cache-cleanup:${randomUUID()}:`
  const tagKey = prefix + "__sharedTags__"
  const ttlKey = prefix + "__sharedTagsTtl__"
  const keys = Array.from({ length: 1_001 }, (_, i) => `expired-${i}`)
  let client
  let handler
  const live = {
    value: { kind: "FETCH", data: { body: "still-live" } },
    tags: ["unrelated"],
    lastModified: Date.now(),
  }

  beforeAll(async () => {
    client = createClient({ url: process.env.REDIS_URL })
    await client.connect()
    handler = createHandler({ client, keyPrefix: prefix })
  })

  beforeEach(async () => {
    await client.unlink([
      tagKey,
      ttlKey,
      prefix + "keep",
      prefix + "target",
      ...keys.map((key) => prefix + key),
    ])
    await handler.set("keep", live)
  })

  afterAll(async () => {
    await client?.unlink([
      tagKey,
      ttlKey,
      prefix + "keep",
      prefix + "target",
      ...keys.map((key) => prefix + key),
    ])
    client?.destroy()
  })

  it("cleans expired metadata across batches and preserves a readable live value", async () => {
    await client.hSet(
      tagKey,
      Object.fromEntries(keys.map((key) => [key, '["expired"]'])),
    )
    await client.hSet(ttlKey, Object.fromEntries(keys.map((key) => [key, "1"])))
    await handler.prepare()

    expect(await client.hKeys(tagKey)).toEqual(["keep"])
    expect(await client.hLen(ttlKey)).toBe(0)
    expect(await handler.get("keep", { implicitTags: [] })).toEqual(live)
  })

  it("invalidates tagged entries across batches while retaining unrelated live content", async () => {
    await client.hSet(
      tagKey,
      Object.fromEntries(keys.map((key) => [key, '["matching"]'])),
    )
    await client.hSet(
      ttlKey,
      Object.fromEntries(keys.map((key) => [key, "9999999999"])),
    )
    await handler.set("target", {
      value: { kind: "FETCH", data: { body: "remove-me" } },
      tags: ["matching"],
      lastModified: Date.now(),
    })
    await handler.revalidateTag("matching")

    expect(await client.hKeys(tagKey)).toEqual(["keep"])
    expect(await client.hLen(ttlKey)).toBe(0)
    expect(await handler.get("target", { implicitTags: [] })).toBeNull()
    expect(await handler.get("keep", { implicitTags: [] })).not.toBeNull()
  })
})
