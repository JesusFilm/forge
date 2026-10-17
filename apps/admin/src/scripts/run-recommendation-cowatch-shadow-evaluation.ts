import { pathToFileURL } from "node:url"
import { z } from "zod"
import { RECOMMENDATION_RAW_RETENTION_DAYS } from "../services/recommendations/contracts"
import {
  COWATCH_MMR_TRIAL_MANIFEST_ID,
  HYBRID_PERSONALIZED_MANIFEST_ID,
} from "../services/recommendations/promotion/manifest"
import {
  RecommendationConflictError,
  RecommendationInputError,
} from "../services/recommendations/errors"

const VALUE_OPTIONS = new Set([
  "--evaluation-id",
  "--generation-id",
  "--manifest-id",
  "--window-start",
  "--window-end",
  "--sample-size",
  "--minimum-runs",
])

export function parseCowatchShadowEvaluationArguments(
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
        "Unknown, duplicate or incomplete shadow evaluation option",
      )
    }
    values.set(key, value)
    index++
  }
  if (
    !execute ||
    values.size !== VALUE_OPTIONS.size - (values.has("--manifest-id") ? 0 : 1)
  ) {
    throw new RecommendationInputError(
      "Required: --execute --evaluation-id UUID --generation-id SHA256 --window-start ISO --window-end ISO --sample-size --minimum-runs",
    )
  }

  const evaluationId = values.get("--evaluation-id")!
  if (!z.uuid().safeParse(evaluationId).success) {
    throw new RecommendationInputError("--evaluation-id must be a UUID")
  }
  const cowatchGenerationId = values.get("--generation-id")!
  if (!/^[a-f0-9]{64}$/.test(cowatchGenerationId)) {
    throw new RecommendationInputError(
      "--generation-id must be an exact lowercase SHA256 graph identity",
    )
  }
  const manifestId =
    values.get("--manifest-id") ?? HYBRID_PERSONALIZED_MANIFEST_ID
  if (
    manifestId !== HYBRID_PERSONALIZED_MANIFEST_ID &&
    manifestId !== COWATCH_MMR_TRIAL_MANIFEST_ID
  ) {
    throw new RecommendationInputError(
      "--manifest-id must name an exact supported co-watch shadow manifest",
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
  function positiveInteger(key: string) {
    const value = values.get(key)!
    const parsed = Number(value)
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed)) {
      throw new RecommendationInputError(`${key} must be a positive integer`)
    }
    return parsed
  }
  const windowStart = timestamp("--window-start")
  const windowEnd = timestamp("--window-end")
  const requestedSampleSize = positiveInteger("--sample-size")
  const minimumRuns = positiveInteger("--minimum-runs")
  if (requestedSampleSize > 10_000 || minimumRuns > requestedSampleSize) {
    throw new RecommendationInputError(
      "Sample size cannot exceed 10000; minimum runs cannot exceed sample size",
    )
  }
  if (
    windowStart >= windowEnd ||
    windowEnd.getTime() > now.getTime() + 60_000 ||
    windowStart.getTime() <
      now.getTime() - RECOMMENDATION_RAW_RETENTION_DAYS * 86_400_000
  ) {
    throw new RecommendationInputError(
      "The event window must be ordered, closed and within raw recommendation retention",
    )
  }
  return {
    evaluationId,
    cowatchGenerationId,
    ...(values.has("--manifest-id") ? { manifestId } : {}),
    windowStart,
    windowEnd,
    requestedSampleSize,
    minimumRuns,
  }
}

type EvaluationInput = ReturnType<
  typeof parseCowatchShadowEvaluationArguments
> & { actorId: string; now: Date }

async function loadRuntime() {
  const { prisma } = await import("../db/client")
  const { startExactCowatchShadowEvaluation } =
    await import("../services/recommendations/shadow-evaluation/operator")
  return {
    dispatch: (input: EvaluationInput) =>
      startExactCowatchShadowEvaluation(prisma, input),
    disconnect: () => prisma.$disconnect(),
  }
}

export async function runCowatchShadowEvaluationCli(
  argv: readonly string[],
  options: {
    now?: () => Date
    write?: (receipt: string) => void
    loadRuntime?: typeof loadRuntime
  } = {},
) {
  const now = (options.now ?? (() => new Date()))()
  const input = parseCowatchShadowEvaluationArguments(argv, now)
  const write = options.write ?? ((receipt) => process.stdout.write(receipt))
  // Emit only the explicit retry tuple before loading or calling the runtime.
  write(`${JSON.stringify({ status: "dispatch_intent", ...input })}\n`)
  const runtime = await (options.loadRuntime ?? loadRuntime)()
  try {
    const result = await runtime.dispatch({
      ...input,
      actorId: "cowatch-shadow-cli",
      now,
    })
    write(`${JSON.stringify(result)}\n`)
    return result
  } finally {
    await runtime.disconnect()
  }
}

export function cowatchShadowEvaluationErrorMessage(error: unknown): string {
  return error instanceof RecommendationInputError ||
    error instanceof RecommendationConflictError
    ? error.message
    : "Shadow evaluation dispatch failed; inspect private runtime diagnostics before retrying the recorded tuple."
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCowatchShadowEvaluationCli(process.argv.slice(2)).catch((error) => {
    console.error(cowatchShadowEvaluationErrorMessage(error))
    process.exitCode = 1
  })
}
