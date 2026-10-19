import tracer from "dd-trace"

import { configureDatadogLogForwarding } from "./datadog-logs"
import { instanceTags, resolveInstanceIdentity } from "./instance-identity"
import { installNextCacheTelemetry } from "./next-cache-telemetry"
import { startSchedulerPressureMetrics } from "./scheduler-pressure"

let configured = false

// dd-trace types the callback span as optional; it is always present when the
// tracer is enabled, and a no-op keeps disabled tracing harmless.
const NOOP_SPAN = { setTag: () => undefined }

export const DATADOG_GRAPHQL_CONFIG = {
  collapse: true,
  depth: -1,
  signature: true,
  source: false,
  variables: undefined,
} as const

export function configureDatadog(): void {
  if (configured) return
  configured = true

  // Production preloads dd-trace with `--require dd-trace/init`, which
  // initializes from DD_* env first; this call is then a no-op and these
  // options apply only when the preload is absent.
  tracer.init({
    logInjection: true,
    runtimeMetrics: true,
    service: "forge-web",
  })

  tracer.use("graphql", DATADOG_GRAPHQL_CONFIG)
  configureDatadogLogForwarding()
  startSchedulerPressureMetrics((metric, value, tags) =>
    tracer.dogstatsd.gauge(metric, value, tags),
  )
  installNextCacheTelemetry({
    distribution: (metric, value, tags) =>
      tracer.dogstatsd.distribution(metric, value, tags),
    tags: instanceTags(resolveInstanceIdentity()),
    tracer: {
      trace: (name, options, fn) =>
        tracer.trace(name, options, (span) => fn(span ?? NOOP_SPAN)),
    },
  })
}
