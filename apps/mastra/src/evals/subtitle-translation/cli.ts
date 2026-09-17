import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

import { env, getOpenRouterApiKey } from "../../config/env"
import { prepareSubtitleEvalCorpus } from "./corpus"
import { runSubtitleEval, scoreSubtitleCandidate } from "./runner"

const DEFAULT_MANIFEST = "apps/mastra/evals/subtitle-translation/manifest.json"
const DEFAULT_LOCK = "apps/mastra/evals/subtitle-translation/corpus.lock.json"
const DEFAULT_WORK_ROOT = ".mastra/subtitle-translation-eval"

type CliArguments = {
  command: string
  values: Map<string, string>
  flags: Set<string>
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv)
  const manifestPath = resolve(args.values.get("manifest") ?? DEFAULT_MANIFEST)
  const lockPath = resolve(args.values.get("lock") ?? DEFAULT_LOCK)
  const corpusDirectory = resolve(
    args.values.get("corpus-dir") ?? `${DEFAULT_WORK_ROOT}/corpus`,
  )

  if (args.command === "prepare") {
    const lock = await prepareSubtitleEvalCorpus({
      manifestPath,
      lockPath,
      corpusDirectory,
      refreshLock: args.flags.has("refresh-lock"),
    })
    console.log(
      `Prepared ${lock.tracks.length} locked subtitle tracks in ${corpusDirectory}`,
    )
    return
  }

  if (args.command === "run") {
    const apiKey = getOpenRouterApiKey()
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY is required to run the subtitle benchmark",
      )
    }
    const result = await runSubtitleEval({
      manifestPath,
      lockPath,
      corpusDirectory,
      outputDirectory: resolve(
        args.values.get("output-dir") ?? `${DEFAULT_WORK_ROOT}/runs`,
      ),
      model: args.values.get("model") ?? env.SUBTITLE_ENRICHMENT_MODEL,
      apiKey,
      timeoutMs: numberArgument(
        args.values.get("timeout-ms"),
        env.SUBTITLE_ENRICHMENT_TIMEOUT_MS,
        "timeout-ms",
      ),
      concurrency: numberArgument(
        args.values.get("concurrency"),
        1,
        "concurrency",
      ),
      caseIds: listArgument(args.values.get("case")),
      targetLanguages: listArgument(args.values.get("language")),
    })
    console.log(`Wrote subtitle eval JSON: ${result.reportPath}`)
    console.log(`Wrote subtitle eval review report: ${result.markdownPath}`)
    return
  }

  if (args.command === "score") {
    const caseId = requiredArgument(args.values, "case")
    const targetLanguage = requiredArgument(args.values, "language")
    const candidateVttPath = resolve(requiredArgument(args.values, "candidate"))
    const metrics = await scoreSubtitleCandidate({
      manifestPath,
      lockPath,
      corpusDirectory,
      caseId,
      targetLanguage,
      candidateVttPath,
    })
    console.log(JSON.stringify(metrics, null, 2))
    return
  }

  throw new Error(
    "Usage: subtitle eval <prepare|run|score> [--manifest=path] [--lock=path] [--corpus-dir=path]",
  )
}

function parseArguments(argv: string[]): CliArguments {
  const [command = "", ...rest] = argv
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (const argument of rest) {
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected subtitle eval argument: ${argument}`)
    }
    const separator = argument.indexOf("=")
    if (separator === -1) {
      flags.add(argument.slice(2))
      continue
    }
    const name = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!name || !value)
      throw new Error(`Invalid subtitle eval argument: ${argument}`)
    if (values.has(name))
      throw new Error(`Duplicate subtitle eval argument: --${name}`)
    values.set(name, value)
  }
  return { command, values, flags }
}

function requiredArgument(values: ReadonlyMap<string, string>, name: string) {
  const value = values.get(name)
  if (!value)
    throw new Error(`Missing required subtitle eval argument: --${name}`)
  return value
}

function numberArgument(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`)
  }
  return parsed
}

function listArgument(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length > 0 ? values : undefined
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Subtitle evaluation failed",
    )
    process.exitCode = 1
  })
}

export const _internals = {
  parseArguments,
  numberArgument,
  listArgument,
}
