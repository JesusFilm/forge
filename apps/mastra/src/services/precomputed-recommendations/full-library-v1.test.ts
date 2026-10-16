import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import type { ModelUsage } from "./astra-provider"
import {
  CodexSubscriptionAstraError,
  type ReservationAwareStructuredModel,
} from "./codex-subscription-astra"
import {
  excludedTarget,
  planFullLibrary,
  renderReadingPrompt,
  runFullLibrary,
  validateConnections,
  validateCorpus,
  type ContextBudget,
  type FullLibraryConnection,
  type FullLibraryCorpus,
  type FullLibraryPlan,
  type LibraryEntry,
  type TokenCounter,
} from "./full-library-v1"

const scratch: string[] = []
afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

function entry(
  id: string,
  texts: string[] = [],
  language = "en",
): LibraryEntry {
  return {
    video: {
      id,
      coreId: id,
      slug: id,
      locale: "en",
      title: `Title ${id}`,
      description: `Complete description ${id}`,
      descriptionTruncated: false,
      keywords: [],
      keywordsTruncated: false,
      bibleCitations: [],
      bibleCitationsTruncated: false,
      parentVideoIds: [],
      childVideoIds: [],
      transcriptLanguages: texts.length ? [language] : [],
      transcriptSelection: {
        policy: "english-per-edition-with-complete-fallback-v1",
        availableTranscriptCount: texts.length ? 1 : 0,
        incompleteTranscriptCount: 0,
        skippedEditionCount: 0,
        selected: texts.length
          ? [
              {
                language,
                totalChunks: texts.length,
                transcriptId: `${id}-transcript`,
                videoEditionId: `${id}-edition`,
              },
            ]
          : [],
      },
    },
    chunks: texts.map((text, chunkIndex) => ({
      id: `${id}-chunk-${chunkIndex}`,
      transcriptId: `${id}-transcript`,
      language,
      chunkIndex,
      text,
    })),
  }
}
function corpusFixture(): FullLibraryCorpus {
  return {
    snapshot: { inputCutoff: "2026-10-16T00:00:00.000Z" },
    entries: [
      entry("001-source", [
        "  SOURCE_START\nA sailor gives away his last meal.",
        "🙂 He returns to reconcile with the person who hurt him.\n\n",
        "SOURCE_TAIL  \n",
      ]),
      entry("002-source", ["The witness learns to listen before speaking."]),
      entry("003-source-metadata"),
      entry("004-target-near", ["A neighbour carries water for a stranger."]),
      entry("005-target-metadata"),
      entry("006-target", ["Complete text from another eligible video."]),
      entry("007-target", ["ሰላም የተለየ ታሪክ እና ትርጉም"], "am"),
      entry("999-target-distant", [
        "A prisoner chooses mercy and shares food with his jailer.",
        "CROSS_BATCH_TAIL",
      ]),
    ],
  }
}
const sourceIds = ["001-source", "002-source", "003-source-metadata"]
const context: ContextBudget = {
  modelId: "gpt-6-astra",
  modelVersion: "synthetic-test-version",
  contextWindowTokens: 600,
  effectiveContextTokens: 600,
  autoCompactLimitTokens: 600,
  outputReserveTokens: 25,
  overheadReserveTokens: 25,
  tokenizer: "independent deterministic fixture",
  contextEvidence: "synthetic test limit, not live admission",
}
type Reading = { sources: LibraryEntry[]; targets: LibraryEntry[] }
type Ranking = { sources: LibraryEntry[]; discoveries: FullLibraryConnection[] }
const countTokens: TokenCounter = async (text) => {
  const wrapped = JSON.parse(text) as { untrustedCatalogData?: string }
  if (!wrapped.untrustedCatalogData) return 100
  const prompt = JSON.parse(wrapped.untrustedCatalogData) as Partial<Reading>
  return prompt.targets ? prompt.targets.length * 100 : 100
}
const knownUsage: ModelUsage = {
  inputTokens: 107,
  cachedInputTokens: 17,
  outputTokens: 11,
}
const shortfall =
  "Only these independently supported connections add watching value."
function evidence(
  value: LibraryEntry,
): FullLibraryConnection["sourceEvidence"] {
  return value.chunks.length
    ? {
        basis: "transcript",
        passages: [
          {
            chunkId: value.chunks.at(-1)!.id,
            excerpt: value.chunks.at(-1)!.text.trim(),
          },
        ],
      }
    : {
        basis: "metadata",
        fields: [{ field: "title", value: value.video.title }],
      }
}
function connection(
  source: LibraryEntry,
  target: LibraryEntry,
): FullLibraryConnection {
  return {
    sourceVideoId: source.video.id,
    targetVideoId: target.video.id,
    connection: "Both stories consider a costly act of reconciliation.",
    watchingValue:
      "The target adds a distinct perspective on responding with mercy.",
    sourceEvidence: evidence(source),
    targetEvidence: evidence(target),
  }
}
function discovery(prompt: string) {
  const { sources, targets } = JSON.parse(prompt) as Reading
  const selected = targets.filter((target) =>
    ["004-target-near", "999-target-distant"].includes(target.video.id),
  )
  const connections = selected.map((target) => connection(sources[0]!, target))
  const metadata = targets.find(
    (target) => target.video.id === "005-target-metadata",
  )
  if (metadata) connections.push(connection(sources[2]!, metadata))
  return {
    reviewedSourceIds: sources.map((source) => source.video.id),
    reviewedTargetIds: targets.map((target) => target.video.id),
    allWorthwhileConnectionsReturned: true,
    connections,
    notes: "Synthetic deterministic discoveries.",
  }
}
function ranking(prompt: string) {
  const { sources, discoveries } = JSON.parse(prompt) as Ranking
  return {
    sources: sources.map((source) => ({
      sourceVideoId: source.video.id,
      recommendations: discoveries
        .filter((item) => item.sourceVideoId === source.video.id)
        .reverse()
        .map((item, index) => ({
          targetVideoId: item.targetVideoId,
          rank: index + 1,
        })),
      fewerThanFiveReason: shortfall,
    })),
  }
}
function shared(prompt: string) {
  const { connections } = discovery(prompt)
  // The shared wire carries the same grounded connections plus final ranks.
  const reading = JSON.parse(prompt) as Reading
  return {
    reviewedSourceIds: reading.sources.map((source) => source.video.id),
    reviewedTargetIds: reading.targets.map((target) => target.video.id),
    sources: reading.sources.map((source) => ({
      sourceVideoId: source.video.id,
      recommendations: connections
        .filter((item) => item.sourceVideoId === source.video.id)
        .map((item, index) => ({ ...item, rank: index + 1 })),
      fewerThanFiveReason: shortfall,
    })),
  }
}
function fakeModel(
  reply: (prompt: string) => unknown = (prompt) => {
    const body = JSON.parse(prompt) as { discoveries?: unknown }
    return body.discoveries ? ranking(prompt) : discovery(prompt)
  },
  usage: ModelUsage = knownUsage,
) {
  const requests: string[] = []
  const model: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      const decision = await reserve()
      if (decision.kind === "skip")
        return { kind: "skipped", reservation: decision.reservation }
      requests.push(request.prompt)
      return {
        kind: "dispatched",
        reservation: decision.reservation,
        response: {
          output: request.schema.parse(await reply(request.prompt)),
          usage,
        },
      }
    },
  }
  return { model, requests }
}
async function setup(
  options: {
    corpus?: FullLibraryCorpus
    count?: TokenCounter
    budget?: ContextBudget
  } = {},
) {
  const corpus = options.corpus ?? corpusFixture()
  const count = options.count ?? countTokens
  const plan = await planFullLibrary({
    corpus,
    sourceIds,
    context: options.budget ?? context,
    countTokens: count,
  })
  const runDirectory = await mkdtemp(
    join(tmpdir(), "forge-full-library-independent-"),
  )
  scratch.push(runDirectory)
  return {
    corpus,
    plan,
    countTokens: count,
    runDirectory,
    executionManifest: {
      operator: "synthetic-test",
      admission: "no live inference",
    },
  }
}
async function jsonFile(path: string) {
  return JSON.parse(await readFile(path, "utf8"))
}

describe("full-library-v1 independent acceptance", () => {
  it("reads every target and complete source in exhaustive batches and carries late evidence into global ranking", async () => {
    const corpus = corpusFixture()
    corpus.entries[0]!.video.parentVideoIds = ["shared-collection"]
    corpus.entries.at(-1)!.video.parentVideoIds = ["shared-collection"]
    const input = await setup({ corpus })
    expect(input.plan.mode).toBe("staged")
    expect(input.plan.batches.length).toBeGreaterThan(1)
    const fake = fakeModel()
    const result = await runFullLibrary({ ...input, model: fake.model })
    const reads = fake.requests
      .slice(0, -1)
      .map((prompt) => JSON.parse(prompt) as Reading)
    expect(
      reads
        .flatMap((read) => read.targets.map((target) => target.video.id))
        .sort(),
    ).toEqual(input.corpus.entries.map((value) => value.video.id).sort())
    for (const read of reads) {
      for (const target of read.targets) {
        expect(target.chunks).toEqual(
          input.corpus.entries.find(
            (original) => original.video.id === target.video.id,
          )!.chunks,
        )
      }
      expect(read.sources.map((source) => source.video.id)).toEqual(sourceIds)
      for (const [index, source] of read.sources.entries()) {
        const original = input.corpus.entries[index]!
        expect(source.chunks).toEqual(original.chunks)
        expect(source.video).toMatchObject({
          id: original.video.id,
          title: original.video.title,
          description: original.video.description,
          keywords: original.video.keywords,
          bibleCitations: original.video.bibleCitations,
        })
      }
    }
    const global = JSON.parse(fake.requests.at(-1)!) as Ranking
    expect(global.discoveries.map((item) => item.targetVideoId).sort()).toEqual(
      ["004-target-near", "005-target-metadata", "999-target-distant"],
    )
    expect(result.sources[0]!.recommendations[0]!.targetVideoId).toBe(
      "999-target-distant",
    )
    expect(result.sources[2]!.recommendations[0]!.sourceEvidence.basis).toBe(
      "metadata",
    )
    expect(result.sources[1]!.recommendations).toEqual([])
    const calls = await readdir(join(input.runDirectory, "calls"))
    expect(calls).toHaveLength(input.plan.batches.length + 1)
    expect(
      await jsonFile(join(input.runDirectory, "usage-summary.json")),
    ).toMatchObject({
      physicalCalls: calls.length,
      inputTokens: knownUsage.inputTokens! * calls.length,
      cachedInputTokens: knownUsage.cachedInputTokens! * calls.length,
      outputTokens: knownUsage.outputTokens! * calls.length,
      reasoningTokens: null,
      billingBasis: "included_subscription",
    })
    for (const call of calls) {
      const receipt = await jsonFile(
        join(input.runDirectory, "calls", call, "receipt.json"),
      )
      expect(receipt.usage).toEqual(knownUsage)
      expect(receipt.consumptionUnknown).toBe(false)
    }
    await expect(
      runFullLibrary({ ...input, model: fake.model }),
    ).resolves.toEqual(result)
    expect(fake.requests).toHaveLength(calls.length)
    await expect(
      runFullLibrary({
        ...input,
        model: fake.model,
        executionManifest: { operator: "different-operator" },
      }),
    ).rejects.toMatchObject({ code: "manifest_changed" })
    await expect(
      runFullLibrary({ ...input, model: fake.model, readingConcurrency: 2 }),
    ).rejects.toMatchObject({ code: "manifest_changed" })
    expect(fake.requests).toHaveLength(calls.length)
  })

  it("supports the complete shared-context path without an unnecessary discovery/ranking framework", async () => {
    const input = await setup({
      budget: {
        ...context,
        contextWindowTokens: 10_000,
        effectiveContextTokens: 10_000,
        autoCompactLimitTokens: 10_000,
      },
    })
    const fake = fakeModel(shared)
    const result = await runFullLibrary({ ...input, model: fake.model })
    expect(input.plan.mode).toBe("shared")
    expect(fake.requests).toHaveLength(1)
    expect(result.sources.map((source) => source.sourceVideoId)).toEqual(
      sourceIds,
    )
  })

  it("constrains reading IDs to every supplied ID and budgets the exact dynamic schema sent to the adapter", async () => {
    const count: TokenCounter = async (text) => {
      const value = JSON.parse(text)
      if (value.untrustedCatalogData) {
        const prompt = JSON.parse(value.untrustedCatalogData)
        return prompt.targets ? prompt.targets.length * 20_000 : 100
      }
      return Buffer.byteLength(text)
    }
    const input = await setup({
      count,
      budget: {
        ...context,
        contextWindowTokens: 70_000,
        effectiveContextTokens: 70_000,
        autoCompactLimitTokens: 70_000,
      },
    })
    expect(input.plan.mode).toBe("staged")
    const fake = fakeModel(),
      seen: string[] = []
    const model: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        const prompt = JSON.parse(request.prompt) as Partial<Reading>
        if (prompt.targets) {
          const output = discovery(request.prompt)
          expect(request.schema.safeParse(output).success).toBe(true)
          const wrongSource = structuredClone(output)
          wrongSource.reviewedSourceIds[0] = "foreign-source"
          expect(request.schema.safeParse(wrongSource).success).toBe(false)
          const wrongTarget = structuredClone(output)
          wrongTarget.reviewedTargetIds[0] = "foreign-target"
          expect(request.schema.safeParse(wrongTarget).success).toBe(false)
          const missingTarget = structuredClone(output)
          missingTarget.reviewedTargetIds.pop()
          expect(request.schema.safeParse(missingTarget).success).toBe(false)
          const candidate = connection(prompt.sources![0]!, prompt.targets[0]!)
          for (const foreign of [
            { ...candidate, sourceVideoId: "foreign-source" },
            { ...candidate, targetVideoId: "foreign-target" },
          ])
            expect(
              request.schema.safeParse({ ...output, connections: [foreign] })
                .success,
            ).toBe(false)
          const batch = input.plan.batches.find(
            (batch) => batch.targetIds[0] === prompt.targets![0]!.video.id,
          )!
          const schemaBytes = Buffer.byteLength(
            JSON.stringify(
              z.toJSONSchema(request.schema, { target: "draft-07" }),
            ),
          )
          expect(batch.measurement.schemaBytes).toBe(schemaBytes)
          expect(batch.measurement.schemaTokens).toBe(schemaBytes)
          expect(
            batch.measurement.inputTokens +
              schemaBytes +
              input.plan.context.overheadReserveTokens +
              input.plan.context.outputReserveTokens,
          ).toBeLessThanOrEqual(70_000)
          seen.push(...prompt.targets.map((target) => target.video.id))
        }
        return fake.model.generateReserved(request, reserve)
      },
    }
    await runFullLibrary({ ...input, model })
    expect(seen.sort()).toEqual(
      input.corpus.entries.map((entry) => entry.video.id).sort(),
    )
  })

  it("rejects truncated metadata and missing final transcript chunks instead of treating them as metadata-only", () => {
    for (const field of [
      "descriptionTruncated",
      "keywordsTruncated",
      "bibleCitationsTruncated",
    ] as const) {
      const corpus = corpusFixture()
      corpus.entries[4]!.video[field] = true
      expect(() => validateCorpus(corpus)).toThrow("corpus_truncated")
    }
    const missingTail = corpusFixture()
    missingTail.entries[0]!.chunks.pop()
    expect(() => validateCorpus(missingTail)).toThrow()
    expect(validateCorpus(corpusFixture()).entries[2]!.chunks).toEqual([])
  })

  it("rejects fabricated, foreign and absent-field evidence, self and true duplicates, but preserves direction", () => {
    const corpus = corpusFixture()
    const source = corpus.entries[0]!,
      target = corpus.entries.at(-1)!
    const valid = connection(source, target)
    expect(() => validateConnections([valid], [source], [target])).not.toThrow()
    const fabricated = structuredClone(valid)
    fabricated.targetEvidence = {
      basis: "transcript",
      passages: [
        {
          chunkId: target.chunks[0]!.id,
          excerpt: "Invented transcript words.",
        },
      ],
    }
    const foreign = structuredClone(valid)
    foreign.targetEvidence = valid.sourceEvidence
    const absentField = structuredClone(valid)
    absentField.targetEvidence = {
      basis: "metadata",
      fields: [{ field: "keywords", value: "not supplied" }],
    }
    for (const invalid of [fabricated, foreign, absentField])
      expect(() => validateConnections([invalid], [source], [target])).toThrow()
    expect(() =>
      validateConnections([valid, valid], [source], [target]),
    ).toThrow("duplicate_connection")
    expect(() =>
      validateConnections([connection(source, source)], [source], [source]),
    ).toThrow("connection_excluded")
    const duplicate = structuredClone(target)
    duplicate.video.coreId = source.video.coreId
    expect(excludedTarget(source, duplicate)).toBe(true)
    expect(() =>
      validateConnections(
        [connection(source, duplicate)],
        [source],
        [duplicate],
      ),
    ).toThrow("connection_excluded")
    const duplicateSlug = structuredClone(target)
    duplicateSlug.video.slug = source.video.slug
    expect(excludedTarget(source, duplicateSlug)).toBe(true)
    expect(() =>
      validateConnections(
        [connection(source, duplicateSlug)],
        [source],
        [duplicateSlug],
      ),
    ).toThrow("connection_excluded")
    // Two independently evidenced directed edges are allowed, never auto-created.
    expect(() =>
      validateConnections(
        [valid, connection(target, source)],
        [source, target],
        [source, target],
      ),
    ).not.toThrow()
  })

  it("keeps distinct siblings, chapters and parent films eligible when they add viewing value", () => {
    for (const relationship of [
      "siblings",
      "source-parent",
      "target-parent",
      "chapter",
      "empty-identities",
    ] as const) {
      const corpus = corpusFixture(),
        source = corpus.entries[0]!,
        target = corpus.entries.at(-1)!
      if (relationship === "siblings" || relationship === "chapter") {
        source.video.parentVideoIds = ["shared-parent-film"]
        target.video.parentVideoIds = ["shared-parent-film"]
      }
      if (relationship === "source-parent") {
        source.video.childVideoIds = [target.video.id]
        target.video.parentVideoIds = [source.video.id]
      }
      if (relationship === "target-parent") {
        source.video.parentVideoIds = [target.video.id]
        target.video.childVideoIds = [source.video.id]
      }
      if (relationship === "empty-identities") {
        source.video.coreId = target.video.coreId = ""
        source.video.slug = target.video.slug = ""
      }
      expect(excludedTarget(source, target), relationship).toBe(false)
      expect(
        () =>
          validateConnections([connection(source, target)], [source], [target]),
        relationship,
      ).not.toThrow()
      expect(
        () =>
          validateConnections([connection(target, source)], [target], [source]),
        relationship,
      ).not.toThrow()
    }
  })

  it("fails before model dispatch when complete content exceeds either token or UTF-8 byte capacity", async () => {
    await expect(setup({ count: async () => 1_000_000 })).rejects.toMatchObject(
      { code: "complete_video_exceeds_context" },
    )
    const corpus = corpusFixture()
    corpus.entries[0]!.chunks[0]!.text = "🙂".repeat(510_000)
    await expect(setup({ corpus, count: async () => 1 })).rejects.toMatchObject(
      { code: "complete_video_exceeds_context" },
    )
  })

  it("fails global-ranking overflow without dropping earlier discoveries or launching an oversized call", async () => {
    const count: TokenCounter = async (text) => {
      const wrapped = JSON.parse(text) as { untrustedCatalogData?: string }
      if (
        wrapped.untrustedCatalogData &&
        "discoveries" in JSON.parse(wrapped.untrustedCatalogData)
      )
        return 10_000
      return countTokens(text)
    }
    const input = await setup({ count })
    const fake = fakeModel()
    await expect(
      runFullLibrary({ ...input, model: fake.model }),
    ).rejects.toMatchObject({ code: "request_exceeds_context" })
    expect(fake.requests).toHaveLength(input.plan.batches.length)
    const calls = await readdir(join(input.runDirectory, "calls"))
    for (const call of calls.filter((call) => call.startsWith("read-")))
      expect(
        (
          await jsonFile(
            join(input.runDirectory, "calls", call, "receipt.json"),
          )
        ).usage,
      ).toEqual(knownUsage)
    await expect(
      readFile(
        join(input.runDirectory, "calls", "rank-global", "reservation.json"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" })
  })

  it.each([
    "missing-source",
    "invented-target",
    "duplicate-target",
    "gapped-rank",
    "unexplained-shortfall",
  ])(
    "rejects final %s while preserving physical-call usage",
    async (failure) => {
      const input = await setup()
      const fake = fakeModel((prompt) => {
        if (!("discoveries" in JSON.parse(prompt))) return discovery(prompt)
        const output = ranking(prompt)
        const source = output.sources[0]!
        if (failure === "missing-source") output.sources.pop()
        if (failure === "invented-target")
          source.recommendations[0]!.targetVideoId = "unknown"
        if (failure === "duplicate-target")
          source.recommendations[1]!.targetVideoId =
            source.recommendations[0]!.targetVideoId
        if (failure === "gapped-rank") source.recommendations[0]!.rank = 2
        if (failure === "unexplained-shortfall") source.fewerThanFiveReason = ""
        return output
      })
      await expect(
        runFullLibrary({ ...input, model: fake.model }),
      ).rejects.toThrow()
      expect(
        (
          await jsonFile(
            join(input.runDirectory, "calls", "rank-global", "receipt.json"),
          )
        ).usage,
      ).toEqual(knownUsage)
    },
  )

  it("never redispatches an unknown physical call on resume", async () => {
    const input = await setup()
    const reply = vi.fn(() => {
      throw new CodexSubscriptionAstraError("provider_unavailable", {
        consumptionUnknown: true,
      })
    })
    const fake = fakeModel(reply)
    await expect(
      runFullLibrary({ ...input, model: fake.model }),
    ).rejects.toThrow()
    const receipt = await jsonFile(
      join(input.runDirectory, "calls", "read-0000", "receipt.json"),
    )
    expect(receipt).toMatchObject({
      status: "failed",
      consumptionUnknown: true,
      usage: null,
    })
    await expect(
      runFullLibrary({ ...input, model: fake.model }),
    ).rejects.toMatchObject({ code: "call_not_resumable" })
    expect(reply).toHaveBeenCalledTimes(1)
  })

  it("requires exact target-read acknowledgement instead of accepting duplicates that hide an omitted target", async () => {
    const input = await setup()
    const fake = fakeModel((prompt) => {
      const output = discovery(prompt)
      output.reviewedTargetIds[output.reviewedTargetIds.length - 1] =
        output.reviewedTargetIds[0]!
      return output
    })
    await expect(
      runFullLibrary({ ...input, model: fake.model }),
    ).rejects.toMatchObject({
      code: "target_read_coverage_invalid",
    })
    expect(fake.requests).toHaveLength(1)
    expect(
      await jsonFile(
        join(input.runDirectory, "calls", "read-0000", "receipt.json"),
      ),
    ).toMatchObject({ usage: knownUsage, consumptionUnknown: false })
    await expect(
      readFile(join(input.runDirectory, "coverage-0000.json")),
    ).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects changed corpus bytes against the frozen plan without another dispatch", async () => {
    const input = await setup()
    const fake = fakeModel()
    await runFullLibrary({ ...input, model: fake.model })
    const calls = fake.requests.length
    const changedCorpus = structuredClone(input.corpus)
    changedCorpus.entries[0]!.chunks[0]!.text +=
      " Changed authoritative transcript."
    await expect(
      runFullLibrary({ ...input, corpus: changedCorpus, model: fake.model }),
    ).rejects.toMatchObject({ code: "plan_changed" })
    expect(fake.requests).toHaveLength(calls)
  })

  it("blocks an unresolved durable reservation even if a result file exists", async () => {
    const input = await setup()
    const fake = fakeModel()
    await runFullLibrary({ ...input, model: fake.model })
    const calls = fake.requests.length
    // Simulate a crash after the result write but before the terminal receipt write.
    await rm(join(input.runDirectory, "calls", "read-0000", "receipt.json"))
    await expect(
      runFullLibrary({ ...input, model: fake.model }),
    ).rejects.toMatchObject({ code: "pending_consumption_unknown" })
    expect(fake.requests).toHaveLength(calls)
  })

  it.each(["failed", "unknown", "pending"] as const)(
    "checks a later %s checkpoint before parallel replay can launch an unread batch",
    async (state) => {
      const input = await setup({
        budget: { ...context, effectiveContextTokens: 350 },
      })
      expect(input.plan.batches).toHaveLength(4)
      const run = { ...input, readingConcurrency: 2 as const }
      await runFullLibrary({ ...run, model: fakeModel().model })
      // Reconstruct an interrupted run: earlier reads succeeded, a later read
      // needs reconciliation, and the last batch has never been dispatched.
      const blockedPath = join(
        input.runDirectory,
        "calls/read-0002/receipt.json",
      )
      if (state === "pending") await rm(blockedPath)
      else {
        const receipt = await jsonFile(blockedPath)
        if (state === "failed") receipt.status = "failed"
        else receipt.consumptionUnknown = true
        await writeFile(blockedPath, JSON.stringify(receipt))
      }
      await rm(join(input.runDirectory, "calls/read-0003"), { recursive: true })
      await rm(join(input.runDirectory, "calls/rank-global"), {
        recursive: true,
      })
      const replay = fakeModel()
      await expect(
        runFullLibrary({ ...run, model: replay.model }),
      ).rejects.toMatchObject({
        code:
          state === "pending"
            ? "pending_consumption_unknown"
            : "call_not_resumable",
      })
      expect(replay.requests).toHaveLength(0)
      await expect(
        readFile(join(input.runDirectory, "calls/read-0003/reservation.json")),
      ).rejects.toMatchObject({ code: "ENOENT" })
    },
  )

  it("marks incomplete usage as unknown consumption rather than a known failed call", async () => {
    const input = await setup()
    const fake = fakeModel(undefined, {})
    await expect(
      runFullLibrary({ ...input, model: fake.model }),
    ).rejects.toMatchObject({ code: "usage_unknown" })
    expect(
      await jsonFile(
        join(input.runDirectory, "calls", "read-0000", "receipt.json"),
      ),
    ).toMatchObject({ status: "failed", consumptionUnknown: true })
  })

  it("refuses replay of a succeeded receipt that explicitly reports unknown consumption", async () => {
    const input = await setup()
    const fake = fakeModel()
    await runFullLibrary({ ...input, model: fake.model })
    const path = join(input.runDirectory, "calls", "read-0000", "receipt.json")
    const receipt = await jsonFile(path)
    receipt.consumptionUnknown = true
    await writeFile(path, JSON.stringify(receipt))
    await expect(
      runFullLibrary({ ...input, model: fake.model }),
    ).rejects.toThrow()
  })

  it("counts structured-output schema tokens when admitting a supposedly fitting shared context", async () => {
    const corpus = corpusFixture()
    const sources = corpus.entries.slice(0, 3)
    const prompt = renderReadingPrompt(sources, corpus.entries, true)
    const measuredTexts: string[] = []
    const count: TokenCounter = async (text) => {
      measuredTexts.push(text)
      return text.length
    }
    const roomy = {
      ...context,
      contextWindowTokens: 1_000_000,
      effectiveContextTokens: 1_000_000,
      autoCompactLimitTokens: 1_000_000,
    }
    const plan: FullLibraryPlan = await planFullLibrary({
      corpus,
      sourceIds,
      context: roomy,
      countTokens: count,
    })
    const envelope = measuredTexts
      .map((text) => {
        try {
          return {
            text,
            value: JSON.parse(text) as { untrustedCatalogData?: string },
          }
        } catch {
          return { text, value: {} }
        }
      })
      .find((item) => item.value.untrustedCatalogData === prompt)!.text
    // JSON Schema is ASCII in this wire contract, so bytes equal this fake tokenizer's character count.
    expect(
      plan.fullLibraryMeasurement.inputTokens +
        plan.fullLibraryMeasurement.schemaTokens,
    ).toBeGreaterThanOrEqual(
      envelope.length + plan.fullLibraryMeasurement.schemaBytes,
    )
    const exactLimit =
      plan.fullLibraryMeasurement.inputTokens +
      plan.fullLibraryMeasurement.schemaTokens +
      roomy.overheadReserveTokens +
      roomy.outputReserveTokens
    const boundary = {
      ...roomy,
      contextWindowTokens: exactLimit,
      effectiveContextTokens: exactLimit,
      autoCompactLimitTokens: exactLimit,
    }
    expect(
      (
        await planFullLibrary({
          corpus,
          sourceIds,
          context: boundary,
          countTokens: count,
        })
      ).mode,
    ).toBe("shared")
    expect(
      (
        await planFullLibrary({
          corpus,
          sourceIds,
          context: { ...boundary, effectiveContextTokens: exactLimit - 1 },
          countTokens: count,
        })
      ).mode,
    ).toBe("staged")
  })
})
