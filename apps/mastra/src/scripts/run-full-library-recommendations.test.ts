import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReservationAwareStructuredModel } from "../services/precomputed-recommendations/codex-subscription-astra"
import { sha256 } from "../services/precomputed-recommendations/full-library-v1"

const mocked = vi.hoisted(() => ({
  readAttestation: vi.fn(),
  readAllowance: vi.fn(),
  readOperatorIdentity: vi.fn(),
  account: vi.fn(),
  model: vi.fn(),
}))
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
  commandTokenCounter,
  fullLibraryCli,
} from "./run-full-library-recommendations"

const scratch: string[] = []
beforeEach(() => {
  vi.clearAllMocks()
  mocked.account.mockReturnValue({
    readAttestation: mocked.readAttestation,
    readAllowance: mocked.readAllowance,
    readOperatorIdentity: mocked.readOperatorIdentity,
  })
  vi.spyOn(process.stdout, "write").mockReturnValue(true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})
async function fixture(readingConcurrency: 1 | 2 = 1) {
  const directory = await mkdtemp(
    join(tmpdir(), "forge-full-library-cli-independent-"),
  )
  scratch.push(directory)
  const tokenizerScript = join(directory, "tokenizer.cjs")
  const script =
    'const fs=require("node:fs"); process.stdout.write(String(Buffer.byteLength(fs.readFileSync(0,"utf8"))))'
  await writeFile(tokenizerScript, script)
  const corpusPath = join(directory, "corpus.json")
  const corpus = {
    snapshot: { inputCutoff: "2026-10-16T00:00:00.000Z" },
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
  }
  const bytes = JSON.stringify(corpus)
  await writeFile(corpusPath, bytes)
  const config = {
    corpusPath,
    corpusSha256: sha256(bytes),
    sourceIds: ["source"],
    context: {
      modelId: "gpt-6-astra",
      modelVersion: "synthetic-test-version",
      contextWindowTokens: 100_000,
      effectiveContextTokens: 100_000,
      autoCompactLimitTokens: 100_000,
      outputReserveTokens: 100,
      overheadReserveTokens: 100,
      tokenizer: "test byte counter",
      contextEvidence: "offline synthetic fixture only",
    },
    tokenizer: {
      executable: process.execPath,
      args: [tokenizerScript],
      scriptPath: tokenizerScript,
      scriptSha256: sha256(script),
    },
    runDirectory: join(directory, "private-run"),
    planPath: join(directory, "plan.json"),
    codexExecutable: "/never-executed/test-codex",
    minimumRemainingPercent: 25,
    readingConcurrency,
  }
  const configPath = join(directory, "config.json")
  await writeFile(configPath, JSON.stringify(config))
  async function admit() {
    const evidencePath = join(directory, "admission.txt"),
      evidence = "Synthetic test admission; no real generation."
    await writeFile(evidencePath, evidence)
    const admitted = {
      ...config,
      admission: {
        admitted: true,
        evidencePath,
        evidenceSha256: sha256(evidence),
      },
    }
    await writeFile(configPath, JSON.stringify(admitted))
  }
  return { directory, config, configPath, admit }
}

describe("full-library CLI independent acceptance", () => {
  it("plans offline with exact reviewed tokenizer bytes, covers all targets and preserves an existing plan", async () => {
    const { config, configPath } = await fixture()
    await fullLibraryCli(["plan", "--config", configPath])
    const original = await readFile(config.planPath, "utf8")
    expect(JSON.parse(original).coverage.eligibleTargetIds).toEqual([
      "source",
      "target",
    ])
    expect(mocked.account).not.toHaveBeenCalled()
    expect(mocked.model).not.toHaveBeenCalled()
    await expect(
      fullLibraryCli(["plan", "--config", configPath]),
    ).rejects.toMatchObject({ code: "EEXIST" })
    expect(await readFile(config.planPath, "utf8")).toBe(original)
  })

  it("rejects changed tokenizer bytes and missing run admission before account access", async () => {
    const { config, configPath } = await fixture()
    await expect(
      fullLibraryCli(["run", "--config", configPath]),
    ).rejects.toMatchObject({ code: "coordinator_admission_required" })
    await writeFile(config.tokenizer.scriptPath, "process.exit(9)")
    await expect(
      fullLibraryCli(["plan", "--config", configPath]),
    ).rejects.toMatchObject({ code: "evidence_digest_mismatch" })
    expect(mocked.account).not.toHaveBeenCalled()
    expect(mocked.model).not.toHaveBeenCalled()
  })

  it("stops an admitted run if current included allowance is unavailable", async () => {
    const { configPath, admit } = await fixture()
    await fullLibraryCli(["plan", "--config", configPath])
    await admit()
    mocked.readAttestation.mockResolvedValue({ admission: "insufficient" })
    await expect(
      fullLibraryCli(["run", "--config", configPath]),
    ).rejects.toMatchObject({ code: "included_allowance_unavailable" })
    expect(mocked.model).not.toHaveBeenCalled()
  })

  it("rejects a changed source/config binding before reading subscription allowance", async () => {
    const { configPath, admit } = await fixture()
    await fullLibraryCli(["plan", "--config", configPath])
    await admit()
    const changed = JSON.parse(await readFile(configPath, "utf8"))
    changed.sourceIds = ["target"]
    await writeFile(configPath, JSON.stringify(changed))
    await expect(
      fullLibraryCli(["run", "--config", configPath]),
    ).rejects.toMatchObject({ code: "saved_plan_config_mismatch" })
    expect(mocked.account).not.toHaveBeenCalled()
    expect(mocked.model).not.toHaveBeenCalled()
  })

  it.each([1, 2] as const)(
    "binds concurrency %s to the guarded adapter and private manifest for a mock run",
    async (readingConcurrency) => {
      const { config, configPath, admit } = await fixture(readingConcurrency)
      await fullLibraryCli(["plan", "--config", configPath])
      await admit()
      mocked.readAttestation.mockResolvedValue({
        admission: "admitted",
        identity: { accountRef: "test-account" },
      })
      const model: ReservationAwareStructuredModel = {
        async generateReserved(request, reserve) {
          const reserved = await reserve()
          if (reserved.kind === "skip")
            return { kind: "skipped", reservation: reserved.reservation }
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
                      "Synthetic metadata provides no sufficiently useful connection.",
                  },
                ],
              }),
              usage: { inputTokens: 25, outputTokens: 9, cachedInputTokens: 4 },
            },
          }
        },
      }
      mocked.model.mockReturnValue(model)
      await fullLibraryCli(["run", "--config", configPath])
      expect(mocked.model).toHaveBeenCalledWith({
        codexExecutable: config.codexExecutable,
        initiatingAccountRef: "test-account",
        readAllowance: mocked.readAllowance,
        readOperatorIdentity: mocked.readOperatorIdentity,
        minimumRemainingPercent: 25,
        concurrency: readingConcurrency,
      })
      const manifest = JSON.parse(
        await readFile(join(config.runDirectory, "manifest.json"), "utf8"),
      )
      expect(manifest).toMatchObject({
        version: "full-library-v1",
        readingConcurrency,
        execution: {
          accountRef: "test-account",
          authMethod: "chatgpt",
          billingBasis: "included_subscription",
        },
      })
      expect(
        JSON.parse(
          await readFile(
            join(config.runDirectory, "recommendations.json"),
            "utf8",
          ),
        ).sources,
      ).toHaveLength(1)
    },
  )

  it("refuses malformed external tokenizer output", async () => {
    await expect(
      commandTokenCounter(process.execPath, [
        "-e",
        'process.stdout.write("1 extra")',
      ])("complete input"),
    ).rejects.toMatchObject({ code: "tokenizer_invalid" })
  })
})
