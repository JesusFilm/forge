import { after } from "next/server"
import { env } from "@/config/env"
import {
  createRecommendationClickHouseClient,
  RecommendationClickHouseError,
  type RecommendationClickHouseClient,
} from "./clickhouse"
import { createRecommendationEventDispatcher } from "./dispatch"
import type { RecommendationEventEnvelope } from "./envelope"

type RuntimeSettings = {
  enabled: boolean
  disabledReason?: "configuration"
  client?: Pick<RecommendationClickHouseClient, "insert">
  maxInFlight?: number
  maxInFlightBytes?: number
}

function createRuntime(
  settings: RuntimeSettings,
  register?: (started: Promise<void>) => void,
) {
  if (settings.enabled && !settings.client)
    throw new RecommendationClickHouseError("configuration")
  return createRecommendationEventDispatcher({
    client: settings.enabled ? settings.client! : null,
    disabledReason: settings.disabledReason,
    register,
    maxInFlight: settings.maxInFlight,
    maxInFlightBytes: settings.maxInFlightBytes,
    log:
      settings.enabled || settings.disabledReason
        ? (line) => console.warn(line)
        : undefined,
  })
}

/** Call from a Next request after the operational transaction commits. */
export function createNextRecommendationEventDispatcher(
  settings: RuntimeSettings,
) {
  return createRuntime(settings, (started) => after(started))
}

/** Workers own the returned dispatcher and await close() on graceful shutdown. */
export function createWorkerRecommendationEventDispatcher(
  settings: RuntimeSettings,
) {
  return createRuntime(settings)
}

function configuredSettings(): RuntimeSettings {
  if (env.RECOMMENDATION_EVENT_EXPORT_ENABLED !== "true")
    return { enabled: false }
  if (
    !env.RECOMMENDATION_CLICKHOUSE_ENDPOINT ||
    !env.RECOMMENDATION_CLICKHOUSE_DATABASE ||
    !env.RECOMMENDATION_CLICKHOUSE_USERNAME ||
    !env.RECOMMENDATION_CLICKHOUSE_PASSWORD
  )
    return { enabled: false, disabledReason: "configuration" }
  try {
    return {
      enabled: true,
      client: createRecommendationClickHouseClient({
        endpoint: env.RECOMMENDATION_CLICKHOUSE_ENDPOINT,
        database: env.RECOMMENDATION_CLICKHOUSE_DATABASE,
        username: env.RECOMMENDATION_CLICKHOUSE_USERNAME,
        password: env.RECOMMENDATION_CLICKHOUSE_PASSWORD,
        timeoutMs: env.RECOMMENDATION_CLICKHOUSE_TIMEOUT_MS,
      }),
      maxInFlight: env.RECOMMENDATION_EVENT_MAX_IN_FLIGHT,
      maxInFlightBytes: env.RECOMMENDATION_EVENT_MAX_IN_FLIGHT_BYTES,
    }
  } catch {
    return { enabled: false, disabledReason: "configuration" }
  }
}

let nextRuntime:
  | ReturnType<typeof createNextRecommendationEventDispatcher>
  | undefined

/** Lazy process-wide limits; no network activity occurs at module import. */
export function getNextRecommendationEventDispatcher() {
  return (nextRuntime ??=
    createNextRecommendationEventDispatcher(configuredSettings()))
}

export function dispatchRecommendationEventsAfterCommit(
  events: readonly RecommendationEventEnvelope[],
): void {
  getNextRecommendationEventDispatcher().dispatch(events)
}

export function createConfiguredWorkerRecommendationEventDispatcher() {
  return createWorkerRecommendationEventDispatcher(configuredSettings())
}
