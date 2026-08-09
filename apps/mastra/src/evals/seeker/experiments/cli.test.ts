import { describe, expect, it, vi } from "vitest"

import { executeVerdictCommand, verdictCommandArgs } from "./cli"

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
