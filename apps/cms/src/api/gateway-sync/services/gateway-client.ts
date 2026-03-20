import type { Core } from "@strapi/strapi"

const GATEWAY_URL =
  process.env.GATEWAY_SYNC_URL ?? "https://api-gateway.central.jesusfilm.org/"
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1_000

function getTimeoutMs(): number {
  const env = process.env.GATEWAY_SYNC_TIMEOUT_MS
  return env ? Number(env) : DEFAULT_TIMEOUT_MS
}

function isTransientError(status: number): boolean {
  return status === 429 || status >= 500
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function queryGateway<T>(
  query: string,
  variables?: Record<string, unknown>,
  strapi?: Core.Strapi,
): Promise<T> {
  const timeoutMs = getTimeoutMs()
  let lastError: Error | undefined
  const queryName = query.match(/\{\s*(\w+)/)?.[1] ?? "unknown"
  const varsStr = variables ? JSON.stringify(variables) : ""
  const msg = `[gateway-sync] Querying gateway: ${queryName} ${varsStr}`
  if (strapi) strapi.log.info(msg)
  else console.log(msg)

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = INITIAL_BACKOFF_MS * 2 ** (attempt - 1)
      await sleep(backoff)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        if (isTransientError(response.status) && attempt < MAX_RETRIES - 1) {
          lastError = new Error(
            `Gateway returned ${response.status}: ${response.statusText}`,
          )
          continue
        }
        throw new Error(
          `Gateway returned ${response.status}: ${response.statusText}`,
        )
      }

      const json = (await response.json()) as {
        data?: T
        errors?: Array<{ message: string }>
      }

      if (json.errors?.length) {
        throw new Error(
          `Gateway GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`,
        )
      }

      if (!json.data) {
        throw new Error("Gateway returned no data")
      }

      return json.data
    } catch (error) {
      clearTimeout(timeout)

      if (
        error instanceof Error &&
        error.name === "AbortError" &&
        attempt < MAX_RETRIES - 1
      ) {
        lastError = new Error(`Gateway request timed out after ${timeoutMs}ms`)
        continue
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Gateway request timed out after ${timeoutMs}ms`)
      }

      throw error
    }
  }

  throw lastError ?? new Error("Gateway request failed after all retries")
}
