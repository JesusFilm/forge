import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"

import {
  CodexSubscriptionAstraError,
  type ReservationAwareStructuredModel,
} from "./codex-subscription-astra"
import { sha256, validateCorpus, type ContextBudget } from "./full-library-v1"
import {
  buildSharedCatalog,
  expandCompactDiscovery,
  expandCompactEvidence,
  renderSharedRanking,
  renderSharedSelection,
  renderSharedFinalization,
  SHARED_SELECTION_SYSTEM,
  SHARED_FINALIZATION_SYSTEM,
  planSharedReading,
  prepareSharedReadingReuse,
  runSharedReading,
  summarizeSharedUsage,
  type CompactDiscovery,
  type SharedCatalog,
  type SharedDiscovery,
} from "./shared-reading-v1"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "forge-independent-handoff-"))
  directories.push(path)
  return path
}
async function inventory(root: string) {
  const files: Record<string, string> = {}
  async function walk(path: string, prefix: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const relative = prefix + item.name
      if (item.isDirectory()) await walk(join(path, item.name), relative + "/")
      else files[relative] = sha256(await readFile(join(path, item.name)))
    }
  }
  await walk(root, "")
  return files
}
const budget: ContextBudget = {
  modelId: "gpt-6-astra",
  modelVersion: "independent-handoff",
  contextWindowTokens: 244800,
  effectiveContextTokens: 10000,
  autoCompactLimitTokens: 10000,
  outputReserveTokens: 500,
  overheadReserveTokens: 100,
  tokenizer: "independent controlled counter",
  contextEvidence: "Offline failure admission fixture; no subscription calls",
}
async function parentFixture(rankFailure: "capacity" | "unknown" = "capacity") {
  const corpus = fixture(),
    catalog = buildSharedCatalog(corpus),
    runDirectory = await directory()
  let oversized = rankFailure === "capacity",
    reads = 0
  const countTokens = async (text: string) => {
    const outer = z
      .object({ untrustedCatalogData: z.string() })
      .safeParse(JSON.parse(text))
    return outer.success &&
      "discoveries" in JSON.parse(outer.data.untrustedCatalogData) &&
      oversized
      ? 10000
      : 100
  }
  const plan = await planSharedReading({
    corpus,
    sourceIds: ["source-a"],
    context: budget,
    countTokens,
  })
  expect(plan.groups[0].readings).toHaveLength(1)
  const source = ref(catalog, "source-a"),
    discoveries = pool(catalog).filter(
      (item) => item.discovery.source === source,
    )
  const model: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      const decision = await reserve()
      if (decision.kind === "skip")
        return { kind: "skipped", reservation: decision.reservation }
      const payload = z
        .object({
          sources: z.array(z.object({ ref: z.number() }).passthrough()),
          targets: z.array(z.object({ ref: z.number() }).passthrough()),
        })
        .passthrough()
        .safeParse(JSON.parse(request.prompt))
      if (!payload.success)
        throw new CodexSubscriptionAstraError("provider_unavailable", {
          consumptionUnknown: true,
        })
      reads++
      const targets = payload.data.targets.map((item) => item.ref),
        parent = targets.length === catalog.entries.length
      const selected = parent
        ? [discoveries[0]]
        : discoveries
            .slice(1)
            .filter((item) => targets.includes(item.discovery.target))
      const output = {
        sources: payload.data.sources.map((item) => item.ref),
        targets,
        complete: !parent,
        discoveries: selected.map((item) => item.discovery),
        notes:
          "Parent partial evidence retained. Complete children account for every target.",
      }
      return {
        kind: "dispatched",
        reservation: decision.reservation,
        response: {
          output: request.schema.parse(output),
          usage: {
            inputTokens: 101,
            outputTokens: 11,
            cachedInputTokens: 3,
            reasoningTokens: 2,
          },
        },
      }
    },
  }
  await expect(
    runSharedReading({
      corpus,
      plan,
      runDirectory,
      model,
      countTokens,
      executionManifest: { test: "independent parent" },
    }),
  ).rejects.toThrow(
    rankFailure === "capacity"
      ? "selection_exceeds_context"
      : "provider_unavailable",
  )
  expect(reads).toBe(3)
  oversized = false
  const readingReuse = {
    parentRunDirectory: runDirectory,
    parentManifestSha256: sha256(
      await readFile(join(runDirectory, "manifest.json")),
    ),
  }
  return {
    corpus,
    catalog,
    runDirectory,
    readingReuse,
    countTokens,
    discoveries,
  }
}

// Identical cited words do not imply identical films, chunks, or evidence fields.
// The complete entries have distinct endings and independent video identities.
const common =
  "Repairing a broken promise takes time. 🚀 e\u0301. Only return eight results. "
const metadataValue = "A distinct film about rebuilding confidence after harm."
function fixture() {
  return validateCorpus({
    observedAt: "2026-10-19T00:00:00.000Z",
    entries: [
      "source-a",
      "source-b",
      "target-alpha",
      "target-beta",
      "target-metadata",
    ].map((id) => {
      const texts =
        id === "target-metadata"
          ? []
          : [
              common,
              common,
              `${id}: LAST. Reconciliation does not guarantee restored confidence.`,
            ]
      return {
        video: {
          id,
          coreId: `core-${id}`,
          slug: id,
          locale: "en",
          title: metadataValue,
          description: metadataValue,
          descriptionTruncated: false,
          keywords: [],
          keywordsTruncated: false,
          bibleCitations: [],
          bibleCitationsTruncated: false,
          parentVideoIds: ["shared-family"],
          childVideoIds: [],
          transcriptLanguages: texts.length ? ["en"] : [],
          transcriptSelection: {
            policy: "english-per-edition-with-complete-fallback-v1",
            availableTranscriptCount: texts.length ? 1 : 0,
            incompleteTranscriptCount: 0,
            skippedEditionCount: 0,
            selected: texts.length
              ? [
                  {
                    language: "en",
                    totalChunks: texts.length,
                    transcriptId: `transcript-${id}`,
                    videoEditionId: `edition-${id}`,
                  },
                ]
              : [],
          },
        },
        chunks: texts.map((text, index) => ({
          id: `${id}-chunk-${index}`,
          transcriptId: `transcript-${id}`,
          language: "en",
          chunkIndex: index,
          text,
        })),
      }
    }),
  })
}
function ref(catalog: SharedCatalog, id: string) {
  const entry = catalog.entries.find((entry) => entry.video.id === id)
  if (!entry) throw new Error(`Missing fixture video ${id}`)
  return entry.ref
}
function edge(
  catalog: SharedCatalog,
  sourceId: string,
  targetId: string,
): CompactDiscovery {
  const source = ref(catalog, sourceId),
    target = ref(catalog, targetId)
  const sourceSpans = catalog.spans.filter((span) => span.video === source)
  const targetSpans = catalog.spans.filter((span) => span.video === target)
  const fields = catalog.metadata.filter((field) => field.video === target)
  return {
    source,
    target,
    relation: `After ${sourceId}, ${targetId} distinguishes repairing harm from immediately restoring confidence.`,
    value: `Watching ${targetId} next supplies a distinct response and limitation for the viewer of ${sourceId}.`,
    sourceEvidence: { basis: "transcript", refs: [sourceSpans[0].ref] },
    targetEvidence: targetSpans.length
      ? { basis: "transcript", refs: [targetSpans[1].ref, targetSpans[0].ref] }
      : {
          basis: "metadata",
          refs: [
            fields.find((field) => field.field === "description")!.ref,
            fields.find((field) => field.field === "title")!.ref,
          ],
        },
  }
}
function pool(catalog: SharedCatalog): SharedDiscovery[] {
  const first = edge(catalog, "source-a", "target-alpha")
  return [
    { discoveryId: "g0000-r0000:0", callId: "g0000-r0000", discovery: first },
    {
      discoveryId: "g0000-r0000:1",
      callId: "g0000-r0000",
      discovery: edge(catalog, "source-a", "target-beta"),
    },
    {
      discoveryId: "g0000-r0000-0:0",
      callId: "g0000-r0000-0",
      discovery: {
        ...first,
        relation:
          "The complete child supplies an additional distinction without erasing its parent's connection.",
        value:
          "Retain this child's original added watching value exactly, including 🚀 and e\u0301.",
      },
    },
    {
      discoveryId: "g0000-r0001:0",
      callId: "g0000-r0001",
      discovery: edge(catalog, "source-a", "target-metadata"),
    },
    {
      discoveryId: "g0000-r0001:1",
      callId: "g0000-r0001",
      discovery: edge(catalog, "source-a", "source-b"),
    },
    {
      discoveryId: "g0000-r0001:2",
      callId: "g0000-r0001",
      discovery: edge(catalog, "source-b", "source-a"),
    },
  ]
}

const numericEvidence = z
  .object({
    basis: z.enum(["transcript", "metadata"]),
    refs: z.array(z.number()),
  })
  .strict()
const handoffWire = z
  .object({
    source: z.object({ ref: z.number() }).passthrough(),
    discoveries: z.array(
      z
        .object({
          discoveryId: z.string(),
          source: z.number(),
          target: z.number(),
          sourceVideoId: z.string(),
          targetVideoId: z.string(),
          connection: z.string(),
          watchingValue: z.string(),
          sourceEvidence: numericEvidence,
          targetEvidence: numericEvidence,
        })
        .strict(),
    ),
    evidenceLookup: z
      .object({
        spans: z.array(
          z
            .object({
              ref: z.number(),
              video: z.number(),
              chunkId: z.string(),
              text: z.string().optional(),
              sourceSpanRef: z.number().optional(),
            })
            .strict(),
        ),
        metadata: z.array(
          z
            .object({
              ref: z.number(),
              video: z.number(),
              field: z.string(),
              value: z.string().optional(),
              sourceMetadataRef: z.number().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .passthrough()

function verifyLossless(
  catalog: SharedCatalog,
  source: number,
  discoveries: SharedDiscovery[],
) {
  const raw = JSON.parse(
    renderSharedRanking(catalog, source, discoveries),
  ) as unknown
  const wire = handoffWire.parse(raw)
  expect(wire.source).toEqual(catalog.entries[source])
  expect(wire.discoveries.map((d) => d.discoveryId)).toEqual(
    discoveries.map((d) => d.discoveryId),
  )
  const expanded = wire.discoveries.map((d, index) => {
    const original = discoveries[index].discovery
    expect([
      d.source,
      d.target,
      d.connection,
      d.watchingValue,
      d.sourceEvidence,
      d.targetEvidence,
    ]).toEqual([
      original.source,
      original.target,
      original.relation,
      original.value,
      original.sourceEvidence,
      original.targetEvidence,
    ])
    function evidence(
      video: number,
      evidence: z.output<typeof numericEvidence>,
    ) {
      if (evidence.basis === "transcript")
        return {
          basis: "transcript",
          passages: evidence.refs.map((ref) => {
            const matches = wire.evidenceLookup.spans.filter(
              (span) => span.ref === ref,
            )
            expect(matches).toHaveLength(1)
            const span = matches[0]
            expect(span.video).toBe(video)
            if (span.sourceSpanRef !== undefined) {
              expect(span.sourceSpanRef).toBe(ref)
              expect(span.video).toBe(source)
              expect(span.text).toBeUndefined()
              const chunk = catalog.entries[source].chunks.find(
                (chunk) => chunk.id === span.chunkId,
              )!
              const original = chunk.spans.find(
                (item) => item.ref === span.sourceSpanRef,
              )!
              expect(original).toBeDefined()
              return { chunkId: span.chunkId, excerpt: original.text }
            }
            expect(typeof span.text).toBe("string")
            return { chunkId: span.chunkId, excerpt: span.text }
          }),
        }
      return {
        basis: "metadata",
        fields: evidence.refs.map((ref) => {
          const matches = wire.evidenceLookup.metadata.filter(
            (field) => field.ref === ref,
          )
          expect(matches).toHaveLength(1)
          const field = matches[0]
          expect(field.video).toBe(video)
          if (field.sourceMetadataRef !== undefined) {
            expect(field.sourceMetadataRef).toBe(ref)
            expect(field.video).toBe(source)
            expect(field.value).toBeUndefined()
            const metadata = catalog.entries[source].metadataRefs.find(
              (item) => item.ref === ref,
            )!
            expect(metadata.field).toBe(field.field)
            const value = catalog.entries[source].video[metadata.field]
            return {
              field: field.field,
              value:
                metadata.index === null
                  ? value
                  : z.array(z.string()).parse(value)[metadata.index],
            }
          }
          expect(typeof field.value).toBe("string")
          return { field: field.field, value: field.value }
        }),
      }
    }
    return {
      discoveryId: d.discoveryId,
      sourceVideoId: d.sourceVideoId,
      targetVideoId: d.targetVideoId,
      connection: d.connection,
      watchingValue: d.watchingValue,
      sourceEvidence: evidence(d.source, d.sourceEvidence),
      targetEvidence: evidence(d.target, d.targetEvidence),
    }
  })
  expect(expanded).toEqual(
    discoveries.map((item) => ({
      discoveryId: item.discoveryId,
      ...expandCompactDiscovery(catalog, item.discovery),
    })),
  )
  for (const basis of ["transcript", "metadata"] as const) {
    const refs = discoveries
      .flatMap((item) => [
        item.discovery.sourceEvidence,
        item.discovery.targetEvidence,
      ])
      .filter((e) => e.basis === basis)
      .flatMap((e) => e.refs)
    const actual = (
      basis === "transcript"
        ? wire.evidenceLookup.spans
        : wire.evidenceLookup.metadata
    ).map((item) => item.ref)
    expect(actual).toEqual([...new Set(refs)].sort((a, b) => a - b))
  }
  return wire
}

describe("independent lossless ranking handoff boundaries", () => {
  it("reuses complete reading trees without dispatching/copying reads and accounts parent plus child physical origins once", async () => {
    const parent = await parentFixture(),
      before = await inventory(parent.runDirectory)
    const admission = await prepareSharedReadingReuse(parent)
    expect(admission.readings.size).toBe(3)
    const child = await directory(),
      pools: Array<z.output<typeof handoffWire>> = []
    let calls = 0
    const model: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        const decision = await reserve()
        if (decision.kind === "skip")
          return { kind: "skipped", reservation: decision.reservation }
        calls++
        const payload = handoffWire.parse(JSON.parse(request.prompt))
        pools.push(payload)
        expect(payload.discoveries.map((item) => item.connection)).toEqual(
          [
            parent.discoveries[0],
            parent.discoveries[2],
            parent.discoveries[4],
            parent.discoveries[1],
            parent.discoveries[3],
          ].map((item) => item.discovery.relation),
        )
        const first = payload.discoveries.find(
          (item) => item.targetVideoId === "target-alpha",
        )!
        const output = {
          recommendations: [
            {
              discoveryId: first.discoveryId,
              rank: 1,
              connection:
                "This full recommendation explains the carried distinction between repair and confidence.",
              watchingValue:
                "The viewer sees another response without an unsupported promise of immediate reconciliation.",
            },
          ],
          fewerThanFiveReason:
            "This fixture intentionally chooses one strongly supported directional connection.",
        }
        return {
          kind: "dispatched",
          reservation: decision.reservation,
          response: {
            output: request.schema.parse(output),
            usage: {
              inputTokens: 201,
              outputTokens: 21,
              cachedInputTokens: 5,
              reasoningTokens: 4,
            },
          },
        }
      },
    }
    const input = {
      corpus: parent.corpus,
      plan: admission.plan,
      runDirectory: child,
      model,
      countTokens: parent.countTokens,
      executionManifest: { test: "new independent child admission" },
    }
    const result = await runSharedReading(input)
    expect(calls).toBe(1)
    expect(pools[0].discoveries).toHaveLength(5)
    expect(result.sources[0].recommendations[0].targetEvidence).toEqual(
      expandCompactDiscovery(parent.catalog, parent.discoveries[0].discovery)
        .targetEvidence,
    )
    expect(
      (await readdir(join(child, "calls"))).every((id) =>
        id.includes("-rank-"),
      ),
    ).toBe(true)
    const summary = await summarizeSharedUsage(child)
    expect(summary).toMatchObject({
      knownPhysicalCalls: 4,
      newKnownPhysicalCalls: 1,
      parentKnownPhysicalCalls: 3,
      importedReadingPhysicalCalls: 3,
      unknownConsumptionCalls: 0,
      inputTokens: 504,
      outputTokens: 54,
      cachedInputTokens: 14,
      reasoningTokens: 10,
      newUsage: {
        inputTokens: 201,
        outputTokens: 21,
        cachedInputTokens: 5,
        reasoningTokens: 4,
      },
      parentUsage: {
        inputTokens: 303,
        outputTokens: 33,
        cachedInputTokens: 9,
        reasoningTokens: 6,
      },
    })
    expect(new Set(summary.origins).size).toBe(4)
    expect(await runSharedReading(input)).toEqual(result)
    expect(calls).toBe(1)
    expect(await inventory(parent.runDirectory)).toEqual(before)
    await expect(
      prepareSharedReadingReuse({
        corpus: parent.corpus,
        countTokens: parent.countTokens,
        readingReuse: {
          parentRunDirectory: child,
          parentManifestSha256: sha256(
            await readFile(join(child, "manifest.json")),
          ),
        },
      }),
    ).rejects.toThrow("reuse_parent_invalid")
  })

  it("rejects changed parent reading evidence/usage and post-admission provenance before any child dispatch", async () => {
    const parent = await parentFixture()
    const admission = await prepareSharedReadingReuse(parent)
    const receiptPath = join(
      parent.runDirectory,
      "calls",
      "g0000-r0000",
      "a0000",
      "receipt.json",
    )
    const bytes = await readFile(receiptPath),
      receipt = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>
    await writeFile(
      receiptPath,
      JSON.stringify({
        ...receipt,
        usage: { inputTokens: 0, outputTokens: 0 },
      }) + "\n",
    )
    await expect(prepareSharedReadingReuse(parent)).rejects.toThrow()
    let calls = 0
    const model: ReservationAwareStructuredModel = {
      async generateReserved() {
        calls++
        throw new Error("Must fail before transport")
      },
    }
    await expect(
      runSharedReading({
        corpus: parent.corpus,
        plan: admission.plan,
        runDirectory: await directory(),
        countTokens: parent.countTokens,
        model,
        executionManifest: {},
      }),
    ).rejects.toThrow()
    expect(calls).toBe(0)
    await writeFile(receiptPath, bytes)
    for (const change of [
      { origin: "0".repeat(64) },
      { status: "failed", consumptionUnknown: false },
      { status: "failed", consumptionUnknown: true },
    ]) {
      await writeFile(
        receiptPath,
        JSON.stringify({ ...receipt, ...change }) + "\n",
      )
      await expect(prepareSharedReadingReuse(parent)).rejects.toThrow()
    }
    await rm(receiptPath)
    await expect(prepareSharedReadingReuse(parent)).rejects.toThrow()
    await writeFile(receiptPath, bytes)
    const referencePath = join(parent.runDirectory, "references.json"),
      references = await readFile(referencePath)
    await writeFile(referencePath, "{}\n")
    await expect(prepareSharedReadingReuse(parent)).rejects.toThrow(
      "reuse_corpus_changed",
    )
    await writeFile(referencePath, references)
    await writeFile(join(parent.runDirectory, "producer.lock"), "active")
    await expect(prepareSharedReadingReuse(parent)).rejects.toThrow(
      "reuse_parent_active",
    )
  })

  it("keeps historical unknown ranking consumption explicit while reusing only known successful reading origins", async () => {
    const parent = await parentFixture("unknown"),
      before = await inventory(parent.runDirectory)
    const admission = await prepareSharedReadingReuse(parent),
      child = await directory()
    let calls = 0
    const model: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        const decision = await reserve()
        if (decision.kind === "skip")
          return { kind: "skipped", reservation: decision.reservation }
        calls++
        handoffWire.parse(JSON.parse(request.prompt))
        return {
          kind: "dispatched",
          reservation: decision.reservation,
          response: {
            output: request.schema.parse({
              recommendations: [],
              fewerThanFiveReason:
                "The fixture returns no additional justified final connections.",
            }),
            usage: { inputTokens: 201, outputTokens: 21 },
          },
        }
      },
    }
    await runSharedReading({
      corpus: parent.corpus,
      plan: admission.plan,
      runDirectory: child,
      model,
      countTokens: parent.countTokens,
      executionManifest: {
        test: "explicitly admitted child after historical rank unknown",
      },
    })
    const summary = await summarizeSharedUsage(child)
    expect(calls).toBe(1)
    expect(summary).toMatchObject({
      knownPhysicalCalls: 4,
      unknownConsumptionCalls: 1,
      importedReadingPhysicalCalls: 3,
      inputTokens: 504,
      outputTokens: 54,
    })
    expect(summary.unknownOrigins).toHaveLength(1)
    expect(new Set(summary.origins).size).toBe(5)
    expect(admission.plan.readingReuse?.readingOrigins).not.toContain(
      summary.unknownOrigins[0],
    )
    expect(await inventory(parent.runDirectory)).toEqual(before)
  })

  it("rejects tampered historical ranking receipts during offline admission rather than after spending child calls", async () => {
    const parent = await parentFixture("unknown")
    const calls = await readdir(join(parent.runDirectory, "calls")),
      rank = calls.find((id) => id.includes("-rank-"))!
    const path = join(
        parent.runDirectory,
        "calls",
        rank,
        "a0000",
        "receipt.json",
      ),
      receipt = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >
    await writeFile(
      path,
      JSON.stringify({
        ...receipt,
        modelVersion: "tampered-history-identity",
      }) + "\n",
    )
    await expect(prepareSharedReadingReuse(parent)).rejects.toThrow()
  })
  it("roundtrips every parent/child note and exact owner/chunk/field association through the exported compact renderer", () => {
    const catalog = buildSharedCatalog(fixture()),
      source = ref(catalog, "source-a")
    const discoveries = pool(catalog).filter(
      (item) => item.discovery.source === source,
    )
    const wire = verifyLossless(catalog, source, discoveries)
    expect(wire.discoveries).toHaveLength(5)
    expect(
      wire.discoveries.filter((item) => item.targetVideoId === "target-alpha"),
    ).toHaveLength(2)
    expect(
      wire.evidenceLookup.spans.filter((span) => span.video === source),
    ).toHaveLength(1)
    expect(
      wire.evidenceLookup.spans.filter((span) => span.text === common),
    ).toHaveLength(6)
    expect(
      wire.evidenceLookup.metadata.filter(
        (field) => field.value === metadataValue,
      ),
    ).toHaveLength(2)
    expect(() =>
      renderSharedRanking(catalog, source, [discoveries[0], discoveries[0]]),
    ).toThrow("ranking_pool_invalid")
    expect(() =>
      renderSharedRanking(catalog, source, [pool(catalog).at(-1)!]),
    ).toThrow("ranking_pool_invalid")
  })
  it("resolves a complete metadata-only source through explicit source field aliases without inventing dialogue", () => {
    const catalog = buildSharedCatalog(fixture()),
      source = ref(catalog, "target-metadata"),
      target = ref(catalog, "source-a")
    const fields = catalog.metadata.filter(
      (field) =>
        field.video === source &&
        ["title", "description"].includes(field.field),
    )
    const targetSpan = catalog.spans.find((span) => span.video === target)!
    const discoveries: SharedDiscovery[] = [
      {
        discoveryId: "g0000-r0000:0",
        callId: "g0000-r0000",
        discovery: {
          source,
          target,
          relation:
            "Metadata lists this subject; it does not establish any unseen dialogue.",
          value:
            "The next film provides an explicit discussion beyond this source's listed metadata.",
          sourceEvidence: {
            basis: "metadata",
            refs: fields.map((field) => field.ref),
          },
          targetEvidence: { basis: "transcript", refs: [targetSpan.ref] },
        },
      },
    ]
    const wire = verifyLossless(catalog, source, discoveries)
    expect(catalog.entries[source].chunks).toEqual([])
    expect(wire.evidenceLookup.metadata).toHaveLength(2)
    expect(
      wire.evidenceLookup.metadata.every(
        (field) =>
          field.sourceMetadataRef === field.ref && field.value === undefined,
      ),
    ).toBe(true)
  })
  it("keeps equal excerpts associated with each original owner and chunk, including repeated parent/child edges", () => {
    const corpus = fixture(),
      catalog = buildSharedCatalog(corpus),
      discoveries = pool(catalog)
    const expanded = discoveries.map((item) => ({
      discoveryId: item.discoveryId,
      ...expandCompactDiscovery(catalog, item.discovery),
    }))
    expect(expanded).toHaveLength(6)
    expect(expanded.map((item) => item.discoveryId)).toEqual(
      discoveries.map((item) => item.discoveryId),
    )
    expect(
      expanded.map((item) => [item.connection, item.watchingValue]),
    ).toEqual(
      discoveries.map((item) => [
        item.discovery.relation,
        item.discovery.value,
      ]),
    )
    expect(expanded[0].targetEvidence).toEqual({
      basis: "transcript",
      passages: [
        { chunkId: "target-alpha-chunk-1", excerpt: common },
        { chunkId: "target-alpha-chunk-0", excerpt: common },
      ],
    })
    expect(expanded[1].targetEvidence).toEqual({
      basis: "transcript",
      passages: [
        { chunkId: "target-beta-chunk-1", excerpt: common },
        { chunkId: "target-beta-chunk-0", excerpt: common },
      ],
    })
    expect(expanded[2].targetEvidence).toEqual(expanded[0].targetEvidence)
    expect(expanded[2].connection).not.toBe(expanded[0].connection)
    expect(expanded[2].watchingValue).not.toBe(expanded[0].watchingValue)
    expect(expanded[3].targetEvidence).toEqual({
      basis: "metadata",
      fields: [
        { field: "description", value: metadataValue },
        { field: "title", value: metadataValue },
      ],
    })
    expect(
      expanded.slice(4).map((item) => [item.sourceVideoId, item.targetVideoId]),
    ).toEqual([
      ["source-a", "source-b"],
      ["source-b", "source-a"],
    ])
    for (const entry of catalog.entries)
      for (const chunk of entry.chunks) {
        const original = corpus.entries
          .find((original) => original.video.id === entry.video.id)!
          .chunks.find((original) => original.id === chunk.id)!
        expect(chunk.spans.map((span) => span.text).join("")).toBe(
          original.text,
        )
      }
  })

  it("rejects foreign equal-text references instead of treating matching words as ownership proof", () => {
    const catalog = buildSharedCatalog(fixture()),
      source = ref(catalog, "source-a"),
      target = ref(catalog, "target-alpha")
    const sourceSpan = catalog.spans.find((span) => span.video === source)!,
      targetSpan = catalog.spans.find((span) => span.video === target)!
    expect(sourceSpan.text).toBe(targetSpan.text)
    expect(() =>
      expandCompactEvidence(catalog, target, {
        basis: "transcript",
        refs: [sourceSpan.ref],
      }),
    ).toThrow("span_reference_invalid")
    const sourceField = catalog.metadata.find(
        (field) => field.video === source && field.field === "title",
      )!,
      targetField = catalog.metadata.find(
        (field) => field.video === target && field.field === "title",
      )!
    expect(sourceField.value).toBe(targetField.value)
    expect(() =>
      expandCompactEvidence(catalog, target, {
        basis: "metadata",
        refs: [sourceField.ref],
      }),
    ).toThrow("metadata_reference_invalid")
    expect(() =>
      expandCompactEvidence(catalog, target, {
        basis: "transcript",
        refs: [targetSpan.ref, targetSpan.ref],
      }),
    ).toThrow("duplicate_evidence_ref")
    const metadataOnly = ref(catalog, "target-metadata")
    expect(catalog.entries[metadataOnly].chunks).toEqual([])
    expect(() =>
      expandCompactEvidence(catalog, metadataOnly, {
        basis: "transcript",
        refs: [sourceSpan.ref],
      }),
    ).toThrow("span_reference_invalid")
  })
})

const phaseWire = z.object({ stage: z.string() }).passthrough()
const selectionWire = z
  .object({
    source: z.unknown(),
    targetIdentities: z.array(
      z
        .object({ ref: z.number(), videoId: z.string(), title: z.string() })
        .passthrough(),
    ),
    discoveries: z.array(z.object({ discoveryId: z.string() }).passthrough()),
  })
  .passthrough()
const finalizationWire = z
  .object({
    source: z.unknown(),
    discoveries: z.array(
      z
        .object({
          discoveryId: z.string(),
          targetVideoId: z.string(),
          sourceEvidence: z.unknown(),
          targetEvidence: z.unknown(),
        })
        .passthrough(),
    ),
  })
  .passthrough()
const shortfall =
  "Only these distinct choices are supported in this deliberately small evidence fixture."
function finalChoice(discoveryId: string, rank = 1) {
  return {
    discoveryId,
    rank,
    connection:
      "The supplied description offers a distinct perspective on rebuilding confidence after harm.",
    watchingValue:
      "Its explicit metadata gives a reason to explore that perspective without claiming unseen dialogue.",
  }
}

async function fallbackFixture(
  options: {
    fit?: boolean
    overflow?: "global-final-selection" | "selected-evidence-finalization"
    fault?: "pause" | "unknown" | "known"
    mutate?: (stage: string, output: unknown) => unknown
  } = {},
) {
  const parent = await parentFixture()
  const countTokens = async (text: string) => {
    const outer = z
      .object({ untrustedCatalogData: z.string() })
      .safeParse(JSON.parse(text))
    if (!outer.success) return 100
    const stage = phaseWire.safeParse(
      JSON.parse(outer.data.untrustedCatalogData),
    )
    return stage.success &&
      ((!options.fit && stage.data.stage === "global-evidence-ranking") ||
        stage.data.stage === options.overflow)
      ? 10000
      : 100
  }
  const admission = await prepareSharedReadingReuse({ ...parent, countTokens })
  const child = await directory()
  const dispatched: Array<{ stage: string; prompt: string; system: string }> =
    []
  let fault = options.fault
  const model: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      const payload = phaseWire.parse(JSON.parse(request.prompt))
      if (
        payload.stage === "selected-evidence-finalization" &&
        fault === "pause"
      ) {
        fault = undefined
        throw new CodexSubscriptionAstraError("allowance_insufficient")
      }
      const decision = await reserve()
      if (decision.kind === "skip")
        return { kind: "skipped", reservation: decision.reservation }
      dispatched.push({
        stage: payload.stage,
        prompt: request.prompt,
        system: request.system,
      })
      if (payload.stage === "selected-evidence-finalization" && fault) {
        const known = fault === "known"
        fault = undefined
        throw new CodexSubscriptionAstraError("provider_unavailable", {
          consumptionUnknown: !known,
          ...(known ? { usage: { inputTokens: 211, outputTokens: 31 } } : {}),
        })
      }
      let output: unknown
      if (payload.stage === "global-final-selection") {
        const wire = selectionWire.parse(payload)
        // The last batch's metadata-only target wins ahead of the first parent's target.
        output = {
          recommendations: [wire.discoveries.at(-1)!, wire.discoveries[0]].map(
            (d, index) => ({ discoveryId: d.discoveryId, rank: index + 1 }),
          ),
          fewerThanFiveReason: shortfall,
        }
      } else if (payload.stage === "selected-evidence-finalization") {
        const wire = finalizationWire.parse(payload)
        output = {
          recommendations: [finalChoice(wire.discoveries[0].discoveryId)],
          rejected: [
            {
              discoveryId: wire.discoveries[1].discoveryId,
              reason:
                "The cited repair passage does not establish this proposed restoration of confidence.",
            },
          ],
          fewerThanFiveReason: shortfall,
        }
      } else {
        const wire = handoffWire.parse(payload)
        output = {
          recommendations: [finalChoice(wire.discoveries[0].discoveryId)],
          fewerThanFiveReason: shortfall,
        }
      }
      return {
        kind: "dispatched",
        reservation: decision.reservation,
        response: {
          output: request.schema.parse(
            options.mutate ? options.mutate(payload.stage, output) : output,
          ),
          usage: {
            inputTokens: 211,
            outputTokens: 31,
            cachedInputTokens: 7,
            reasoningTokens: 3,
          },
        },
      }
    },
  }
  const input = {
    corpus: parent.corpus,
    plan: admission.plan,
    runDirectory: child,
    countTokens,
    model,
    executionManifest: { test: "independent measured fallback" },
  }
  return {
    parent,
    child,
    input,
    dispatched,
    run: () => runSharedReading(input),
  }
}

describe("independent measured global selection and evidence finalization", () => {
  it("retains every original parent/child note and pointer and supplies exact selected evidence with complete source", () => {
    const catalog = buildSharedCatalog(fixture()),
      source = ref(catalog, "source-a")
    const discoveries = pool(catalog).filter(
      (d) => d.discovery.source === source,
    )
    const wire = selectionWire.parse(
      JSON.parse(renderSharedSelection(catalog, source, discoveries)),
    )
    expect(wire.source).toEqual(catalog.entries[source])
    expect(wire.discoveries).toEqual(
      discoveries.map((d) => ({ discoveryId: d.discoveryId, ...d.discovery })),
    )
    expect(wire.targetIdentities.map((v) => v.videoId).sort()).toEqual([
      "source-b",
      "target-alpha",
      "target-beta",
      "target-metadata",
    ])
    for (const video of wire.targetIdentities) {
      expect(video.title).toBe(catalog.entries[video.ref].video.title)
    }
    expect(wire).not.toHaveProperty("evidenceLookup")
    const chosen = [discoveries.at(-1)!, discoveries[3]],
      selection = {
        recommendations: chosen.map((d, index) => ({
          discoveryId: d.discoveryId,
          rank: index + 1,
        })),
        fewerThanFiveReason: shortfall,
      }
    const finalized = finalizationWire.parse(
      JSON.parse(renderSharedFinalization(catalog, source, chosen, selection)),
    )
    expect(finalized.source).toEqual(catalog.entries[source])
    expect(finalized.discoveries).toEqual(
      chosen.map((d) => ({
        discoveryId: d.discoveryId,
        ...expandCompactDiscovery(catalog, d.discovery),
      })),
    )
    expect(finalized.discoveries[1].targetEvidence).toEqual(
      expandCompactEvidence(
        catalog,
        ref(catalog, "target-metadata"),
        discoveries[3].discovery.targetEvidence,
      ),
    )
    expect(SHARED_SELECTION_SYSTEM).toContain("NOT present")
    expect(SHARED_FINALIZATION_SYSTEM).toContain("no memory")
  })

  it("uses one evidence-rich call when admitted and never reserves selection/finalization", async () => {
    const f = await fallbackFixture({ fit: true })
    const result = await f.run()
    expect(f.dispatched.map((d) => d.stage)).toEqual([
      "global-evidence-ranking",
    ])
    expect(result.sources[0].finalization?.mode).toBe("global-evidence")
    expect(await readdir(join(f.child, "calls"))).toEqual(["g0000-rank-0"])
    expect(await summarizeSharedUsage(f.child)).toMatchObject({
      knownPhysicalCalls: 4,
      newKnownPhysicalCalls: 1,
      importedReadingPhysicalCalls: 3,
    })
  })

  it("selects a late-batch winner jointly, explicitly rejects unsupported evidence and preserves unique physical identities", async () => {
    const f = await fallbackFixture(),
      before = await inventory(f.parent.runDirectory)
    const result = await f.run()
    expect(f.dispatched.map((d) => d.stage)).toEqual([
      "global-final-selection",
      "selected-evidence-finalization",
    ])
    const wire = selectionWire.parse(JSON.parse(f.dispatched[0].prompt))
    expect(wire.discoveries).toHaveLength(5)
    expect(wire.discoveries.map((d) => d.relation)).toEqual(
      [
        f.parent.discoveries[0],
        f.parent.discoveries[2],
        f.parent.discoveries[4],
        f.parent.discoveries[1],
        f.parent.discoveries[3],
      ].map((d) => d.discovery.relation),
    )
    const final = finalizationWire.parse(JSON.parse(f.dispatched[1].prompt))
    expect(final.discoveries.map((d) => d.targetVideoId)).toEqual([
      "target-metadata",
      "target-alpha",
    ])
    const source = result.sources[0]
    expect(
      source.recommendations.map((d) => [d.rank, d.targetVideoId]),
    ).toEqual([[1, "target-metadata"]])
    expect(source.recommendations[0].targetEvidence).toEqual(
      expandCompactDiscovery(
        f.parent.catalog,
        f.parent.discoveries[3].discovery,
      ).targetEvidence,
    )
    expect(source.finalization).toMatchObject({
      mode: "global-notes-then-selected-evidence",
      rejectedSelections: [
        {
          targetVideoId: "target-alpha",
          reason: expect.stringContaining("does not establish"),
        },
      ],
    })
    expect(await readdir(join(f.child, "calls"))).toEqual([
      "g0000-rank-0-finalize",
      "g0000-rank-0-select",
    ])
    const summary = await summarizeSharedUsage(f.child)
    expect(summary).toMatchObject({
      knownPhysicalCalls: 5,
      newKnownPhysicalCalls: 2,
      parentKnownPhysicalCalls: 3,
      unknownConsumptionCalls: 0,
      inputTokens: 725,
      outputTokens: 95,
      cachedInputTokens: 23,
      reasoningTokens: 12,
      newUsage: {
        inputTokens: 422,
        outputTokens: 62,
        cachedInputTokens: 14,
        reasoningTokens: 6,
      },
    })
    expect(new Set(summary.origins).size).toBe(5)
    expect(await f.run()).toEqual(result)
    expect(f.dispatched).toHaveLength(2)
    expect(await inventory(f.parent.runDirectory)).toEqual(before)
  })

  it.each([
    "global-final-selection",
    "selected-evidence-finalization",
  ] as const)(
    "refuses oversized %s before that phase's reservation",
    async (stage) => {
      const f = await fallbackFixture({ overflow: stage })
      await expect(f.run()).rejects.toThrow(
        stage === "global-final-selection"
          ? "selection_exceeds_context"
          : "finalization_exceeds_context",
      )
      expect(f.dispatched.map((d) => d.stage)).toEqual(
        stage === "global-final-selection" ? [] : ["global-final-selection"],
      )
      const calls = await readdir(join(f.child, "calls"))
      expect(calls.some((id) => id.endsWith("-finalize"))).toBe(false)
      expect(calls.includes("g0000-rank-0")).toBe(false)
      expect(await summarizeSharedUsage(f.child)).toMatchObject({
        unknownConsumptionCalls: 0,
        newKnownPhysicalCalls: stage === "global-final-selection" ? 0 : 1,
      })
    },
  )

  it("replays known selection after a proven no-dispatch finalizer pause and dispatches only the finalizer", async () => {
    const f = await fallbackFixture({ fault: "pause" })
    await expect(f.run()).rejects.toThrow("allowance_insufficient")
    expect(f.dispatched.map((d) => d.stage)).toEqual(["global-final-selection"])
    expect(await summarizeSharedUsage(f.child)).toMatchObject({
      newKnownPhysicalCalls: 1,
      notDispatchedAttempts: 1,
      unknownConsumptionCalls: 0,
    })
    const selectionPath = join(
        f.child,
        "calls",
        "g0000-rank-0-select",
        "a0000",
        "receipt.json",
      ),
      before = await readFile(selectionPath)
    await f.run()
    expect(f.dispatched.map((d) => d.stage)).toEqual([
      "global-final-selection",
      "selected-evidence-finalization",
    ])
    expect(await readFile(selectionPath)).toEqual(before)
    expect(await summarizeSharedUsage(f.child)).toMatchObject({
      newKnownPhysicalCalls: 2,
      notDispatchedAttempts: 1,
      unknownConsumptionCalls: 0,
    })
  })

  it.each(["unknown", "known"] as const)(
    "blocks direct restart after %s finalization failure without repeating selection or reads",
    async (fault) => {
      const f = await fallbackFixture({ fault })
      await expect(f.run()).rejects.toThrow("provider_unavailable")
      await expect(f.run()).rejects.toThrow("physical_call_not_resumable")
      expect(f.dispatched.map((d) => d.stage)).toEqual([
        "global-final-selection",
        "selected-evidence-finalization",
      ])
      expect(await summarizeSharedUsage(f.child)).toMatchObject({
        newKnownPhysicalCalls: fault === "known" ? 2 : 1,
        unknownConsumptionCalls: fault === "unknown" ? 1 : 0,
      })
    },
  )

  it.each([
    "duplicate-target",
    "rank-gap",
    "unexplained-shortfall",
    "unaccounted-choice",
    "double-accounted-choice",
  ])(
    "rejects %s with known receipt instead of accepting or retrying",
    async (failure) => {
      const f = await fallbackFixture({
        mutate(stage, raw) {
          const output = z
            .object({
              recommendations: z.array(
                z
                  .object({ discoveryId: z.string(), rank: z.number() })
                  .passthrough(),
              ),
              fewerThanFiveReason: z.string().nullable(),
            })
            .passthrough()
            .parse(raw)
          if (stage === "global-final-selection") {
            if (failure === "duplicate-target")
              output.recommendations = [
                output.recommendations[1],
                { ...output.recommendations[1], rank: 2 },
              ]
            if (failure === "rank-gap") output.recommendations[0].rank = 2
            if (failure === "unexplained-shortfall")
              output.fewerThanFiveReason = null
          }
          if (stage === "selected-evidence-finalization") {
            if (failure === "unaccounted-choice") output.rejected = []
            if (failure === "double-accounted-choice")
              output.rejected = [
                {
                  discoveryId: output.recommendations[0].discoveryId,
                  reason:
                    "This choice is also recommended, contradicting exact accounting.",
                },
              ]
          }
          return output
        },
      })
      await expect(f.run()).rejects.toThrow()
      const summary = await summarizeSharedUsage(f.child)
      expect(summary.unknownConsumptionCalls).toBe(0)
      expect(summary.newKnownPhysicalCalls).toBe(
        failure.includes("choice") ? 2 : 1,
      )
      await expect(f.run()).rejects.toThrow("physical_call_not_resumable")
      expect(f.dispatched).toHaveLength(failure.includes("choice") ? 2 : 1)
    },
  )
})

describe("independent actual envelope byte bound", () => {
  it("preserves oversized notes and stops before selection reservation despite a low token estimate", async () => {
    const data = fixture(),
      metadata = data.entries.at(-1)!
    data.entries = [
      data.entries[0],
      ...Array.from({ length: 2400 }, (_, index) => ({
        ...metadata,
        video: {
          ...metadata.video,
          id: `large-target-${index}`,
          coreId: `large-core-${index}`,
          slug: `large-slug-${index}`,
        },
      })),
    ]
    const catalog = buildSharedCatalog(validateCorpus(data)),
      source = ref(catalog, "source-a")
    const countTokens = async () => 100
    const plan = await planSharedReading({
      corpus: data,
      sourceIds: ["source-a"],
      context: budget,
      countTokens,
    })
    const runDirectory = await directory()
    let reads = 0
    const model: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        const wire = z
          .object({
            sources: z.array(z.object({ ref: z.number() }).passthrough()),
            targets: z.array(z.object({ ref: z.number() }).passthrough()),
          })
          .parse(JSON.parse(request.prompt))
        const decision = await reserve()
        if (decision.kind === "skip")
          return { kind: "skipped", reservation: decision.reservation }
        reads++
        return {
          kind: "dispatched",
          reservation: decision.reservation,
          response: {
            output: request.schema.parse({
              sources: wire.sources.map((s) => s.ref),
              targets: wire.targets.map((t) => t.ref),
              complete: true,
              notes:
                "All supplied complete metadata considered without dropping any worthwhile fixture connection.",
              discoveries: wire.targets
                .filter((t) => t.ref !== source)
                .map((t) => ({
                  ...edge(
                    catalog,
                    "source-a",
                    catalog.corpus.entries[t.ref].video.id,
                  ),
                  relation: (
                    "Repair and confidence offer a distinct metadata perspective. " +
                    "Preserve this original interpreted nuance. ".repeat(12)
                  ).slice(0, 400),
                  value: (
                    "Explore another perspective without claiming unseen dialogue. " +
                    "Keep this complete watching-value note. ".repeat(12)
                  ).slice(0, 400),
                })),
            }),
            usage: { inputTokens: 101, outputTokens: 11 },
          },
        }
      },
    }
    await expect(
      runSharedReading({
        corpus: data,
        plan,
        runDirectory,
        model,
        countTokens,
        executionManifest: { test: "actual bytes, low token counter" },
      }),
    ).rejects.toThrow("selection_exceeds_context")
    expect(reads).toBe(plan.groups[0].readings.length)
    expect(
      (await readdir(join(runDirectory, "calls"))).every(
        (id) => !id.includes("-rank-"),
      ),
    ).toBe(true)
    const coverage = JSON.parse(
      await readFile(
        join(runDirectory, "groups", "g0000", "coverage.json"),
        "utf8",
      ),
    ) as { discoveries: SharedDiscovery[] }
    expect(coverage.discoveries).toHaveLength(2400)
    const prompt = renderSharedSelection(catalog, source, coverage.discoveries)
    const outer = JSON.stringify({
      instructions: SHARED_SELECTION_SYSTEM,
      untrustedCatalogData: prompt,
      response:
        "Return only the JSON object required by the provided output schema. Do not call tools.",
    })
    expect(Buffer.byteLength(outer)).toBeGreaterThan(2000000)
    expect(selectionWire.parse(JSON.parse(prompt)).discoveries).toEqual(
      coverage.discoveries.map((d) => ({
        discoveryId: d.discoveryId,
        ...d.discovery,
      })),
    )
    expect(await summarizeSharedUsage(runDirectory)).toMatchObject({
      knownPhysicalCalls: reads,
      unknownConsumptionCalls: 0,
    })
  })
})
