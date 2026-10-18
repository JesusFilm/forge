import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReservationAwareStructuredModel } from "../services/precomputed-recommendations/codex-subscription-astra"
import {
  sha256,
  validateCorpus,
} from "../services/precomputed-recommendations/full-library-v1"
import {
  SharedReadingConfigSchema,
  sharedReadingCli,
} from "./run-shared-reading-recommendations"

const guards = vi.hoisted(() => ({ account: vi.fn(), model: vi.fn() }))
vi.mock("../services/precomputed-recommendations/codex-local-account", () => ({
  createLocalCodexAccountReader: guards.account,
}))
vi.mock(
  "../services/precomputed-recommendations/codex-subscription-astra",
  async (original) => ({
    ...(await original<
      typeof import("../services/precomputed-recommendations/codex-subscription-astra")
    >()),
    createCodexSubscriptionAstraModel: guards.model,
  }),
)
const paths: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    paths.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  )
})
beforeEach(() => {
  guards.account.mockReset()
  guards.model.mockReset()
})
async function configFixture() {
  const root = await mkdtemp(join(tmpdir(), "shared-cli-builder-"))
  paths.push(root)
  const corpus = validateCorpus({
    observedAt: "2026-10-19T00:00:00.000Z",
    entries: ["source-a", "source-b"].map((id) => ({
      video: {
        id,
        coreId: id,
        slug: id,
        locale: "en",
        title: "Title " + id,
        description: "Whole description " + id,
        descriptionTruncated: false,
        keywords: [],
        keywordsTruncated: false,
        bibleCitations: [],
        bibleCitationsTruncated: false,
        parentVideoIds: [],
        childVideoIds: [],
        transcriptLanguages: [],
        transcriptSelection: {
          policy: "english-per-edition-with-complete-fallback-v1",
          availableTranscriptCount: 0,
          incompleteTranscriptCount: 0,
          skippedEditionCount: 0,
          selected: [],
        },
      },
      chunks: [],
    })),
  })
  const corpusBytes = JSON.stringify(corpus)
  const script =
    "let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>process.stdout.write(String(Math.max(1,Math.ceil(Buffer.byteLength(text)/4)))));"
  const scriptPath = join(root, "counter.cjs")
  const evidencePath = join(root, "admission.json")
  await Promise.all([
    writeFile(join(root, "corpus.json"), corpusBytes),
    writeFile(scriptPath, script),
    writeFile(evidencePath, "{}"),
  ])
  const config = {
    corpusPath: join(root, "corpus.json"),
    corpusSha256: sha256(corpusBytes),
    context: {
      modelId: "gpt-6-astra",
      modelVersion: "fixture",
      contextWindowTokens: 50000,
      effectiveContextTokens: 50000,
      autoCompactLimitTokens: 50000,
      outputReserveTokens: 1000,
      overheadReserveTokens: 1000,
      tokenizer: "fixture UTF8/4 only",
      contextEvidence: "fake boundary test",
    },
    tokenizer: {
      executable: process.execPath,
      args: [scriptPath],
      scriptPath,
      scriptSha256: sha256(script),
    },
    runDirectory: join(root, "run"),
    planPath: join(root, "plan.json"),
  }
  const configPath = join(root, "config.json")
  await writeFile(configPath, JSON.stringify(config))
  return { config, configPath, evidencePath }
}
describe("shared reading CLI builder boundary", () => {
  it("defaults ALL sources, four per group, concurrency two, timeout fifteen minutes and guard25", async () => {
    const { config } = await configFixture()
    const parsed = SharedReadingConfigSchema.parse(config)
    expect(parsed.sourceIds).toBeUndefined()
    expect(parsed.maxSourcesPerGroup).toBe(4)
    expect(parsed.readingConcurrency).toBe(2)
    expect(parsed.timeoutMs).toBe(900000)
    expect(parsed.minimumRemainingPercent).toBe(25)
    for (const invalid of [
      { maxSourcesPerGroup: 5 },
      { maxSourcesPerGroup: 0 },
      { readingConcurrency: 3 },
      { timeoutMs: 900001 },
      { minimumRemainingPercent: 1 },
    ])
      expect(
        SharedReadingConfigSchema.safeParse({ ...config, ...invalid }).success,
      ).toBe(false)
  })

  it("plans offline without account/model access and refuses a nonadmitted run", async () => {
    const { config, configPath } = await configFixture()
    vi.spyOn(process.stdout, "write").mockReturnValue(true)
    await sharedReadingCli(["plan", "--config", configPath])
    const plan = JSON.parse(await readFile(config.planPath, "utf8"))
    expect(plan.sourceIds).toEqual(["source-a", "source-b"])
    expect(plan.groups[0].sources).toEqual([0, 1])
    expect(
      plan.groups[0].readings.flatMap((r: { targets: number[] }) => r.targets),
    ).toEqual([0, 1])
    expect(guards.account).not.toHaveBeenCalled()
    expect(guards.model).not.toHaveBeenCalled()
    await expect(
      sharedReadingCli(["run", "--config", configPath]),
    ).rejects.toThrow("coordinator_admission_required")
    await expect(
      sharedReadingCli(["run", "--config", "relative.json"]),
    ).rejects.toThrow("usage_plan_or_run")
  })

  it("wires existing subscription guards, hashes source/config and resumes without additional calls", async () => {
    const { config, configPath, evidencePath } = await configFixture()
    vi.spyOn(process.stdout, "write").mockReturnValue(true)
    await sharedReadingCli(["plan", "--config", configPath])
    const admitted = {
      ...config,
      codexExecutable: "/fake/codex-never-spawned",
      admission: { admitted: true, evidencePath, evidenceSha256: sha256("{}") },
    }
    await writeFile(configPath, JSON.stringify(admitted))
    const allowance = vi.fn(),
      identity = vi.fn()
    guards.account.mockReturnValue({
      readAttestation: async () => ({
        admission: "admitted",
        identity: { accountRef: "private-fixture-account" },
      }),
      readAllowance: allowance,
      readOperatorIdentity: identity,
    })
    let calls = 0
    const fake: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        calls++
        const decision = await reserve()
        if (decision.kind === "skip")
          return { kind: "skipped", reservation: decision.reservation }
        const p = JSON.parse(request.prompt)
        const output = p.targets
          ? {
              sources: p.sources.map((s: { ref: number }) => s.ref),
              targets: p.targets.map((t: { ref: number }) => t.ref),
              complete: true,
              discoveries: [],
              notes: "No sufficiently supported connections in this fixture.",
            }
          : {
              recommendations: [],
              fewerThanFiveReason:
                "No supported viewing-value connections in the fixture.",
            }
        return {
          kind: "dispatched",
          reservation: decision.reservation,
          response: {
            output: request.schema.parse(output),
            usage: { inputTokens: 100, outputTokens: 20 },
          },
        }
      },
    }
    guards.model.mockReturnValue(fake)
    await sharedReadingCli(["run", "--config", configPath])
    expect(guards.account).toHaveBeenCalledWith({
      codexExecutable: admitted.codexExecutable,
      minimumRemainingPercent: 25,
    })
    expect(guards.model).toHaveBeenCalledWith({
      codexExecutable: admitted.codexExecutable,
      initiatingAccountRef: "private-fixture-account",
      readAllowance: allowance,
      readOperatorIdentity: identity,
      minimumRemainingPercent: 25,
      concurrency: 2,
      timeoutMs: 900000,
    })
    const manifest = JSON.parse(
      await readFile(join(config.runDirectory, "manifest.json"), "utf8"),
    )
    expect(Object.keys(manifest.execution.sourceHashes)).toHaveLength(8)
    expect(manifest.execution.config.maxSourcesPerGroup).toBe(4)
    expect(manifest.execution.billingBasis).toBe("included_subscription")
    expect(calls).toBe(3)
    await sharedReadingCli(["run", "--config", configPath])
    expect(calls).toBe(3)
    const usage = JSON.parse(
      await readFile(join(config.runDirectory, "usage-summary.json"), "utf8"),
    )
    expect(usage).toMatchObject({
      knownPhysicalCalls: 3,
      unknownConsumptionCalls: 0,
      inputTokens: 300,
      outputTokens: 60,
    })
    expect(usage.cachedInputTokens).toBeNull()
  })
})
