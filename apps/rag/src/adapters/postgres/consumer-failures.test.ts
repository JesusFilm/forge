import { afterEach, describe, expect, it, vi } from "vitest"

import { PrismaClient } from "../../generated/prisma/index.js"
import { ConsumerAccessError } from "../../contracts/consumer-access.js"
import { DeadlineError } from "../../contracts/deadline.js"
import { withConsumerOwner } from "./consumer-access-ownership.js"
import { PostgresConsumerAccess } from "./consumer-access.js"
import { PostgresConsumerAuthenticator } from "./consumer-auth.js"

const id = "00000000-0000-4000-8000-000000000001"
const sha = "b".repeat(40)
const clients: PrismaClient[] = []
function client() {
  const db = new PrismaClient()
  clients.push(db)
  return db
}
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(clients.splice(0).map((db) => db.$disconnect()))
})

describe("consumer failure boundaries", () => {
  it.each(["forbidden", "conflict"] as const)(
    "preserves %s when writing the denial audit fails",
    async (code) => {
      const db = client()
      const error = new ConsumerAccessError(code)
      vi.spyOn(db, "$transaction").mockRejectedValue(error)
      vi.spyOn(db, "$executeRaw").mockRejectedValue(new Error("private SQL"))
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      await expect(
        withConsumerOwner(db, id, "42", sha, async () => {}),
      ).rejects.toBe(error)
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "consumer_denial_audit_failed",
      )
    },
  )

  it("bounds a stuck authentication lookup, including connection acquisition", async () => {
    vi.useFakeTimers()
    const db = client()
    vi.spyOn(db, "$transaction").mockImplementation(() => new Promise(() => {}))
    const result = new PostgresConsumerAuthenticator(db).authenticate(
      `rag_${"a".repeat(43)}`,
    )
    const assertion = expect(result).rejects.toBeInstanceOf(DeadlineError)
    await vi.advanceTimersByTimeAsync(3_500)
    await assertion
  })

  it("cancels stalled membership admission before the owner transaction expires", async () => {
    vi.useFakeTimers()
    const db = client()
    const row = {
      id,
      name: "test",
      state: "active",
      allowed_source_keys: [],
      created_at: new Date(),
      credential_version: 1n,
      membership_version: 1n,
    }
    vi.spyOn(db, "$queryRaw")
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ github_user_id: 42n }])
    // The same client stands in for an interactive transaction; no database is contacted.
    vi.spyOn(db, "$transaction").mockImplementation(async (operation) => {
      if (typeof operation !== "function") throw new DeadlineError()
      return operation(db)
    })
    let signal: AbortSignal | undefined
    const result = new PostgresConsumerAccess(db).addMember({
      consumerId: id,
      actorGithubUserId: "42",
      memberGithubUserId: "43",
      expectedVersion: 1,
      verifyCurrentEligibility: async (deadline) => {
        signal = deadline
        return new Promise(() => {})
      },
    })
    const assertion = expect(result).rejects.toBeInstanceOf(DeadlineError)
    await vi.advanceTimersByTimeAsync(8_000)
    await assertion
    expect(signal?.aborted).toBe(true)
  })
})
