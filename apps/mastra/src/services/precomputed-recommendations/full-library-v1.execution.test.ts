import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  CodexSubscriptionAstraError,
  type ReservationAwareStructuredModel,
} from "./codex-subscription-astra"
import {
  planFullLibrary,
  runFullLibrary,
  validateConnections,
  validateCorpus,
  type ContextBudget,
  type FullLibraryConnection,
} from "./full-library-v1"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "forge-full-library-test-"))
  directories.push(path)
  return path
}
const context: ContextBudget = {
  modelId: "gpt-6-astra",
  modelVersion: "unreported",
  contextWindowTokens: 272000,
  effectiveContextTokens: 258400,
  autoCompactLimitTokens: 244800,
  outputReserveTokens: 16000,
  overheadReserveTokens: 10000,
  tokenizer: "test byte counter",
  contextEvidence: "offline fixture",
}
const countTokens = async (text: string) => Buffer.byteLength(text)
function corpus() {
  return validateCorpus({
    observedAt: "2026-10-16T00:00:00.000Z",
    entries: ["source-a", "target-b", "target-c"].map((id) => ({
      video: {
        id,
        coreId: id,
        slug: id,
        locale: "en",
        title: `Title ${id}`,
        description: `Description ${id}`,
        keywords: [],
        bibleCitations: [],
        descriptionTruncated: false,
        keywordsTruncated: false,
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
}
function connection(targetVideoId = "target-b"): FullLibraryConnection {
  return {
    sourceVideoId: "source-a",
    targetVideoId,
    connection: "A directional relationship supported by the given metadata.",
    watchingValue: "Watching this next adds a different concrete perspective.",
    sourceEvidence: {
      basis: "metadata",
      fields: [{ field: "title", value: "Title source-a" }],
    },
    targetEvidence: {
      basis: "metadata",
      fields: [{ field: "title", value: `Title ${targetVideoId}` }],
    },
  }
}
function sharedModel(onCall: () => void): ReservationAwareStructuredModel {
  return {
    async generateReserved(request, reserve) {
      const reservation = await reserve()
      if (reservation.kind === "skip")
        return { kind: "skipped", reservation: reservation.reservation }
      onCall()
      return {
        kind: "dispatched",
        reservation: reservation.reservation,
        response: {
          output: request.schema.parse({
            reviewedSourceIds: ["source-a"],
            reviewedTargetIds: ["source-a", "target-b", "target-c"],
            sources: [
              {
                sourceVideoId: "source-a",
                recommendations: [{ ...connection(), rank: 1 }],
                fewerThanFiveReason:
                  "Only one strong metadata-supported connection in this fixture.",
              },
            ],
          }),
          usage: { inputTokens: 400, outputTokens: 100, cachedInputTokens: 0 },
        },
      }
    },
  }
}
describe("full-library durable execution", () => {
  it("replays a complete physical receipt without spending again and detects result tampering", async () => {
    const data = corpus(),
      runDirectory = await directory()
    const plan = await planFullLibrary({
      corpus: data,
      sourceIds: ["source-a"],
      context,
      countTokens,
    })
    let calls = 0
    const input = {
      corpus: data,
      plan,
      runDirectory,
      countTokens,
      model: sharedModel(() => calls++),
      executionManifest: { fixture: true },
    }
    const first = await runFullLibrary(input)
    expect(first.sources[0].recommendations[0].targetVideoId).toBe("target-b")
    expect(await runFullLibrary(input)).toEqual(first)
    expect(calls).toBe(1)
    const receipt = JSON.parse(
      await readFile(
        join(runDirectory, "calls/read-0000/receipt.json"),
        "utf8",
      ),
    )
    expect(receipt).toMatchObject({
      status: "succeeded",
      reasoningTokens: null,
      cachedInputTokens: 0,
      consumptionUnknown: false,
    })
    await writeFile(join(runDirectory, "calls/read-0000/result.json"), "{}")
    await expect(runFullLibrary(input)).rejects.toThrow(
      "result_digest_mismatch",
    )
    expect(calls).toBe(1)
  })
  it("records unknown consumption once and refuses to dispatch a resumed failed call", async () => {
    const data = corpus(),
      runDirectory = await directory()
    const plan = await planFullLibrary({
      corpus: data,
      sourceIds: ["source-a"],
      context,
      countTokens,
    })
    let calls = 0
    const model: ReservationAwareStructuredModel = {
      async generateReserved(_request, reserve) {
        await reserve()
        calls++
        throw new CodexSubscriptionAstraError("provider_unavailable", {
          consumptionUnknown: true,
        })
      },
    }
    const input = {
      corpus: data,
      plan,
      runDirectory,
      countTokens,
      model,
      executionManifest: {},
    }
    await expect(runFullLibrary(input)).rejects.toThrow("provider_unavailable")
    expect(
      JSON.parse(
        await readFile(
          join(runDirectory, "calls/read-0000/receipt.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ status: "failed", consumptionUnknown: true, usage: null })
    await expect(runFullLibrary(input)).rejects.toThrow("call_not_resumable")
    expect(calls).toBe(1)
  })
  it("blocks a reserved call with no receipt instead of assuming it was never sent", async () => {
    const data = corpus(),
      runDirectory = await directory()
    const plan = await planFullLibrary({
      corpus: data,
      sourceIds: ["source-a"],
      context,
      countTokens,
    })
    const input = {
      corpus: data,
      plan,
      runDirectory,
      countTokens,
      model: sharedModel(() => {}),
      executionManifest: {},
    }
    await runFullLibrary(input)
    await rm(join(runDirectory, "calls/read-0000/receipt.json"))
    await expect(runFullLibrary(input)).rejects.toThrow(
      "pending_consumption_unknown",
    )
  })
  it("validates exact evidence and true duplicate identities while allowing distinct siblings", () => {
    const data = corpus()
    const source = data.entries[0],
      target = data.entries[1]
    const valid = connection()
    expect(() => validateConnections([valid], [source], [target])).not.toThrow()
    expect(() =>
      validateConnections(
        [
          {
            ...valid,
            targetEvidence: {
              basis: "transcript",
              passages: [
                { chunkId: "source-only", excerpt: "not a target transcript" },
              ],
            },
          },
        ],
        [source],
        [target],
      ),
    ).toThrow("evidence_not_verbatim")
    target.video.parentVideoIds = ["family"]
    source.video.parentVideoIds = ["family"]
    expect(() => validateConnections([valid], [source], [target])).not.toThrow()
    const duplicate = structuredClone(target)
    duplicate.video.coreId = source.video.coreId
    expect(() => validateConnections([valid], [source], [duplicate])).toThrow(
      "connection_excluded",
    )
    expect(() =>
      validateConnections(
        [
          {
            ...valid,
            targetEvidence: {
              basis: "metadata",
              fields: [{ field: "title", value: "Invented title" }],
            },
          },
        ],
        [source],
        [target],
      ),
    ).toThrow("metadata_evidence_invalid")
  })
  it("partitions all targets and rejects incomplete/truncated content", async () => {
    const data = corpus()
    // Force multiple batches using complete large metadata values, not a shortlist.
    data.entries.forEach((entry) => {
      entry.video.description = "complete metadata ".repeat(500)
    })
    const plan = await planFullLibrary({
      corpus: data,
      sourceIds: ["source-a"],
      context: {
        ...context,
        contextWindowTokens: 60000,
        effectiveContextTokens: 60000,
        autoCompactLimitTokens: 60000,
        outputReserveTokens: 12000,
      },
      countTokens,
    })
    expect(plan.mode).toBe("staged")
    expect(plan.batches.length).toBeGreaterThan(1)
    expect(plan.batches.flatMap((batch) => batch.targetIds)).toEqual([
      "source-a",
      "target-b",
      "target-c",
    ])
    data.entries[1].video.descriptionTruncated = true
    expect(() => validateCorpus(data)).toThrow("corpus_truncated")
  })
  it("saves all discovery evidence for a single global ranking across target batches", async () => {
    const data = corpus(),
      runDirectory = await directory()
    data.entries.forEach((entry) => {
      entry.video.description = "complete metadata ".repeat(500)
    })
    const plan = await planFullLibrary({
      corpus: data,
      sourceIds: ["source-a"],
      context: {
        ...context,
        contextWindowTokens: 60000,
        effectiveContextTokens: 60000,
        autoCompactLimitTokens: 60000,
        outputReserveTokens: 12000,
      },
      countTokens,
    })
    let reads = 0,
      rankings = 0
    const model: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        const reservation = await reserve()
        const prompt = JSON.parse(request.prompt)
        if (reservation.kind === "skip")
          return { kind: "skipped", reservation: reservation.reservation }
        let output: unknown
        if (prompt.discoveries) {
          rankings++
          expect(
            prompt.discoveries
              .map((item: FullLibraryConnection) => item.targetVideoId)
              .sort(),
          ).toEqual(["target-b", "target-c"])
          output = {
            sources: [
              {
                sourceVideoId: "source-a",
                recommendations: [
                  { targetVideoId: "target-c", rank: 1 },
                  { targetVideoId: "target-b", rank: 2 },
                ],
                fewerThanFiveReason:
                  "Only two strong connections across the complete fixture.",
              },
            ],
          }
        } else {
          reads++
          expect(prompt.sources[0].video.description).toBe(
            data.entries[0].video.description,
          )
          output = {
            reviewedSourceIds: ["source-a"],
            reviewedTargetIds: prompt.targets.map(
              (target: { video: { id: string } }) => target.video.id,
            ),
            allWorthwhileConnectionsReturned: true,
            connections: prompt.targets
              .filter(
                (target: { video: { id: string } }) =>
                  target.video.id !== "source-a",
              )
              .map((target: { video: { id: string } }) =>
                connection(target.video.id),
              ),
            notes: "Complete fixture read.",
          }
        }
        return {
          kind: "dispatched",
          reservation: reservation.reservation,
          response: {
            output: request.schema.parse(output),
            usage: { inputTokens: 100, outputTokens: 30 },
          },
        }
      },
    }
    const result = await runFullLibrary({
      corpus: data,
      plan,
      runDirectory,
      countTokens,
      model,
      executionManifest: {},
    })
    expect(
      result.sources[0].recommendations.map((item) => item.targetVideoId),
    ).toEqual(["target-c", "target-b"])
    expect(reads).toBe(plan.batches.length)
    expect(rankings).toBe(1)
    expect((await readdir(join(runDirectory, "calls"))).length).toBe(reads + 1)
  })
})

// Synthetic context budget forces one complete target per reading call.
const parallelCount: typeof countTokens = async (text) => {
  const envelope = JSON.parse(text)
  if (typeof envelope.untrustedCatalogData === "string") {
    const prompt = JSON.parse(envelope.untrustedCatalogData)
    if (Array.isArray(prompt.targets))
      return 1000 + 1000 * prompt.targets.length
  }
  return 100
}
async function parallelInput() {
  const data = corpus()
  for (const id of ["target-d", "target-e"]) {
    const entry = structuredClone(data.entries[1])
    Object.assign(entry.video, {
      id,
      coreId: id,
      slug: id,
      title: `Title ${id}`,
    })
    data.entries.push(entry)
  }
  const plan = await planFullLibrary({
    corpus: data,
    sourceIds: ["source-a"],
    countTokens: parallelCount,
    context: {
      ...context,
      contextWindowTokens: 4000,
      effectiveContextTokens: 4000,
      autoCompactLimitTokens: 4000,
      outputReserveTokens: 500,
      overheadReserveTokens: 500,
    },
  })
  expect(plan.batches).toHaveLength(5)
  return {
    corpus: data,
    plan,
    countTokens: parallelCount,
    runDirectory: await directory(),
    executionManifest: {},
  }
}
function gate() {
  let release!: () => void
  const reached = new Promise<void>((resolve) => {
    release = resolve
  })
  return { reached, release }
}
describe("bounded full-library reading concurrency", () => {
  it.each([1, 2] as const)(
    "settles reads within concurrency %s and ranks in frozen batch order",
    async (readingConcurrency) => {
      const input = await parallelInput()
      let active = 0,
        maximum = 0,
        rankingCalls = 0
      const seen: string[] = [],
        settled: string[] = []
      const firstTwoStarted = gate(),
        laterDiscoverySettled = gate()
      const model: ReservationAwareStructuredModel = {
        async generateReserved(request, reserve) {
          const reservation = await reserve()
          if (reservation.kind === "skip")
            return { kind: "skipped", reservation: reservation.reservation }
          const prompt = JSON.parse(request.prompt)
          let output: unknown
          if (Array.isArray(prompt.discoveries)) {
            rankingCalls++
            expect(active).toBe(0)
            expect(
              prompt.discoveries.map(
                (item: FullLibraryConnection) => item.targetVideoId,
              ),
            ).toEqual(["target-b", "target-c", "target-d", "target-e"])
            output = {
              sources: [
                {
                  sourceVideoId: "source-a",
                  recommendations: [{ targetVideoId: "target-e", rank: 1 }],
                  fewerThanFiveReason:
                    "Only the strongest distinct connection is selected in this fixture.",
                },
              ],
            }
          } else {
            const targetId = prompt.targets[0].video.id as string
            seen.push(targetId)
            active++
            maximum = Math.max(maximum, active)
            if (readingConcurrency === 2) {
              if (seen.length === 2) firstTwoStarted.release()
              await firstTwoStarted.reached
              // Both batches return evidence, so completion-order flattening
              // would incorrectly put target-c before target-b in ranking.
              if (targetId === "target-b") await laterDiscoverySettled.reached
            }
            active--
            settled.push(targetId)
            if (targetId === "target-c") laterDiscoverySettled.release()
            output = {
              reviewedSourceIds: ["source-a"],
              reviewedTargetIds: [targetId],
              allWorthwhileConnectionsReturned: true,
              connections:
                targetId === "source-a" ? [] : [connection(targetId)],
              notes: "All supplied input read.",
            }
          }
          return {
            kind: "dispatched",
            reservation: reservation.reservation,
            response: {
              output: request.schema.parse(output),
              usage: { inputTokens: 100, outputTokens: 20 },
            },
          }
        },
      }
      const result = await runFullLibrary({
        ...input,
        readingConcurrency,
        model,
      })
      const expected = input.plan.batches.flatMap((batch) => batch.targetIds)
      expect(maximum).toBe(readingConcurrency)
      expect([...seen].sort()).toEqual([...expected].sort())
      expect(new Set(seen).size).toBe(5)
      expect([...settled].sort()).toEqual([...expected].sort())
      if (readingConcurrency === 2)
        expect(settled.indexOf("target-c")).toBeLessThan(
          settled.indexOf("target-b"),
        )
      expect(rankingCalls).toBe(1)
      expect(result.sources[0].recommendations).toMatchObject([
        { targetVideoId: "target-e", rank: 1 },
      ])
      expect(await readdir(join(input.runDirectory, "calls"))).toHaveLength(6)
    },
  )
  it.each([false, true, "invalid-connection"] as const)(
    "stops new reads and waits for in-flight receipts after failure (%s)",
    async (failureCase) => {
      const unknown = failureCase === true
      const invalidConnection = failureCase === "invalid-connection"
      const input = await parallelInput()
      const dispatched: string[] = [],
        settled: string[] = []
      const bothStarted = gate(),
        releaseSibling = gate()
      let rankingCalls = 0
      const model: ReservationAwareStructuredModel = {
        async generateReserved(request, reserve) {
          const reservation = await reserve()
          if (reservation.kind === "skip")
            return { kind: "skipped", reservation: reservation.reservation }
          const prompt = JSON.parse(request.prompt)
          if (!prompt.targets) {
            rankingCalls++
            throw new Error("ranking must not start")
          }
          const targetId = prompt.targets[0].video.id as string
          dispatched.push(targetId)
          if (dispatched.length === 2) bothStarted.release()
          await bothStarted.reached
          if (targetId !== "source-a") await releaseSibling.reached
          settled.push(targetId)
          if (targetId === "source-a" && !invalidConnection)
            throw new CodexSubscriptionAstraError("provider_unavailable", {
              consumptionUnknown: unknown,
              usage: unknown ? undefined : { inputTokens: 12, outputTokens: 3 },
            })
          return {
            kind: "dispatched",
            reservation: reservation.reservation,
            response: {
              output: request.schema.parse({
                reviewedSourceIds: ["source-a"],
                reviewedTargetIds: [targetId],
                allWorthwhileConnectionsReturned: true,
                connections: [connection(targetId)],
                notes: "Settled after sibling failure.",
              }),
              usage: { inputTokens: 100, outputTokens: 20 },
            },
          }
        },
      }
      const run = { ...input, readingConcurrency: 2 as const, model }
      let finished = false
      const outcome = runFullLibrary(run).then(
        () => {
          finished = true
          return { error: undefined }
        },
        (error: unknown) => {
          finished = true
          return { error }
        },
      )
      const failureCode = invalidConnection
        ? "connection_excluded"
        : "provider_unavailable"
      try {
        // The sibling remains physically in flight while the first terminal
        // receipt is persisted. A failed receipt is written after pausing;
        // Invalid self-recommendations pass the ID schema but must fail
        // semantic validation after their successful physical receipt.
        await expect
          .poll(
            async () => {
              try {
                return JSON.parse(
                  await readFile(
                    join(input.runDirectory, "calls/read-0000/receipt.json"),
                    "utf8",
                  ),
                )
              } catch {
                return null
              }
            },
            { timeout: 5_000, interval: 10 },
          )
          .toMatchObject({ status: invalidConnection ? "succeeded" : "failed" })
        expect([...dispatched].sort()).toEqual(["source-a", "target-b"])
        expect(settled).toEqual(["source-a"])
        expect(finished).toBe(false)
        expect(rankingCalls).toBe(0)
      } finally {
        releaseSibling.release()
        await outcome
      }
      expect((await outcome).error).toMatchObject({ code: failureCode })
      expect([...dispatched].sort()).toEqual(["source-a", "target-b"])
      expect([...settled].sort()).toEqual(["source-a", "target-b"])
      expect(rankingCalls).toBe(0)
      expect((await readdir(join(input.runDirectory, "calls"))).sort()).toEqual(
        ["read-0000", "read-0001"],
      )
      const failed = JSON.parse(
        await readFile(
          join(input.runDirectory, "calls/read-0000/receipt.json"),
          "utf8",
        ),
      )
      const completed = JSON.parse(
        await readFile(
          join(input.runDirectory, "calls/read-0001/receipt.json"),
          "utf8",
        ),
      )
      expect(failed).toMatchObject({
        status: invalidConnection ? "succeeded" : "failed",
        consumptionUnknown: unknown,
        reserved: true,
        usage: unknown
          ? null
          : invalidConnection
            ? { inputTokens: 100, outputTokens: 20 }
            : { inputTokens: 12, outputTokens: 3 },
      })
      expect(completed).toMatchObject({
        status: "succeeded",
        usage: { inputTokens: 100, outputTokens: 20 },
        consumptionUnknown: false,
      })
      expect(
        JSON.parse(
          await readFile(
            join(input.runDirectory, "reading-failure.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({ code: failureCode, inFlightSettled: true })
      await expect(
        readFile(join(input.runDirectory, "producer.lock")),
      ).rejects.toMatchObject({ code: "ENOENT" })
      await expect(runFullLibrary(run)).rejects.toThrow(
        invalidConnection ? "reading_run_paused" : "call_not_resumable",
      )
      expect(dispatched).toHaveLength(2)
    },
    10_000,
  )
})
