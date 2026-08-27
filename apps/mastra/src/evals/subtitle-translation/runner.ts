import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import {
  runSubtitleEnrichment,
  type SubtitleEnrichmentProviderCall,
  type SubtitleEnrichmentProviderOperation,
  type RunSubtitleEnrichmentDeps,
} from "../../services/subtitle-enrichment/run"
import { retimeChunk } from "../../services/subtitle-enrichment/retimer"
import { translateChunk } from "../../services/subtitle-enrichment/translator"
import type { WriteSubtitleArtifactOptions } from "../../services/subtitle-enrichment/storage"
import type { OpenRouterUsage } from "../../services/subtitle-enrichment/openrouter"
import {
  loadSubtitleEvalCorpusLock,
  loadSubtitleEvalManifest,
  readVerifiedCorpusTrack,
  sha256,
} from "./corpus"
import { compareSubtitleCues } from "./metrics"
import type {
  SubtitleEvalCaseReport,
  SubtitleEvalAutomaticMetrics,
  SubtitleEvalCloudUsage,
  SubtitleEvalProviderCall,
  SubtitleEvalReport,
  SubtitleEvalUsage,
} from "./types"
import { SubtitleEvalCloudUsageSchema } from "./types"
import { parseVtt } from "./vtt"
import { SUBTITLE_EVAL_WORKFLOW_POLICY_FILES } from "./workflow-policy"

const execFileAsync = promisify(execFile)
const DEFAULT_REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
)
export type RunSubtitleEvalInput = {
  manifestPath: string
  lockPath: string
  corpusDirectory: string
  outputDirectory: string
  model: string
  apiKey?: string
  timeoutMs: number
  concurrency: number
  caseIds?: string[]
  targetLanguages?: string[]
  repositoryRoot?: string
  now?: () => Date
  runId?: string
}

export type RunSubtitleEvalOptions = {
  deps?: Omit<
    RunSubtitleEnrichmentDeps,
    | "readArtifact"
    | "writeArtifact"
    | "onProviderUsage"
    | "onProviderUsageUnavailable"
  >
}

export type RunSubtitleEvalCellInput = {
  cellId: string
  sourceLanguage: string
  targetLanguage: string
  sourceVtt: string
  referenceVtt: string
  clipStartSeconds: number
  clipEndSeconds: number
  model: string
  apiKey?: string
  timeoutMs: number
  translationContext?: Parameters<
    typeof runSubtitleEnrichment
  >[0]["translationContext"]
}

export type RunSubtitleEvalCellResult = {
  candidateVtt: string
  usage: SubtitleEvalCloudUsage
  metrics: SubtitleEvalAutomaticMetrics
  providerCalls: SubtitleEvalProviderCall[]
}

/**
 * In-memory one-cell adapter over the production subtitle enrichment runtime.
 * It performs no Core fetches and no durable artifact writes; callers own the
 * already-frozen source/reference bytes and content-addressed persistence.
 */
export async function runSubtitleEvalCell(
  input: RunSubtitleEvalCellInput,
  options: RunSubtitleEvalOptions = {},
): Promise<RunSubtitleEvalCellResult> {
  const sourceCues = parseVtt(input.sourceVtt)
  const referenceCues = parseVtt(input.referenceVtt)
  const transcriptBytes = new TextEncoder().encode(
    JSON.stringify({ segments: sourceCues }),
  )
  const artifacts = new Map<string, string>()
  const usageByLanguage = new Map<string, SubtitleEvalUsage>()
  const cellUsageTracker = createCellUsageTracker()
  const providerCallTracker = createProviderCallTracker()
  let providerError: unknown
  const deps = buildRunnerDeps({
    transcriptBytes,
    artifacts,
    usageByLanguage,
    cellUsageTracker,
    providerCallTracker,
    supplied: options.deps,
    onProviderError: (error) => {
      providerError ??= error
    },
  })
  const [languageResult] = await runSubtitleEnrichment(
    {
      assetId: `subtitle-eval-cell-${input.cellId}`,
      sourceLanguage: input.sourceLanguage,
      targetLanguages: [input.targetLanguage],
      model: input.model,
      apiKey: input.apiKey,
      timeoutMs: input.timeoutMs,
      deadlineAtMs: Date.now() + input.timeoutMs,
      concurrency: 1,
      translationContext: input.translationContext,
    },
    deps,
  )
  if (!languageResult || languageResult.status === "failed") {
    if (providerError != null) {
      throw attachProviderCalls(providerError, providerCallTracker.snapshot())
    }
    throw attachProviderCalls(
      new Error(
        languageResult?.error ?? "Subtitle runtime returned no language result",
      ),
      providerCallTracker.snapshot(),
    )
  }

  const candidateVtt = requireGeneratedVtt(artifacts, input.targetLanguage)
  return {
    candidateVtt,
    usage: cellUsageTracker.snapshot(),
    metrics: compareSubtitleCues({
      source: sourceCues,
      generated: parseVtt(candidateVtt, { emptyCue: "preserve" }),
      reference: referenceCues,
      clipStartSeconds: input.clipStartSeconds,
      clipEndSeconds: input.clipEndSeconds,
    }),
    providerCalls: providerCallTracker.snapshot(),
  }
}

export function providerCallsFromError(
  error: unknown,
): SubtitleEvalProviderCall[] {
  if (
    typeof error === "object" &&
    error != null &&
    "subtitleEvalProviderCalls" in error &&
    Array.isArray(error.subtitleEvalProviderCalls)
  ) {
    return error.subtitleEvalProviderCalls as SubtitleEvalProviderCall[]
  }
  return []
}

export async function runSubtitleEval(
  input: RunSubtitleEvalInput,
  options: RunSubtitleEvalOptions = {},
): Promise<{
  report: SubtitleEvalReport
  reportPath: string
  markdownPath: string
}> {
  const [loadedManifest, loadedLock] = await Promise.all([
    loadSubtitleEvalManifest(input.manifestPath),
    loadSubtitleEvalCorpusLock(input.lockPath),
  ])
  if (loadedLock.lock.manifestSha256 !== loadedManifest.sha256) {
    throw new Error(
      "Subtitle eval manifest does not match corpus.lock.json; prepare the corpus before running",
    )
  }

  const selectedCases = selectValues(
    loadedManifest.manifest.cases,
    input.caseIds,
    (item) => item.id,
    "case",
  )
  const selectedLanguages = selectValues(
    loadedManifest.manifest.targetLanguages,
    input.targetLanguages,
    (item) => item,
    "target language",
  )
  const repositoryRoot = resolve(
    input.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
  )
  const createdAt = (input.now ?? (() => new Date()))().toISOString()
  const runId =
    input.runId ??
    `${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`
  const runDirectory = resolve(input.outputDirectory, runId)
  await mkdir(runDirectory, { recursive: true })

  const caseReports: SubtitleEvalCaseReport[] = []
  for (const benchmarkCase of selectedCases) {
    const sourceTrack = requireTrack(
      loadedLock.lock.tracks,
      benchmarkCase.id,
      loadedManifest.manifest.sourceLanguage,
    )
    const sourceVtt = await readVerifiedCorpusTrack({
      corpusDirectory: input.corpusDirectory,
      track: sourceTrack,
    })
    const sourceCues = parseVtt(sourceVtt)
    const transcriptBytes = new TextEncoder().encode(
      JSON.stringify({ segments: sourceCues }),
    )
    const artifacts = new Map<string, string>()
    const usageByLanguage = new Map<string, SubtitleEvalUsage>()
    const startedAt = Date.now()

    const deps = buildRunnerDeps({
      transcriptBytes,
      artifacts,
      usageByLanguage,
      supplied: options.deps,
    })
    const languageResults = await runSubtitleEnrichment(
      {
        assetId: `subtitle-eval-${benchmarkCase.id}`,
        sourceLanguage: loadedManifest.manifest.sourceLanguage,
        targetLanguages: selectedLanguages,
        model: input.model,
        apiKey: input.apiKey,
        timeoutMs: input.timeoutMs,
        concurrency: input.concurrency,
        translationContext: benchmarkCase.translationContext,
      },
      deps,
    )
    const elapsedMs = Date.now() - startedAt

    for (const language of selectedLanguages) {
      const usage = usageByLanguage.get(language) ?? emptyUsage()
      const result = languageResults.find((item) => item.lang === language)
      const baseReport = {
        caseId: benchmarkCase.id,
        title: benchmarkCase.title,
        collection: benchmarkCase.collection,
        videoId: benchmarkCase.videoId,
        edition: benchmarkCase.edition,
        targetLanguage: language,
        elapsedMs,
        usage,
        humanReview: {
          status: "pending" as const,
          rubricVersion: "subtitle-human-review/v1" as const,
        },
      }

      if (!result || result.status === "failed") {
        caseReports.push({
          ...baseReport,
          status: "failed",
          error:
            result?.error ?? "Subtitle runtime returned no language result",
        })
        continue
      }

      try {
        const generatedVtt = requireGeneratedVtt(artifacts, language)
        const referenceTrack = requireTrack(
          loadedLock.lock.tracks,
          benchmarkCase.id,
          language,
        )
        const referenceVtt = await readVerifiedCorpusTrack({
          corpusDirectory: input.corpusDirectory,
          track: referenceTrack,
        })
        const generatedPath = join(
          runDirectory,
          "generated",
          benchmarkCase.id,
          `${language}.vtt`,
        )
        await mkdir(dirname(generatedPath), { recursive: true })
        await writeFile(generatedPath, generatedVtt)

        caseReports.push({
          ...baseReport,
          status: "completed",
          metrics: compareSubtitleCues({
            source: sourceCues,
            generated: parseVtt(generatedVtt, { emptyCue: "preserve" }),
            reference: parseVtt(referenceVtt),
            clipStartSeconds: benchmarkCase.clip.startSeconds,
            clipEndSeconds: benchmarkCase.clip.endSeconds,
          }),
          artifacts: {
            generatedVtt: relative(runDirectory, generatedPath),
            humanReferenceVtt: referenceTrack.relativePath,
          },
        })
      } catch (error) {
        caseReports.push({
          ...baseReport,
          status: "failed",
          error:
            error instanceof Error ? error.message : "Subtitle scoring failed",
        })
      }
    }
  }

  const [gitIdentity, runtimePolicySha256] = await Promise.all([
    readGitIdentity(repositoryRoot),
    hashRuntimePolicy(repositoryRoot),
  ])
  const report: SubtitleEvalReport = {
    schemaVersion: "subtitle-translation-eval-report/v1",
    runId,
    createdAt,
    manifestSha256: loadedManifest.sha256,
    corpusLockSha256: loadedLock.sha256,
    referenceAuthority: loadedManifest.manifest.referenceAuthority,
    model: input.model,
    runtime: {
      sourceKind: "human_source_vtt",
      timeoutMs: input.timeoutMs,
      concurrency: input.concurrency,
    },
    codeRevision: gitIdentity.revision,
    workingTreeDirty: gitIdentity.dirty,
    runtimePolicySha256,
    selection: {
      caseIds: selectedCases.map((item) => item.id),
      targetLanguages: selectedLanguages,
    },
    summary: summarizeReports(caseReports),
    cases: caseReports,
  }
  const reportPath = join(runDirectory, "report.json")
  const markdownPath = join(runDirectory, "report.md")
  await Promise.all([
    writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(markdownPath, renderSubtitleEvalMarkdown(report)),
  ])
  return { report, reportPath, markdownPath }
}

export async function scoreSubtitleCandidate(input: {
  manifestPath: string
  lockPath: string
  corpusDirectory: string
  caseId: string
  targetLanguage: string
  candidateVttPath: string
}) {
  const [loadedManifest, loadedLock, generatedVtt] = await Promise.all([
    loadSubtitleEvalManifest(input.manifestPath),
    loadSubtitleEvalCorpusLock(input.lockPath),
    readFile(input.candidateVttPath, "utf8"),
  ])
  if (loadedManifest.sha256 !== loadedLock.lock.manifestSha256) {
    throw new Error("Subtitle eval manifest does not match corpus lock")
  }
  const benchmarkCase = loadedManifest.manifest.cases.find(
    (item) => item.id === input.caseId,
  )
  if (!benchmarkCase)
    throw new Error(`Unknown subtitle eval case: ${input.caseId}`)
  if (!loadedManifest.manifest.targetLanguages.includes(input.targetLanguage)) {
    throw new Error(
      `Unknown subtitle eval target language: ${input.targetLanguage}`,
    )
  }
  const sourceTrack = requireTrack(
    loadedLock.lock.tracks,
    input.caseId,
    loadedManifest.manifest.sourceLanguage,
  )
  const referenceTrack = requireTrack(
    loadedLock.lock.tracks,
    input.caseId,
    input.targetLanguage,
  )
  const [sourceVtt, referenceVtt] = await Promise.all([
    readVerifiedCorpusTrack({
      corpusDirectory: input.corpusDirectory,
      track: sourceTrack,
    }),
    readVerifiedCorpusTrack({
      corpusDirectory: input.corpusDirectory,
      track: referenceTrack,
    }),
  ])
  return compareSubtitleCues({
    source: parseVtt(sourceVtt),
    generated: parseVtt(generatedVtt, { emptyCue: "preserve" }),
    reference: parseVtt(referenceVtt),
    clipStartSeconds: benchmarkCase.clip.startSeconds,
    clipEndSeconds: benchmarkCase.clip.endSeconds,
  })
}

function buildRunnerDeps(input: {
  transcriptBytes: Uint8Array
  artifacts: Map<string, string>
  usageByLanguage: Map<string, SubtitleEvalUsage>
  cellUsageTracker?: CellUsageTracker
  providerCallTracker?: ReturnType<typeof createProviderCallTracker>
  supplied?: Omit<RunSubtitleEnrichmentDeps, "readArtifact" | "writeArtifact">
  onProviderError?: (error: unknown) => void
}): RunSubtitleEnrichmentDeps {
  const supplied = input.supplied ?? {}
  const translate = supplied.translate ?? translateChunk
  const retime = supplied.retime ?? retimeChunk
  const detectScriptureContext = supplied.detectScriptureContext
  const validateScripture = supplied.validateScripture
  return {
    ...supplied,
    onProviderUsage: ({ operation, usage }) => {
      input.cellUsageTracker?.recordInstrumented(operation, usage)
    },
    onProviderUsageUnavailable: (operation) => {
      input.cellUsageTracker?.markUnavailable(operation)
    },
    onProviderCall: (call) => {
      input.providerCallTracker?.record(call)
      supplied.onProviderCall?.(call)
    },
    readArtifact: async (_assetId, artifactType, ext) => {
      if (artifactType !== "transcript" || ext !== "json") {
        throw new Error(
          `Unexpected subtitle eval artifact read: ${artifactType}.${ext}`,
        )
      }
      return input.transcriptBytes
    },
    writeArtifact: async (options) => {
      const key = `${options.assetId}/${options.artifactType}.${options.ext}`
      input.artifacts.set(
        `${options.artifactType}.${options.ext}`,
        artifactBodyToString(options),
      )
      return key
    },
    translate: async (options) => {
      try {
        let instrumented = false
        let unavailable = false
        const result = await translate({
          ...options,
          onUsage: (usage) => {
            instrumented = true
            options.onUsage?.(usage)
          },
          onUsageUnavailable: () => {
            unavailable = true
            options.onUsageUnavailable?.()
          },
        })
        if (input.cellUsageTracker) {
          if (!instrumented && !unavailable) {
            input.cellUsageTracker.recordReported("translation", result.usage)
          }
        } else {
          addUsage(input.usageByLanguage, options.targetLanguage, result.usage)
        }
        return result
      } catch (error) {
        input.onProviderError?.(error)
        throw error
      }
    },
    retime: async (options) => {
      try {
        let instrumented = false
        let unavailable = false
        const result = await retime({
          ...options,
          onUsage: (usage) => {
            instrumented = true
            options.onUsage?.(usage)
          },
          onUsageUnavailable: () => {
            unavailable = true
            options.onUsageUnavailable?.()
          },
        })
        if (input.cellUsageTracker) {
          if (!instrumented && !unavailable) {
            input.cellUsageTracker.recordReported("retiming", result.usage)
          }
          if (result.fallbackUsed) input.cellUsageTracker.recordRetimeFallback()
        } else {
          addUsage(
            input.usageByLanguage,
            options.targetLanguage,
            result.usage,
            result.fallbackUsed,
          )
        }
        return result
      } catch (error) {
        input.onProviderError?.(error)
        throw error
      }
    },
    ...(detectScriptureContext
      ? {
          detectScriptureContext: async (
            options: Parameters<typeof detectScriptureContext>[0],
          ) => {
            let instrumented = false
            let unavailable = false
            const result = await detectScriptureContext({
              ...options,
              onUsage: (usage) => {
                instrumented = true
                options.onUsage?.(usage)
              },
              onUsageUnavailable: () => {
                unavailable = true
                options.onUsageUnavailable?.()
              },
            })
            if (input.cellUsageTracker && !instrumented && !unavailable) {
              input.cellUsageTracker.markUnavailable("scripture_detection")
            }
            return result
          },
        }
      : {}),
    ...(validateScripture
      ? {
          validateScripture: async (
            options: Parameters<typeof validateScripture>[0],
          ) => {
            let instrumented = false
            let unavailable = false
            const result = await validateScripture({
              ...options,
              onUsage: (usage) => {
                instrumented = true
                options.onUsage?.(usage)
              },
              onUsageUnavailable: () => {
                unavailable = true
                options.onUsageUnavailable?.()
              },
            })
            if (input.cellUsageTracker && !instrumented && !unavailable) {
              input.cellUsageTracker.markUnavailable("scripture_validation")
            }
            return result
          },
        }
      : {}),
  }
}

type CellUsageOperationKey = keyof SubtitleEvalCloudUsage["operations"]

const CELL_USAGE_OPERATION_KEYS: Record<
  SubtitleEnrichmentProviderOperation,
  CellUsageOperationKey
> = {
  scripture_detection: "scriptureDetection",
  translation: "translation",
  retiming: "retiming",
  scripture_validation: "scriptureValidation",
}

type CellUsageTracker = ReturnType<typeof createCellUsageTracker>

function createProviderCallTracker() {
  const calls: SubtitleEvalProviderCall[] = []
  return {
    record(call: SubtitleEnrichmentProviderCall) {
      calls.push({ callSequence: calls.length + 1, ...call })
    },
    snapshot(): SubtitleEvalProviderCall[] {
      return calls.map((call) => ({
        ...call,
        usage: call.usage ? { ...call.usage } : null,
      }))
    },
  }
}

function attachProviderCalls(
  error: unknown,
  providerCalls: SubtitleEvalProviderCall[],
): Error {
  const target = error instanceof Error ? error : new Error("Provider failed")
  Object.defineProperty(target, "subtitleEvalProviderCalls", {
    value: providerCalls,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return target
}

function createCellUsageTracker() {
  const operations: SubtitleEvalCloudUsage["operations"] = {
    scriptureDetection: emptyOperationUsage(),
    translation: emptyOperationUsage(),
    retiming: emptyOperationUsage(),
    scriptureValidation: emptyOperationUsage(),
  }
  let retimeFallbackCount = 0

  return {
    recordInstrumented(
      operation: SubtitleEnrichmentProviderOperation,
      usage: OpenRouterUsage,
    ) {
      addOperationUsage(
        operations[CELL_USAGE_OPERATION_KEYS[operation]],
        usage,
        "instrumented",
      )
    },
    recordReported(
      operation: SubtitleEnrichmentProviderOperation,
      usage: OpenRouterUsage,
    ) {
      addOperationUsage(
        operations[CELL_USAGE_OPERATION_KEYS[operation]],
        usage,
        "reported",
      )
    },
    markUnavailable(operation: SubtitleEnrichmentProviderOperation) {
      const current = operations[CELL_USAGE_OPERATION_KEYS[operation]]
      current.unaccountedResponseCount += 1
      current.accounting =
        current.accounting === "not_invoked" ||
        current.accounting === "unavailable"
          ? "unavailable"
          : "partial"
    },
    recordRetimeFallback() {
      retimeFallbackCount += 1
    },
    snapshot(): SubtitleEvalCloudUsage {
      const totals = Object.values(operations).reduce(
        (sum, operation) => ({
          promptTokens: sum.promptTokens + operation.promptTokens,
          completionTokens: sum.completionTokens + operation.completionTokens,
          totalTokens: sum.totalTokens + operation.totalTokens,
        }),
        { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      )
      const missingOperations = (
        Object.entries(CELL_USAGE_OPERATION_KEYS) as Array<
          [SubtitleEnrichmentProviderOperation, CellUsageOperationKey]
        >
      )
        .filter(([, key]) =>
          ["partial", "unavailable"].includes(operations[key].accounting),
        )
        .map(([operation]) => operation)
      return SubtitleEvalCloudUsageSchema.parse({
        ...totals,
        retimeFallbackCount,
        operations,
        coverage: {
          status: missingOperations.length === 0 ? "complete" : "partial",
          missingOperations,
        },
      })
    },
  }
}

function emptyOperationUsage(): SubtitleEvalCloudUsage["operations"][CellUsageOperationKey] {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    providerResponseCount: 0,
    unaccountedResponseCount: 0,
    accounting: "not_invoked",
  }
}

function addOperationUsage(
  current: SubtitleEvalCloudUsage["operations"][CellUsageOperationKey],
  usage: OpenRouterUsage,
  accounting: "instrumented" | "reported",
): void {
  current.promptTokens += usage.promptTokens
  current.completionTokens += usage.completionTokens
  current.totalTokens += usage.totalTokens
  current.accounting =
    current.unaccountedResponseCount > 0 ? "partial" : accounting
  current.providerResponseCount =
    accounting === "instrumented"
      ? (current.providerResponseCount ?? 0) + 1
      : null
}

function artifactBodyToString(options: WriteSubtitleArtifactOptions): string {
  return typeof options.body === "string"
    ? options.body
    : new TextDecoder().decode(options.body)
}

function addUsage(
  usageByLanguage: Map<string, SubtitleEvalUsage>,
  language: string,
  usage: OpenRouterUsage,
  fallbackUsed = false,
): void {
  const current = usageByLanguage.get(language) ?? emptyUsage()
  usageByLanguage.set(language, {
    promptTokens: current.promptTokens + usage.promptTokens,
    completionTokens: current.completionTokens + usage.completionTokens,
    totalTokens: current.totalTokens + usage.totalTokens,
    retimeFallbackCount: current.retimeFallbackCount + (fallbackUsed ? 1 : 0),
  })
}

function emptyUsage(): SubtitleEvalUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    retimeFallbackCount: 0,
  }
}

function requireGeneratedVtt(
  artifacts: ReadonlyMap<string, string>,
  language: string,
): string {
  const value = artifacts.get(`subtitles-${language}.vtt`)
  if (!value) throw new Error(`Subtitle runtime did not write ${language} VTT`)
  return value
}

function requireTrack(
  tracks: Awaited<
    ReturnType<typeof loadSubtitleEvalCorpusLock>
  >["lock"]["tracks"],
  caseId: string,
  language: string,
) {
  const track = tracks.find(
    (item) => item.caseId === caseId && item.language === language,
  )
  if (!track) throw new Error(`Corpus lock is missing ${caseId}/${language}`)
  return track
}

function selectValues<T>(
  available: readonly T[],
  requested: readonly string[] | undefined,
  identity: (value: T) => string,
  label: string,
): T[] {
  if (!requested || requested.length === 0) return [...available]
  const uniqueRequested = [...new Set(requested)]
  const selected = uniqueRequested.map((requestedIdentity) => {
    const value = available.find(
      (candidate) => identity(candidate) === requestedIdentity,
    )
    if (!value)
      throw new Error(`Unknown subtitle eval ${label}: ${requestedIdentity}`)
    return value
  })
  return selected
}

async function readGitIdentity(
  repositoryRoot: string,
): Promise<{ revision: string; dirty: boolean | null }> {
  try {
    const [{ stdout: revision }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
      execFileAsync("git", ["status", "--porcelain"], { cwd: repositoryRoot }),
    ])
    return { revision: revision.trim(), dirty: status.trim().length > 0 }
  } catch {
    return { revision: "unknown", dirty: null }
  }
}

async function hashRuntimePolicy(repositoryRoot: string): Promise<string> {
  const parts: string[] = []
  for (const relativePath of SUBTITLE_EVAL_WORKFLOW_POLICY_FILES) {
    const bytes = await readFile(resolve(repositoryRoot, relativePath))
    parts.push(`${relativePath}:${sha256(bytes)}`)
  }
  return sha256(parts.join("\n"))
}

function summarizeReports(
  reports: readonly SubtitleEvalCaseReport[],
): SubtitleEvalReport["summary"] {
  return {
    completed: reports.filter((item) => item.status === "completed").length,
    failed: reports.filter((item) => item.status === "failed").length,
    structuralPassed: reports.filter(
      (item) => item.metrics?.structural.passed === true,
    ).length,
    structuralFailed: reports.filter(
      (item) => item.metrics?.structural.passed === false,
    ).length,
    humanReviewPending: reports.length,
  }
}

export function renderSubtitleEvalMarkdown(report: SubtitleEvalReport): string {
  const lines = [
    "# Subtitle translation evaluation",
    "",
    `- Run: \`${report.runId}\``,
    `- Model: \`${report.model}\``,
    `- Reference authority: **${report.referenceAuthority}**`,
    `- Completed: ${report.summary.completed}; failed: ${report.summary.failed}`,
    `- Structural pass: ${report.summary.structuralPassed}; structural fail: ${report.summary.structuralFailed}`,
    `- Human reviews pending: ${report.summary.humanReviewPending}`,
    "",
    "Automatic text similarity is diagnostic only. Human adequacy, naturalness, and scripture review remain required.",
    "",
    "| Case | Language | Runtime | Structure | Character F | Windowed F | Timing recall | Fallbacks |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: |",
  ]
  for (const item of report.cases) {
    lines.push(
      `| ${item.title} | ${item.targetLanguage} | ${item.status} | ${item.metrics ? (item.metrics.structural.passed ? "pass" : "fail") : "—"} | ${item.metrics?.text.characterNgramFScore ?? "—"} | ${item.metrics?.text.windowedCharacterNgramFScore ?? "—"} | ${item.metrics?.timing.referenceOverlapRecall ?? "—"} | ${item.usage.retimeFallbackCount} |`,
    )
  }
  lines.push("", "## Failures and warnings", "")
  const findings = report.cases.flatMap((item) => {
    const values = [
      ...(item.error ? [item.error] : []),
      ...(item.metrics?.structural.failures ?? []),
      ...(item.metrics?.structural.warnings ?? []),
    ]
    return values.map(
      (value) => `- ${item.caseId}/${item.targetLanguage}: ${value}`,
    )
  })
  lines.push(...(findings.length > 0 ? findings : ["- None"]), "")
  return lines.join("\n")
}
