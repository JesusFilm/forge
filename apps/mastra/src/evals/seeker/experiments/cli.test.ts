import { describe, expect, it, vi } from "vitest"

import {
  executePromotionCommand,
  executeVerdictCommand,
  promotionCommandArgs,
  verdictCommandArgs,
} from "./cli"

describe("verdictCommandArgs", () => {
  it("loads a complete typed verdict command", () => {
    expect(
      verdictCommandArgs([
        "--experiment=docs/experiments/exp-one",
        "--attempt=attempt-1",
        "--candidate=candidate-one",
        "--verdict=deferred",
        "--actor=reviewer@example.org",
        "--reason=Waiting for a larger evaluation sample.",
        "--evidence=attempts/attempt-1/gate-report.json,attempts/attempt-1/score.json",
      ]),
    ).toMatchObject({ verdict: "deferred", evidence: expect.any(Array) })
  })

  it.each([
    ["missing candidate", "candidate", []],
    ["invalid verdict", "verdict", ["--verdict=approved"]],
    ["missing evidence", "evidence", ["--evidence="]],
  ])("rejects %s", (_name, replacedName, replacement) => {
    const base = [
      "--experiment=exp-one",
      "--attempt=attempt-1",
      "--candidate=candidate-one",
      "--verdict=failed",
      "--actor=reviewer",
      "--reason=There is enough reasoning for review.",
      "--evidence=attempts/attempt-1/gate-report.json",
    ]
    expect(() =>
      verdictCommandArgs([
        ...base.filter((arg) => !arg.startsWith(`--${replacedName}=`)),
        ...replacement,
      ]),
    ).toThrow()
  })

  it("wires the typed command to the terminal-verdict action", async () => {
    const recorder = vi.fn().mockResolvedValue({
      path: "/repo/experiments/exp-one/verdict.json",
      eligibility: {
        gate: { outcome: "green" },
        criterion: {
          id: "minimum-run-score",
          version: "1",
          outcome: "passed",
        },
        eligible: true,
        evidence: ["attempts/attempt-1/gate-report.json"],
      },
      commitReady: true,
    })
    await executeVerdictCommand(
      [
        "--experiment=experiments/exp-one",
        "--attempt=attempt-1",
        "--candidate=candidate-one",
        "--verdict=successful",
        "--actor=reviewer@example.org",
        "--reason=All declared evidence passed human review.",
        "--evidence=attempts/attempt-1/gate-report.json,attempts/attempt-1/score.json,attempts/attempt-1/comparison.md",
      ],
      "/repo",
      recorder,
    )
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        experimentsRoot: "/repo/experiments",
        experimentDir: "/repo/experiments/exp-one",
        verdict: "successful",
      }),
    )
  })
})

describe("promotion command", () => {
  it("requires explicit committed evidence and keeps materialization opt-in", () => {
    expect(
      promotionCommandArgs([
        "--experiment=exp",
        "--attempt=attempt-one",
        "--candidate=candidate-one",
        "--commit=abc123",
        "--production-identity=identity.json",
        "--benchmark-dir=baseline",
      ]),
    ).toMatchObject({ evidenceCommit: "abc123", materialize: false })
    expect(() => promotionCommandArgs([])).toThrow("--experiment")
  })

  it("loads the proposed identity and invokes the separate promoter", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const cwd = await mkdtemp(join(tmpdir(), "promotion-cli-"))
    const h = "a".repeat(64)
    const identity = {
      prompt: {
        provider: "langfuse",
        name: "seeker",
        revision: "1",
        contentHash: h,
      },
      model: {
        routing: "ordered-fallback",
        routes: [
          {
            provider: "openrouter",
            model: "m",
            endpoint: "model-router",
            maxRetries: 0,
          },
        ],
      },
      decoding: { mode: "provider-default" },
      questionSet: { id: "q", questionIds: ["q"] },
      criteria: { contentHash: h },
      judge: { model: "j", rubricHash: h },
      retrieval: { mode: "none" },
      runtime: { configurationHash: h },
    }
    await writeFile(join(cwd, "identity.json"), JSON.stringify(identity))
    const promoter = vi.fn().mockResolvedValue({
      valid: true,
      requiresFreshRun: false,
      mismatches: [],
      source: {
        experimentId: "exp",
        attemptId: "attempt-one",
        candidateId: "candidate-one",
        commit: "abc",
      },
      materializedFiles: [],
    })
    await executePromotionCommand(
      [
        "--experiment=exp",
        "--attempt=attempt-one",
        "--candidate=candidate-one",
        "--commit=abc",
        "--production-identity=identity.json",
        "--benchmark-dir=baseline",
      ],
      cwd,
      promoter,
    )
    expect(promoter).toHaveBeenCalledWith(
      expect.objectContaining({
        proposedIdentity: identity,
        materialize: false,
      }),
    )
  })
})
