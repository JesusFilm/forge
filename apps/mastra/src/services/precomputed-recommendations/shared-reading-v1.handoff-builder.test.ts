import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import type { z } from "zod"

import type { ReservationAwareStructuredModel } from "./codex-subscription-astra"
import { sha256, validateCorpus, type ContextBudget } from "./full-library-v1"
import {
  buildSharedCatalog,
  expandCompactDiscovery,
  planSharedReading,
  prepareSharedReadingReuse,
  renderSharedRanking,
  SHARED_SELECTION_SYSTEM,
  SHARED_FINALIZATION_SYSTEM,
  runSharedReading,
  sharedEnvelope,
  SHARED_RANKING_SYSTEM,
  type SharedDiscovery,
} from "./shared-reading-v1"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})
const counter = async (text: string) => Math.ceil(Buffer.byteLength(text) / 100)
const context: ContextBudget = {
  modelId: "gpt-6-astra",
  modelVersion: "fake",
  contextWindowTokens: 10000,
  effectiveContextTokens: 10000,
  autoCompactLimitTokens: 10000,
  overheadReserveTokens: 100,
  outputReserveTokens: 100,
  tokenizer: "test bytes/100",
  contextEvidence: "test only",
}
function fixture() {
  return validateCorpus({
    observedAt: "2026-10-19T00:00:00.000Z",
    entries: ["a", "b", "c", "metadata"].map((id, index) => ({
      video: {
        id,
        coreId: id,
        slug: id,
        locale: "en",
        title: "The complete title " + id,
        description: "The complete description " + id,
        descriptionTruncated: false,
        keywords: [],
        keywordsTruncated: false,
        bibleCitations: [],
        bibleCitationsTruncated: false,
        parentVideoIds: [],
        childVideoIds: [],
        transcriptLanguages: index === 3 ? [] : ["en"],
        transcriptSelection: {
          policy: "english-per-edition-with-complete-fallback-v1",
          availableTranscriptCount: index === 3 ? 0 : 1,
          incompleteTranscriptCount: 0,
          skippedEditionCount: 0,
          selected:
            index === 3
              ? []
              : [
                  {
                    transcriptId: id + "-t",
                    videoEditionId: id + "-e",
                    language: "en",
                    totalChunks: 1,
                  },
                ],
        },
      },
      chunks:
        index === 3
          ? []
          : [
              {
                id: id + "-chunk",
                transcriptId: id + "-t",
                language: "en",
                chunkIndex: 0,
                text:
                  "Exact original words with a distinctive ending. ".repeat(
                    24,
                  ) + id,
              },
            ],
    })),
  })
}
function pool(
  catalog: ReturnType<typeof buildSharedCatalog>,
  repeated = 1,
): SharedDiscovery[] {
  const support = (video: number) =>
    catalog.entries[video].chunks.length
      ? {
          basis: "transcript" as const,
          refs: [catalog.entries[video].chunks[0].spans[0].ref],
        }
      : {
          basis: "metadata" as const,
          refs: [catalog.entries[video].metadataRefs[0].ref],
        }
  return Array.from({ length: repeated }, (_, i) =>
    [1, 2, 3].map((target) => ({
      discoveryId: "batch" + i + ":" + target,
      callId: "batch" + i,
      discovery: {
        source: 0,
        target,
        relation: "A distinct supported relation number " + i,
        value: "A distinct added viewing value number " + i,
        sourceEvidence: support(0),
        targetEvidence: support(target),
      },
    })),
  ).flat()
}
function fake(
  catalog: ReturnType<typeof buildSharedCatalog>,
  options: { partial?: boolean; rankError?: boolean } = {},
) {
  const calls: string[] = []
  let partial = options.partial
  const model: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      const p = JSON.parse(request.prompt)
      calls.push(p.targets ? "read" : "rank")
      const reserved = await reserve()
      if (reserved.kind === "skip")
        return { kind: "skipped", reservation: reserved.reservation }
      if (!p.targets && options.rankError)
        throw new Error("physical ranking failure")
      const incomplete = !!p.targets && partial
      partial = false
      const output = p.targets
        ? {
            sources: p.sources.map((s: { ref: number }) => s.ref),
            targets: p.targets.map((t: { ref: number }) => t.ref),
            complete: !incomplete,
            notes: "All supplied content considered.",
            discoveries: pool(catalog)
              .filter((d) =>
                p.targets.some(
                  (t: { ref: number }) => t.ref === d.discovery.target,
                ),
              )
              .map((d) => d.discovery),
          }
        : {
            recommendations: p.discoveries
              .slice(0, 1)
              .map((d: { discoveryId: string }) => ({
                discoveryId: d.discoveryId,
                rank: 1,
                connection: "The final full directional explanation.",
                watchingValue: "The final distinct added viewing value.",
              })),
            fewerThanFiveReason:
              "Only one connection selected in this fake transport.",
          }
      return {
        kind: "dispatched",
        reservation: reserved.reservation,
        response: {
          output: request.schema.parse(output),
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            modelVersion: "fake",
          },
        },
      }
    },
  }
  return { model, calls }
}
async function setup(partial = false, rankError = false) {
  const root = await mkdtemp(join(tmpdir(), "handoff-builder-"))
  roots.push(root)
  const corpus = fixture(),
    catalog = buildSharedCatalog(corpus)
  const plan = await planSharedReading({
    corpus,
    sourceIds: ["a"],
    context,
    countTokens: counter,
  })
  const parent = join(root, "parent"),
    transport = fake(catalog, { partial, rankError })
  const input = {
    corpus,
    plan,
    countTokens: counter,
    runDirectory: parent,
    executionManifest: { fake: true },
    model: transport.model,
  }
  if (rankError)
    await expect(runSharedReading(input)).rejects.toThrow(
      "physical ranking failure",
    )
  else await runSharedReading(input)
  const readingReuse = {
    parentRunDirectory: parent,
    parentManifestSha256: sha256(await readFile(join(parent, "manifest.json"))),
  }
  return { root, parent, corpus, catalog, input, readingReuse }
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else result[child] = sha256(await readFile(child))
    }
  }
  await visit(root)
  return result
}

describe("lossless ranking registry", () => {
  it("resolves every association exactly, without repeating source or target evidence", () => {
    const catalog = buildSharedCatalog(fixture()),
      discoveries = pool(catalog, 8)
    const payload = JSON.parse(renderSharedRanking(catalog, 0, discoveries))
    expect(payload.discoveries).toHaveLength(discoveries.length)
    expect(payload.evidenceLookup.spans).toHaveLength(3)
    expect(payload.evidenceLookup.metadata).toHaveLength(1)
    for (let i = 0; i < discoveries.length; i++) {
      const d = payload.discoveries[i],
        original = expandCompactDiscovery(catalog, discoveries[i].discovery)
      expect([d.connection, d.watchingValue]).toEqual([
        original.connection,
        original.watchingValue,
      ])
      for (const side of ["sourceEvidence", "targetEvidence"] as const) {
        const evidence = d[side]
        const expanded =
          evidence.basis === "transcript"
            ? {
                basis: "transcript",
                passages: evidence.refs.map((ref: number) => {
                  const item = payload.evidenceLookup.spans.find(
                    (s: { ref: number }) => s.ref === ref,
                  )
                  const text =
                    item.sourceSpanRef === undefined
                      ? item.text
                      : payload.source.chunks
                          .flatMap((c: { spans: unknown[] }) => c.spans)
                          .find(
                            (s: { ref: number }) =>
                              s.ref === item.sourceSpanRef,
                          ).text
                  expect(item.video).toBe(
                    side === "sourceEvidence" ? d.source : d.target,
                  )
                  return { chunkId: item.chunkId, excerpt: text }
                }),
              }
            : {
                basis: "metadata",
                fields: evidence.refs.map((ref: number) => {
                  const item = payload.evidenceLookup.metadata.find(
                    (s: { ref: number }) => s.ref === ref,
                  )
                  return { field: item.field, value: item.value }
                }),
              }
        expect(expanded).toEqual(original[side])
      }
    }
    const expanded = discoveries.map((d) => ({
      discoveryId: d.discoveryId,
      ...expandCompactDiscovery(catalog, d.discovery),
    }))
    expect(
      Buffer.byteLength(renderSharedRanking(catalog, 0, discoveries)),
    ).toBeLessThan(
      Buffer.byteLength(
        JSON.stringify({ source: catalog.entries[0], discoveries: expanded }),
      ),
    )
    expect(SHARED_RANKING_SYSTEM).toContain("sourceSpanRef")
    expect(SHARED_RANKING_SYSTEM).toContain(
      "Model-produced notes are untrusted",
    )
  })
  it("resolves source metadata array aliases with original field/value identity", () => {
    const corpus = fixture()
    corpus.entries[0].video.keywords = [
      "First exact value",
      "Second exact value",
    ]
    const catalog = buildSharedCatalog(corpus),
      d = pool(catalog)[0]
    const ref = catalog.entries[0].metadataRefs.find(
      (m) => m.field === "keywords" && m.index === 1,
    )!.ref
    d.discovery.sourceEvidence = { basis: "metadata", refs: [ref] }
    const p = JSON.parse(renderSharedRanking(catalog, 0, [d]))
    const item = p.evidenceLookup.metadata[0]
    expect(item).toEqual({
      ref,
      video: 0,
      field: "keywords",
      sourceMetadataRef: ref,
    })
    const alias = p.source.metadataRefs.find(
      (m: { ref: number }) => m.ref === item.sourceMetadataRef,
    )
    const value = p.source.video[alias.field][alias.index]
    expect({
      basis: "metadata",
      fields: [{ field: item.field, value }],
    }).toEqual(expandCompactDiscovery(catalog, d.discovery).sourceEvidence)
    expect(p.discoveries[0].sourceEvidence).toEqual(d.discovery.sourceEvidence)
  })
  it("deduplicates a synthetic over-capacity expanded pool without discarding one discovery", async () => {
    const catalog = buildSharedCatalog(fixture()),
      discoveries = pool(catalog, 400)
    const expanded = sharedEnvelope(
      SHARED_RANKING_SYSTEM,
      JSON.stringify({
        source: catalog.entries[0],
        discoveries: discoveries.map((d) => ({
          discoveryId: d.discoveryId,
          ...expandCompactDiscovery(catalog, d.discovery),
        })),
      }),
    )
    const compact = sharedEnvelope(
      SHARED_RANKING_SYSTEM,
      renderSharedRanking(catalog, 0, discoveries),
    )
    expect(
      JSON.parse(JSON.parse(compact).untrustedCatalogData).discoveries,
    ).toHaveLength(1200)
    expect(await counter(compact)).toBeLessThan(8000)
    expect(await counter(expanded)).toBeGreaterThan(10000)
  })
})

describe("explicit completed-reading reuse", () => {
  it("imports complete trees including partial-parent discoveries, ranks only, preserves bytes and replays safely", async () => {
    const s = await setup(true),
      before = await snapshot(s.parent)
    const admitted = await prepareSharedReadingReuse({
      corpus: s.corpus,
      readingReuse: s.readingReuse,
      countTokens: counter,
    })
    expect(admitted.readings.size).toBe(3)
    const child = fake(s.catalog),
      runDirectory = join(s.root, "child")
    const input = {
      ...s.input,
      plan: admitted.plan,
      runDirectory,
      model: child.model,
    }
    const result = await runSharedReading(input)
    expect(child.calls).toEqual(["rank"])
    const coverage = JSON.parse(
      await readFile(join(runDirectory, "groups/g0000/coverage.json"), "utf8"),
    )
    expect(coverage.discoveries).toHaveLength(6)
    expect(
      coverage.leaves.flatMap((a: { targets: number[] }) => a.targets),
    ).toEqual([0, 1, 2, 3])
    expect(result.sources[0].recommendations[0].sourceEvidence).toEqual(
      expandCompactDiscovery(s.catalog, pool(s.catalog)[0].discovery)
        .sourceEvidence,
    )
    const usage = JSON.parse(
      await readFile(join(runDirectory, "usage-summary.json"), "utf8"),
    )
    expect(usage).toMatchObject({
      newKnownPhysicalCalls: 1,
      parentKnownPhysicalCalls: 4,
      importedReadingPhysicalCalls: 3,
      knownPhysicalCalls: 5,
      inputTokens: 500,
      unknownConsumptionCalls: 0,
    })
    await runSharedReading(input)
    expect(child.calls).toEqual(["rank"])
    expect(await snapshot(s.parent)).toEqual(before)
  })
  it("admits a parent stopped before oversized ranking without a physical ranking call", async () => {
    const s = await setup()
    const root = join(s.root, "overflow-parent")
    const tooLargeRank = async (text: string) => {
      const p = JSON.parse(text)
      if (
        typeof p.untrustedCatalogData === "string" &&
        JSON.parse(p.untrustedCatalogData).discoveries
      )
        return 20000
      return counter(text)
    }
    const original = fake(s.catalog)
    await expect(
      runSharedReading({
        ...s.input,
        runDirectory: root,
        countTokens: tooLargeRank,
        model: original.model,
      }),
    ).rejects.toThrow("selection_exceeds_context")
    expect(original.calls).toEqual(["read"])
    const admitted = await prepareSharedReadingReuse({
      corpus: s.corpus,
      countTokens: counter,
      readingReuse: {
        parentRunDirectory: root,
        parentManifestSha256: sha256(
          await readFile(join(root, "manifest.json")),
        ),
      },
    })
    const child = fake(s.catalog),
      runDirectory = join(s.root, "overflow-child")
    await runSharedReading({
      ...s.input,
      plan: admitted.plan,
      runDirectory,
      model: child.model,
    })
    expect(child.calls).toEqual(["rank"])
    const usage = JSON.parse(
      await readFile(join(runDirectory, "usage-summary.json"), "utf8"),
    )
    expect(usage).toMatchObject({
      newKnownPhysicalCalls: 1,
      parentKnownPhysicalCalls: 1,
      knownPhysicalCalls: 2,
      unknownConsumptionCalls: 0,
    })
  })
  it("keeps unknown parent ranking usage explicit without repeating parent reads", async () => {
    const s = await setup(false, true)
    const admitted = await prepareSharedReadingReuse({
      corpus: s.corpus,
      readingReuse: s.readingReuse,
      countTokens: counter,
    })
    const child = fake(s.catalog),
      runDirectory = join(s.root, "child")
    await runSharedReading({
      ...s.input,
      plan: admitted.plan,
      runDirectory,
      model: child.model,
    })
    const usage = JSON.parse(
      await readFile(join(runDirectory, "usage-summary.json"), "utf8"),
    )
    expect(usage).toMatchObject({
      newKnownPhysicalCalls: 1,
      parentKnownPhysicalCalls: 1,
      knownPhysicalCalls: 2,
      importedReadingPhysicalCalls: 1,
      unknownConsumptionCalls: 1,
      inputTokens: 200,
    })
    expect(
      usage.lineage.some(
        (r: { status: string; runDirectory: string }) =>
          r.status === "failed" && r.runDirectory === s.parent,
      ),
    ).toBe(true)
    expect(child.calls).toEqual(["rank"])
  })
  it.each(["unknown", "missing", "evidence", "request", "context", "manifest"])(
    "rejects %s reading imports before dispatch",
    async (kind) => {
      const s = await setup(),
        call = join(s.parent, "calls/g0000-r0000/a0000")
      if (kind === "missing") await rm(join(call, "result.json"))
      else if (kind === "request")
        await writeFile(join(s.parent, "calls/g0000-r0000/request.json"), "{}")
      else if (kind === "manifest")
        s.readingReuse.parentManifestSha256 = "0".repeat(64)
      else if (kind === "context") {
        const m = JSON.parse(
          await readFile(join(s.parent, "manifest.json"), "utf8"),
        )
        m.plan.context.outputReserveTokens++
        await writeFile(join(s.parent, "manifest.json"), JSON.stringify(m))
        s.readingReuse.parentManifestSha256 = sha256(
          await readFile(join(s.parent, "manifest.json")),
        )
      } else if (kind === "unknown") {
        const receipt = JSON.parse(
          await readFile(join(call, "receipt.json"), "utf8"),
        )
        receipt.consumptionUnknown = true
        await writeFile(join(call, "receipt.json"), JSON.stringify(receipt))
      } else {
        const result = JSON.parse(
          await readFile(join(call, "result.json"), "utf8"),
        )
        result.discoveries[0].targetEvidence.refs = [999999]
        await writeFile(join(call, "result.json"), JSON.stringify(result))
      }
      await expect(
        prepareSharedReadingReuse({
          corpus: s.corpus,
          readingReuse: s.readingReuse,
          countTokens: counter,
        }),
      ).rejects.toThrow()
    },
  )
  it("rejects active parents and any parent mutation after admission", async () => {
    const s = await setup()
    await writeFile(join(s.parent, "producer.lock"), "active")
    await expect(
      prepareSharedReadingReuse({
        corpus: s.corpus,
        readingReuse: s.readingReuse,
        countTokens: counter,
      }),
    ).rejects.toThrow("reuse_parent_active")
    await rm(join(s.parent, "producer.lock"))
    const admitted = await prepareSharedReadingReuse({
      corpus: s.corpus,
      readingReuse: s.readingReuse,
      countTokens: counter,
    })
    await writeFile(join(s.parent, "pauses/new.json"), "{}")
    const child = fake(s.catalog)
    await expect(
      runSharedReading({
        ...s.input,
        plan: admitted.plan,
        runDirectory: join(s.root, "child"),
        model: child.model,
      }),
    ).rejects.toThrow("plan_changed")
    expect(child.calls).toEqual([])
  })
})

// Stage-sensitive counter: discovery bytes/measurements remain identical; only
// the measured evidence-rich ranking overflows unless the test says otherwise.
function fallbackCounter(overflow?: "selection" | "finalization") {
  return async (text: string) => {
    const envelope = JSON.parse(text)
    if (typeof envelope.untrustedCatalogData === "string") {
      const p = JSON.parse(envelope.untrustedCatalogData)
      if (
        p.stage === "global-evidence-ranking" ||
        (overflow === "selection" && p.stage === "global-final-selection") ||
        (overflow === "finalization" &&
          p.stage === "selected-evidence-finalization")
      )
        return 20000
    }
    return counter(text)
  }
}
function staged(
  catalog: ReturnType<typeof buildSharedCatalog>,
  mutate?: (
    stage: string,
    output: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => void,
  unknownSelection = false,
) {
  const base = fake(catalog),
    stages: string[] = [],
    requests: Array<
      Parameters<ReservationAwareStructuredModel["generateReserved"]>[0]
    > = []
  const model: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      const p = JSON.parse(request.prompt)
      requests.push(request)
      if (
        p.stage !== "global-final-selection" &&
        p.stage !== "selected-evidence-finalization"
      )
        return base.model.generateReserved(request, reserve)
      stages.push(p.stage)
      const reserved = await reserve()
      if (reserved.kind === "skip")
        return { kind: "skipped", reservation: reserved.reservation }
      if (unknownSelection && p.stage === "global-final-selection")
        throw new Error("unknown selection consumption")
      const unique = new Set<number>()
      const chosen =
        p.stage === "global-final-selection"
          ? p.discoveries
              .filter((d: { target: number }) => {
                if (unique.has(d.target)) return false
                unique.add(d.target)
                return true
              })
              .slice(0, 3)
          : p.discoveries
      const recommendations = chosen.map(
        (d: { discoveryId: string }, index: number) => ({
          discoveryId: d.discoveryId,
          rank: index + 1,
        }),
      )
      const output: Record<string, unknown> =
        p.stage === "global-final-selection"
          ? {
              recommendations,
              fewerThanFiveReason:
                "Only these three notes suggest sufficiently distinct added value.",
            }
          : {
              recommendations: recommendations
                .slice(0, 2)
                .map((d: { discoveryId: string; rank: number }) => ({
                  ...d,
                  connection:
                    "The actual quotes support this directional connection.",
                  watchingValue:
                    "The actual evidence supports a distinct added viewing value.",
                })),
              rejected: recommendations
                .slice(2)
                .map((d: { discoveryId: string }) => ({
                  discoveryId: d.discoveryId,
                  reason:
                    "The supplied title metadata alone does not support the proposed causal claim.",
                })),
              fewerThanFiveReason:
                "Only these choices remain supported after inspecting original evidence.",
            }
      mutate?.(p.stage, output, p)
      const parsed = request.schema.safeParse(output)
      return {
        kind: "dispatched",
        reservation: reserved.reservation,
        response: {
          // Deliberately simulate malformed provider wire data AFTER a physical
          // reservation, so runner validation retains the known returned usage.
          output: parsed.success
            ? parsed.data
            : (output as z.output<typeof request.schema>),
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            modelVersion: "fake",
          },
        },
      }
    },
  }
  return { model, stages, requests, base }
}

describe("measured global selection and evidence finalization", () => {
  it("keeps the single evidence-rich call when it fits", async () => {
    const s = await setup(),
      model = staged(s.catalog),
      runDirectory = join(s.root, "single")
    const result = await runSharedReading({
      ...s.input,
      runDirectory,
      model: model.model,
    })
    expect(model.stages).toEqual([])
    expect(
      model.requests
        .filter((r) => JSON.parse(r.prompt).stage)
        .map((r) => JSON.parse(r.prompt).stage),
    ).toEqual(["global-evidence-ranking"])
    expect(result.sources[0].finalization?.mode).toBe("global-evidence")
  })
  it("hands ALL parent/child notes to one global selector, verifies selected exact evidence and records rejection", async () => {
    const s = await setup(true),
      before = await snapshot(s.parent)
    const admitted = await prepareSharedReadingReuse({
      corpus: s.corpus,
      readingReuse: s.readingReuse,
      countTokens: fallbackCounter(),
    })
    const model = staged(s.catalog),
      runDirectory = join(s.root, "two-stage")
    const input = {
      ...s.input,
      plan: admitted.plan,
      runDirectory,
      model: model.model,
      countTokens: fallbackCounter(),
    }
    const result = await runSharedReading(input)
    expect(model.base.calls).toEqual([])
    expect(model.stages).toEqual([
      "global-final-selection",
      "selected-evidence-finalization",
    ])
    const selection = JSON.parse(model.requests[0].prompt),
      final = JSON.parse(model.requests[1].prompt)
    const coverage = JSON.parse(
      await readFile(join(s.parent, "groups/g0000/coverage.json"), "utf8"),
    )
    expect(selection.discoveries).toEqual(
      coverage.discoveries.map((d: SharedDiscovery) => ({
        discoveryId: d.discoveryId,
        ...d.discovery,
      })),
    )
    expect(selection.discoveries).toHaveLength(6)
    expect(selection.source).toEqual(s.catalog.entries[0])
    expect(selection.targetIdentities).toEqual(
      [1, 2, 3].map((ref) => ({
        ref,
        videoId: s.catalog.corpus.entries[ref].video.id,
        title: s.catalog.corpus.entries[ref].video.title,
        coreId: s.catalog.corpus.entries[ref].video.coreId,
        slug: s.catalog.corpus.entries[ref].video.slug,
      })),
    )
    expect(selection.evidenceLookup).toBeUndefined()
    expect(SHARED_SELECTION_SYSTEM).toContain("target quote text")
    expect(SHARED_SELECTION_SYSTEM).toContain("no shared memory")
    expect(SHARED_FINALIZATION_SYSTEM).toContain("Do not invent replacements")
    for (const item of final.discoveries) {
      const original = coverage.discoveries.find(
        (d: SharedDiscovery) => d.discoveryId === item.discoveryId,
      )
      expect(item).toEqual({
        discoveryId: original.discoveryId,
        ...expandCompactDiscovery(s.catalog, original.discovery),
      })
    }
    expect(result.sources[0].recommendations).toHaveLength(2)
    expect(result.sources[0].finalization?.rejectedSelections).toEqual([
      {
        discoveryId: final.discoveries[2].discoveryId,
        targetVideoId: "metadata",
        reason:
          "The supplied title metadata alone does not support the proposed causal claim.",
      },
    ])
    const usage = JSON.parse(
      await readFile(join(runDirectory, "usage-summary.json"), "utf8"),
    )
    expect(usage).toMatchObject({
      newKnownPhysicalCalls: 2,
      parentKnownPhysicalCalls: 4,
      importedReadingPhysicalCalls: 3,
      knownPhysicalCalls: 6,
      newUsage: { inputTokens: 200, outputTokens: 20 },
    })
    expect(await readdir(join(runDirectory, "calls"))).toEqual([
      "g0000-rank-0-finalize",
      "g0000-rank-0-select",
    ])
    await runSharedReading(input)
    expect(model.stages).toHaveLength(2)
    expect(await snapshot(s.parent)).toEqual(before)
    expect(admitted.plan.instructionDigests.selection).toBe(
      sha256(SHARED_SELECTION_SYSTEM),
    )
    expect(admitted.plan.instructionDigests.finalization).toBe(
      sha256(SHARED_FINALIZATION_SYSTEM),
    )
  })
  it("rejects different selected targets with the same true duplicate identity", async () => {
    const s = await setup(),
      corpus = fixture()
    corpus.entries[1].video.coreId = "same-film"
    corpus.entries[2].video.coreId = "same-film"
    const catalog = buildSharedCatalog(corpus),
      countTokens = fallbackCounter(),
      model = staged(catalog)
    const plan = await planSharedReading({
      corpus,
      sourceIds: ["a"],
      context,
      countTokens,
    })
    const runDirectory = join(s.root, "true-duplicate")
    await expect(
      runSharedReading({
        ...s.input,
        corpus,
        plan,
        runDirectory,
        countTokens,
        model: model.model,
      }),
    ).rejects.toThrow("ranking_duplicate")
    expect(model.stages).toEqual(["global-final-selection"])
  })
  it.each(["invented", "duplicate", "rank", "unexplained"])(
    "refuses selector %s and preserves known usage before finalization",
    async (kind) => {
      const s = await setup(),
        admitted = await prepareSharedReadingReuse({
          corpus: s.corpus,
          readingReuse: s.readingReuse,
          countTokens: fallbackCounter(),
        })
      const model = staged(s.catalog, (stage, output) => {
          if (stage !== "global-final-selection") return
          const choices = output.recommendations as Array<{
            discoveryId: string
            rank: number
          }>
          if (kind === "invented") choices[0].discoveryId = "invented"
          if (kind === "duplicate")
            choices[1].discoveryId = choices[0].discoveryId
          if (kind === "rank") choices[0].rank = 2
          if (kind === "unexplained") output.fewerThanFiveReason = null
        }),
        runDirectory = join(s.root, "invalid")
      await expect(
        runSharedReading({
          ...s.input,
          plan: admitted.plan,
          runDirectory,
          model: model.model,
          countTokens: fallbackCounter(),
        }),
      ).rejects.toThrow()
      expect(model.stages).toEqual(["global-final-selection"])
      expect(
        JSON.parse(
          await readFile(join(runDirectory, "usage-summary.json"), "utf8"),
        ),
      ).toMatchObject({ newKnownPhysicalCalls: 1, unknownConsumptionCalls: 0 })
    },
  )
  it.each(["replacement", "omission", "overlap", "blankReason"])(
    "refuses finalizer %s without losing the physical receipt",
    async (kind) => {
      const s = await setup(),
        admitted = await prepareSharedReadingReuse({
          corpus: s.corpus,
          readingReuse: s.readingReuse,
          countTokens: fallbackCounter(),
        })
      const model = staged(s.catalog, (stage, output) => {
          if (stage !== "selected-evidence-finalization") return
          const choices = output.recommendations as Array<{
              discoveryId: string
              rank: number
            }>,
            rejected = output.rejected as Array<{
              discoveryId: string
              reason: string
            }>
          if (kind === "replacement")
            choices[0].discoveryId = "outside-selected-set"
          if (kind === "omission") output.rejected = []
          if (kind === "overlap")
            rejected[0].discoveryId = choices[0].discoveryId
          if (kind === "blankReason") rejected[0].reason = " ".repeat(20)
        }),
        runDirectory = join(s.root, "invalid-final")
      await expect(
        runSharedReading({
          ...s.input,
          plan: admitted.plan,
          runDirectory,
          model: model.model,
          countTokens: fallbackCounter(),
        }),
      ).rejects.toThrow()
      expect(model.stages).toEqual([
        "global-final-selection",
        "selected-evidence-finalization",
      ])
      expect(
        JSON.parse(
          await readFile(join(runDirectory, "usage-summary.json"), "utf8"),
        ),
      ).toMatchObject({ newKnownPhysicalCalls: 2, unknownConsumptionCalls: 0 })
    },
  )
  it.each(["selection", "finalization"] as const)(
    "stops genuine %s overflow before its reservation",
    async (overflow) => {
      const s = await setup(),
        admitted = await prepareSharedReadingReuse({
          corpus: s.corpus,
          readingReuse: s.readingReuse,
          countTokens: fallbackCounter(overflow),
        })
      const model = staged(s.catalog),
        runDirectory = join(s.root, "capacity")
      const input = {
        ...s.input,
        plan: admitted.plan,
        runDirectory,
        model: model.model,
        countTokens: fallbackCounter(overflow),
      }
      await expect(runSharedReading(input)).rejects.toThrow(
        overflow + "_exceeds_context",
      )
      expect(model.stages).toEqual(
        overflow === "selection" ? [] : ["global-final-selection"],
      )
      const usage = JSON.parse(
        await readFile(join(runDirectory, "usage-summary.json"), "utf8"),
      )
      expect(usage.newKnownPhysicalCalls).toBe(overflow === "selection" ? 0 : 1)
      expect(usage.unknownConsumptionCalls).toBe(0)
      await expect(runSharedReading(input)).rejects.toThrow(
        overflow + "_exceeds_context",
      )
      expect(model.stages).toEqual(
        overflow === "selection" ? [] : ["global-final-selection"],
      )
    },
  )
  it("pauses unknown selector consumption and refuses blind replay", async () => {
    const s = await setup(),
      admitted = await prepareSharedReadingReuse({
        corpus: s.corpus,
        readingReuse: s.readingReuse,
        countTokens: fallbackCounter(),
      })
    const model = staged(s.catalog, undefined, true),
      runDirectory = join(s.root, "unknown")
    const input = {
      ...s.input,
      plan: admitted.plan,
      runDirectory,
      model: model.model,
      countTokens: fallbackCounter(),
    }
    await expect(runSharedReading(input)).rejects.toThrow(
      "unknown selection consumption",
    )
    expect(
      JSON.parse(
        await readFile(join(runDirectory, "usage-summary.json"), "utf8"),
      ),
    ).toMatchObject({ unknownConsumptionCalls: 1, newKnownPhysicalCalls: 0 })
    await expect(runSharedReading(input)).rejects.toThrow(
      "physical_call_not_resumable",
    )
    expect(model.stages).toEqual(["global-final-selection"])
  })
})
