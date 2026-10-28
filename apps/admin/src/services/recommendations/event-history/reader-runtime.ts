import { env } from "@/config/env"
import {
  createRecommendationClickHouseClient,
  RecommendationClickHouseError,
} from "./clickhouse"

/** Null keeps the existing PostgreSQL report until the reader gate is enabled. */
export function getConfiguredWatchExposureHistoryReader() {
  if (env.RECOMMENDATION_WATCH_HISTORY_READER_ENABLED !== "true") return null
  if (
    !env.RECOMMENDATION_CLICKHOUSE_ENDPOINT ||
    !env.RECOMMENDATION_CLICKHOUSE_DATABASE ||
    !env.RECOMMENDATION_CLICKHOUSE_USERNAME ||
    !env.RECOMMENDATION_CLICKHOUSE_PASSWORD
  )
    throw new RecommendationClickHouseError("configuration")
  return createRecommendationClickHouseClient({
    endpoint: env.RECOMMENDATION_CLICKHOUSE_ENDPOINT,
    database: env.RECOMMENDATION_CLICKHOUSE_DATABASE,
    username: env.RECOMMENDATION_CLICKHOUSE_USERNAME,
    password: env.RECOMMENDATION_CLICKHOUSE_PASSWORD,
    timeoutMs: 3_000,
  })
}

/** Independent default-off gate for authorized operator request detail. */
export function getConfiguredOperatorTraceHistoryReader() {
  if (env.RECOMMENDATION_OPERATOR_TRACE_READER_ENABLED !== "true") return null
  if (
    !env.RECOMMENDATION_CLICKHOUSE_ENDPOINT ||
    !env.RECOMMENDATION_CLICKHOUSE_DATABASE ||
    !env.RECOMMENDATION_CLICKHOUSE_USERNAME ||
    !env.RECOMMENDATION_CLICKHOUSE_PASSWORD
  )
    throw new RecommendationClickHouseError("configuration")
  return createRecommendationClickHouseClient({
    endpoint: env.RECOMMENDATION_CLICKHOUSE_ENDPOINT,
    database: env.RECOMMENDATION_CLICKHOUSE_DATABASE,
    username: env.RECOMMENDATION_CLICKHOUSE_USERNAME,
    password: env.RECOMMENDATION_CLICKHOUSE_PASSWORD,
    timeoutMs: 3_000,
  })
}
