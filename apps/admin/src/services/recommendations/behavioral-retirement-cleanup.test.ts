import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  parseRetirementCutoverProof,
  RETIREMENT_PHASES,
} from "./behavioral-retirement-cleanup"

const releaseA = "a".repeat(40)
const releaseB = "b".repeat(40)
const now = new Date("2026-10-29T11:00:00.000Z")

function proof(overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from(
    JSON.stringify({
      kind: "recommendation-behavioral-retirement-cutover-v1",
      releaseACommit: releaseA,
      releaseBCommit: releaseB,
      releaseAAllRolesVerifiedAt: "2026-10-29T10:00:00.000Z",
      releaseBAllRolesVerifiedAt: "2026-10-29T10:30:00.000Z",
      expiresAt: "2026-10-29T11:15:00.000Z",
      httpRevision: releaseB,
      workerRevision: releaseB,
      oldReplicasAbsent: true,
      oldLearnerRuntimesTerminal: true,
      parentApprovedCleanup: true,
      ...overrides,
    }),
  )
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    expectedReleaseA: releaseA,
    runningReleaseB: releaseB,
    now,
  }
}

describe("behavioral retirement admission", () => {
  it("requires a fresh digest-verified all-role cutover receipt", () => {
    expect(parseRetirementCutoverProof(proof()).releaseBCommit).toBe(releaseB)
    expect(() =>
      parseRetirementCutoverProof({ ...proof(), sha256: "0".repeat(64) }),
    ).toThrow()
    expect(() =>
      parseRetirementCutoverProof(proof({ workerRevision: releaseA })),
    ).toThrow()
    expect(() =>
      parseRetirementCutoverProof(proof({ oldReplicasAbsent: false })),
    ).toThrow()
    expect(() =>
      parseRetirementCutoverProof(
        proof({ expiresAt: "2026-10-29T10:59:59.000Z" }),
      ),
    ).toThrow()
    expect(() =>
      parseRetirementCutoverProof(
        proof({ releaseAAllRolesVerifiedAt: "2026-10-29T10:45:00.000Z" }),
      ),
    ).toThrow()
  })

  it("has exactly the 19 retired direct-delete phases and three explicit unlinks", () => {
    expect(
      RETIREMENT_PHASES.filter((phase) => phase.kind === "delete"),
    ).toHaveLength(19)
    expect(
      RETIREMENT_PHASES.filter((phase) => phase.kind === "detach").map(
        (phase) => phase.name,
      ),
    ).toEqual(["decision_detach", "assignment_detach", "shadow_detach"])
    expect(RETIREMENT_PHASES.map((phase) => phase.table)).not.toContain(
      "recommendation_viewer",
    )
    expect(
      RETIREMENT_PHASES.some((phase) =>
        phase.table.startsWith("recommendation_precomputed"),
      ),
    ).toBe(false)
  })
})
