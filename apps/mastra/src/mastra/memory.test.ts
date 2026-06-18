import { afterEach, describe, expect, it } from "vitest"

import { InMemoryStore } from "@mastra/core/storage"

import {
  __resetSeekerMemoryForTesting,
  buildSeekerMemory,
  getSeekerMemory,
} from "./memory"

afterEach(() => {
  __resetSeekerMemoryForTesting()
})

describe("seeker memory", () => {
  it("returns a singleton Memory instance", () => {
    const first = getSeekerMemory()
    const second = getSeekerMemory()
    expect(first).toBe(second)
  })

  it("is backed by an in-memory store (never a persisted store)", () => {
    // Guards against accidentally wiring a Postgres/PgVector-backed store —
    // the seeker skeleton's memory must physically be unable to persist.
    expect(buildSeekerMemory().storage).toBeInstanceOf(InMemoryStore)
  })

  // Adversarial cross-thread isolation against a REAL InMemoryStore-backed
  // Memory. This is the assertion a no-op / identity memory layer would fail:
  // it proves messages written to thread A do not leak into thread B. Both
  // threads MUST be created first — `recall` on a never-created thread throws
  // ("No thread found with id …"), it does not return empty (verified U2 recipe).
  it("keeps messages scoped to their own thread", async () => {
    const memory = buildSeekerMemory()
    const resourceId = "seeker-test-resource"
    const threadA = "thread-a"
    const threadB = "thread-b"
    const now = new Date()

    await memory.saveThread({
      thread: {
        id: threadA,
        resourceId,
        title: "Thread A",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    })
    await memory.saveThread({
      thread: {
        id: threadB,
        resourceId,
        title: "Thread B",
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
    })

    await memory.saveMessages({
      messages: [
        {
          id: "message-a-1",
          role: "user",
          threadId: threadA,
          resourceId,
          createdAt: now,
          content: {
            format: 2,
            parts: [{ type: "text", text: "Who is Jesus?" }],
            content: "Who is Jesus?",
          },
        },
      ],
    })

    const recalledA = await memory.recall({ threadId: threadA, resourceId })
    const recalledB = await memory.recall({ threadId: threadB, resourceId })

    // Exact-count + identity rather than `>= 1`: this is the tighter
    // non-vacuous assertion — it proves thread A holds exactly the message we
    // saved (not stray messages from elsewhere) and thread B holds none.
    expect(recalledA.messages).toHaveLength(1)
    expect(recalledA.messages[0]?.id).toBe("message-a-1")
    expect(recalledB.messages).toHaveLength(0)
  })
})
