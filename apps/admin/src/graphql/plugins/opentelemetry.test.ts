import { describe, expect, it, vi } from "vitest"

const provider = { getTracer: vi.fn() }
const useOpenTelemetry = vi.fn(() => ({ name: "otel-plugin" }))

vi.mock("@/observability/datadog", () => ({
  getDatadogOtelTracerProvider: () => provider,
}))

vi.mock("@envelop/opentelemetry", () => ({
  useOpenTelemetry,
}))

const { GRAPHQL_OTEL_TRACING_OPTIONS, openTelemetryPlugin } =
  await import("./opentelemetry")

describe("openTelemetryPlugin", () => {
  it("uses the official Envelop OpenTelemetry plugin without raw payload capture", () => {
    expect(GRAPHQL_OTEL_TRACING_OPTIONS).toEqual({
      document: false,
      resolvers: false,
      defaultResolvers: false,
      variables: false,
      result: false,
    })

    expect(useOpenTelemetry).toHaveBeenCalledTimes(1)
    expect(useOpenTelemetry).toHaveBeenCalledWith(
      GRAPHQL_OTEL_TRACING_OPTIONS,
      provider,
      expect.any(Number),
      {},
      "forge-admin.graphql",
      "graphql.",
    )
    expect(openTelemetryPlugin).toEqual({ name: "otel-plugin" })
  })
})
