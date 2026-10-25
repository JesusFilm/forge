import { SpanKind } from "@opentelemetry/api"
import { useOpenTelemetry, type TracingOptions } from "@envelop/opentelemetry"

import { getDatadogOtelTracerProvider } from "@/observability/datadog"

export const GRAPHQL_OTEL_TRACING_OPTIONS = {
  document: false,
  resolvers: false,
  defaultResolvers: false,
  variables: false,
  result: false,
} satisfies TracingOptions

export const openTelemetryPlugin = useOpenTelemetry(
  GRAPHQL_OTEL_TRACING_OPTIONS,
  getDatadogOtelTracerProvider(),
  SpanKind.INTERNAL,
  {},
  "forge-admin.graphql",
  "graphql.",
)
