import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"

import type { ReservationAwareStructuredModel } from "./codex-subscription-astra"
import {
  FULL_LIBRARY_SYSTEM,
  excludedTarget,
  planFullLibrary,
  runFullLibrary,
  validateCorpus,
  type ContextBudget,
  type LibraryEntry,
} from "./full-library-v1"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})
function entry(id: string): LibraryEntry {
  return {
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
  }
}
const context: ContextBudget = {
  modelId: "gpt-6-astra",
  modelVersion: "synthetic-schema-test",
  contextWindowTokens: 100_000,
  effectiveContextTokens: 100_000,
  autoCompactLimitTokens: 100_000,
  overheadReserveTokens: 1000,
  outputReserveTokens: 1000,
  tokenizer: "synthetic schema byte counter",
  contextEvidence: "Offline fixture only.",
}
// Keep prompt-token cost constant so partitioning is driven by the actual schema.
const countTokens = async (text: string) =>
  text.includes('"untrustedCatalogData"') ? 100 : Buffer.byteLength(text)
function data(targets = 4) {
  return validateCorpus({
    observedAt: "2026-10-16T00:00:00.000Z",
    entries: [
      entry("source-a"),
      entry("source-b"),
      ...Array.from({ length: targets }, (_, index) =>
        entry(`target-${String(index).padStart(2, "0")}-${"x".repeat(100)}`),
      ),
    ],
  })
}
const sourceIds = ["source-a", "source-b"]

describe("full-library complete-input ID schemas and true duplicate eligibility", () => {
  it("allows distinct siblings, parents and children while excluding only self or true identities", () => {
    const source = entry("source"),
      parent = entry("parent"),
      child = entry("child"),
      sibling = entry("sibling")
    source.video.parentVideoIds = ["parent"]
    source.video.childVideoIds = ["child"]
    parent.video.childVideoIds = ["source"]
    child.video.parentVideoIds = ["source"]
    sibling.video.parentVideoIds = ["parent"]
    for (const target of [parent, child, sibling]) {
      expect(excludedTarget(source, target)).toBe(false)
      expect(excludedTarget(target, source)).toBe(false)
    }
    expect(excludedTarget(source, source)).toBe(true)
    expect(
      excludedTarget(source, {
        ...parent,
        video: { ...parent.video, coreId: source.video.coreId },
      }),
    ).toBe(true)
    expect(
      excludedTarget(source, {
        ...parent,
        video: { ...parent.video, slug: source.video.slug },
      }),
    ).toBe(true)
    expect(
      excludedTarget(
        { ...source, video: { ...source.video, coreId: "", slug: "" } },
        { ...parent, video: { ...parent.video, coreId: "", slug: "" } },
      ),
    ).toBe(false)
    expect(FULL_LIBRARY_SYSTEM).toContain(
      "shared family membership alone is never an exclusion",
    )
  })

  it.each(["shared", "staged"] as const)(
    "measures the actual %s ID enum/length schema for planning and physical reservations",
    async (mode) => {
      const corpus = data(mode === "shared" ? 4 : 18)
      const budget =
        mode === "shared"
          ? context
          : {
              ...context,
              contextWindowTokens: 6500,
              effectiveContextTokens: 6500,
              autoCompactLimitTokens: 6500,
              overheadReserveTokens: 100,
              outputReserveTokens: 100,
            }
      const plan = await planFullLibrary({
        corpus,
        sourceIds,
        context: budget,
        countTokens,
      })
      expect(plan.mode).toBe(mode)
      if (mode === "staged") expect(plan.batches.length).toBeGreaterThan(1)
      const runDirectory = await mkdtemp(
        join(tmpdir(), "forge-library-schema-"),
      )
      directories.push(runDirectory)
      let readingCalls = 0
      const supplied: string[] = []
      const model: ReservationAwareStructuredModel = {
        async generateReserved(request, reserve) {
          const reserved = await reserve()
          if (reserved.kind === "skip")
            return { kind: "skipped", reservation: reserved.reservation }
          const prompt = JSON.parse(request.prompt)
          const sources = sourceIds.map((sourceVideoId) => ({
            sourceVideoId,
            recommendations: [],
            fewerThanFiveReason:
              "This synthetic fixture has no useful recommendation.",
          }))
          let output: Record<string, unknown> = { sources }
          if (prompt.targets) {
            const batch = plan.batches[readingCalls++]
            const targetIds = prompt.targets.map(
              (entry: LibraryEntry) => entry.video.id,
            )
            supplied.push(...targetIds)
            expect(targetIds).toEqual(batch.targetIds)
            const json = z.toJSONSchema(request.schema, { target: "draft-07" })
            const text = JSON.stringify(json)
            expect(batch.measurement.schemaBytes).toBe(Buffer.byteLength(text))
            expect(batch.measurement.schemaTokens).toBe(await countTokens(text))
            const reservation = JSON.parse(
              await readFile(
                join(
                  runDirectory,
                  "calls",
                  String(reserved.reservation),
                  "reservation.json",
                ),
                "utf8",
              ),
            )
            expect(reservation.measurement).toEqual(batch.measurement)
            if (mode === "shared")
              expect(plan.fullLibraryMeasurement.schemaTokens).toBe(
                batch.measurement.schemaTokens,
              )
            const ack = {
              reviewedSourceIds: sourceIds,
              reviewedTargetIds: targetIds,
            }
            output =
              mode === "shared"
                ? { ...ack, sources }
                : {
                    ...ack,
                    allWorthwhileConnectionsReturned: true,
                    connections: [],
                    notes: "Synthetic fixture.",
                  }
            expect(request.schema.safeParse(output).success).toBe(true)
            expect(
              request.schema.safeParse({
                ...output,
                reviewedTargetIds: ["mistyped-target", ...targetIds.slice(1)],
              }).success,
            ).toBe(false)
            expect(
              request.schema.safeParse({
                ...output,
                reviewedTargetIds: targetIds.slice(1),
              }).success,
            ).toBe(false)
            expect(
              request.schema.safeParse({
                ...output,
                reviewedSourceIds: ["wrong-source", sourceIds[1]],
              }).success,
            ).toBe(false)
            expect(text).toContain(JSON.stringify(targetIds))
            const properties = json.properties as Record<
              string,
              { items: { enum: string[] }; minItems: number; maxItems?: number }
            >
            expect(properties.reviewedTargetIds.items.enum).toEqual(targetIds)
            expect(properties.reviewedTargetIds.minItems).toBe(targetIds.length)
            expect(properties.reviewedTargetIds.maxItems).toBe(targetIds.length)
            expect(properties.reviewedSourceIds.items.enum).toEqual(sourceIds)
            if (mode === "staged") {
              expect(properties.connections.maxItems).toBeUndefined()
            }
          }
          return {
            kind: "dispatched",
            reservation: reserved.reservation,
            response: {
              output: request.schema.parse(output),
              usage: {
                inputTokens: 100,
                outputTokens: 20,
                cachedInputTokens: 0,
              },
            },
          }
        },
      }
      await runFullLibrary({
        corpus,
        plan,
        countTokens,
        model,
        runDirectory,
        executionManifest: { fixture: mode },
      })
      expect(supplied.sort()).toEqual(
        corpus.entries.map((entry) => entry.video.id).sort(),
      )
      expect(new Set(supplied).size).toBe(corpus.entries.length)
    },
  )

  it("partitions on the dynamic schema byte cap even when token admission fits", async () => {
    const corpus = data(700)
    const plan = await planFullLibrary({
      corpus,
      sourceIds,
      context,
      countTokens: async () => 1,
    })
    expect(plan.fullLibraryMeasurement.schemaBytes).toBeGreaterThan(128_000)
    expect(plan.fullLibraryMeasurement.promptBytes).toBeLessThan(2_000_000)
    expect(plan.mode).toBe("staged")
    expect(plan.batches.length).toBeGreaterThan(1)
    for (const batch of plan.batches)
      expect(batch.measurement.schemaBytes).toBeLessThanOrEqual(128_000)
    expect(plan.batches.flatMap((batch) => batch.targetIds).sort()).toEqual(
      corpus.entries.map((entry) => entry.video.id).sort(),
    )
  })

  it("rejects a mistyped acknowledgement from a nonconforming transport, preserves physical usage and blocks replay", async () => {
    const corpus = data()
    const plan = await planFullLibrary({
      corpus,
      sourceIds,
      context,
      countTokens,
    })
    const runDirectory = await mkdtemp(
      join(tmpdir(), "forge-library-schema-invalid-"),
    )
    directories.push(runDirectory)
    let calls = 0
    const model: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        const reserved = await reserve()
        if (reserved.kind === "skip")
          return { kind: "skipped", reservation: reserved.reservation }
        calls++
        const invalid = {
          reviewedSourceIds: sourceIds,
          reviewedTargetIds: [
            "mistyped-target",
            ...plan.batches[0].targetIds.slice(1),
          ],
          sources: sourceIds.map((sourceVideoId) => ({
            sourceVideoId,
            recommendations: [],
            fewerThanFiveReason: "Synthetic invalid acknowledgement fixture.",
          })),
        }
        // Simulate a transport ignoring its output schema; core must still reject.
        return {
          kind: "dispatched",
          reservation: reserved.reservation,
          response: {
            output: invalid as z.output<typeof request.schema>,
            usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
          },
        }
      },
    }
    const input = {
      corpus,
      plan,
      countTokens,
      model,
      runDirectory,
      executionManifest: { fixture: "invalid-schema" },
    }
    await expect(runFullLibrary(input)).rejects.toBeDefined()
    const receipt = JSON.parse(
      await readFile(
        join(runDirectory, "calls", "read-0000", "receipt.json"),
        "utf8",
      ),
    )
    expect(receipt).toMatchObject({
      status: "failed",
      consumptionUnknown: false,
      usage: { inputTokens: 100, outputTokens: 20 },
    })
    await expect(runFullLibrary(input)).rejects.toMatchObject({
      code: "call_not_resumable",
    })
    expect(calls).toBe(1)
  })
})
