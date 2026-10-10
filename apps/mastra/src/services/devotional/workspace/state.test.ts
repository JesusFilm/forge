import { describe, expect, it } from "vitest"

import { InMemoryDevotionalAttemptStore } from "./state"

describe("InMemoryDevotionalAttemptStore", () => {
  it("deduplicates the same parent, key, and request hash", async () => {
    const store = new InMemoryDevotionalAttemptStore()
    const first = await store.beginRetry({
      parentRunId: "parent",
      idempotencyKey: "retry-key",
      requestHash: "a".repeat(64),
    })
    const replay = await store.beginRetry({
      parentRunId: "parent",
      idempotencyKey: "retry-key",
      requestHash: "a".repeat(64),
    })

    expect(first.kind).toBe("created")
    expect(replay).toMatchObject({ kind: "existing", attempt: first.attempt })
  })

  it("rejects key reuse with a different payload and allocates fresh attempts for new keys", async () => {
    const store = new InMemoryDevotionalAttemptStore()
    const first = await store.beginRetry({
      parentRunId: "parent",
      idempotencyKey: "retry-key-1",
      requestHash: "a".repeat(64),
    })
    const conflict = await store.beginRetry({
      parentRunId: "parent",
      idempotencyKey: "retry-key-1",
      requestHash: "b".repeat(64),
    })
    const second = await store.beginRetry({
      parentRunId: "parent",
      idempotencyKey: "retry-key-2",
      requestHash: "b".repeat(64),
    })

    expect(conflict.kind).toBe("conflict")
    expect(second.attempt.attemptNumber).toBe(2)
    expect(second.attempt.id).not.toBe(first.attempt.id)
  })

  it("records provisioning readiness and failure durably", async () => {
    const store = new InMemoryDevotionalAttemptStore()
    const begun = await store.beginRetry({
      parentRunId: "parent",
      idempotencyKey: "retry-key",
      requestHash: "a".repeat(64),
    })
    await store.markReady(begun.attempt.id, {
      catalogGeneration: 4,
      runId: "parent-attempt-1",
      selectedSources: [],
    })
    await expect(store.get(begun.attempt.id)).resolves.toMatchObject({
      provisioningState: "ready",
      catalogGeneration: 4,
    })

    await store.markFailed(begun.attempt.id, "storage unavailable")
    await expect(store.get(begun.attempt.id)).resolves.toMatchObject({
      provisioningState: "failed",
      failureReason: "storage unavailable",
    })
  })
})
