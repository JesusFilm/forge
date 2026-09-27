import { describe, expect, it } from "vitest"
import {
  candidateTracePayload,
  type CandidateEvidenceRow,
} from "./candidate-trace"

const row: CandidateEvidenceRow = {
  id: "stage-1",
  runId: "run-1",
  stage: "composed",
  ordinal: 0,
  candidateKey: "video-1",
  targetMediaId: "video-1",
  sourceGenerator: "semantic",
  sourceRank: 1,
  sourceScore: 0.9,
  normalizedScore: 0.8,
  rrfScore: 0.7,
  deterministicScore: 0.6,
  finalPosition: 0,
  reasonCodes: ["position_retained"],
  sourceEvidence: [
    {
      generator: "semantic",
      generatorVersion: "v1",
      rank: 1,
      score: 0.9,
      evidence: { sceneIndex: 2 },
      rejectionReason: null,
    },
  ],
  createdAt: new Date("2026-09-28T01:00:00.000Z"),
  expiresAt: new Date("2026-10-27T01:00:00.000Z"),
}

describe("candidate trace payload", () => {
  it("preserves every stage observation and its order without run metadata", () => {
    expect(
      candidateTracePayload([row, { ...row, id: "stage-2", ordinal: 1 }]),
    ).toEqual({
      stages: [
        {
          id: "stage-1",
          stage: row.stage,
          ordinal: 0,
          candidateKey: row.candidateKey,
          targetMediaId: row.targetMediaId,
          sourceGenerator: row.sourceGenerator,
          sourceRank: row.sourceRank,
          sourceScore: row.sourceScore,
          normalizedScore: row.normalizedScore,
          rrfScore: row.rrfScore,
          deterministicScore: row.deterministicScore,
          finalPosition: row.finalPosition,
          reasonCodes: row.reasonCodes,
          sourceEvidence: row.sourceEvidence,
          createdAt: "2026-09-28T01:00:00.000Z",
        },
        expect.objectContaining({ id: "stage-2", ordinal: 1 }),
      ],
    })
    expect(candidateTracePayload([])).toEqual({ stages: [] })
  })

  it("rejects nonfinite values instead of silently storing null", () => {
    expect(() =>
      candidateTracePayload([{ ...row, sourceScore: Number.NaN }]),
    ).toThrow("finite numbers")
    expect(() =>
      candidateTracePayload([
        {
          ...row,
          sourceEvidence: [{ evidence: { score: Number.POSITIVE_INFINITY } }],
        },
      ]),
    ).toThrow("finite numbers")
  })
})
