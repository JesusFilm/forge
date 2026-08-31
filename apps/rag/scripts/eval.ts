import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

import YAML from "yaml"

import { loadEnvironmentFiles, parseRuntimeEnv } from "../src/config/env.js"
import type { Retriever } from "../src/contracts/index.js"
import { wire } from "../src/main.js"
import { SOURCES } from "../src/registry/index.js"
import {
  GoldenFileSchema,
  allRelevantPaths,
  caseLanguage,
  computeMetrics,
  coverageByLanguage,
  coverageBySource,
  coverageByTier,
  firstMatchingRank,
  returnedRelevant,
  safePathname,
  type CaseResult,
} from "./lib/evaluation/metrics.js"
import {
  CONTROL_CASE_COUNT,
  METRIC_IMPLEMENTATION_ID,
  caseSetRevision,
  contentRevision,
  createRunId,
  registryRevision,
  writeReceiptAtomic,
  type EvaluationReceipt,
} from "./lib/evaluation/identity.js"

const TOP_K = 10 as const
const MINIMUM_SCORE = 0.37
const CONTROL_SET = "control-2026-08-06"
const POST_CONTROL_CASE_IDS = [
  "gq-seeker-abuse-safety",
  "gq-seeker-suicide",
  "gq-skeptic-evolution",
  "gq-skeptic-bible-slavery",
  "gq-believer-predestination",
  "gq-believer-church-hurt",
  "gq-believer-spiritual-warfare",
  "gq-newcomer-denominations",
  "gq-seeker-lgbt",
] as const

type RunnerDependencies = {
  retriever: Retriever
  shutdown(): Promise<void>
}

type EvalOptions = {
  packageDirectory: string
  environment: NodeJS.ProcessEnv
  environmentName: "local" | "production-read"
  createWiring?: (environment: NodeJS.ProcessEnv) => RunnerDependencies
  now?: () => Date
  runId?: () => string
}

function selectedCases<T extends { id: string }>(
  cases: T[],
  caseSet: string,
): T[] {
  if (caseSet === "current") return cases
  if (caseSet === CONTROL_SET) {
    if (cases.length !== 425)
      throw new Error(
        "control case reconciliation refused: expected 425 golden entries",
      )
    const appendedIds = cases
      .slice(CONTROL_CASE_COUNT)
      .map((goldenCase) => goldenCase.id)
    if (appendedIds.join("\n") !== POST_CONTROL_CASE_IDS.join("\n"))
      throw new Error(
        "control case reconciliation refused: the nine post-control cases changed",
      )
    return cases.slice(0, CONTROL_CASE_COUNT)
  }
  throw new Error(`unknown case set; use current or ${CONTROL_SET}`)
}

function parseArgs(argv: string[]): {
  caseSet: string
  outputDirectory: string
} {
  let caseSet = "current"
  let outputDirectory = "eval/attempts"
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg !== "--case-set" && arg !== "--output-directory")
      throw new Error(`unknown eval argument: ${arg}`)
    const value = argv[++index]
    if (!value) throw new Error(`${arg} needs a value`)
    if (arg === "--case-set") caseSet = value
    else outputDirectory = value
  }
  return { caseSet, outputDirectory }
}

export async function runEvaluation(
  argv: string[],
  options: EvalOptions,
): Promise<string> {
  const args = parseArgs(argv)
  const goldenText = await readFile(
    join(options.packageDirectory, "eval/qa-golden.yaml"),
    "utf8",
  )
  const golden = GoldenFileSchema.parse(YAML.parse(goldenText))
  const cases = selectedCases(golden.cases, args.caseSet)
  if (!cases.length)
    throw new Error("evaluation refused: zero applicable cases")

  const languagesBySource = Object.fromEntries(
    SOURCES.map(({ key, languages }) => [key, [...languages]]),
  )
  const scopedCases = cases.map((goldenCase) => {
    const language = caseLanguage(goldenCase, languagesBySource)
    if (!language)
      throw new Error(
        `evaluation refused: ambiguous case language for ${goldenCase.id}`,
      )
    return { goldenCase, language }
  })
  const runtime = parseRuntimeEnv(options.environment)
  const corpusRevision = options.environment.JFRAG_EVAL_CORPUS_REVISION?.trim()
  if (!corpusRevision)
    throw new Error(
      "evaluation refused: JFRAG_EVAL_CORPUS_REVISION is required",
    )

  const wiring = (options.createWiring ?? wire)(options.environment)
  const results: CaseResult[] = []
  try {
    for (const { goldenCase, language } of scopedCases) {
      const hits = await wiring.retriever.search(goldenCase.question, {
        topK: TOP_K,
        minScore: MINIMUM_SCORE,
        language,
      })
      const safeHits = hits.map((hit) => ({
        chunkId: hit.chunkId,
        docPath: safePathname(hit.citation.url),
        docUrl: null,
        score: hit.score,
      }))
      results.push({
        case: goldenCase,
        hits: safeHits,
        matchedRank: firstMatchingRank(safeHits, goldenCase),
        returnedRelevant: returnedRelevant(safeHits, goldenCase),
        language,
      })
    }
  } finally {
    await wiring.shutdown()
  }

  if (results.length !== scopedCases.length)
    throw new Error("evaluation refused: incomplete execution")
  const metrics = computeMetrics(results)
  const runId = (options.runId ?? createRunId)()
  const diagnostics = {
    sources: coverageBySource(results).map((item) => ({
      key: item.source,
      cases: item.cases,
      recall_at_10: item.recall,
      coverage: item.coverage,
    })),
    languages: coverageByLanguage(results).map((item) => ({
      key: item.language,
      cases: item.cases,
      recall_at_10: item.recall_at_10,
      coverage: item.coverage,
    })),
    evidenceTiers: coverageByTier(results).map((item) => ({
      key: item.tier,
      cases: item.cases,
      recall_at_10: item.recall_at_10,
      coverage: item.coverage,
    })),
  }
  const receipt: EvaluationReceipt = {
    schemaVersion: 1,
    runId,
    environment: options.environmentName,
    completedAt: (options.now ?? (() => new Date()))().toISOString(),
    identity: {
      goldenRevision: contentRevision(goldenText),
      caseSetRevision: caseSetRevision(cases.map(({ id }) => id)),
      caseCount: cases.length,
      registryRevision: registryRevision(SOURCES),
      corpusRevision,
      embeddingModel: runtime.EMBED_MODEL_ID,
      queryInstruction: runtime.EMBED_QUERY_INSTRUCTION ?? "",
      topK: TOP_K,
      minimumScore: MINIMUM_SCORE,
      metricImplementation: METRIC_IMPLEMENTATION_ID,
    },
    metrics,
    diagnostics,
    cases: results.map((result) => ({
      id: result.case.id,
      firstRelevantRank: result.matchedRank,
      relevantReturned: result.returnedRelevant.length,
      relevantTotal: allRelevantPaths(result.case).length,
    })),
  }
  const destination = join(
    options.packageDirectory,
    args.outputDirectory,
    `${options.environmentName}-${runId}.json`,
  )
  await writeReceiptAtomic(destination, receipt)
  return destination
}

const invokedPath = process.argv[1]
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  const packageDirectory = fileURLToPath(new URL("..", import.meta.url))
  const environment = loadEnvironmentFiles(
    packageDirectory,
  ) as NodeJS.ProcessEnv
  const destination = await runEvaluation(process.argv.slice(2), {
    packageDirectory,
    environment,
    environmentName: "local",
  })
  console.log(`evaluation complete: ${destination}`)
}
