export type SearchFailureStage =
  | "model_check"
  | "embedding"
  | "vector_search"
  | "document_fetch"
  | "response_contract"
  | "http"
type FailureCategory =
  | "transport"
  | "provider"
  | "database"
  | "model"
  | "contract"
  | "unknown"
export type SafeSearchFailure = {
  stage: SearchFailureStage
  category: FailureCategory
  detail: string
}
const stages = new Set<string>([
  "model_check",
  "embedding",
  "vector_search",
  "document_fetch",
  "response_contract",
  "http",
])
const prismaCodes = new Set([
  "P1000",
  "P1001",
  "P1002",
  "P1008",
  "P1011",
  "P1017",
  "P2000",
  "P2002",
  "P2010",
  "P2024",
  "P2025",
  "P2034",
  "P2037",
])

/** Carries the boundary only. Original exception data is never serialized. */
export class SearchStageError extends Error {
  constructor(
    readonly stage: SearchFailureStage,
    readonly original: unknown,
  ) {
    super("search operation failed")
  }
}
export class EmbeddingProviderError extends Error {
  readonly retryable: boolean
  constructor(readonly status: number) {
    super("embeddings failed: " + status)
    this.retryable = status === 429 || status >= 500
  }
}
export class RetrievalModelMismatchError extends Error {}
export class EmbeddingResponseError extends Error {}

const failureStages = new WeakMap<object, SearchFailureStage>()

export async function inSearchStage<T>(
  stage: SearchFailureStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      failureStages.set(error, stage)
      throw error // Preserve existing exception identity and CLI diagnostics.
    }
    throw new SearchStageError(stage, error)
  }
}

/** Only closed classifications cross the log boundary; never message/stack/cause/meta. */
export function safeSearchFailure(error: unknown): SafeSearchFailure {
  try {
    return classifySearchFailure(error)
  } catch {
    return { stage: "http", category: "unknown", detail: "unclassified" }
  }
}
function classifySearchFailure(error: unknown): SafeSearchFailure {
  const recordedStage =
    error instanceof SearchStageError
      ? error.stage
      : typeof error === "object" && error !== null
        ? failureStages.get(error)
        : undefined
  const stage =
    recordedStage && stages.has(recordedStage) ? recordedStage : "http"
  const original = error instanceof SearchStageError ? error.original : error
  const result = (
    category: FailureCategory,
    detail: string,
  ): SafeSearchFailure => ({ stage, category, detail })
  if (original instanceof EmbeddingProviderError) {
    const status = original.status
    if (Number.isInteger(status) && status >= 400 && status <= 599)
      return result("provider", "http_" + status)
  }
  if (original instanceof RetrievalModelMismatchError)
    return result("model", "mismatch")
  if (original instanceof EmbeddingResponseError)
    return result("contract", "invalid_embedding")
  if (stage === "response_contract")
    return result("contract", "invalid_response")
  if (typeof original === "object" && original !== null) {
    // Read known fields defensively: even an exception with throwing getters must stay redacted.
    try {
      const fields = original as { name?: unknown; code?: unknown }
      const code = fields.code
      if (typeof code === "string" && prismaCodes.has(code))
        return result("database", code)
      const name = fields.name
      if (name === "AbortError" || name === "TimeoutError")
        return result("transport", "abort")
      if (stage === "embedding" && name === "TypeError")
        return result("transport", "network")
      if (stage === "embedding" && name === "SyntaxError")
        return result("contract", "invalid_embedding")
      if (
        name === "PrismaClientInitializationError" ||
        name === "PrismaClientKnownRequestError" ||
        name === "PrismaClientRustPanicError" ||
        name === "PrismaClientValidationError"
      )
        return result("database", "unclassified")
    } catch {
      /* Unknown exceptions remain bounded. */
    }
  }
  return result("unknown", "unclassified")
}
