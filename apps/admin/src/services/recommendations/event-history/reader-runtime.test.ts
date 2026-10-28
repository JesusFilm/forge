import { afterEach, describe, expect, it, vi } from "vitest"

const settings = vi.hoisted(() => ({
  RECOMMENDATION_WATCH_HISTORY_READER_ENABLED: "false",
  RECOMMENDATION_OPERATOR_TRACE_READER_ENABLED: "false",
  RECOMMENDATION_CLICKHOUSE_ENDPOINT: undefined as string | undefined,
  RECOMMENDATION_CLICKHOUSE_DATABASE: undefined as string | undefined,
  RECOMMENDATION_CLICKHOUSE_USERNAME: undefined as string | undefined,
  RECOMMENDATION_CLICKHOUSE_PASSWORD: undefined as string | undefined,
}))
vi.mock("@/config/env", () => ({ env: settings }))

import {
  getConfiguredWatchExposureHistoryReader,
  getConfiguredOperatorTraceHistoryReader,
} from "./reader-runtime"

describe("Watch report reader gate", () => {
  afterEach(() => {
    settings.RECOMMENDATION_WATCH_HISTORY_READER_ENABLED = "false"
    settings.RECOMMENDATION_OPERATOR_TRACE_READER_ENABLED = "false"
    settings.RECOMMENDATION_CLICKHOUSE_ENDPOINT = undefined
    settings.RECOMMENDATION_CLICKHOUSE_DATABASE = undefined
    settings.RECOMMENDATION_CLICKHOUSE_USERNAME = undefined
    settings.RECOMMENDATION_CLICKHOUSE_PASSWORD = undefined
  })

  it("keeps the PostgreSQL reader by default", () => {
    expect(getConfiguredWatchExposureHistoryReader()).toBeNull()
  })

  it("reports missing ClickHouse configuration instead of falling back", () => {
    settings.RECOMMENDATION_WATCH_HISTORY_READER_ENABLED = "true"
    expect(getConfiguredWatchExposureHistoryReader).toThrowError(
      "Recommendation ClickHouse configuration",
    )
  })

  it("returns a bounded authenticated reader when configured", () => {
    settings.RECOMMENDATION_WATCH_HISTORY_READER_ENABLED = "true"
    settings.RECOMMENDATION_CLICKHOUSE_ENDPOINT =
      "https://clickhouse.example.test/"
    settings.RECOMMENDATION_CLICKHOUSE_DATABASE = "events"
    settings.RECOMMENDATION_CLICKHOUSE_USERNAME = "reader"
    settings.RECOMMENDATION_CLICKHOUSE_PASSWORD = "secret"
    expect(getConfiguredWatchExposureHistoryReader()).toHaveProperty(
      "watchExposureBreakdown",
      expect.any(Function),
    )
  })
})

describe("operator trace reader gate", () => {
  it("is independent and default off", () => {
    settings.RECOMMENDATION_WATCH_HISTORY_READER_ENABLED = "true"
    expect(getConfiguredOperatorTraceHistoryReader()).toBeNull()
  })

  it("reports missing configuration when enabled", () => {
    settings.RECOMMENDATION_OPERATOR_TRACE_READER_ENABLED = "true"
    expect(getConfiguredOperatorTraceHistoryReader).toThrowError(
      "Recommendation ClickHouse configuration",
    )
  })
})
