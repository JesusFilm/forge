import { describe, expect, it } from "vitest"

import {
  ArtifactInventorySchema,
  AttemptCompletionSchema,
  VerdictRecordSchema,
} from "./types"

describe("experiment evidence schemas", () => {
  it("accepts a complete package-local inventory and completion", () => {
    const inventory = ArtifactInventorySchema.parse({
      experimentId: "prompt-tone-2026-08",
      attemptId: "attempt-001",
      artifacts: [
        {
          kind: "resolved-identity",
          path: "attempts/attempt-001/resolved-identity.json",
          sha256: "a".repeat(64),
        },
        {
          kind: "comparison",
          path: "attempts/attempt-001/comparison.json",
          sha256: "b".repeat(64),
        },
      ],
    })
    expect(
      AttemptCompletionSchema.parse({
        schemaVersion: "seeker-attempt/v1",
        experimentId: inventory.experimentId,
        attemptId: inventory.attemptId,
        completedAt: "2026-08-10T10:00:00.000Z",
        inventory,
      }).attemptId,
    ).toBe("attempt-001")
  })

  it.each(["../escape.json", "/tmp/file.json", "attempts/other/file.json"])(
    "rejects artifact path outside its attempt: %s",
    (path) => {
      expect(
        ArtifactInventorySchema.safeParse({
          experimentId: "prompt-tone-2026-08",
          attemptId: "attempt-001",
          artifacts: [{ kind: "comparison", path, sha256: "a".repeat(64) }],
        }).success,
      ).toBe(false)
    },
  )

  it("keeps terminal verdict and lifecycle separate and requires evidence-backed reasoning", () => {
    expect(
      VerdictRecordSchema.parse({
        schemaVersion: "seeker-verdict/v1",
        experimentId: "prompt-tone-2026-08",
        attemptId: "attempt-001",
        candidateId: "revised-prompt",
        verdict: "inconclusive",
        actor: "reviewer@example.org",
        recordedAt: "2026-08-10T10:00:00.000Z",
        reasoning: "The confidence interval is too wide.",
        evidence: ["attempts/attempt-001/comparison.json"],
        eligibility: {
          gate: { outcome: "green" },
          criterion: {
            id: "minimum-run-score",
            version: "1",
            outcome: "passed",
          },
          eligible: true,
          evidence: ["attempts/attempt-001/comparison.json"],
        },
      }).verdict,
    ).toBe("inconclusive")
    expect(
      VerdictRecordSchema.safeParse({
        schemaVersion: "seeker-verdict/v1",
        experimentId: "prompt-tone-2026-08",
        attemptId: "attempt-001",
        candidateId: "revised-prompt",
        lifecycle: "successful",
        verdict: "successful",
        actor: "reviewer@example.org",
        recordedAt: "2026-08-10T10:00:00.000Z",
        reasoning: "ok",
        evidence: [],
      }).success,
    ).toBe(false)
  })
})
