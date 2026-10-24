import { describe, expect, it } from "vitest"

import {
  DevotionalAttemptSchema,
  DevotionalSourceRefSchema,
  MAX_DEVOTIONAL_ATTEMPT_STATE_BYTES,
  assertBoundedAttemptState,
} from "./state-schema"

describe("devotional Workspace state schemas", () => {
  it("accepts bounded source references without source bodies", () => {
    expect(
      DevotionalSourceRefSchema.parse({
        path: "/inputs/reflections/grace.md",
        category: "reflections",
        digest: "a".repeat(64),
        size: 42,
        modifiedAt: "2026-07-31T12:00:00.000Z",
        title: "grace",
      }),
    ).toMatchObject({ path: "/inputs/reflections/grace.md" })
  })

  it("rejects attempts containing source bodies or oversized state", () => {
    expect(() =>
      DevotionalAttemptSchema.parse({
        id: "attempt-1",
        parentRunId: "parent",
        attemptNumber: 1,
        idempotencyKey: "key-1",
        requestHash: "b".repeat(64),
        provisioningState: "ready",
        catalogGeneration: 1,
        runId: "parent-attempt-1",
        selectedSources: [],
        sourceBodies: ["forbidden"],
        createdAt: "2026-07-31T12:00:00.000Z",
        updatedAt: "2026-07-31T12:00:00.000Z",
      }),
    ).toThrow()

    expect(() =>
      assertBoundedAttemptState({
        refs: [],
        padding: "x".repeat(MAX_DEVOTIONAL_ATTEMPT_STATE_BYTES),
      }),
    ).toThrow(/bounded state limit/u)
  })
})
