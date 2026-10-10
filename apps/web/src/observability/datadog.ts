import tracer from "dd-trace"

import { configureDatadogLogForwarding } from "./datadog-logs"

let configured = false

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

  tracer.init({
    logInjection: true,
    runtimeMetrics: true,
    service: "forge-web",
  })

  tracer.use("graphql", DATADOG_GRAPHQL_CONFIG)
  configureDatadogLogForwarding()
}
