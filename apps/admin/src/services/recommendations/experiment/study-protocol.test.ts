import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import {
  isStudyAdmitted,
  parseStudyProtocol,
  parseStudyEvidence,
  studyChallengerCeilingBps,
  studyGuardrails,
  studyProtocolDigest,
} from "./study-protocol"

export const protocolFixture = () => ({
  version: "profile-study-governance-v1",
  studyId: "calibration-1",
  mode: "calibration",
  comparison: "semantic-aa",
  identity: "anonymous-profile-generation-v1",
  surface: "watch-below-player-v1",
  cohort: "human-en-english-durable-v1",
  controlManifestId: "semantic-transcript-pgvector-v1",
  challengerManifestId: "semantic-experiment-aa-v1",
  controlManifestDigest: "a".repeat(64),
  challengerManifestDigest: "b".repeat(64),
  incumbentExecution: "hybrid_personalized",
  controlExecution: "semantic_contextual",
  admissionBps: 1000,
  challengerProbability: 0.5,
  startsAt: "2026-10-01T00:00:00.000Z",
  endsAt: "2026-10-03T00:00:00.000Z",
  expiresAt: "2026-10-20T00:00:00.000Z",
  stoppingRule: "fixed-enrollment-window-v1",
  plannedAssignmentsPerArm: 200,
  minimumUsefulDelta: null,
  evidenceMaxAgeHours: 24,
  calibrationEvaluationId: null,
})
const receipt = {
  source: "reviewed-artifact",
  reference: "docs/validation/fixture.json",
  sha256: "c".repeat(64),
}
const arm = {
  requests: 1000,
  timeoutsOrErrors: 2,
  requestsWithCards: 999,
  p95LatencyMs: 500,
  claimedEpisodes: 100,
  missingActiveEpisodes: 1,
  attributionFailures: 0,
  fatalPlaybackErrors: 0,
}
export const evidenceFixture = () => ({
  kind: "outcomes" as const,
  capturedAt: "2026-10-04T06:00:00.000Z",
  validUntil: "2026-10-05T06:00:00.000Z",
  windowStart: "2026-10-01T00:00:00.000Z",
  windowEnd: "2026-10-04T06:00:00.000Z",
  delivery: receipt,
  playback: receipt,
  collection: receipt,
  retention: receipt,
  browserJourney: receipt,
  control: arm,
  challenger: arm,
})

describe("immutable profile study protocol", () => {
  it("separates sticky enrollment from 50/50 arms and digest-binds its fraction", () => {
    const protocol = parseStudyProtocol(protocolFixture())
    expect(studyChallengerCeilingBps(protocol)).toBe(500)
    const digest = studyProtocolDigest(protocol)
    let admitted = 0
    for (let i = 0; i < 10000; i++) {
      const unit = createHash("sha256").update(String(i)).digest("hex")
      const first = isStudyAdmitted(unit, digest, protocol.admissionBps)
      expect(isStudyAdmitted(unit, digest, protocol.admissionBps)).toBe(first)
      admitted += Number(first)
    }
    expect(admitted).toBeGreaterThan(850)
    expect(admitted).toBeLessThan(1150)
    expect(studyProtocolDigest({ ...protocol, admissionBps: 2000 })).not.toBe(
      digest,
    )
  })
  it.each([
    { identity: "session" },
    { admissionBps: 1 },
    { admissionBps: 10001 },
    { challengerProbability: 0.01 },
    { endsAt: "2026-10-02T00:00:00.000Z" },
    { startsAt: "2026-10-01T00:01:00.000Z" },
    { endsAt: "2026-10-16T00:00:00.000Z" },
    { expiresAt: "2026-10-04T06:00:00.000Z" },
    { expiresAt: "2026-10-30T00:00:00.000Z" },
    { challengerManifestId: "cowatch-shadow-v1" },
    { mode: "efficacy" },
    { plannedAssignmentsPerArm: 199 },
    { guardrailsPassed: true },
  ])("rejects invalid or undeclared contract %j", (change) =>
    expect(() =>
      parseStudyProtocol({ ...protocolFixture(), ...change }),
    ).toThrow(),
  )
  it("requires exact whole-follow-up numeric evidence and calculates harm", () => {
    const p = parseStudyProtocol(protocolFixture())
    const e = parseStudyEvidence(
      evidenceFixture(),
      p,
      new Date("2026-10-04T07:00:00Z"),
    )
    if (e.kind !== "outcomes") throw new Error("fixture")
    expect(studyGuardrails(e).passed).toBe(true)
    expect(
      studyGuardrails({
        ...e,
        challenger: { ...e.challenger, p95LatencyMs: 701 },
      }).reasons,
    ).toContain("delivery_latency")
    expect(() =>
      parseStudyEvidence(
        { ...e, guardrailsPassed: true },
        p,
        new Date(e.capturedAt),
      ),
    ).toThrow()
    expect(() =>
      parseStudyEvidence(
        { ...e, windowEnd: p.endsAt },
        p,
        new Date(e.capturedAt),
      ),
    ).toThrow()
    expect(() =>
      parseStudyEvidence(e, p, new Date("2026-10-06T00:00:00Z")),
    ).toThrow()
  })
})
