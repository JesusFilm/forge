import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReservationAwareStructuredModel } from "../services/precomputed-recommendations/codex-subscription-astra"
import { sha256 } from "../services/precomputed-recommendations/full-library-v1"

const mocked = vi.hoisted(() => ({ account: vi.fn(), model: vi.fn() }))
vi.mock("../services/precomputed-recommendations/codex-local-account", () => ({
  createLocalCodexAccountReader: mocked.account,
}))
vi.mock(
  "../services/precomputed-recommendations/codex-subscription-astra",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../services/precomputed-recommendations/codex-subscription-astra")
    >()),
    createCodexSubscriptionAstraModel: mocked.model,
  }),
)
import {
  FullLibraryConfigSchema,
  fullLibraryCli,
} from "./run-full-library-recommendations"

const directories: string[] = []
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(process.stdout, "write").mockReturnValue(true)
  mocked.account.mockReturnValue({
    readAttestation: async () => ({
      admission: "admitted",
      identity: { accountRef: "timeout-test-account" },
    }),
    readAllowance: vi.fn(),
    readOperatorIdentity: vi.fn(),
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function fixture(timeoutMs?: number) {
  const directory = await mkdtemp(join(tmpdir(), "forge-library-timeout-"))
  directories.push(directory)
  const corpusPath = join(directory, "corpus.json")
  const corpus = JSON.stringify({
    observedAt: "2026-10-16T00:00:00.000Z",
    entries: ["source", "target"].map((id) => ({
      video: {
        id,
        coreId: id,
        slug: id,
        locale: "en",
        title: `Title ${id}`,
        description: `Description ${id}`,
        descriptionTruncated: false,
        keywords: [],
        keywordsTruncated: false,
        bibleCitations: [],
        bibleCitationsTruncated: false,
        parentVideoIds: [],
        childVideoIds: [],
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
  await writeFile(corpusPath, corpus)
  const tokenizerScript = join(directory, "tokens.cjs")
  const script =
    'const fs = require("node:fs"); console.log(Buffer.byteLength(fs.readFileSync(0, "utf8")))'
  await writeFile(tokenizerScript, script)
  const evidencePath = join(directory, "admission.txt")
  const evidence = "Synthetic offline test admission."
  await writeFile(evidencePath, evidence)
  const config = {
    corpusPath,
    corpusSha256: sha256(corpus),
    sourceIds: ["source"],
    context: {
      modelId: "gpt-6-astra",
      modelVersion: "synthetic-timeout-fixture",
      contextWindowTokens: 100_000,
      effectiveContextTokens: 100_000,
      autoCompactLimitTokens: 100_000,
      outputReserveTokens: 100,
      overheadReserveTokens: 100,
      tokenizer: "offline byte counter",
      contextEvidence: "Synthetic fixture only.",
    },
    tokenizer: {
      executable: process.execPath,
      args: [tokenizerScript],
      scriptPath: tokenizerScript,
      scriptSha256: sha256(script),
    },
    planPath: join(directory, "plan.json"),
    runDirectory: join(directory, "run"),
    codexExecutable: "/never-executed/fake-codex",
    readingConcurrency: 2,
    timeoutMs,
    admission: {
      admitted: true,
      evidencePath,
      evidenceSha256: sha256(evidence),
    },
  }
  const configPath = join(directory, "config.json")
  await writeFile(configPath, JSON.stringify(config))
  return { config, configPath }
}

describe("full-library CLI bounded timeout", () => {
  it("defaults to fifteen minutes and rejects nonfinite, noninteger or out-of-range deadlines", () => {
    const schema = FullLibraryConfigSchema.pick({ timeoutMs: true })
    expect(schema.parse({})).toEqual({ timeoutMs: 900_000 })
    for (const timeoutMs of [
      0,
      -1,
      0.5,
      900_001,
      NaN,
      Infinity,
      null,
      "900000",
    ])
      expect(schema.safeParse({ timeoutMs }).success).toBe(false)
    for (const timeoutMs of [1, 300_001, 900_000])
      expect(schema.parse({ timeoutMs })).toEqual({ timeoutMs })
  })

  it.each([undefined, 450_000])(
    "wires timeout %s to transport and durable config without changing plan; refuses changed-timeout replay",
    async (timeoutMs) => {
      const { config, configPath } = await fixture(timeoutMs)
      await fullLibraryCli(["plan", "--config", configPath])
      const originalPlan = await readFile(config.planPath, "utf8")
      let physicalCalls = 0
      const model: ReservationAwareStructuredModel = {
        async generateReserved(request, reserve) {
          const reserved = await reserve()
          if (reserved.kind === "skip")
            return { kind: "skipped", reservation: reserved.reservation }
          physicalCalls++
          return {
            kind: "dispatched",
            reservation: reserved.reservation,
            response: {
              output: request.schema.parse({
                reviewedSourceIds: ["source"],
                reviewedTargetIds: ["source", "target"],
                sources: [
                  {
                    sourceVideoId: "source",
                    recommendations: [],
                    fewerThanFiveReason:
                      "This synthetic fixture provides no worthwhile connection.",
                  },
                ],
              }),
              usage: { inputTokens: 25, cachedInputTokens: 0, outputTokens: 9 },
            },
          }
        },
      }
      mocked.model.mockReturnValue(model)
      await fullLibraryCli(["run", "--config", configPath])
      const expectedTimeout = timeoutMs ?? 900_000
      expect(mocked.model).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: expectedTimeout, concurrency: 2 }),
      )
      const manifestPath = join(config.runDirectory, "manifest.json")
      const originalManifest = await readFile(manifestPath, "utf8")
      expect(JSON.parse(originalManifest).execution.config.timeoutMs).toBe(
        expectedTimeout,
      )
      expect(physicalCalls).toBe(1)
      await fullLibraryCli(["run", "--config", configPath])
      expect(physicalCalls).toBe(1)
      await writeFile(
        configPath,
        JSON.stringify({ ...config, timeoutMs: 600_000 }),
      )
      await expect(
        fullLibraryCli(["run", "--config", configPath]),
      ).rejects.toMatchObject({
        code: "manifest_changed",
      })
      expect(physicalCalls).toBe(1)
      expect(await readFile(manifestPath, "utf8")).toBe(originalManifest)
      expect(await readFile(config.planPath, "utf8")).toBe(originalPlan)
    },
  )
})
