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

import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import {
  CodexSubscriptionAstraError,
  type ReservationAwareStructuredModel,
} from "./codex-subscription-astra"
import { validateCorpus, sha256, type ContextBudget } from "./full-library-v1"
import {
  buildSharedCatalog,
  expandCompactDiscovery,
  expandCompactEvidence,
  planSharedReading,
  runSharedReading,
  renderSharedReading,
  sharedReadingSchema,
  sharedEnvelope,
  SHARED_DISCOVERY_SYSTEM,
  SHARED_RANKING_SYSTEM,
  type CompactDiscovery,
} from "./shared-reading-v1"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  )
})
async function directory() {
  const d = await mkdtemp(join(tmpdir(), "shared-builder-"))
  directories.push(d)
  return d
}
function fixture(n = 7) {
  return validateCorpus({
    snapshot: { inputCutoff: "2026-10-19T00:00:00.000Z" },
    entries: Array.from({ length: n }, (_, i) => {
      const id = "video-" + i
      const texts =
        i === n - 1
          ? []
          : [
              "🙂 Complete original text, including the end. ".repeat(18) +
                "TAIL",
              "The second complete chunk includes the consequences of reconciliation.",
            ]
      return {
        video: {
          id,
          coreId: id,
          slug: id,
          locale: "en",
          title: "Full title " + id,
          description: "Full description of " + id,
          descriptionTruncated: false,
          keywords: ["Exact keyword " + id],
          keywordsTruncated: false,
          bibleCitations: ["John 1:1"],
          bibleCitationsTruncated: false,
          parentVideoIds: ["shared-parent"],
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
                    transcriptId: id + "-t",
                    videoEditionId: id + "-e",
                  },
                ]
              : [],
          },
        },
        chunks: texts.map((text, chunkIndex) => ({
          id: id + "-chunk-" + chunkIndex,
          transcriptId: id + "-t",
          language: "en",
          chunkIndex,
          text,
        })),
      }
    }),
  })
}
const context: ContextBudget = {
  modelId: "gpt-6-astra",
  modelVersion: "fake-known-version",
  contextWindowTokens: 3000,
  effectiveContextTokens: 3000,
  autoCompactLimitTokens: 3000,
  outputReserveTokens: 100,
  overheadReserveTokens: 100,
  tokenizer: "fixture assignment counter",
  contextEvidence: "Test only, no admission",
}
// Deliberately makes requests with four sources and two targets fit, three not fit.
// Component estimates overpack, exercising the final exact measurement guard.
const countTokens = async (text: string) => {
  const outer = JSON.parse(text)
  if (typeof outer.untrustedCatalogData === "string") {
    const p = JSON.parse(outer.untrustedCatalogData)
    return p.targets
      ? 200 + p.sources.length * 350 + p.targets.length * 500
      : 800
  }
  return typeof outer === "string" ? 50 : 100
}
const usage = {
  inputTokens: 800,
  outputTokens: 20,
  cachedInputTokens: 0,
  reasoningTokens: 2,
  modelVersion: "fake-known-version",
}
type Data = ReturnType<typeof buildSharedCatalog>["entries"][number]
type Target = Data | { ref: number; sourceRef: number }
function resolveTarget(sources: Data[], target: Target): Data {
  if ("sourceRef" in target) {
    const full = sources.find((s) => s.ref === target.sourceRef)
    if (!full || full.ref !== target.ref) throw new Error("invalid_alias")
    return full
  }
  return target
}
function edge(source: Data, target: Data): CompactDiscovery {
  const evidence = (entry: Data) =>
    entry.chunks.length
      ? {
          basis: "transcript" as const,
          refs: [entry.chunks.at(-1)!.spans[0].ref],
        }
      : { basis: "metadata" as const, refs: [entry.metadataRefs[0].ref] }
  return {
    source: source.ref,
    target: target.ref,
    relation: "Their choices have related consequences.",
    value: "Watch the target to examine a distinct response.",
    sourceEvidence: evidence(source),
    targetEvidence: evidence(target),
  }
}
type Request = Parameters<
  ReservationAwareStructuredModel["generateReserved"]
>[0]
function response(request: Request, incomplete = false) {
  const p = JSON.parse(request.prompt)
  if (p.targets) {
    const discoveries = p.sources.flatMap((s: Data) =>
      p.targets
        .map((t: Target) => resolveTarget(p.sources, t))
        .filter((t: Data) => t.ref !== s.ref)
        .map((t: Data) => edge(s, t)),
    )
    return {
      sources: p.sources.map((s: Data) => s.ref),
      targets: p.targets.map((t: Data) => t.ref),
      complete: !incomplete,
      discoveries,
      notes: "All supplied entries read; partial when explicitly flagged.",
    }
  }
  const targets = new Set<string>()
  const selected = p.discoveries
    .filter((d: { targetVideoId: string }) => {
      if (targets.has(d.targetVideoId)) return false
      targets.add(d.targetVideoId)
      return true
    })
    .slice(0, 8)
  return {
    recommendations: selected.map((d: { discoveryId: string }, i: number) => ({
      discoveryId: d.discoveryId,
      rank: i + 1,
      connection: "A full final explanation of the directional connection.",
      watchingValue: "A full explanation of the distinct added viewing value.",
    })),
    fewerThanFiveReason:
      selected.length < 5
        ? "Only these supported connections add enough distinct value."
        : null,
  }
}
function model(
  hook?: (request: Request, index: number) => Promise<void>,
  incomplete?: (request: Request, index: number) => boolean,
) {
  const requests: Request[] = []
  const fake: ReservationAwareStructuredModel = {
    async generateReserved(request, reserve) {
      const index = requests.push(request) - 1
      await hook?.(request, index)
      const decision = await reserve()
      if (decision.kind === "skip")
        return { kind: "skipped", reservation: decision.reservation }
      return {
        kind: "dispatched",
        reservation: decision.reservation,
        response: {
          output: request.schema.parse(
            response(request, incomplete?.(request, index)),
          ),
          usage,
        },
      }
    },
  }
  return { fake, requests }
}
async function setup(sourceIds?: string[]) {
  const corpus = fixture()
  const plan = await planSharedReading({
    corpus,
    sourceIds,
    context,
    countTokens,
  })
  return {
    corpus,
    plan,
    runDirectory: await directory(),
    countTokens,
    executionManifest: { test: "immutable" },
  }
}
async function summary(path: string) {
  return JSON.parse(await readFile(join(path, "usage-summary.json"), "utf8"))
}

describe("shared reading builder boundaries", () => {
  it("supplies each overlapping complete entry once while retaining both target directions", async () => {
    const corpus = fixture(),
      catalog = buildSharedCatalog(corpus)
    const prompt = renderSharedReading(catalog, [0, 1], [0, 1, 2])
    const payload = JSON.parse(prompt)
    expect(payload.sources).toEqual([catalog.entries[0], catalog.entries[1]])
    expect(payload.targets).toEqual([
      { ref: 0, sourceRef: 0 },
      { ref: 1, sourceRef: 1 },
      catalog.entries[2],
    ])
    const bodies = [
      ...payload.sources,
      ...payload.targets.filter((t: Target) => !("sourceRef" in t)),
    ] as Data[]
    expect(bodies.map((e) => e.ref)).toEqual([0, 1, 2])
    for (const body of bodies) {
      expect(body.video).toEqual(catalog.entries[body.ref].video)
      expect(
        body.chunks.map((c) => c.spans.map((s) => s.text).join("")),
      ).toEqual(corpus.entries[body.ref].chunks.map((c) => c.text))
      expect(prompt.split(JSON.stringify(body))).toHaveLength(2)
    }
    expect(
      payload.targets.map((t: Target) => resolveTarget(payload.sources, t)),
    ).toEqual([catalog.entries[0], catalog.entries[1], catalog.entries[2]])
    expect(SHARED_DISCOVERY_SYSTEM).toContain(
      "aliases the complete source entry",
    )
    expect(SHARED_DISCOVERY_SYSTEM).toContain(
      "judge each direction independently",
    )
    const schema = sharedReadingSchema([0, 1], [0, 1, 2])
    const output = schema.parse(
      response({
        system: SHARED_DISCOVERY_SYSTEM,
        prompt,
        schema,
        maxOutputTokens: 100,
      }),
    )
    expect(output.sources).toEqual([0, 1])
    expect(output.targets).toEqual([0, 1, 2])
    expect(output.discoveries.map((d) => [d.source, d.target])).toContainEqual([
      0, 1,
    ])
    expect(output.discoveries.map((d) => [d.source, d.target])).toContainEqual([
      1, 0,
    ])
    expect(output.discoveries.every((d) => d.source !== d.target)).toBe(true)
    for (const discovery of output.discoveries)
      expect(() => expandCompactDiscovery(catalog, discovery)).not.toThrow()
    const input = await setup(["video-0", "video-1"]),
      transport = model()
    const result = await runSharedReading({ ...input, model: transport.fake })
    expect(
      result.sources[0].recommendations.map((r) => r.targetVideoId),
    ).toContain("video-1")
    expect(
      result.sources[1].recommendations.map((r) => r.targetVideoId),
    ).toContain("video-0")
    const coverage = JSON.parse(
      await readFile(
        join(input.runDirectory, "groups/g0000/coverage.json"),
        "utf8",
      ),
    )
    for (const source of [0, 1])
      expect(
        coverage.leaves
          .filter((l: { sources: number[] }) => l.sources.includes(source))
          .flatMap((l: { targets: number[] }) => l.targets),
      ).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("refuses a foreign run without rewriting its artifacts or usage summary", async () => {
    const input = await setup(["video-0"])
    const manifest = '{"version":"full-library-v1"}\n'
    const usage = '{"knownPhysicalCalls":10,"inputTokens":1890507}\n'
    await mkdir(join(input.runDirectory, "pauses"))
    await writeFile(join(input.runDirectory, "manifest.json"), manifest)
    await writeFile(join(input.runDirectory, "usage-summary.json"), usage)
    const fresh = model()
    await expect(
      runSharedReading({ ...input, model: fresh.fake }),
    ).rejects.toThrow("artifact_changed")
    expect(fresh.requests).toHaveLength(0)
    expect(
      await readFile(join(input.runDirectory, "manifest.json"), "utf8"),
    ).toBe(manifest)
    expect(
      await readFile(join(input.runDirectory, "usage-summary.json"), "utf8"),
    ).toBe(usage)
    expect(await readdir(join(input.runDirectory, "pauses"))).toEqual([])
  })

  it("refines singleton-target output by complete sources and preserves full coverage", async () => {
    const corpus = fixture()
    const singleTarget = async (text: string) => {
      const outer = JSON.parse(text)
      if (outer.untrustedCatalogData) {
        const p = JSON.parse(outer.untrustedCatalogData)
        return p.targets
          ? 200 + p.sources.length * 100 + p.targets.length * 1500
          : 800
      }
      return 100
    }
    const plan = await planSharedReading({
      corpus,
      sourceIds: ["video-0", "video-1", "video-2", "video-3"],
      context,
      countTokens: singleTarget,
    })
    expect(plan.groups[0].readings.every((r) => r.targets.length === 1)).toBe(
      true,
    )
    const root = await directory(),
      transport = model(undefined, (_r, i) => i === 0)
    await runSharedReading({
      corpus,
      plan,
      runDirectory: root,
      model: transport.fake,
      countTokens: singleTarget,
      readingConcurrency: 1,
      executionManifest: {},
    })
    const split = JSON.parse(
      await readFile(join(root, "calls/g0000-r0000/split.json"), "utf8"),
    )
    expect(split.children.map((c: { sources: number[] }) => c.sources)).toEqual(
      [
        [0, 1],
        [2, 3],
      ],
    )
    expect(
      split.children.every(
        (c: { targets: number[] }) => JSON.stringify(c.targets) === "[0]",
      ),
    ).toBe(true)
    const coverage = JSON.parse(
      await readFile(join(root, "groups/g0000/coverage.json"), "utf8"),
    )
    for (const source of [0, 1, 2, 3])
      expect(
        coverage.leaves
          .filter((l: { sources: number[] }) => l.sources.includes(source))
          .flatMap((l: { targets: number[] }) => l.targets)
          .sort(),
      ).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("stops at an oversized global handoff without dispatching a pruned rank", async () => {
    const corpus = fixture()
    const noRankCapacity = async (text: string) => {
      const outer = JSON.parse(text)
      if (
        outer.untrustedCatalogData &&
        JSON.parse(outer.untrustedCatalogData).discoveries
      )
        return 1000000
      return countTokens(text)
    }
    const plan = await planSharedReading({
      corpus,
      sourceIds: ["video-0"],
      context,
      countTokens: noRankCapacity,
    })
    const root = await directory(),
      transport = model()
    await expect(
      runSharedReading({
        corpus,
        plan,
        model: transport.fake,
        runDirectory: root,
        countTokens: noRankCapacity,
        executionManifest: {},
      }),
    ).rejects.toThrow("request_exceeds_context")
    expect(transport.requests).toHaveLength(plan.groups[0].readings.length)
    expect(
      transport.requests.every((r) => Boolean(JSON.parse(r.prompt).targets)),
    ).toBe(true)
    const pool = JSON.parse(
      await readFile(join(root, "groups/g0000/coverage.json"), "utf8"),
    )
    expect(pool.discoveries).toHaveLength(6)
    expect(await summary(root)).toMatchObject({
      knownPhysicalCalls: transport.requests.length,
      unknownConsumptionCalls: 0,
    })
  })

  it("preserves unresolvable singleton incompleteness as known usage, never retrying it", async () => {
    const corpus = fixture(1),
      root = await directory()
    const plan = await planSharedReading({ corpus, context, countTokens })
    const transport = model(undefined, () => true)
    const input = {
      corpus,
      plan,
      runDirectory: root,
      model: transport.fake,
      countTokens,
      executionManifest: {},
    }
    await expect(runSharedReading(input)).rejects.toThrow(
      "incomplete_single_assignment",
    )
    expect(await summary(root)).toMatchObject({
      knownPhysicalCalls: 1,
      unknownConsumptionCalls: 0,
    })
    const next = model()
    await expect(
      runSharedReading({ ...input, model: next.fake }),
    ).rejects.toThrow("incomplete_single_assignment")
    expect(next.requests).toHaveLength(0)
  })

  it("preserves every Unicode source character and resolves private exact spans/metadata", () => {
    const corpus = fixture(),
      catalog = buildSharedCatalog(corpus)
    for (let i = 0; i < corpus.entries.length; i++)
      expect(
        catalog.entries[i].chunks.map((c) =>
          c.spans.map((s) => s.text).join(""),
        ),
      ).toEqual(corpus.entries[i].chunks.map((c) => c.text))
    const item = expandCompactDiscovery(
      catalog,
      edge(catalog.entries[0], catalog.entries[6]),
    )
    expect(item.sourceEvidence.basis).toBe("transcript")
    expect(item.targetEvidence).toEqual({
      basis: "metadata",
      fields: [{ field: "title", value: "Full title video-6" }],
    })
    expect(() =>
      expandCompactEvidence(catalog, 1, { basis: "transcript", refs: [0] }),
    ).toThrow("span_reference_invalid")
    expect(() =>
      expandCompactDiscovery(
        catalog,
        edge(catalog.entries[0], catalog.entries[0]),
      ),
    ).toThrow()
  })

  it("measures exact trusted envelope and dynamic schema; IDs do not filter eligibility", async () => {
    const corpus = fixture(),
      catalog = buildSharedCatalog(corpus)
    const measured = vi.fn(countTokens)
    const plan = await planSharedReading({
      corpus,
      sourceIds: ["video-0", "video-1", "video-2", "video-3"],
      context,
      countTokens: measured,
    })
    expect(plan.groups).toHaveLength(1)
    expect(plan.groups[0].sources).toHaveLength(4)
    const targets = plan.groups[0].readings.flatMap((r) => r.targets)
    expect(targets).toEqual(catalog.entries.map((e) => e.ref))
    for (const reading of plan.groups[0].readings) {
      const schema = z.toJSONSchema(
        sharedReadingSchema(reading.sources, reading.targets),
        { target: "draft-07" },
      )
      const prompt = renderSharedReading(
        catalog,
        reading.sources,
        reading.targets,
      )
      const envelope = sharedEnvelope(SHARED_DISCOVERY_SYSTEM, prompt)
      expect(reading.measurement).toEqual({
        inputTokens: await countTokens(envelope),
        schemaTokens: await countTokens(JSON.stringify(schema)),
        promptBytes: Buffer.byteLength(envelope),
        schemaBytes: Buffer.byteLength(JSON.stringify(schema)),
      })
      expect(reading.requestDigest).toBe(
        sha256(
          JSON.stringify({
            system: SHARED_DISCOVERY_SYSTEM,
            prompt,
            schema,
            maxOutputTokens: context.outputReserveTokens,
          }),
        ),
      )
      expect(measured).toHaveBeenCalledWith(envelope)
      expect(
        reading.measurement.inputTokens +
          reading.measurement.schemaTokens +
          200,
      ).toBeLessThanOrEqual(3000)
    }
    expect(SHARED_DISCOVERY_SYSTEM).not.toMatch(/5.?8/)
    expect(SHARED_RANKING_SYSTEM).toContain("5–8")
    expect(
      Object.keys(JSON.parse(renderSharedReading(catalog, [0], [1]))),
    ).toEqual(["version", "sources", "targets"])
    expect(() =>
      sharedReadingSchema([0], [1]).parse({
        sources: [0],
        targets: [2],
        complete: true,
        discoveries: [],
        notes: "",
      }),
    ).toThrow()
  })

  it("splits source groups by real complete-entry capacity and defaults to every source", async () => {
    const corpus = fixture()
    const constrained = {
      ...context,
      contextWindowTokens: 2400,
      effectiveContextTokens: 2400,
      autoCompactLimitTokens: 2400,
    }
    const plan = await planSharedReading({
      corpus,
      context: constrained,
      countTokens,
    })
    expect(plan.sourceIds).toEqual(corpus.entries.map((e) => e.video.id))
    expect(plan.groups.every((g) => g.sources.length <= 4)).toBe(true)
    expect(plan.groups.flatMap((g) => g.sources)).toEqual(
      corpus.entries.map((_, i) => i),
    )
    for (const group of plan.groups)
      expect(group.readings.flatMap((r) => r.targets)).toEqual(
        corpus.entries.map((_, i) => i),
      )
    // Make a fourth source fail even with one complete target.
    const tight = {
      ...context,
      contextWindowTokens: 2000,
      effectiveContextTokens: 2000,
      autoCompactLimitTokens: 2000,
    }
    const split = await planSharedReading({
      corpus,
      context: tight,
      countTokens,
    })
    expect(split.groups.every((g) => g.sources.length <= 2)).toBe(true)
  })

  it("finishes all groups, hands off every discovery with full evidence, and replays without dispatch", async () => {
    const input = await setup()
    const transport = model()
    const result = await runSharedReading({ ...input, model: transport.fake })
    expect(result.sources).toHaveLength(7)
    expect(result.sources.every((s) => s.recommendations.length === 6)).toBe(
      true,
    )
    const ranks = transport.requests.filter(
      (r) => !JSON.parse(r.prompt).targets,
    )
    expect(ranks).toHaveLength(7)
    for (const request of ranks) {
      const p = JSON.parse(request.prompt)
      expect(p.discoveries).toHaveLength(6)
      expect(
        new Set(
          p.discoveries.map((d: { targetVideoId: string }) => d.targetVideoId),
        ).size,
      ).toBe(6)
      expect(
        p.discoveries.every(
          (d: { sourceEvidence: unknown; targetEvidence: unknown }) =>
            d.sourceEvidence && d.targetEvidence,
        ),
      ).toBe(true)
    }
    const before = await summary(input.runDirectory)
    const fresh = model()
    expect(await runSharedReading({ ...input, model: fresh.fake })).toEqual(
      result,
    )
    expect(fresh.requests).toHaveLength(0)
    expect(await summary(input.runDirectory)).toEqual(before)
    expect(before.knownPhysicalCalls).toBe(transport.requests.length)
    expect(before.inputTokens).toBe(
      transport.requests.length * usage.inputTokens,
    )
  })

  it("retains incomplete parent's discoveries and reads complete child entries, without replaying physical calls", async () => {
    const input = await setup(["video-0", "video-1"])
    const transport = model(
      undefined,
      (r, i) => i === 0 && Boolean(JSON.parse(r.prompt).targets),
    )
    await runSharedReading({
      ...input,
      model: transport.fake,
      readingConcurrency: 1,
    })
    const first = JSON.parse(transport.requests[0].prompt)
    const coverage = JSON.parse(
      await readFile(
        join(input.runDirectory, "groups/g0000/coverage.json"),
        "utf8",
      ),
    )
    expect(
      coverage.leaves.every((l: { id: string }) => l.id !== "g0000-r0000"),
    ).toBe(true)
    for (const s of first.sources) {
      const rank = JSON.parse(
        transport.requests.find((r) => {
          const p = JSON.parse(r.prompt)
          return p.source?.ref === s.ref
        })!.prompt,
      )
      expect(
        rank.discoveries.filter((d: { discoveryId: string }) =>
          d.discoveryId.startsWith("g0000-r0000:"),
        ).length,
      ).toBeGreaterThan(0)
      expect(
        rank.discoveries.some((d: { discoveryId: string }) =>
          d.discoveryId.startsWith("g0000-r0000-0:"),
        ),
      ).toBe(true)
      expect(
        coverage.leaves
          .filter((l: { sources: number[] }) => l.sources.includes(s.ref))
          .flatMap((l: { targets: number[] }) => l.targets)
          .sort(),
      ).toEqual([0, 1, 2, 3, 4, 5, 6])
    }
    const all = await summary(input.runDirectory)
    expect(all.knownPhysicalCalls).toBe(transport.requests.length)
    const replay = model()
    await runSharedReading({
      ...input,
      model: replay.fake,
      readingConcurrency: 1,
    })
    expect(replay.requests).toHaveLength(0)
  })

  it("resumes a proven allowance rejection without deleting receipts or rereading successful batches", async () => {
    const input = await setup(["video-0"])
    const first = model(async (_r, i) => {
      if (i === 1)
        throw new CodexSubscriptionAstraError("allowance_insufficient")
    })
    await expect(
      runSharedReading({ ...input, model: first.fake, readingConcurrency: 1 }),
    ).rejects.toThrow("allowance_insufficient")
    const paused = await summary(input.runDirectory)
    expect(paused.knownPhysicalCalls).toBe(1)
    expect(paused.notDispatchedAttempts).toBe(1)
    expect(paused.unknownConsumptionCalls).toBe(0)
    const receipt = await readFile(
      join(input.runDirectory, "calls/g0000-r0001/a0000/receipt.json"),
      "utf8",
    )
    const next = model()
    await runSharedReading({
      ...input,
      model: next.fake,
      readingConcurrency: 1,
    })
    expect(next.requests.map((r) => r.prompt)).not.toContain(
      first.requests[0].prompt,
    )
    expect(
      await readFile(
        join(input.runDirectory, "calls/g0000-r0001/a0000/receipt.json"),
        "utf8",
      ),
    ).toBe(receipt)
    expect(
      await readdir(join(input.runDirectory, "calls/g0000-r0001")),
    ).toContain("a0001")
    const resumed = await summary(input.runDirectory)
    expect(resumed.notDispatchedAttempts).toBe(1)
    expect(resumed.knownPhysicalCalls).toBe(
      first.requests.length - 1 + next.requests.length,
    )
  })

  it("settles two physical reads after unknown failure and blocks any blind resume", async () => {
    const input = await setup(["video-0", "video-1", "video-2", "video-3"])
    let active = 0,
      maximum = 0,
      calls = 0
    const transport: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        const index = calls++
        const decision = await reserve()
        if (decision.kind === "skip")
          return { kind: "skipped", reservation: decision.reservation }
        active++
        maximum = Math.max(active, maximum)
        try {
          await new Promise((r) => setTimeout(r, index === 0 ? 5 : 30))
          if (index === 0)
            throw new CodexSubscriptionAstraError("provider_unavailable", {
              consumptionUnknown: true,
            })
          return {
            kind: "dispatched",
            reservation: decision.reservation,
            response: {
              output: request.schema.parse(response(request)),
              usage,
            },
          }
        } finally {
          active--
        }
      },
    }
    await expect(
      runSharedReading({ ...input, model: transport }),
    ).rejects.toThrow("provider_unavailable")
    expect(calls).toBe(2)
    expect(maximum).toBe(2)
    expect(active).toBe(0)
    const totals = await summary(input.runDirectory)
    expect(totals.unknownConsumptionCalls).toBe(1)
    expect(totals.knownPhysicalCalls).toBe(1)
    expect(totals.inputTokens).toBe(800)
    const replay = model()
    await expect(
      runSharedReading({ ...input, model: replay.fake }),
    ).rejects.toThrow("physical_call_not_resumable")
    expect(replay.requests).toHaveLength(0)
  })

  it("rejects changed result, requested model or manifest before dispatch", async () => {
    for (const tamper of ["result", "model", "manifest"]) {
      const input = await setup(["video-0"]),
        first = model()
      await runSharedReading({ ...input, model: first.fake })
      if (tamper === "manifest") input.executionManifest = { test: "changed" }
      else if (tamper === "result")
        await writeFile(
          join(input.runDirectory, "calls/g0000-r0000/a0000/result.json"),
          "{}",
        )
      else {
        const path = join(
          input.runDirectory,
          "calls/g0000-r0000/a0000/receipt.json",
        )
        const receipt = JSON.parse(await readFile(path, "utf8"))
        receipt.modelId = "another-model"
        await writeFile(path, JSON.stringify(receipt))
      }
      const replay = model()
      await expect(
        runSharedReading({ ...input, model: replay.fake }),
      ).rejects.toThrow()
      expect(replay.requests).toHaveLength(0)
    }
  })

  it("retains known invalid physical response and refuses to rank or retry it", async () => {
    const input = await setup(["video-0"])
    const invalid: ReservationAwareStructuredModel = {
      async generateReserved(request, reserve) {
        const decision = await reserve()
        const output = request.schema.parse(response(request))
        if (
          typeof output === "object" &&
          output !== null &&
          "targets" in output &&
          Array.isArray(output.targets)
        )
          output.targets.fill(0)
        return {
          kind: "dispatched",
          reservation: decision.reservation,
          response: { output, usage },
        }
      },
    }
    await expect(
      runSharedReading({ ...input, model: invalid, readingConcurrency: 1 }),
    ).rejects.toThrow()
    expect(
      JSON.parse(
        await readFile(
          join(input.runDirectory, "calls/g0000-r0000/a0000/response.json"),
          "utf8",
        ),
      ).usage,
    ).toEqual(usage)
    expect(await summary(input.runDirectory)).toMatchObject({
      knownPhysicalCalls: 1,
      unknownConsumptionCalls: 0,
    })
    const replay = model()
    await expect(
      runSharedReading({ ...input, model: replay.fake, readingConcurrency: 1 }),
    ).rejects.toThrow("physical_call_not_resumable")
    expect(replay.requests).toHaveLength(0)
  })
})
