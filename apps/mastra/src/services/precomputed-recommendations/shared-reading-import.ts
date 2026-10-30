/** Read-only adapter for completed, explicitly declared private imports.
 * No generator, account, tokenizer, or derived usage-summary calls belong here. */
import { readFile, readdir } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { z } from "zod"
import {
  ContextBudgetSchema,
  loadFullLibraryCorpus,
  sha256,
  validateConnections,
} from "./full-library-v1"
import {
  buildSharedCatalog,
  expandCompactDiscovery,
  renderSharedReading,
  renderSharedRanking,
  renderSharedSelection,
  renderSharedFinalization,
  sharedReadingSchema,
  sharedRankingSchema,
  sharedSelectionSchema,
  sharedFinalizationSchema,
  sharedEnvelope,
  SHARED_DISCOVERY_SYSTEM,
  SHARED_RANKING_SYSTEM,
  SHARED_SELECTION_SYSTEM,
  SHARED_FINALIZATION_SYSTEM,
  SHARED_FINALIZATION_POLICY,
  type SharedAssignment,
  type SharedDiscovery,
  type SharedSourceResult,
} from "./shared-reading-v1"

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const ids = z.array(z.string().min(1).max(191)).min(1)
const integer = z.number().int().nonnegative().safe()
const refs = z.array(integer).min(1)
const measurementSchema = z
  .object({
    inputTokens: integer,
    schemaTokens: integer,
    promptBytes: integer,
    schemaBytes: integer,
  })
  .strict()
const assignmentSchema = z
  .object({
    id: z.string().regex(/^g\d{4}-r\d{4}(?:-[01])*$/u),
    sources: refs,
    targets: refs,
    measurement: measurementSchema,
    requestDigest: hash,
  })
  .strict()
const planSchema = z
  .object({
    version: z.literal("shared-reading-v1"),
    corpusDigest: hash,
    referenceDigest: hash,
    sourceIds: ids,
    context: ContextBudgetSchema,
    instructionDigests: z
      .object({
        discovery: hash,
        ranking: hash,
        selection: hash.optional(),
        finalization: hash.optional(),
      })
      .strict(),
    finalizationPolicy: z.literal(SHARED_FINALIZATION_POLICY).optional(),
    groups: z
      .array(
        z
          .object({
            id: z.string().regex(/^g\d{4}$/u),
            sources: refs,
            readings: z.array(assignmentSchema).min(1),
          })
          .strict(),
      )
      .min(1),
    coverage: z
      .object({
        eligibleTargetIds: ids,
        selectedChunks: integer,
        metadataOnlyVideos: integer,
      })
      .strict(),
    readingReuse: z
      .object({
        parentRunDirectory: z.string(),
        parentManifestSha256: hash,
        files: z.array(z.object({ path: z.string(), sha256: hash }).strict()),
        readingOrigins: z.array(hash),
      })
      .strict()
      .optional(),
  })
  .passthrough()
const manifestSchema = z
  .object({
    version: z.literal("shared-reading-v1"),
    runDirectory: z.string(),
    plan: planSchema,
    execution: z
      .object({
        authMethod: z.literal("chatgpt"),
        billingBasis: z.literal("included_subscription"),
      })
      .passthrough(),
  })
  .passthrough()
const receiptSchema = z
  .object({
    origin: hash,
    requestDigest: hash,
    modelId: z.literal("gpt-6-astra"),
    modelVersion: z.string(),
    status: z.enum(["succeeded", "failed", "not_dispatched"]),
    reserved: z.boolean(),
    consumptionUnknown: z.boolean(),
    usage: z
      .object({
        inputTokens: integer,
        outputTokens: integer,
        cachedInputTokens: integer.optional(),
        reasoningTokens: integer.optional(),
        modelVersion: z.string().optional(),
        costUsd: z.number().finite().nonnegative().optional(),
      })
      .strict()
      .nullable(),
    responseDigest: hash.optional(),
    resultDigest: hash.optional(),
    finishedAt: z.string().datetime({ offset: true }),
    code: z.string().optional(),
  })
  .strict()
export const sharedImportConfigSchema = z
  .object({
    generationId: z.string().regex(/^[a-zA-Z0-9_-]{1,191}$/u),
    scope: z.enum(["private_pilot", "full_catalog"]),
    corpusPath: z.string().refine(isAbsolute),
    corpusSha256: hash,
    sourceIds: ids,
    runs: z
      .array(
        z
          .object({
            directory: z.string().refine(isAbsolute),
            manifestSha256: hash,
            resultSha256: hash,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
export type SharedImportConfig = z.infer<typeof sharedImportConfigSchema>
export class SharedImportArtifactError extends Error {
  constructor(
    readonly code: string,
    readonly artifact?: string,
  ) {
    super(`${code}${artifact ? `: ${artifact}` : ""}`)
    this.name = "SharedImportArtifactError"
  }
}
function check(value: unknown, code: string, artifact?: string): asserts value {
  if (!value) throw new SharedImportArtifactError(code, artifact)
}
const digest = (value: unknown) => sha256(JSON.stringify(value))
function wireDigest(value: unknown): string {
  function sort(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sort)
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sort(child)]),
      )
    return item
  }
  return digest(sort(value))
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function exact(
  actual: Array<string | number>,
  expected: Array<string | number>,
) {
  check(
    actual.length === expected.length &&
      new Set(actual).size === actual.length &&
      actual.every((id) => expected.includes(id)),
    "coverage_or_membership_invalid",
  )
}
function requestFor(
  system: string,
  prompt: string,
  schema: z.ZodType,
  maxOutputTokens: number,
) {
  return {
    system,
    prompt,
    schema: z.toJSONSchema(schema, { target: "draft-07" }),
    maxOutputTokens,
  }
}
function rowFor(call: {
  origin: string
  sourceVideoId: string
  stage: string
  status: string
  modelId: string
  requestDigest: string
  responseDigest: string | null
  receiptDigest: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  startedAt: string
  finishedAt: string
}) {
  // Explicit HTTP wire mirror of Admin's physicalCallRow; no cross-app imports.
  return {
    callId: call.origin,
    sourceVideoId: call.sourceVideoId,
    stage: call.stage,
    status: call.status,
    modelId: call.modelId,
    inputDigest: call.requestDigest,
    outputDigest: call.status === "failed" ? null : call.responseDigest,
    receiptDigest: call.receiptDigest,
    errorCode: call.status === "failed" ? "shared_reading_failed" : null,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    cachedInputTokens: call.cachedInputTokens,
    startedAt: new Date(call.startedAt).toISOString(),
    finishedAt: new Date(call.finishedAt).toISOString(),
  }
}

export async function prepareSharedReadingImport(raw: unknown) {
  const config = sharedImportConfigSchema.parse(raw)
  const corpus = await loadFullLibraryCorpus(
    config.corpusPath,
    config.corpusSha256,
  )
  const catalog = buildSharedCatalog(corpus)
  const eligibleVideoIds = catalog.corpus.entries.map((e) => e.video.id)
  exact(config.sourceIds, [...new Set(config.sourceIds)])
  check(
    config.sourceIds.every((id) => eligibleVideoIds.includes(id)),
    "source_outside_corpus",
  )
  if (config.scope === "full_catalog") exact(config.sourceIds, eligibleVideoIds)
  const tracked = new Map<string, string>()
  async function bytes(path: string) {
    const data = await readFile(path)
    const previous = tracked.get(path)
    check(
      !previous || previous === sha256(data),
      "input_changed_during_read",
      path,
    )
    tracked.set(path, sha256(data))
    return data
  }
  async function json(path: string): Promise<unknown> {
    return JSON.parse((await bytes(path)).toString("utf8"))
  }
  const record = z.record(z.string(), z.unknown())
  type Manifest = z.infer<typeof manifestSchema>
  const manifests = new Map<string, Manifest>()
  const rawManifestTexts = new Map<string, string>()
  const observations: Array<{
    directory: string
    callId: string
    attempt: string
    state: "not_dispatched" | "unreserved_local_attempt"
  }> = []
  const physical = new Map<string, Awaited<ReturnType<typeof physicalRecord>>>()
  const outputs = new Map<string, unknown>()
  const measurements = new Map<string, z.infer<typeof measurementSchema>>()
  const usedReads = new Set<string>()
  const callCounts = new Map<string, number>()
  async function physicalRecord(
    root: string,
    manifest: Manifest,
    callId: string,
    attempt: string,
  ) {
    const directory = join(root, "calls", callId, attempt)
    const files = await readdir(directory)
    const present = files.includes("reservation.json")
    if (!files.includes("receipt.json")) {
      check(!present, "unknown_consumption_blocks_import", directory)
      observations.push({
        directory: root,
        callId,
        attempt,
        state: "unreserved_local_attempt",
      })
      return null
    }
    const receiptBytes = await bytes(join(directory, "receipt.json"))
    const receipt = receiptSchema.parse(
      JSON.parse(receiptBytes.toString("utf8")),
    )
    const request = record.parse(
      await json(join(root, "calls", callId, "request.json")),
    )
    const requestDigest = digest(request)
    check(
      receipt.origin ===
        sha256(rawManifestTexts.get(root)! + ":" + callId + ":" + attempt) &&
        receipt.requestDigest === requestDigest &&
        receipt.modelVersion === manifest.plan.context.modelVersion,
      "receipt_origin_request_mismatch",
      directory,
    )
    if (receipt.status === "not_dispatched") {
      check(
        !present &&
          !receipt.reserved &&
          !receipt.consumptionUnknown &&
          receipt.usage === null,
        "invalid_no_dispatch",
        directory,
      )
      observations.push({
        directory: root,
        callId,
        attempt,
        state: "not_dispatched",
      })
      return null
    }
    check(
      present &&
        receipt.reserved &&
        !receipt.consumptionUnknown &&
        receipt.usage,
      "unknown_consumption_blocks_import",
      directory,
    )
    const reservationBytes = await bytes(join(directory, "reservation.json"))
    const reservation = record.parse(
      JSON.parse(reservationBytes.toString("utf8")),
    )
    check(
      reservation.origin === receipt.origin &&
        reservation.requestDigest === requestDigest &&
        reservation.modelId === receipt.modelId &&
        reservation.modelVersion === receipt.modelVersion,
      "reservation_binding_mismatch",
      directory,
    )
    const measurement = measurementSchema.parse(reservation.measurement)
    measurements.set(root + ":" + callId, measurement)
    const context = manifest.plan.context
    check(
      typeof request.system === "string" &&
        typeof request.prompt === "string" &&
        request.maxOutputTokens === context.outputReserveTokens,
      "request_invalid",
      directory,
    )
    check(
      measurement.promptBytes ===
        Buffer.byteLength(sharedEnvelope(request.system, request.prompt)) &&
        measurement.schemaBytes ===
          Buffer.byteLength(JSON.stringify(request.schema)) &&
        measurement.promptBytes <= 2_000_000 &&
        measurement.schemaBytes <= 128_000 &&
        measurement.inputTokens +
          measurement.schemaTokens +
          context.overheadReserveTokens +
          context.outputReserveTokens <=
          Math.min(
            context.effectiveContextTokens,
            context.autoCompactLimitTokens,
          ),
      "stored_context_invalid",
      directory,
    )
    const usage = receipt.usage
    check(
      usage.costUsd === undefined || usage.costUsd === 0,
      "non_subscription_charge_blocks_import",
      directory,
    )
    check(
      usage.cachedInputTokens !== undefined,
      "cached_usage_unreported_blocks_import",
      directory,
    )
    check(
      (usage.cachedInputTokens ?? 0) <= usage.inputTokens &&
        (usage.reasoningTokens ?? 0) <= usage.outputTokens &&
        (receipt.status === "failed" ||
          (usage.outputTokens <= context.outputReserveTokens &&
            usage.inputTokens + usage.outputTokens <=
              Math.min(
                context.effectiveContextTokens,
                context.autoCompactLimitTokens,
              ))),
      "actual_usage_context_invalid",
      directory,
    )
    if (receipt.responseDigest) {
      const responseBytes = await bytes(join(directory, "response.json"))
      const response = record.parse(JSON.parse(responseBytes.toString("utf8")))
      check(
        sha256(responseBytes) === receipt.responseDigest &&
          same(response.usage, usage),
        "response_binding_mismatch",
        directory,
      )
      if (receipt.status === "succeeded") {
        const resultBytes = await bytes(join(directory, "result.json"))
        check(
          sha256(resultBytes) === receipt.resultDigest &&
            same(JSON.parse(resultBytes.toString("utf8")), response.output),
          "result_binding_mismatch",
          directory,
        )
        outputs.set(root + ":" + callId, response.output)
      }
    } else
      check(
        receipt.status === "failed",
        "successful_response_missing",
        directory,
      )
    const group = manifest.plan.groups.find((g) =>
      callId.startsWith(g.id + "-"),
    )
    check(group, "unassigned_physical_call", directory)
    const rankingRef = /-rank-(\d+)(?:-select|-finalize)?$/u.exec(callId)
    const sourceRefs = rankingRef ? [Number(rankingRef[1])] : group.sources
    check(
      sourceRefs.every((ref) => group.sources.includes(ref)),
      "call_source_invalid",
      directory,
    )
    const sourceVideoIds = sourceRefs
      .map((ref) => catalog.corpus.entries[ref].video.id)
      .sort()
    const stage = rankingRef
      ? callId.endsWith("-select")
        ? "global_select"
        : callId.endsWith("-finalize")
          ? "evidence_finalize"
          : "global_rank"
      : "shared_read"
    const startedAt = z
      .string()
      .datetime({ offset: true })
      .parse(reservation.startedAt)
    check(
      new Date(startedAt) <= new Date(receipt.finishedAt),
      "call_interval_invalid",
      directory,
    )
    return {
      origin: receipt.origin,
      sourceVideoId: sourceVideoIds[0],
      sourceVideoIds,
      stage,
      status: receipt.status,
      modelId: receipt.modelId,
      requestDigest,
      responseDigest: receipt.responseDigest ?? null,
      receiptDigest: sha256(receiptBytes),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      reasoningTokens: usage.reasoningTokens ?? null,
      startedAt,
      finishedAt: receipt.finishedAt,
      originalRunDirectory: root,
      originalAttemptPath: `calls/${callId}/${attempt}`,
      originalManifestDigest: tracked.get(join(root, "manifest.json"))!,
      reservationDigest: sha256(reservationBytes),
      receiptJson: receiptBytes.toString("utf8"),
    }
  }
  const inventories = new Map<string, string>()
  async function inventory(root: string) {
    const entries: string[] = []
    for (const id of (await readdir(join(root, "calls"))).sort()) {
      check(
        /^g\d{4}-(?:r\d{4}(?:-[01])*|rank-\d+(?:-select|-finalize)?)$/u.test(
          id,
        ),
        "unexpected_call_directory",
      )
      for (const attempt of (await readdir(join(root, "calls", id)))
        .filter((n) => /^a\d{4}$/u.test(n))
        .sort())
        entries.push(id + "/" + attempt)
    }
    return entries
  }
  async function loadRun(root: string, expected: string): Promise<Manifest> {
    root = resolve(root)
    if (manifests.has(root)) {
      check(
        tracked.get(join(root, "manifest.json")) === expected,
        "manifest_alias_mismatch",
      )
      return manifests.get(root)!
    }
    const rawManifest = await bytes(join(root, "manifest.json"))
    check(sha256(rawManifest) === expected, "manifest_digest_mismatch", root)
    const manifest = manifestSchema.parse(
      JSON.parse(rawManifest.toString("utf8")),
    )
    rawManifestTexts.set(
      root,
      JSON.stringify(JSON.parse(rawManifest.toString("utf8"))),
    )
    check(
      manifest.runDirectory === root &&
        manifest.plan.corpusDigest === digest(catalog.corpus) &&
        manifest.plan.referenceDigest ===
          digest({
            entries: catalog.entries,
            spans: catalog.spans,
            metadata: catalog.metadata,
          }),
      "frozen_catalog_mismatch",
      root,
    )
    check(
      same(await json(join(root, "corpus.json")), catalog.corpus) &&
        same(await json(join(root, "references.json")), {
          spans: catalog.spans,
          metadata: catalog.metadata,
        }),
      "frozen_references_mismatch",
      root,
    )
    exact(manifest.plan.coverage.eligibleTargetIds, eligibleVideoIds)
    check(
      manifest.plan.coverage.selectedChunks ===
        corpus.entries.reduce((sum, e) => sum + e.chunks.length, 0) &&
        manifest.plan.coverage.metadataOnlyVideos ===
          corpus.entries.filter((e) => e.chunks.length === 0).length,
      "coverage_totals_invalid",
    )
    exact(
      manifest.plan.groups.flatMap((g) =>
        g.sources.map((ref) => catalog.corpus.entries[ref]?.video.id),
      ),
      manifest.plan.sourceIds,
    )
    check(
      manifest.plan.instructionDigests.discovery ===
        sha256(SHARED_DISCOVERY_SYSTEM),
      "discovery_instructions_mismatch",
    )
    manifests.set(root, manifest)
    if (manifest.plan.readingReuse) {
      const reuse = manifest.plan.readingReuse
      check(
        isAbsolute(reuse.parentRunDirectory) &&
          resolve(reuse.parentRunDirectory) !== root,
        "invalid_parent_path",
      )
      const parent = await loadRun(
        reuse.parentRunDirectory,
        reuse.parentManifestSha256,
      )
      check(
        !parent.plan.readingReuse &&
          same(parent.plan.groups, manifest.plan.groups) &&
          same(parent.plan.context, manifest.plan.context) &&
          same(parent.plan.sourceIds, manifest.plan.sourceIds),
        "reuse_assignments_context_mismatch",
      )
      for (const file of reuse.files) {
        check(
          !isAbsolute(file.path) && !file.path.split(/[\\/]/u).includes(".."),
          "unsafe_reuse_path",
        )
        check(
          sha256(await bytes(join(reuse.parentRunDirectory, file.path))) ===
            file.sha256,
          "reused_artifact_changed",
          file.path,
        )
      }
    }
    const calls = await inventory(root)
    inventories.set(root, JSON.stringify(calls))
    for (const path of calls) {
      const [id, attempt] = path.split("/")
      const call = await physicalRecord(root, manifest, id, attempt)
      if (!call) continue
      const previous = physical.get(call.origin)
      check(!previous || same(previous, call), "conflicting_physical_origin")
      physical.set(call.origin, call)
      const key = root + ":" + id
      callCounts.set(key, (callCounts.get(key) ?? 0) + 1)
      check(callCounts.get(key) === 1, "duplicate_physical_call_attempt")
    }
    return manifest
  }
  async function success(
    root: string,
    id: string,
    request: ReturnType<typeof requestFor>,
  ) {
    check(
      same(await json(join(root, "calls", id, "request.json")), request),
      "stage_request_changed",
      id,
    )
    check(
      outputs.has(root + ":" + id) && callCounts.get(root + ":" + id) === 1,
      "successful_call_missing",
      id,
    )
    return outputs.get(root + ":" + id)
  }
  async function readingTree(
    root: string,
    manifest: Manifest,
    a: SharedAssignment,
  ): Promise<{ leaves: SharedAssignment[]; discoveries: SharedDiscovery[] }> {
    const request = requestFor(
      SHARED_DISCOVERY_SYSTEM,
      renderSharedReading(catalog, a.sources, a.targets),
      sharedReadingSchema(a.sources, a.targets),
      manifest.plan.context.outputReserveTokens,
    )
    check(
      digest(request) === a.requestDigest,
      "reading_plan_request_mismatch",
      a.id,
    )
    const output = sharedReadingSchema(a.sources, a.targets).parse(
      await success(root, a.id, request),
    )
    check(
      same(measurements.get(root + ":" + a.id), a.measurement),
      "reading_measurement_changed",
    )
    check(!usedReads.has(root + ":" + a.id), "reading_used_twice")
    usedReads.add(root + ":" + a.id)
    exact(output.sources, a.sources)
    exact(output.targets, a.targets)
    exact(
      output.discoveries.map((d) => d.source + ":" + d.target),
      [...new Set(output.discoveries.map((d) => d.source + ":" + d.target))],
    )
    const discoveries = output.discoveries.map((discovery, index) => {
      check(
        a.sources.includes(discovery.source) &&
          a.targets.includes(discovery.target),
        "reading_discovery_outside_assignment",
      )
      expandCompactDiscovery(catalog, discovery)
      return { discoveryId: a.id + ":" + index, callId: a.id, discovery }
    })
    if (output.complete) return { leaves: [a], discoveries }
    const split = z
      .object({
        parentRequestDigest: hash,
        children: z.tuple([assignmentSchema, assignmentSchema]),
      })
      .strict()
      .parse(await json(join(root, "calls", a.id, "split.json")))
    check(
      split.parentRequestDigest === a.requestDigest &&
        (a.targets.length > 1 || a.sources.length > 1),
      "invalid_split",
    )
    const splitTargets = a.targets.length > 1
    const values = splitTargets ? a.targets : a.sources
    const middle = Math.ceil(values.length / 2)
    for (const [index, child] of split.children.entries()) {
      check(
        child.id === a.id + "-" + index &&
          same(
            child.sources,
            splitTargets
              ? a.sources
              : values.slice(index ? middle : 0, index ? undefined : middle),
          ) &&
          same(
            child.targets,
            splitTargets
              ? values.slice(index ? middle : 0, index ? undefined : middle)
              : a.targets,
          ),
        "split_assignment_invalid",
      )
    }
    const first = await readingTree(root, manifest, split.children[0]),
      second = await readingTree(root, manifest, split.children[1])
    return {
      leaves: [...first.leaves, ...second.leaves],
      discoveries: [
        ...discoveries,
        ...first.discoveries,
        ...second.discoveries,
      ],
    }
  }
  const sourceResults: Array<{
    sourceVideoId: string
    recommendations: SharedSourceResult["recommendations"]
    fewerThanFiveReason: string | null
    witnesses: Array<{
      videoId: string
      coreId: string | null
      slug: string
      metadata: {
        title: string
        description: string
        keywords: string[]
        bibleCitations: string[]
      }
      chunks: Array<{
        id: string
        transcriptId: string
        language: string
        text: string
      }>
    }>
    provenance: Record<string, unknown>
  }> = []
  const runProvenance: Array<Record<string, unknown>> = []
  for (const run of config.runs) {
    const root = resolve(run.directory)
    let resultBytes: Buffer
    try {
      resultBytes = await bytes(join(root, "recommendations.json"))
    } catch (cause) {
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "ENOENT"
      )
        throw new SharedImportArtifactError(
          "run_incomplete_not_importable",
          root,
        )
      throw cause
    }
    const manifest = await loadRun(root, run.manifestSha256),
      plan = manifest.plan
    check(
      plan.finalizationPolicy === SHARED_FINALIZATION_POLICY &&
        plan.instructionDigests.ranking === sha256(SHARED_RANKING_SYSTEM) &&
        plan.instructionDigests.selection === sha256(SHARED_SELECTION_SYSTEM) &&
        plan.instructionDigests.finalization ===
          sha256(SHARED_FINALIZATION_SYSTEM),
      "finalization_instructions_mismatch",
    )
    const rawPlan = record.parse(
      JSON.parse((await bytes(join(root, "manifest.json"))).toString("utf8")),
    ).plan
    check(
      sha256(resultBytes) === run.resultSha256,
      "run_result_digest_mismatch",
      root,
    )
    const result = z
      .object({
        version: z.literal("shared-reading-v1"),
        planDigest: hash,
        sources: z.array(z.unknown()),
        coverage: z.unknown(),
      })
      .strict()
      .parse(JSON.parse(resultBytes.toString("utf8")))
    check(
      result.planDigest === digest(rawPlan) &&
        same(result.coverage, plan.coverage),
      "run_completion_binding_invalid",
      root,
    )
    exact(
      plan.sourceIds,
      result.sources.map(
        (s) => z.object({ sourceVideoId: z.string() }).parse(s).sourceVideoId,
      ),
    )
    const readRoot = plan.readingReuse?.parentRunDirectory ?? root
    const readManifest = manifests.get(readRoot)!
    const readOrigins: string[] = []
    const grouped: SharedSourceResult[] = []
    for (const group of plan.groups) {
      exact(
        group.readings.flatMap((a) => a.targets),
        catalog.entries.map((e) => e.ref),
      )
      const leaves: SharedAssignment[] = [],
        discoveries: SharedDiscovery[] = []
      for (const a of group.readings) {
        check(same(a.sources, group.sources), "reading_group_sources_mismatch")
        const tree = await readingTree(readRoot, readManifest, a)
        leaves.push(...tree.leaves)
        discoveries.push(...tree.discoveries)
      }
      for (const source of group.sources)
        exact(
          leaves
            .filter((a) => a.sources.includes(source))
            .flatMap((a) => a.targets),
          catalog.entries.map((e) => e.ref),
        )
      const expectedCoverage = { sources: group.sources, leaves, discoveries }
      for (const coverageRoot of new Set([root, readRoot]))
        check(
          same(
            await json(join(coverageRoot, "groups", group.id, "coverage.json")),
            expectedCoverage,
          ),
          "coverage_artifact_changed",
        )
      for (const source of group.sources) {
        const pool = discoveries.filter((d) => d.discovery.source === source)
        const expanded = new Map(
          pool.map((d) => [
            d.discoveryId,
            expandCompactDiscovery(catalog, d.discovery),
          ]),
        )
        const rankingId = group.id + "-rank-" + source
        const rankMeta = z
          .object({
            policy: z.literal(SHARED_FINALIZATION_POLICY),
            mode: z.enum([
              "global-evidence",
              "global-notes-then-selected-evidence",
            ]),
            discoveries: integer,
            poolDigest: hash,
            callIds: z.array(z.string()),
            informationLoss: z.string(),
          })
          .passthrough()
          .parse(
            await json(
              join(root, "groups", group.id, `ranking-${source}.json`),
            ),
          )
        check(
          rankMeta.poolDigest === digest(pool) &&
            rankMeta.discoveries === pool.length,
          "global_pool_changed",
        )
        let output: z.infer<ReturnType<typeof sharedRankingSchema>>,
          rejected: Array<{ discoveryId: string; reason: string }> = []
        function choices(
          items: Array<{ discoveryId: string; rank: number }>,
          reason: string | null,
        ) {
          check(
            items.length >= 5 || (reason?.trim().length ?? 0) >= 12,
            "shortfall_unexplained",
          )
          const seenIds = new Set<string>(),
            cores = new Set<string>(),
            slugs = new Set<string>()
          for (const [index, item] of items.entries()) {
            const found = expanded.get(item.discoveryId)
            check(found && item.rank === index + 1, "invalid_rank_or_discovery")
            const target = catalog.corpus.entries.find(
              (e) => e.video.id === found.targetVideoId,
            )!.video
            check(
              !seenIds.has(target.id) &&
                !(target.coreId && cores.has(target.coreId)) &&
                !(target.slug && slugs.has(target.slug)),
              "duplicate_target_identity",
            )
            seenIds.add(target.id)
            cores.add(target.coreId)
            slugs.add(target.slug)
          }
        }
        if (rankMeta.mode === "global-evidence") {
          check(same(rankMeta.callIds, [rankingId]), "rank_call_id_mismatch")
          const schema = sharedRankingSchema(pool)
          output = schema.parse(
            await success(
              root,
              rankingId,
              requestFor(
                SHARED_RANKING_SYSTEM,
                renderSharedRanking(catalog, source, pool),
                schema,
                plan.context.outputReserveTokens,
              ),
            ),
          )
        } else {
          check(
            same(rankMeta.callIds, [
              rankingId + "-select",
              rankingId + "-finalize",
            ]),
            "rank_call_id_mismatch",
          )
          const selectionSchema = sharedSelectionSchema(pool)
          const selection = selectionSchema.parse(
            await success(
              root,
              rankingId + "-select",
              requestFor(
                SHARED_SELECTION_SYSTEM,
                renderSharedSelection(catalog, source, pool),
                selectionSchema,
                plan.context.outputReserveTokens,
              ),
            ),
          )
          choices(selection.recommendations, selection.fewerThanFiveReason)
          const selected = selection.recommendations.map(
            (r) => pool.find((d) => d.discoveryId === r.discoveryId)!,
          )
          const schema = sharedFinalizationSchema(selected)
          const finalized = schema.parse(
            await success(
              root,
              rankingId + "-finalize",
              requestFor(
                SHARED_FINALIZATION_SYSTEM,
                renderSharedFinalization(catalog, source, selected, selection),
                schema,
                plan.context.outputReserveTokens,
              ),
            ),
          )
          exact(
            [
              ...finalized.recommendations.map((r) => r.discoveryId),
              ...finalized.rejected.map((r) => r.discoveryId),
            ],
            selected.map((d) => d.discoveryId),
          )
          check(
            finalized.rejected.every((r) => r.reason.trim().length >= 12),
            "rejection_unexplained",
          )
          const selectedMeta = z
            .object({
              selectionCallId: z.string(),
              finalizationCallId: z.string(),
              selection: z.unknown(),
              selectedPoolDigest: hash,
            })
            .passthrough()
            .parse(
              await json(
                join(
                  root,
                  "groups",
                  group.id,
                  `selected-evidence-${source}.json`,
                ),
              ),
            )
          check(
            selectedMeta.selectionCallId === rankingId + "-select" &&
              selectedMeta.finalizationCallId === rankingId + "-finalize" &&
              same(selectedMeta.selection, selection) &&
              selectedMeta.selectedPoolDigest === digest(selected),
            "selected_evidence_changed",
          )
          output = finalized
          rejected = finalized.rejected
        }
        choices(output.recommendations, output.fewerThanFiveReason)
        const recommendations = output.recommendations.map((item) => {
          const original = expanded.get(item.discoveryId)!
          return {
            sourceVideoId: original.sourceVideoId,
            targetVideoId: original.targetVideoId,
            sourceEvidence: original.sourceEvidence,
            targetEvidence: original.targetEvidence,
            connection: item.connection,
            watchingValue: item.watchingValue,
            rank: item.rank,
          }
        })
        validateConnections(
          recommendations.map(({ rank: _rank, ...r }) => r),
          [catalog.corpus.entries[source]],
          catalog.corpus.entries,
        )
        const saved: SharedSourceResult = {
          sourceVideoId: catalog.corpus.entries[source].video.id,
          recommendations,
          fewerThanFiveReason: output.fewerThanFiveReason,
          finalization: {
            mode: rankMeta.mode,
            callIds: rankMeta.callIds,
            rejectedSelections: rejected.map((r) => ({
              ...r,
              targetVideoId: expanded.get(r.discoveryId)!.targetVideoId,
            })),
          },
        }
        grouped.push(saved)
        const witnessIds = new Set([
          saved.sourceVideoId,
          ...recommendations.map((r) => r.targetVideoId),
        ])
        const witnesses = catalog.corpus.entries
          .filter((e) => witnessIds.has(e.video.id))
          .map((e) => {
            const used = new Set(
              recommendations
                .flatMap((r) => [
                  r.sourceVideoId === e.video.id ? r.sourceEvidence : null,
                  r.targetVideoId === e.video.id ? r.targetEvidence : null,
                ])
                .flatMap((evidence) =>
                  evidence?.basis === "transcript"
                    ? evidence.passages.map((p) => p.chunkId)
                    : [],
                ),
            )
            return {
              videoId: e.video.id,
              coreId: e.video.coreId || null,
              slug: e.video.slug,
              metadata: {
                title: e.video.title,
                description: e.video.description,
                keywords: e.video.keywords,
                bibleCitations: e.video.bibleCitations,
              },
              chunks: e.chunks
                .filter((c) => used.has(c.id))
                .map(({ id, transcriptId, language, text }) => ({
                  id,
                  transcriptId,
                  language,
                  text,
                })),
            }
          })
        sourceResults.push({
          sourceVideoId: saved.sourceVideoId,
          recommendations,
          fewerThanFiveReason: saved.fewerThanFiveReason,
          witnesses,
          provenance: {
            runDirectory: root,
            manifestSha256: run.manifestSha256,
            resultSha256: run.resultSha256,
            groupId: group.id,
            coverageDigest: digest(expectedCoverage),
            eligibleTargets: eligibleVideoIds.length,
            finalization: saved.finalization,
            informationLoss: rankMeta.informationLoss,
            selectedDiscoveries: output.recommendations.map((item) =>
              pool.find((d) => d.discoveryId === item.discoveryId),
            ),
          },
        })
      }
      const groupResults = z
        .object({
          version: z.literal("shared-reading-v1"),
          sources: z.unknown(),
        })
        .strict()
        .parse(
          await json(join(root, "groups", group.id, "recommendations.json")),
        )
      check(
        same(groupResults.sources, grouped.slice(-group.sources.length)),
        "group_result_changed",
      )
    }
    check(
      same(result.sources, grouped),
      "root_results_differ_from_physical_results",
    )
    for (const call of physical.values())
      if (
        call &&
        call.originalRunDirectory === readRoot &&
        call.stage === "shared_read"
      )
        readOrigins.push(call.origin)
    if (plan.readingReuse) exact(readOrigins, plan.readingReuse.readingOrigins)
    runProvenance.push({
      directory: root,
      manifestSha256: run.manifestSha256,
      resultSha256: run.resultSha256,
      planDigest: result.planDigest,
      parent: plan.readingReuse
        ? {
            directory: readRoot,
            manifestSha256: plan.readingReuse.parentManifestSha256,
            readingOrigins: plan.readingReuse.readingOrigins,
            admittedFilesDigest: digest(plan.readingReuse.files),
          }
        : null,
    })
  }
  exact(
    sourceResults.map((s) => s.sourceVideoId),
    config.sourceIds,
  )
  const calls = [...physical.values()]
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => a.origin.localeCompare(b.origin))
  for (const call of calls)
    if (call.stage === "shared_read") {
      const callId = call.originalAttemptPath.split("/")[1]
      check(
        call.status === "succeeded" &&
          usedReads.has(call.originalRunDirectory + ":" + callId),
        "unassigned_or_failed_read",
      )
    }
  const sources = sourceResults.sort((a, b) =>
    a.sourceVideoId.localeCompare(b.sourceVideoId),
  )
  for (const [root, inventoryAtRead] of inventories)
    check(
      JSON.stringify(await inventory(root)) === inventoryAtRead,
      "run_changed_during_read",
      root,
    )
  for (const [path, hash] of tracked)
    check(
      sha256(await readFile(path)) === hash,
      "input_changed_during_read",
      path,
    )
  check(
    sha256(await readFile(config.corpusPath)) === config.corpusSha256,
    "corpus_changed_during_read",
  )
  const manifest = {
    version: "shared-reading-v1" as const,
    scope: config.scope,
    modelId: "gpt-6-astra" as const,
    inputCutoff: corpus.snapshot?.inputCutoff ?? corpus.observedAt!,
    corpusFileSha256: config.corpusSha256,
    corpusDigest: digest(catalog.corpus),
    referenceDigest: digest({
      entries: catalog.entries,
      spans: catalog.spans,
      metadata: catalog.metadata,
    }),
    eligibleVideoIds,
    sources: sources.map((s) => ({
      sourceVideoId: s.sourceVideoId,
      payloadDigest: wireDigest(s),
      fewerThanFiveReason: s.fewerThanFiveReason,
    })),
    calls: calls.map((c) => ({
      origin: c.origin,
      payloadDigest: wireDigest(c),
      rowDigest: wireDigest(rowFor(c)),
    })),
    provenance: {
      runs: runProvenance,
      noDispatch: observations,
      verifiedArtifactCount: tracked.size,
      verifiedArtifactsDigest: digest(
        [...tracked].sort(([a], [b]) => a.localeCompare(b)),
      ),
      freshness:
        "frozen producer-verified corpus; current DB text freshness and historical/public qualification not asserted",
    },
  }
  const inputDigest = wireDigest(manifest)
  const submissions = [
    {
      action: "shared_reading_start",
      generationId: config.generationId,
      manifest,
    },
    ...calls.map((call) => ({
      action: "shared_reading_call",
      generationId: config.generationId,
      inputDigest,
      call,
    })),
    ...sources.map((source) => ({
      action: "shared_reading_source",
      generationId: config.generationId,
      inputDigest,
      source,
    })),
    {
      action: "shared_reading_complete",
      generationId: config.generationId,
      inputDigest,
    },
  ]
  check(
    submissions.every(
      (body) => Buffer.byteLength(JSON.stringify(body)) <= 2 * 1024 * 1024,
    ),
    "import_request_exceeds_existing_2MiB_boundary",
  )
  return {
    manifest,
    inputDigest,
    inspectedRunDirectories: [...manifests.keys()],
    submissions,
    summary: {
      scope: config.scope,
      sources: sources.length,
      eligibleTargetsPerSource: eligibleVideoIds.length,
      recommendations: sources.reduce(
        (sum, s) => sum + s.recommendations.length,
        0,
      ),
      physicalCalls: calls.length,
      knownFailedCalls: calls.filter((c) => c.status === "failed").length,
      unknownCalls: 0,
      nonPhysicalObservations: observations.length,
      inputTokens: calls.reduce((sum, c) => sum + c.inputTokens, 0),
      outputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0),
      cachedInputTokens: calls.reduce((sum, c) => sum + c.cachedInputTokens, 0),
      reasoningTokensKnownSubset: calls.reduce(
        (sum, c) => sum + (c.reasoningTokens ?? 0),
        0,
      ),
    },
  }
}
