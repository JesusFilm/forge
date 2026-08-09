import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { describe, expect, it } from "vitest"

import { ResolvedIdentitySchema } from "./types"
import { preparePromotion } from "./promotion"

const exec = promisify(execFile)
const hash = "a".repeat(64)
const identity = ResolvedIdentitySchema.parse({
  prompt: {
    provider: "langfuse",
    name: "seeker-system",
    revision: "42",
    contentHash: hash,
  },
  model: {
    routing: "ordered-fallback",
    routes: [
      {
        provider: "openrouter",
        model: "model",
        endpoint: "model-router",
        maxRetries: 1,
      },
    ],
  },
  decoding: { mode: "provider-default" },
  questionSet: { id: "questions/v1", questionIds: ["q-one"] },
  criteria: { contentHash: hash },
  judge: { model: "judge", rubricHash: hash },
  retrieval: { mode: "fixtures", corpusHash: hash, topK: 5 },
  runtime: { configurationHash: hash },
})

async function fixture(
  options: { verdict?: string; eligible?: boolean; mutate?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "seeker-promotion-"))
  await exec("git", ["init", "-q"], { cwd: root })
  await exec("git", ["config", "user.email", "test@example.org"], { cwd: root })
  await exec("git", ["config", "user.name", "Test"], { cwd: root })
  const experiment = "apps/mastra/evals/experiments/seeker/exp-one"
  const attempt = `${experiment}/attempts/attempt-one`
  await mkdir(join(root, attempt), { recursive: true })
  const artifacts: Array<{ kind: string; path: string; sha256: string }> = []
  const evidence: Array<[string, string, string]> = [
    [
      "resolved-identity",
      "resolved-identity.json",
      JSON.stringify({ candidates: { "candidate-one": identity } }),
    ],
    ...["answers", "transcripts", "judged", "score"].map(
      (name) =>
        [
          name,
          `${name}.json`,
          JSON.stringify({
            candidates: { "candidate-one": { kind: `${name}.json`, identity } },
          }),
        ] as [string, string, string],
    ),
    ["comparison", "comparison.md", "comparison evidence\n"],
    [
      "gate-report",
      "gate-report.json",
      JSON.stringify({ candidates: { "candidate-one": { outcome: "green" } } }),
    ],
  ]
  for (const [kind, name, content] of evidence) {
    await writeFile(join(root, attempt, name), content)
    artifacts.push({
      kind,
      path: `attempts/attempt-one/${name}`,
      sha256: createHash("sha256").update(content).digest("hex"),
    })
  }
  await writeFile(
    join(root, attempt, "completion.json"),
    JSON.stringify({
      schemaVersion: "seeker-attempt/v1",
      experimentId: "exp-one",
      attemptId: "attempt-one",
      completedAt: "2026-08-01T00:00:00.000Z",
      inventory: {
        experimentId: "exp-one",
        attemptId: "attempt-one",
        artifacts,
      },
    }),
  )
  await writeFile(
    join(root, experiment, "verdict.json"),
    JSON.stringify({
      schemaVersion: "seeker-verdict/v1",
      experimentId: "exp-one",
      attemptId: "attempt-one",
      candidateId: "candidate-one",
      verdict: options.verdict ?? "successful",
      actor: "owner",
      recordedAt: "2026-08-01T00:00:00.000Z",
      reasoning: "Evidence is acceptable.",
      evidence: ["attempts/attempt-one/gate-report.json"],
      eligibility: {
        gate: { outcome: "green" },
        criterion: { id: "criterion", version: "1", outcome: "passed" },
        eligible: options.eligible ?? true,
        evidence: ["attempts/attempt-one/gate-report.json"],
      },
    }),
  )
  await exec("git", ["add", "."], { cwd: root })
  await exec("git", ["commit", "-qm", "experiment evidence"], { cwd: root })
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root })
  if (options.mutate)
    await writeFile(join(root, attempt, "answers.json"), "changed")
  return { root, experiment, commit: stdout.trim() }
}

describe("preparePromotion", () => {
  it("validates committed exact-match evidence and materializes linked benchmark artifacts", async () => {
    const f = await fixture()
    const output = join(f.root, "benchmark")
    const result = await preparePromotion({
      repositoryRoot: f.root,
      experimentPath: f.experiment,
      attemptId: "attempt-one",
      candidateId: "candidate-one",
      evidenceCommit: f.commit,
      proposedIdentity: identity,
      productionPrompt: identity.prompt,
      benchmarkDir: output,
      materialize: true,
    })
    expect(result).toMatchObject({
      valid: true,
      requiresFreshRun: false,
      source: {
        experimentId: "exp-one",
        attemptId: "attempt-one",
        candidateId: "candidate-one",
        commit: f.commit,
      },
    })
    expect(
      JSON.parse(await readFile(join(output, "answers.json"), "utf8")),
    ).toMatchObject({ sourcePromotion: result.source })
  })

  it.each([
    ["unsuccessful verdict", { verdict: "failed" }],
    ["ineligible verdict", { eligible: false }],
    ["working-tree mutation", { mutate: true }],
  ])("rejects %s", async (_name, options) => {
    const f = await fixture(options)
    await expect(
      preparePromotion({
        repositoryRoot: f.root,
        experimentPath: f.experiment,
        attemptId: "attempt-one",
        candidateId: "candidate-one",
        evidenceCommit: f.commit,
        proposedIdentity: identity,
        productionPrompt: identity.prompt,
        benchmarkDir: join(f.root, "benchmark"),
        materialize: false,
      }),
    ).rejects.toThrow()
  })

  it("requires a fresh run for any complete identity drift and writes nothing", async () => {
    const f = await fixture()
    const output = join(f.root, "benchmark")
    const changed = {
      ...identity,
      runtime: { configurationHash: "b".repeat(64) },
    }
    const result = await preparePromotion({
      repositoryRoot: f.root,
      experimentPath: f.experiment,
      attemptId: "attempt-one",
      candidateId: "candidate-one",
      evidenceCommit: f.commit,
      proposedIdentity: changed,
      productionPrompt: identity.prompt,
      benchmarkDir: output,
      materialize: true,
    })
    expect(result).toMatchObject({
      valid: false,
      requiresFreshRun: true,
      mismatches: ["runtime"],
    })
    await expect(readFile(join(output, "answers.json"))).rejects.toThrow()
  })
})
