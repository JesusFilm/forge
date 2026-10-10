import tracer from "dd-trace"

import { env } from "@/config/env"
import { configureDatadogLogForwarding } from "./datadog-logs"

let configured = false
let datadogOtelTracerProvider:
  | InstanceType<typeof tracer.TracerProvider>
  | undefined

export const DATADOG_GRAPHQL_CONFIG = {
  collapse: true,
  depth: -1,
  signature: true,
  source: false,
  variables: undefined,
} as const

export function getDatadogOtelTracerProvider(): InstanceType<
  typeof tracer.TracerProvider
> {
  datadogOtelTracerProvider ??= new tracer.TracerProvider()
  return datadogOtelTracerProvider
}

export function configureDatadog(): void {
  if (configured) return
  configured = true

  tracer.init({
    logInjection: true,
    runtimeMetrics: true,
    service: env.DD_SERVICE ?? "forge-admin",
  })

  getDatadogOtelTracerProvider().register()
  tracer.use("graphql", DATADOG_GRAPHQL_CONFIG)
  configureDatadogLogForwarding()
}
