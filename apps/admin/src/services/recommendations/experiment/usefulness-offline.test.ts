import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  evaluateUsefulnessSnapshot,
  type UsefulnessSnapshot,
} from "./usefulness-offline"

function snapshot(): UsefulnessSnapshot {
  return {
    schemaVersion: "recommendation-usefulness-offline-v1",
    experimentId: "synthetic-only",
    configurationDigest: "a".repeat(64),
    enrollmentStart: "2026-09-01T00:00:00Z",
    enrollmentEnd: "2026-09-02T00:00:00Z",
    capturedAt: "2026-09-03T06:00:00Z",
    plannedAssignmentsPerArm: 200,
    minimumUsefulDelta: 0.1,
    health: {
      assignmentLedgerCount: 400,
      claimedEpisodes: 1000,
      missingActiveEpisodes: 0,
      unresolvedEpisodes: 0,
      contaminatedAssignments: 0,
      fencedAssignments: 0,
      conflictingOutcomes: 0,
      aaPassed: true,
      routingVerified: true,
      retentionHealthy: true,
      collectionHealthy: true,
      guardrailsPassed: true,
    },
    units: Array.from({ length: 400 }, (_, index) => ({
      unitDigest: createHash("sha256")
        .update(`synthetic-${index}`)
        .digest("hex"),
      unitKind: "anonymous_profile",
      arm: index < 200 ? "control" : "challenger",
      assignedAt: "2026-09-01T12:00:00Z",
      qualifiedViews: index % 2,
    })),
  }
}

describe("offline qualified viewing evaluation", () => {
  it("keeps zero-view assignments and counts multiple views per unit", () => {
    const input = snapshot()
    input.units[0].qualifiedViews = 4
    const result = evaluateUsefulnessSnapshot(input)
    expect(result.control).toEqual({
      assigned: 200,
      qualifiedViews: 104,
      qualifiedViewsPerAssignedUnit: 0.52,
    })
    expect(JSON.stringify(result)).not.toContain(input.units[0].unitDigest)
    expect(evaluateUsefulnessSnapshot(input)).toEqual(result)
  })

  it("refuses an exposed-only denominator or duplicate units", () => {
    const input = snapshot()
    input.units.pop()
    expect(evaluateUsefulnessSnapshot(input).reasonCodes).toContain(
      "assignment_denominator_mismatch",
    )
    const duplicate = snapshot()
    duplicate.units[1].unitDigest = duplicate.units[0].unitDigest
    expect(evaluateUsefulnessSnapshot(duplicate).reasonCodes).toContain(
      "duplicate_assignment_unit",
    )
  })

  it("requires an equal 24-hour horizon plus the six-hour late-fact window", () => {
    const input = snapshot()
    input.capturedAt = "2026-09-03T05:59:59Z"
    expect(evaluateUsefulnessSnapshot(input).reasonCodes).toContain(
      "outcome_window_immature",
    )
    input.capturedAt = "2026-10-01T00:00:00Z"
    expect(evaluateUsefulnessSnapshot(input).reasonCodes).toContain(
      "raw_retention_window_exceeded",
    )
  })

  it("keeps collector gaps, fencing and sample-ratio mismatches unhealthy", () => {
    const input = snapshot()
    input.health.missingActiveEpisodes = 51
    input.health.fencedAssignments = 1
    input.units[0].arm = "challenger"
    for (let index = 1; index < 100; index++)
      input.units[index].arm = "challenger"
    const result = evaluateUsefulnessSnapshot(input)
    expect(result.decision).toBe("data_unhealthy")
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        "active_playback_coverage_below_95_percent",
        "fencedAssignments",
        "sample_ratio_mismatch",
      ]),
    )
    expect(result.uncertainty).toBeNull()
  })

  it("does not classify insufficient or zero-event samples as no benefit", () => {
    const input = snapshot()
    input.plannedAssignmentsPerArm = 500
    expect(evaluateUsefulnessSnapshot(input).decision).toBe("inconclusive")
    input.plannedAssignmentsPerArm = 200
    input.units.forEach((unit) => {
      unit.qualifiedViews = 0
    })
    expect(evaluateUsefulnessSnapshot(input).decision).toBe("inconclusive")
  })

  it("separates meaningful improvement, a ruled-out useful effect, and uncertainty", () => {
    const improved = snapshot()
    improved.units.forEach((unit) => {
      if (unit.arm === "challenger") unit.qualifiedViews += 2
    })
    expect(evaluateUsefulnessSnapshot(improved).decision).toBe("improve")
    const unchanged = snapshot()
    unchanged.minimumUsefulDelta = 0.5
    expect(evaluateUsefulnessSnapshot(unchanged).decision).toBe("no_benefit")
    unchanged.minimumUsefulDelta = 0.01
    expect(evaluateUsefulnessSnapshot(unchanged).decision).toBe("inconclusive")
  })

  it("rejects an otherwise improving challenger when operational guardrails fail", () => {
    const input = snapshot()
    input.units.forEach((unit) => {
      if (unit.arm === "challenger") unit.qualifiedViews += 2
    })
    expect(evaluateUsefulnessSnapshot(input).decision).toBe("improve")

    input.health.guardrailsPassed = false

    expect(evaluateUsefulnessSnapshot(input)).toMatchObject({
      decision: "no_benefit",
      reasonCodes: ["operational_guardrail_failed"],
      uncertainty: null,
    })
  })

  it("refuses operational-session identities and malformed numeric input", () => {
    const input = snapshot()
    const sessionInput = JSON.parse(JSON.stringify(input))
    sessionInput.units[0].unitKind = "anonymous_session"
    expect(() => evaluateUsefulnessSnapshot(sessionInput)).toThrow(
      "Invalid usefulness snapshot",
    )
    input.units[0].qualifiedViews = -1
    expect(() => evaluateUsefulnessSnapshot(input)).toThrow(
      "Invalid usefulness snapshot",
    )
  })

  it("refuses ambiguous local dates and impossible outcome totals", () => {
    const input = snapshot()
    input.enrollmentStart = "2026-09-01T00:00:00"
    expect(() => evaluateUsefulnessSnapshot(input)).toThrow(
      "Invalid usefulness snapshot",
    )
    const impossible = snapshot()
    impossible.health.claimedEpisodes = 0
    expect(() => evaluateUsefulnessSnapshot(impossible)).toThrow(
      "Invalid usefulness snapshot",
    )
  })

  it("runs the documented native-Node CLI against a real snapshot file", () => {
    const directory = mkdtempSync(join(tmpdir(), "usefulness-cli-"))
    try {
      const path = join(directory, "snapshot.json")
      writeFileSync(path, JSON.stringify(snapshot()))
      const output = execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL("./usefulness-offline.ts", import.meta.url)),
          path,
        ],
        { encoding: "utf8" },
      )
      expect(JSON.parse(output).control.assigned).toBe(200)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
