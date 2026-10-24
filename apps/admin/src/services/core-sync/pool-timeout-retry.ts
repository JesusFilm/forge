type RetryEvent = {
  operation: string
  attempt: number
  nextAttempt: number
  delayMs: number
}

export type PrismaPoolRetryOptions = {
  operation: string
  maxAttempts?: number
  baseDelayMs?: number
  sleep?: (delayMs: number) => Promise<void>
  onRetry?: (event: RetryEvent) => void
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 1_000

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs)
    timer.unref?.()
  })
}

function readErrorCode(error: unknown): unknown {
  return error != null && typeof error === "object"
    ? (error as { code?: unknown }).code
    : undefined
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === "string" ? error : ""
}

export function isPrismaPoolTimeoutError(error: unknown): boolean {
  if (readErrorCode(error) === "P2024") return true

  const message = readErrorMessage(error)
  return (
    message.includes("P2024") ||
    message.includes(
      "Timed out fetching a new connection from the connection pool",
    )
  )
}

export async function withPrismaPoolTimeoutRetry<T>(
  run: () => Promise<T>,
  {
    operation,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    sleep = defaultSleep,
    onRetry = defaultPoolRetryLog,
  }: PrismaPoolRetryOptions,
): Promise<T> {
  let attempt = 1

  while (true) {
    try {
      return await run()
    } catch (error) {
      if (!isPrismaPoolTimeoutError(error) || attempt >= maxAttempts) {
        throw error
      }

      const delayMs = baseDelayMs * attempt
      onRetry({ operation, attempt, nextAttempt: attempt + 1, delayMs })
      await sleep(delayMs)
      attempt++
    }
  }
}

function defaultPoolRetryLog({
  operation,
  attempt,
  nextAttempt,
  delayMs,
}: RetryEvent) {
  console.warn(
    `[core-sync] event=prisma_pool_retry operation=${operation} attempt=${attempt} nextAttempt=${nextAttempt} delayMs=${delayMs}`,
  )
}
