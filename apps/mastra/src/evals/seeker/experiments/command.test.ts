import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  generateEvidence,
  runLeaf,
  serializeSupportedModelRoutes,
} from "./command"
import { parseOrderedModelRoutes } from "../run-loop"
import type { ResolvedIdentity } from "./types"

const hash = (value: string) => value.repeat(64)
const resolvedIdentity: ResolvedIdentity = {
  prompt: {
    provider: "langfuse",
    name: "seeker-system",
    revision: "42",
    contentHash: hash("a"),
  },
  model: {
    routing: "ordered-fallback",
    routes: [
      {
        provider: "openrouter",
        model: "model-a",
        endpoint: "model-router",
        maxRetries: 0,
      },
    ],
  },
  decoding: { mode: "provider-default" },
  questionSet: { id: "questions/v1", questionIds: ["q-one"] },
  criteria: { contentHash: hash("b") },
  judge: { model: "judge-a", rubricHash: hash("c") },
  retrieval: { mode: "fixtures", corpusHash: hash("d"), topK: 5 },
  runtime: { configurationHash: hash("e") },
}

const runIdentity = {
  promptSha256: resolvedIdentity.prompt.contentHash,
  promptSource: "langfuse" as const,
  promptLangfuseVersion: 42,
  promptLangfuseLabel: null,
  sectionMappingVersion: "sections/v1",
  questionSetId: resolvedIdentity.questionSet.id,
  questionIds: resolvedIdentity.questionSet.questionIds,
  criteriaSha256: resolvedIdentity.criteria.contentHash,
  answeringModels: ["model-a"],
  decoding: null,
  sampleId: "s1",
  gitSha: null,
  retrieval: {
    mode: "fixtures" as const,
    corpusSha256:
      resolvedIdentity.retrieval.mode === "fixtures"
        ? resolvedIdentity.retrieval.corpusHash
        : "",
    topK:
      resolvedIdentity.retrieval.mode === "fixtures"
        ? resolvedIdentity.retrieval.topK
        : 0,
  },
  judge: null,
  runtimeConfigurationHash: resolvedIdentity.runtime.configurationHash,
}

describe("official experiment command model routing", () => {
  it("preserves the complete ordered OpenRouter fallback identity", () => {
    const routes = [
      {
        provider: "openrouter",
        model: "anthropic/claude-sonnet-5",
        endpoint: "model-router",
        maxRetries: 0,
      },
      {
        provider: "openrouter",
        model: "google/gemma-4-31b-it:free",
        endpoint: "model-router",
        maxRetries: 2,
      },
    ]
    expect(JSON.parse(serializeSupportedModelRoutes(routes))).toEqual(routes)
    expect(
      parseOrderedModelRoutes(serializeSupportedModelRoutes(routes)),
    ).toEqual([
      { model: "openrouter/anthropic/claude-sonnet-5", maxRetries: 0 },
      { model: "openrouter/google/gemma-4-31b-it:free", maxRetries: 2 },
    ])
  })

  it("fails closed for route fields the production runner cannot honor", () => {
    expect(() =>
      serializeSupportedModelRoutes([
        {
          provider: "jesusfilm",
          model: "coding",
          endpoint: "chat-completions",
          maxRetries: 0,
          timeoutMs: 55_000,
        },
      ]),
    ).toThrow(/unsupported model route identity/)
  })

  it("terminates a leaf process that exceeds its overall deadline", async () => {
    await expect(
      runLeaf("src/evals/seeker/experiments/command-hang.fixture.ts", [], {
        timeoutMs: 50,
        terminationGraceMs: 50,
      }),
    ).rejects.toThrow(/overall deadline/)
  })

  it("coordinates leaf arguments, aggregates outputs, and verifies emitted identity", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "seeker-command-"))
    const calls: Array<{ script: string; args: string[] }> = []
    const fakeRunLeaf = vi.fn(async (script: string, args: string[]) => {
      calls.push({ script, args })
      const flag = (name: string) =>
        args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
      const writeJson = async (path: string, value: unknown) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify(value))
      }
      if (script.endsWith("run-loop.ts")) {
        await writeJson(flag("out")!, { identity: runIdentity })
        await writeJson(flag("transcripts")!, { identity: runIdentity })
      } else if (script.endsWith("run-judge.ts")) {
        await writeJson(flag("out")!, {
          identity: {
            ...runIdentity,
            judge: {
              model: resolvedIdentity.judge.model,
              rubricSha256: resolvedIdentity.judge.rubricHash,
            },
          },
        })
      } else if (script.endsWith("run-score.ts")) {
        await writeJson(flag("out")!, { runScore: 1 })
      } else if (script.endsWith("run-gate.ts")) {
        await writeJson(flag("out")!, { verdict: "green" })
      }
    })
    const evidence = await generateEvidence(
      {
        attemptDir: join(scratch, "attempt"),
        manifest: {
          schemaVersion: "seeker-experiment/v1",
          id: "experiment-one",
          owner: "owner",
          hypothesis: "The candidate should preserve quality.",
          criterion: {
            id: "minimum-run-score",
            version: "1",
            parameters: { minimum: 1 },
          },
          comparisonAxis: "model",
          productionBenchmark: {
            path: join(scratch, "baseline"),
            identity: resolvedIdentity,
          },
          candidates: [{ id: "candidate-one", identity: resolvedIdentity }],
          lifecycle: "executing",
        },
        resolvedIdentities: { "candidate-one": resolvedIdentity },
        resolvedPromptTexts: { "candidate-one": "managed prompt" },
      },
      { runLeaf: fakeRunLeaf as typeof runLeaf },
    )
    expect(evidence["gate-report.json"]).toMatchObject({
      candidates: { "candidate-one": { verdict: "green" } },
    })
    expect(
      calls.find((call) => call.script.endsWith("run-loop.ts"))?.args,
    ).toContain(`--runtime-hash=${resolvedIdentity.runtime.configurationHash}`)
    expect(
      calls.find((call) => call.script.endsWith("run-gate.ts"))?.args,
    ).toContain("--experiment-axis=model")
  })
})
