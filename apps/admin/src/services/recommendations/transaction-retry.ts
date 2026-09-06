import { RecommendationInternalStateError } from "./errors"

const MAX_SERIALIZABLE_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 5

function prismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null
  const code = "code" in error ? String(error.code) : null
  if (code) return code
  return "cause" in error ? prismaErrorCode(error.cause) : null
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Retry only Prisma's documented Serializable write-conflict error. */
export async function withRecommendationSerializableRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (
        prismaErrorCode(error) !== "P2034" ||
        attempt === MAX_SERIALIZABLE_ATTEMPTS
      ) {
        throw error
      }
      await sleep(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1))
    }
  }
  throw new RecommendationInternalStateError(
    "recommendation_transaction_retry_unreachable",
  )
}
