import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type UsefulnessSnapshot = {
  schemaVersion:
    | "recommendation-usefulness-offline-v1"
    | "recommendation-usefulness-offline-v2"
  experimentId: string
  configurationDigest: string
  enrollmentStart: string
  enrollmentEnd: string
  capturedAt: string
  plannedAssignmentsPerArm: number
  minimumUsefulDelta: number
  health: {
    assignmentLedgerCount: number
    claimedEpisodes: number
    missingActiveEpisodes: number
    unresolvedEpisodes: number
    contaminatedAssignments: number
    fencedAssignments: number
    conflictingOutcomes: number
    aaPassed: boolean
    routingVerified: boolean
    retentionHealthy: boolean
    collectionHealthy: boolean
    guardrailsPassed: boolean
  }
  units: {
    unitDigest: string
    unitKind: "anonymous_profile"
    arm: "control" | "challenger"
    assignedAt: string
    qualifiedViews: number
  }[]
}

const DAY_MS = 86_400_000
const BOOTSTRAP_REPLICATES = 2_000

class UsefulnessInputError extends Error {
  constructor() {
    super("Invalid usefulness snapshot; see the versioned runbook schema")
    this.name = "UsefulnessInputError"
  }
}

/** Offline only: accepts a reconciled snapshot; never reads or changes serving. */
export function evaluateUsefulnessSnapshot(input: UsefulnessSnapshot) {
  validateSnapshot(input)
  const inputDigest = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
  const control = input.units.filter((unit) => unit.arm === "control")
  const challenger = input.units.filter((unit) => unit.arm === "challenger")
  const counts = [control.length, challenger.length]
  const total = input.units.length
  const chiSquare = total === 0 ? 0 : (counts[0] - counts[1]) ** 2 / total
  const reasonCodes: string[] = []
  const health = input.health
  if (new Set(input.units.map((unit) => unit.unitDigest)).size !== total)
    reasonCodes.push("duplicate_assignment_unit")
  if (health.assignmentLedgerCount !== total)
    reasonCodes.push("assignment_denominator_mismatch")
  if (chiSquare > 10.828) reasonCodes.push("sample_ratio_mismatch")
  if (
    Date.parse(input.capturedAt) <
    Date.parse(input.enrollmentEnd) + DAY_MS + 6 * 3_600_000
  )
    reasonCodes.push("outcome_window_immature")
  if (
    Date.parse(input.capturedAt) - Date.parse(input.enrollmentStart) >=
    29 * DAY_MS
  )
    reasonCodes.push("raw_retention_window_exceeded")
  for (const key of [
    "unresolvedEpisodes",
    "contaminatedAssignments",
    "fencedAssignments",
    "conflictingOutcomes",
  ] as const) {
    if (health[key] > 0) reasonCodes.push(key)
  }
  for (const key of [
    "aaPassed",
    "routingVerified",
    "retentionHealthy",
    "collectionHealthy",
  ] as const) {
    if (!health[key]) reasonCodes.push(key)
  }
  if (
    health.claimedEpisodes > 0 &&
    health.missingActiveEpisodes / health.claimedEpisodes > 0.05
  )
    reasonCodes.push("active_playback_coverage_below_95_percent")

  const summary = (units: UsefulnessSnapshot["units"]) => ({
    assigned: units.length,
    qualifiedViews: units.reduce((sum, unit) => sum + unit.qualifiedViews, 0),
    qualifiedViewsPerAssignedUnit:
      units.length === 0
        ? null
        : mean(units.map((unit) => unit.qualifiedViews)),
  })
  const base = {
    schemaVersion: input.schemaVersion,
    experimentId: input.experimentId,
    configurationDigest: input.configurationDigest,
    inputDigest,
    capturedAt: input.capturedAt,
    metric:
      input.schemaVersion === "recommendation-usefulness-offline-v2"
        ? "qualified_views_any_observed_mode_per_assigned_profile_24h"
        : "qualified_views_per_assigned_profile_24h",
    sampleRatio: { expectedChallengerProbability: 0.5, chiSquare },
    control: summary(control),
    challenger: summary(challenger),
    minimumUsefulDelta: input.minimumUsefulDelta,
  }
  if (reasonCodes.length > 0)
    return {
      ...base,
      decision: "data_unhealthy",
      reasonCodes,
      uncertainty: null,
    }
  if (!health.guardrailsPassed)
    return {
      ...base,
      decision: "no_benefit",
      reasonCodes: ["operational_guardrail_failed"],
      uncertainty: null,
    }
  if (
    counts.some((count) => count < input.plannedAssignmentsPerArm) ||
    [control, challenger].some(
      (units) => units.filter((unit) => unit.qualifiedViews > 0).length < 20,
    )
  )
    return {
      ...base,
      decision: "inconclusive",
      reasonCodes: ["planned_sample_or_nonzero_unit_floor_not_met"],
      uncertainty: null,
    }

  const values = [control, challenger].map((units) =>
    units.map((unit) => unit.qualifiedViews),
  )
  const estimate = mean(values[1]) - mean(values[0])
  const random = seededRandom(Number.parseInt(inputDigest.slice(0, 8), 16))
  const differences = Array.from({ length: BOOTSTRAP_REPLICATES }, () => {
    const resampledMeans = values.map((arm) => {
      let sum = 0
      for (let index = 0; index < arm.length; index++)
        sum += arm[Math.floor(random() * arm.length)]
      return sum / arm.length
    })
    return resampledMeans[1] - resampledMeans[0]
  }).sort((left, right) => left - right)
  const lower = differences[Math.floor(BOOTSTRAP_REPLICATES * 0.025)]
  const upper = differences[Math.ceil(BOOTSTRAP_REPLICATES * 0.975) - 1]
  const decision =
    lower > input.minimumUsefulDelta
      ? "improve"
      : upper < input.minimumUsefulDelta
        ? "no_benefit"
        : "inconclusive"
  return {
    ...base,
    decision,
    reasonCodes: [
      decision === "improve"
        ? "interval_above_minimum_useful_delta"
        : decision === "no_benefit"
          ? "minimum_useful_delta_ruled_out"
          : "interval_crosses_minimum_useful_delta",
    ],
    uncertainty: {
      method: "assignment-cluster-percentile-bootstrap-v1",
      replicates: BOOTSTRAP_REPLICATES,
      confidenceLevel: 0.95,
      estimate,
      lower,
      upper,
    },
  }
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function seededRandom(seed: number) {
  let state = seed || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 2 ** 32
  }
}

function validateSnapshot(value: unknown): asserts value is UsefulnessSnapshot {
  const fail = () => {
    throw new UsefulnessInputError()
  }
  const record = (item: unknown): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item)
  const count = (item: unknown): item is number =>
    typeof item === "number" && Number.isSafeInteger(item) && item >= 0
  const date = (item: unknown): item is string =>
    typeof item === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(item) &&
    Number.isFinite(Date.parse(item)) &&
    new Date(item).toISOString() ===
      (item.includes(".") ? item : item.replace("Z", ".000Z"))
  if (!record(value)) return fail()
  if (
    (value.schemaVersion !== "recommendation-usefulness-offline-v1" &&
      value.schemaVersion !== "recommendation-usefulness-offline-v2") ||
    typeof value.experimentId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,191}$/.test(value.experimentId) ||
    typeof value.configurationDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.configurationDigest) ||
    !date(value.enrollmentStart) ||
    !date(value.enrollmentEnd) ||
    !date(value.capturedAt) ||
    Date.parse(value.enrollmentEnd) <= Date.parse(value.enrollmentStart) ||
    Date.parse(value.enrollmentEnd) - Date.parse(value.enrollmentStart) >
      14 * DAY_MS ||
    !count(value.plannedAssignmentsPerArm) ||
    value.plannedAssignmentsPerArm < 200 ||
    typeof value.minimumUsefulDelta !== "number" ||
    !Number.isFinite(value.minimumUsefulDelta) ||
    value.minimumUsefulDelta <= 0 ||
    !record(value.health) ||
    !Array.isArray(value.units)
  )
    return fail()
  const { health } = value
  for (const key of [
    "assignmentLedgerCount",
    "claimedEpisodes",
    "missingActiveEpisodes",
    "unresolvedEpisodes",
    "contaminatedAssignments",
    "fencedAssignments",
    "conflictingOutcomes",
  ])
    if (!count(health[key])) return fail()
  if (Number(health.missingActiveEpisodes) > Number(health.claimedEpisodes))
    return fail()
  for (const key of [
    "aaPassed",
    "routingVerified",
    "retentionHealthy",
    "collectionHealthy",
    "guardrailsPassed",
  ])
    if (typeof health[key] !== "boolean") return fail()
  const start = Date.parse(value.enrollmentStart)
  const end = Date.parse(value.enrollmentEnd)
  let qualifiedViews = 0
  for (const unit of value.units) {
    if (
      !record(unit) ||
      typeof unit.unitDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(unit.unitDigest) ||
      unit.unitKind !== "anonymous_profile" ||
      (unit.arm !== "control" && unit.arm !== "challenger") ||
      !date(unit.assignedAt) ||
      Date.parse(unit.assignedAt) < start ||
      Date.parse(unit.assignedAt) >= end ||
      !count(unit.qualifiedViews)
    )
      return fail()
    qualifiedViews += unit.qualifiedViews
  }
  if (
    !Number.isSafeInteger(qualifiedViews) ||
    qualifiedViews > Number(health.claimedEpisodes)
  )
    return fail()
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 3) throw new UsefulnessInputError()
    const snapshot: unknown = JSON.parse(readFileSync(process.argv[2], "utf8"))
    validateSnapshot(snapshot)
    const result = evaluateUsefulnessSnapshot(snapshot)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = result.decision === "data_unhealthy" ? 2 : 0
  } catch {
    // Never echo paths, input JSON, unit digests, or parser excerpts to shared logs.
    process.stderr.write(
      "Invalid usefulness input. Usage: node usefulness-offline.ts snapshot.json\n",
    )
    process.exitCode = 1
  }
}
