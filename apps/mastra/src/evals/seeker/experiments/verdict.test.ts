import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { createAttemptWriter } from "./artifacts"
import { recordTerminalVerdict } from "./verdict"

const required = [
  "resolved-identity.json",
  "answers.json",
  "transcripts.json",
  "judged.json",
  "score.json",
  "comparison.md",
  "gate-report.json",
] as const

async function completedExperiment(
  gate: "green" | "red" | "refused",
  runScore = 0.9,
) {
  const root = await mkdtemp(join(tmpdir(), "seeker-verdict-"))
  const experimentDir = join(root, "exp-one")
  await mkdir(experimentDir, { recursive: true })
  await writeFile(
    join(experimentDir, "experiment.json"),
    JSON.stringify({
      schemaVersion: "seeker-experiment/v1",
      id: "exp-one",
      criterion: {
        id: "minimum-run-score",
        version: "1",
        parameters: { minimum: 0.8 },
      },
      candidates: [{ id: "candidate-one" }],
    }),
  )
  const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
  for (const path of required) {
    if (path === "comparison.md") await writer.writeText(path, "# result\n")
    else if (path === "gate-report.json")
      await writer.writeJson(path, {
        schemaVersion: "seeker-experiment-gates/v1",
        candidates: { "candidate-one": { verdict: gate } },
      })
    else if (path === "score.json")
      await writer.writeJson(path, {
        schemaVersion: "seeker-experiment-scores/v1",
        candidates: { "candidate-one": { runScore } },
      })
    else await writer.writeJson(path, {})
  }
  await writer.complete(required)
  return { root, experimentDir }
}

const evidence = [
  "attempts/attempt-1/gate-report.json",
  "attempts/attempt-1/score.json",
  "attempts/attempt-1/comparison.md",
]

describe("recordTerminalVerdict", () => {
  it("records successful only for automatically eligible evidence", async () => {
    const { root, experimentDir } = await completedExperiment("green")
    const result = await recordTerminalVerdict({
      experimentsRoot: root,
      experimentDir,
      attemptId: "attempt-1",
      candidateId: "candidate-one",
      verdict: "successful",
      actor: "reviewer@example.org",
      recordedAt: "2026-08-10T10:00:00.000Z",
      reasoning: "The declared criterion and regression gate both passed.",
      evidence,
    })

    expect(result.eligibility.eligible).toBe(true)
    expect(JSON.parse(await readFile(result.path, "utf8"))).toMatchObject({
      verdict: "successful",
      eligibility: {
        gate: { outcome: "green" },
        criterion: { outcome: "passed" },
      },
    })
  })

  it.each(["failed", "inconclusive", "deferred"] as const)(
    "allows an eligible result to be vetoed as %s and remains commit-ready",
    async (verdict) => {
      const { root, experimentDir } = await completedExperiment("green")
      const result = await recordTerminalVerdict({
        experimentsRoot: root,
        experimentDir,
        attemptId: "attempt-1",
        candidateId: "candidate-one",
        verdict,
        actor: "reviewer@example.org",
        recordedAt: "2026-08-10T10:00:00.000Z",
        reasoning: "Human review identified evidence that warrants a veto.",
        evidence,
      })
      expect(result.commitReady).toBe(true)
      expect(result.eligibility.eligible).toBe(true)
    },
  )

  it.each(["red", "refused"] as const)(
    "never permits human success over a %s gate",
    async (gate) => {
      const { root, experimentDir } = await completedExperiment(gate)
      await expect(
        recordTerminalVerdict({
          experimentsRoot: root,
          experimentDir,
          attemptId: "attempt-1",
          candidateId: "candidate-one",
          verdict: "successful",
          actor: "owner@example.org",
          recordedAt: "2026-08-10T10:00:00.000Z",
          reasoning: "The owner would still prefer to promote this candidate.",
          evidence,
        }),
      ).rejects.toThrow(/cannot record successful.*automatically ineligible/)
    },
  )

  it("requires complete checksummed evidence and inventory-backed references", async () => {
    const { root, experimentDir } = await completedExperiment("green")
    await writeFile(
      join(experimentDir, "attempts/attempt-1/score.json"),
      "corrupt\n",
    )
    await expect(
      recordTerminalVerdict({
        experimentsRoot: root,
        experimentDir,
        attemptId: "attempt-1",
        candidateId: "candidate-one",
        verdict: "failed",
        actor: "reviewer@example.org",
        recordedAt: "2026-08-10T10:00:00.000Z",
        reasoning: "The package integrity check should reject this evidence.",
        evidence,
      }),
    ).rejects.toThrow(/checksum mismatch/)
  })

  it("refuses a verdict when the completed package contains an untracked partial", async () => {
    const { root, experimentDir } = await completedExperiment("green")
    await writeFile(
      join(experimentDir, "attempts/attempt-1/score.json.partial"),
      "{}",
    )
    await expect(
      recordTerminalVerdict({
        experimentsRoot: root,
        experimentDir,
        attemptId: "attempt-1",
        candidateId: "candidate-one",
        verdict: "failed",
        actor: "reviewer@example.org",
        recordedAt: "2026-08-10T10:00:00.000Z",
        reasoning: "The package scan must precede the human verdict action.",
        evidence,
      }),
    ).rejects.toThrow(/forbidden or untracked package artifact/)
  })

  it("does not rewrite prior eligibility when policy or opinion changes", async () => {
    const { root, experimentDir } = await completedExperiment("red")
    await recordTerminalVerdict({
      experimentsRoot: root,
      experimentDir,
      attemptId: "attempt-1",
      candidateId: "candidate-one",
      verdict: "failed",
      actor: "reviewer@example.org",
      recordedAt: "2026-08-10T10:00:00.000Z",
      reasoning: "The persisted regression gate is red and cannot be waived.",
      evidence,
    })
    await expect(
      recordTerminalVerdict({
        experimentsRoot: root,
        experimentDir,
        attemptId: "attempt-1",
        candidateId: "candidate-one",
        verdict: "successful",
        actor: "owner@example.org",
        recordedAt: "2026-08-10T11:00:00.000Z",
        reasoning: "A changed policy should require an entirely new run.",
        evidence,
      }),
    ).rejects.toThrow(/already has a terminal verdict/)
  })
})
