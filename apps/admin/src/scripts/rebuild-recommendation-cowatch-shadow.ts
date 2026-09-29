import { pathToFileURL } from "node:url"
import { z } from "zod"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "../services/recommendations/errors"
import {
  assertCowatchSourceWindow,
  COWATCH_SOURCE_WINDOW_VERSION,
  type CowatchSourceWindow,
} from "../services/recommendations/cowatch/source-window"

const VALUE_OPTIONS = new Set([
  "--window-start",
  "--window-end",
  "--evaluation-as-of",
])

export function parseCowatchRebuildArguments(
  argv: readonly string[],
  now: Date,
) {
  const values = new Map<string, string>()
  let execute = false
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (key === "--execute") {
      if (execute) throw new RecommendationInputError("Duplicate --execute")
      execute = true
      continue
    }
    const value = argv[index + 1]
    if (
      !VALUE_OPTIONS.has(key) ||
      values.has(key) ||
      !value ||
      value.startsWith("--")
    ) {
      throw new RecommendationInputError(
        "Unknown, duplicate or incomplete co-watch rebuild option",
      )
    }
    values.set(key, value)
    index++
  }
  if (values.size !== VALUE_OPTIONS.size) {
    throw new RecommendationInputError(
      "Required: --window-start ISO --window-end ISO --evaluation-as-of ISO; add --execute to publish",
    )
  }
  function timestamp(key: string) {
    const value = values.get(key)!
    if (
      !z.iso.datetime({ offset: true }).safeParse(value).success ||
      /\.\d{4,}/.test(value)
    ) {
      throw new RecommendationInputError(
        `${key} must be an ISO timestamp with a timezone and at most millisecond precision`,
      )
    }
    return new Date(value)
  }
  const sourceWindow: CowatchSourceWindow = {
    version: COWATCH_SOURCE_WINDOW_VERSION,
    windowStart: timestamp("--window-start"),
    windowEnd: timestamp("--window-end"),
    evaluationAsOf: timestamp("--evaluation-as-of"),
  }
  assertCowatchSourceWindow(sourceWindow, now)
  return { execute, sourceWindow }
}

async function loadRuntime() {
  const { prisma } = await import("../db/client")
  const { preflightCowatchShadowGeneration, publishCowatchShadowGeneration } =
    await import("../services/recommendations/cowatch/projection.service")
  return {
    preflight: (now: Date, scope: CowatchSourceWindow) =>
      preflightCowatchShadowGeneration(prisma, now, scope),
    publish: (now: Date, scope: CowatchSourceWindow) =>
      publishCowatchShadowGeneration(prisma, now, scope),
    disconnect: () => prisma.$disconnect(),
  }
}

export async function runCowatchRebuildCli(
  argv: readonly string[],
  options: {
    now?: () => Date
    write?: (receipt: string) => void
    loadRuntime?: typeof loadRuntime
  } = {},
) {
  const now = (options.now ?? (() => new Date()))()
  const input = parseCowatchRebuildArguments(argv, now)
  const runtime = await (options.loadRuntime ?? loadRuntime)()
  try {
    const result = input.execute
      ? await runtime.publish(now, input.sourceWindow)
      : await runtime.preflight(now, input.sourceWindow)
    // Aggregate-only output; no session, profile, episode or outcome identities.
    const write = options.write ?? ((receipt) => process.stdout.write(receipt))
    write(`${JSON.stringify(result)}\n`)
    return result
  } finally {
    await runtime.disconnect()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCowatchRebuildCli(process.argv.slice(2))
    .then((result) => {
      if (
        result.status === "source_overflow" ||
        result.status === "work_overflow"
      )
        process.exitCode = 2
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof RecommendationInputError ||
          error instanceof RecommendationConflictError
          ? error.message
          : "Co-watch rebuild failed; inspect private runtime diagnostics before retrying the same scope.",
      )
      process.exitCode = 1
    })
}
