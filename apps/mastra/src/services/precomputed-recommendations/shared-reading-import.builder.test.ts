import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { sha256, validateCorpus, type ContextBudget } from "./full-library-v1"
import {
  buildSharedCatalog,
  planSharedReading,
  prepareSharedReadingReuse,
  runSharedReading,
} from "./shared-reading-v1"
import type { ReservationAwareStructuredModel } from "./codex-subscription-astra"
import { prepareSharedReadingImport } from "./shared-reading-import"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})
const counter = async (text: string) => Math.ceil(Buffer.byteLength(text) / 100)
const context: ContextBudget = {
  modelId: "gpt-6-astra",
  modelVersion: "fake",
  contextWindowTokens: 10000,
  effectiveContextTokens: 10000,
  autoCompactLimitTokens: 10000,
  outputReserveTokens: 1000,
  overheadReserveTokens: 100,
  tokenizer: "fake bytes/100",
  contextEvidence: "synthetic tests only",
}
async function fixture(partial = false) {
  const root = await mkdtemp(join(tmpdir(), "private-shared-import-"))
  roots.push(root)
  const corpus = validateCorpus({
    observedAt: "2026-10-19T00:00:00Z",
    entries: ["a", "b", "metadata"].map((id) => ({
      video: {
        id,
        coreId: id,
        slug: id,
        locale: "en",
        title: `Distinct complete ${id}`,
        description: `Original <literal> description ${id}`,
        descriptionTruncated: false,
        keywords: [],
        keywordsTruncated: false,
        bibleCitations: [],
        bibleCitationsTruncated: false,
        parentVideoIds: [],
        childVideoIds: [],
        transcriptLanguages: id === "metadata" ? [] : ["en"],
        transcriptSelection: {
          policy: "english-per-edition-with-complete-fallback-v1",
          availableTranscriptCount: id === "metadata" ? 0 : 1,
          incompleteTranscriptCount: 0,
          skippedEditionCount: 0,
          selected:
            id === "metadata"
              ? []
              : [
                  {
                    transcriptId: id + "-t",
                    videoEditionId: id + "-edition",
                    language: "en",
                    totalChunks: 1,
                  },
                ],
        },
      },
      chunks:
        id === "metadata"
          ? []
          : [
              {
                id: "subtitle-" + id,
                transcriptId: id + "-t",
                language: "en",
                chunkIndex: 0,
                text: `${id} exact words and a sufficiently detailed account. `.repeat(
                  45,
                ),
              },
            ],
    })),
  })
  const catalog = buildSharedCatalog(corpus)
  let partialPending = partial
  const model: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      const reserved = await reserve()
      if (reserved.kind === "skip")
        return { kind: "skipped", reservation: reserved.reservation }
      const p = JSON.parse(request.prompt) as {
        sources?: Array<{ ref: number }>
        targets?: Array<{ ref: number }>
        discoveries?: Array<{ discoveryId: string; target: number }>
      }
      const support = (ref: number) =>
        catalog.entries[ref].chunks.length
          ? {
              basis: "transcript",
              refs: catalog.entries[ref].chunks[0].spans
                .slice(0, 5)
                .map((s) => s.ref),
            }
          : {
              basis: "metadata",
              refs: [catalog.entries[ref].metadataRefs[1].ref],
            }
      const incomplete = !!p.targets && partialPending
      if (p.targets) partialPending = false
      const seen = new Set<number>()
      const output = p.targets
        ? {
            sources: p.sources!.map((s) => s.ref),
            targets: p.targets.map((t) => t.ref),
            complete: !incomplete,
            notes: "Complete synthetic coverage.",
            discoveries: p.targets
              .filter((t) => t.ref !== 0)
              .map((t) => ({
                source: 0,
                target: t.ref,
                relation: "A concrete directional relation.",
                value: "A concrete additional watching value.",
                sourceEvidence: support(0),
                targetEvidence: support(t.ref),
              })),
          }
        : {
            recommendations: p
              .discoveries!.filter((d) => {
                if (seen.has(d.target)) return false
                seen.add(d.target)
                return true
              })
              .map((d, i) => ({
                discoveryId: d.discoveryId,
                rank: i + 1,
                connection: "Complete explanation longer than legacy. ".repeat(
                  25,
                ),
                watchingValue: "Complete additional viewing value. ".repeat(25),
              })),
            fewerThanFiveReason:
              "Only two meaningful targets in this synthetic corpus.",
          }
      return {
        kind: "dispatched",
        reservation: reserved.reservation,
        response: {
          output: request.schema.parse(output),
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            cachedInputTokens: 5,
            reasoningTokens: 2,
          },
        },
      }
    },
  }
  const plan = await planSharedReading({
    corpus,
    sourceIds: ["a"],
    context,
    countTokens: counter,
  })
  const directory = join(root, "run")
  const executionManifest = {
    authMethod: "chatgpt",
    billingBasis: "included_subscription",
  }
  await runSharedReading({
    corpus,
    plan,
    runDirectory: directory,
    countTokens: counter,
    model,
    executionManifest,
  })
  const corpusPath = join(root, "corpus.json")
  await writeFile(corpusPath, JSON.stringify(corpus))
  async function configFor(path = directory) {
    return {
      generationId: "private-fixture",
      scope: "private_pilot",
      corpusPath,
      corpusSha256: sha256(await readFile(corpusPath)),
      sourceIds: ["a"],
      runs: [
        {
          directory: path,
          manifestSha256: sha256(await readFile(join(path, "manifest.json"))),
          resultSha256: sha256(
            await readFile(join(path, "recommendations.json")),
          ),
        },
      ],
    }
  }
  return { root, directory, corpus, model, executionManifest, configFor }
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) Object.assign(result, await snapshot(path))
    else result[path] = sha256(await readFile(path))
  }
  return result
}
describe("completed shared-reading private exporter", () => {
  it("preserves long text, five passages, both sides and exact metadata without writes", async () => {
    const f = await fixture(),
      before = await snapshot(f.root)
    const result = await prepareSharedReadingImport(await f.configFor())
    expect(result.summary).toMatchObject({
      sources: 1,
      eligibleTargetsPerSource: 3,
      recommendations: 2,
      physicalCalls: 2,
      inputTokens: 200,
      outputTokens: 20,
      unknownCalls: 0,
    })
    const source = result.submissions.find((s) => "source" in s)?.source
    expect(source!.recommendations[0].connection.length).toBeGreaterThan(600)
    expect(source!.recommendations[0].sourceEvidence).toMatchObject({
      basis: "transcript",
      passages: expect.arrayContaining([
        expect.objectContaining({ chunkId: "subtitle-a" }),
      ]),
    })
    expect(
      source!.recommendations[0].sourceEvidence.basis === "transcript" &&
        source!.recommendations[0].sourceEvidence.passages,
    ).toHaveLength(5)
    expect(source!.recommendations[1].targetEvidence).toEqual({
      basis: "metadata",
      fields: [
        {
          field: "description",
          value: "Original <literal> description metadata",
        },
      ],
    })
    expect(await snapshot(f.root)).toEqual(before)
  })
  it("reconstructs complete split leaves without losing valid partial-parent discoveries", async () => {
    const f = await fixture(true)
    const result = await prepareSharedReadingImport(await f.configFor())
    expect(result.summary).toMatchObject({
      physicalCalls: 4,
      recommendations: 2,
      eligibleTargetsPerSource: 3,
    })
    const payload = result.submissions.find((s) => "source" in s)?.source
    expect(payload!.provenance.selectedDiscoveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ discoveryId: "g0000-r0000:0" }),
        expect.objectContaining({ discoveryId: "g0000-r0000:1" }),
      ]),
    )
  })
  it("counts reused parent reads once and distinct parent/child physical rankings once", async () => {
    const f = await fixture()
    const { plan } = await prepareSharedReadingReuse({
      corpus: f.corpus,
      countTokens: counter,
      readingReuse: {
        parentRunDirectory: f.directory,
        parentManifestSha256: sha256(
          await readFile(join(f.directory, "manifest.json")),
        ),
      },
    })
    const child = join(f.root, "child")
    await runSharedReading({
      corpus: f.corpus,
      plan,
      countTokens: counter,
      runDirectory: child,
      model: f.model,
      executionManifest: f.executionManifest,
    })
    const result = await prepareSharedReadingImport(await f.configFor(child))
    expect(result.summary).toMatchObject({
      physicalCalls: 3,
      inputTokens: 300,
      outputTokens: 30,
    })
    expect(result.manifest.calls.map((c) => c.origin)).toHaveLength(
      new Set(result.manifest.calls.map((c) => c.origin)).size,
    )
  })
  it("retains known failed parent consumption without inventing an output or rereading", async () => {
    const f = await fixture()
    const manifest = JSON.parse(
      await readFile(join(f.directory, "manifest.json"), "utf8"),
    )
    const id = "g0000-rank-0-select",
      path = join(f.directory, "calls", id, "a0000")
    await mkdir(path, { recursive: true })
    const original = join(f.directory, "calls", "g0000-rank-0")
    const request = JSON.parse(
      await readFile(join(original, "request.json"), "utf8"),
    )
    const requestDigest = sha256(JSON.stringify(request))
    await writeFile(join(path, "..", "request.json"), JSON.stringify(request))
    const origin = sha256(JSON.stringify(manifest) + ":" + id + ":a0000")
    const reservation = JSON.parse(
      await readFile(join(original, "a0000", "reservation.json"), "utf8"),
    )
    await writeFile(
      join(path, "reservation.json"),
      JSON.stringify({ ...reservation, origin, requestDigest }),
    )
    await writeFile(
      join(path, "receipt.json"),
      JSON.stringify({
        origin,
        requestDigest,
        modelId: "gpt-6-astra",
        modelVersion: "fake",
        status: "failed",
        reserved: true,
        consumptionUnknown: false,
        usage: {
          inputTokens: 123,
          outputTokens: 4,
          cachedInputTokens: 10,
          reasoningTokens: 2,
        },
        code: "operator_interrupted",
        finishedAt: new Date(
          Date.parse(reservation.startedAt) + 1000,
        ).toISOString(),
      }),
    )
    const { plan } = await prepareSharedReadingReuse({
      corpus: f.corpus,
      countTokens: counter,
      readingReuse: {
        parentRunDirectory: f.directory,
        parentManifestSha256: sha256(
          await readFile(join(f.directory, "manifest.json")),
        ),
      },
    })
    const child = join(f.root, "child")
    await runSharedReading({
      corpus: f.corpus,
      plan,
      countTokens: counter,
      runDirectory: child,
      model: f.model,
      executionManifest: f.executionManifest,
    })
    const result = await prepareSharedReadingImport(await f.configFor(child))
    expect(result.summary).toMatchObject({
      physicalCalls: 4,
      knownFailedCalls: 1,
      inputTokens: 423,
      outputTokens: 34,
      cachedInputTokens: 25,
    })
    const imported = result.submissions.find(
      (s) => "call" in s && s.call.origin === origin,
    )
    expect(imported && "call" in imported && imported.call.status).toBe(
      "failed",
    )
  })
  it.each([
    "partial",
    "tampered-evidence",
    "unknown",
    "missing-receipt",
    "missing-cached",
    "duplicate-source",
    "pilot-as-catalog",
  ])("refuses %s before any import", async (kind) => {
    const f = await fixture(),
      config = await f.configFor()
    if (kind === "partial")
      await rm(join(f.directory, "groups", "g0000", "coverage.json"))
    if (kind === "tampered-evidence") {
      const path = join(f.directory, "recommendations.json"),
        value = JSON.parse(await readFile(path, "utf8"))
      value.sources[0].recommendations[0].sourceEvidence.passages[0].excerpt =
        "Invented words"
      await writeFile(path, JSON.stringify(value))
      config.runs[0].resultSha256 = sha256(await readFile(path))
    }
    if (
      kind === "unknown" ||
      kind === "missing-receipt" ||
      kind === "missing-cached"
    ) {
      const readId = (await readdir(join(f.directory, "calls"))).find(
        (id) => !id.includes("rank"),
      )!
      const path = join(f.directory, "calls", readId, "a0000", "receipt.json")
      if (kind === "missing-receipt") await rm(path)
      else {
        const r = JSON.parse(await readFile(path, "utf8"))
        if (kind === "missing-cached") delete r.usage.cachedInputTokens
        else {
          r.consumptionUnknown = true
          r.usage = null
        }
        await writeFile(path, JSON.stringify(r))
      }
    }
    if (kind === "duplicate-source") config.sourceIds.push("a")
    const raw =
      kind === "pilot-as-catalog"
        ? { ...config, scope: "full_catalog" }
        : config
    await expect(prepareSharedReadingImport(raw)).rejects.toThrow(
      kind === "missing-cached"
        ? "cached_usage_unreported_blocks_import"
        : undefined,
    )
  })
})
