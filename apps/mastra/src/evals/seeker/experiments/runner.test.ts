import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { ExperimentManifestInput, ResolvedIdentity } from "./types"
import { runExperiment } from "./runner"

const hash = (character: string) => character.repeat(64)
function identity(revision = "42", contentHash = hash("a")): ResolvedIdentity {
  return {
    prompt: {
      provider: "langfuse",
      name: "seeker-system",
      revision,
      contentHash,
    },
    model: {
      routing: "ordered-fallback",
      routes: [
        {
          provider: "openrouter",
          model: "model-a",
          endpoint: "chat",
          maxRetries: 0,
        },
      ],
    },
    decoding: { mode: "provider-default" },
    questionSet: { id: "seeker-v1", questionIds: ["q-1"] },
    criteria: { contentHash: hash("b") },
    judge: { model: "judge", rubricHash: hash("c") },
    retrieval: { mode: "fixtures", corpusHash: hash("d"), topK: 5 },
    runtime: { configurationHash: hash("e") },
  }
}
function manifest(
  candidate = identity("43", hash("f")),
): ExperimentManifestInput {
  return {
    schemaVersion: "seeker-experiment/v1",
    id: "exp-one",
    owner: "owner",
    hypothesis: "Candidate should improve the production result",
    criterion: { id: "quality", version: "1", parameters: {} },
    comparisonAxis: "prompt",
    productionBenchmark: {
      path: "baseline/identity.json",
      identity: identity(),
    },
    candidates: [{ id: "candidate-one", identity: candidate }],
    lifecycle: "executing",
  }
}
async function packageWith(
  input: unknown,
): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), "seeker-runner-"))
  const dir = join(root, "exp-one")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "experiment.json"), JSON.stringify(input))
  return { root, dir }
}

describe("runExperiment preflight", () => {
  it.each([
    ["fallback", { ok: false as const, reason: "fallback" }],
    ["stale", { ok: false as const, reason: "stale" }],
    ["missing", { ok: false as const, reason: "missing" }],
    ["mismatch", { ok: true as const, revision: "44", contentHash: hash("f") }],
  ])(
    "refuses %s prompt resolution before any answer generation",
    async (_name, resolution) => {
      const { root, dir } = await packageWith(manifest())
      const generate = vi.fn()
      await expect(
        runExperiment({
          experimentsRoot: root,
          experimentDir: dir,
          attemptId: "attempt-1",
          resolvePrompt: vi.fn().mockResolvedValue(resolution),
          generate,
        }),
      ).rejects.toThrow(/official prompt preflight/)
      expect(generate).not.toHaveBeenCalled()
      expect(
        JSON.parse(
          await readFile(
            join(dir, "attempts/attempt-1/diagnostic.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({ stage: "preflight" })
    },
  )

  it("refuses invalid manifests, off-axis drift, and baseline mismatch before generation", async () => {
    const cases: unknown[] = [
      { ...manifest(), owner: undefined },
      {
        ...manifest(),
        candidates: [
          {
            id: "candidate-one",
            identity: {
              ...identity("43", hash("f")),
              decoding: { mode: "parameters", temperature: 0, maxTokens: 10 },
            },
          },
        ],
      },
    ]
    for (const input of cases) {
      const { root, dir } = await packageWith(input)
      const generate = vi.fn()
      await expect(
        runExperiment({
          experimentsRoot: root,
          experimentDir: dir,
          attemptId: "attempt-1",
          resolvePrompt: vi.fn(),
          generate,
        }),
      ).rejects.toThrow()
      expect(generate).not.toHaveBeenCalled()
    }
    const { root, dir } = await packageWith(manifest())
    const generate = vi.fn()
    await expect(
      runExperiment({
        experimentsRoot: root,
        experimentDir: dir,
        attemptId: "attempt-1",
        loadBenchmarkIdentity: vi
          .fn()
          .mockResolvedValue(identity("99", hash("9"))),
        resolvePrompt: vi.fn(),
        generate,
      }),
    ).rejects.toThrow(/benchmark identity mismatch/)
    expect(generate).not.toHaveBeenCalled()
  })

  it("refuses a concurrent manifest revision before generation", async () => {
    const { root, dir } = await packageWith(manifest())
    const generate = vi.fn()
    await expect(
      runExperiment({
        experimentsRoot: root,
        experimentDir: dir,
        attemptId: "attempt-1",
        resolvePrompt: async () => {
          await writeFile(
            join(dir, "experiment.json"),
            JSON.stringify({
              ...manifest(),
              hypothesis: "changed concurrently",
            }),
          )
          return { ok: true, revision: "43", contentHash: hash("f") }
        },
        generate,
      }),
    ).rejects.toThrow(/manifest changed during preflight/)
    expect(generate).not.toHaveBeenCalled()
  })
})

describe("runExperiment integration", () => {
  it("persists resolved identity before spend and completes package-local evidence", async () => {
    const { root, dir } = await packageWith(manifest())
    const observed: string[] = []
    const result = await runExperiment({
      experimentsRoot: root,
      experimentDir: dir,
      attemptId: "attempt-1",
      resolvePrompt: vi.fn().mockResolvedValue({
        ok: true,
        revision: "43",
        contentHash: hash("f"),
      }),
      generate: async ({ attemptDir }) => {
        observed.push(
          await readFile(join(attemptDir, "resolved-identity.json"), "utf8"),
        )
        return {
          "answers.json": { kind: "answers" },
          "transcripts.json": { kind: "transcripts" },
          "judged.json": { kind: "judged" },
          "score.json": { kind: "score" },
          "comparison.md": "# comparison\n",
          "gate-report.json": { verdict: "green" },
        }
      },
    })
    expect(observed).toHaveLength(1)
    expect(result.completed).toBe(true)
    expect(
      await readFile(join(dir, "attempts/attempt-1/completion.json"), "utf8"),
    ).toContain("seeker-attempt/v1")
  })

  it("retains failed attempts without a completion marker and retries immutably", async () => {
    const { root, dir } = await packageWith(manifest())
    const common = {
      experimentsRoot: root,
      experimentDir: dir,
      resolvePrompt: vi.fn().mockResolvedValue({
        ok: true,
        revision: "43",
        contentHash: hash("f"),
      }),
    }
    await expect(
      runExperiment({
        ...common,
        attemptId: "attempt-1",
        generate: vi.fn().mockRejectedValue(new Error("provider down")),
      }),
    ).rejects.toThrow(/provider down/)
    await expect(
      readFile(join(dir, "attempts/attempt-1/completion.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      runExperiment({ ...common, attemptId: "attempt-1", generate: vi.fn() }),
    ).rejects.toThrow(/already exists/)
    await expect(
      runExperiment({
        ...common,
        attemptId: "attempt-2",
        generate: vi.fn().mockResolvedValue({}),
      }),
    ).rejects.toThrow(/missing required artifact/)
  })

  it("reuses only a completed full-identity-matching attempt", async () => {
    const { root, dir } = await packageWith(manifest())
    const resolution = vi
      .fn()
      .mockResolvedValue({ ok: true, revision: "43", contentHash: hash("f") })
    const evidence = {
      "answers.json": {},
      "transcripts.json": {},
      "judged.json": {},
      "score.json": {},
      "comparison.md": "# comparison\n",
      "gate-report.json": {},
    }
    await runExperiment({
      experimentsRoot: root,
      experimentDir: dir,
      attemptId: "attempt-1",
      resolvePrompt: resolution,
      generate: vi.fn().mockResolvedValue(evidence),
    })
    const generate = vi.fn().mockResolvedValue(evidence)
    await runExperiment({
      experimentsRoot: root,
      experimentDir: dir,
      attemptId: "attempt-2",
      reuseAttemptId: "attempt-1",
      resolvePrompt: resolution,
      generate,
    })
    expect(generate.mock.calls[0]?.[0].reuseAttemptDir).toContain("attempt-1")
    await writeFile(
      join(dir, "attempts/attempt-1/resolved-identity.json"),
      JSON.stringify({ candidates: {} }),
    )
    await expect(
      runExperiment({
        experimentsRoot: root,
        experimentDir: dir,
        attemptId: "attempt-3",
        reuseAttemptId: "attempt-1",
        resolvePrompt: resolution,
        generate,
      }),
    ).rejects.toThrow(/reuse attempt artifact integrity mismatch/)
  })
})
