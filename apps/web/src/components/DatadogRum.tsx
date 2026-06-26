"use client"

import { datadogRum, type RumInitConfiguration } from "@datadog/browser-rum"
import { reactPlugin } from "@datadog/browser-rum-react"
import { useEffect, useRef } from "react"

import { env } from "@/env"

const DATADOG_SERVICE = "forge-web"

const DATADOG_ALLOWED_TRACING_URLS = [
  {
    match: "https://api-gateway.central.jesusfilm.org/",
    propagatorTypes: ["tracecontext"],
  },
  {
    match: "https://api-gateway.stage.central.jesusfilm.org/",
    propagatorTypes: ["tracecontext"],
  },
  {
    match: "https://admin.jesusfilm.org/api/graphql",
    propagatorTypes: ["tracecontext"],
  },
] satisfies NonNullable<RumInitConfiguration["allowedTracingUrls"]>

export function getDatadogRumInitConfig(): RumInitConfiguration | null {
  const applicationId = env.NEXT_PUBLIC_DATADOG_APPLICATION_ID
  const clientToken = env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN

  if (!applicationId || !clientToken) return null

  return {
    applicationId,
    clientToken,
    site: env.NEXT_PUBLIC_DATADOG_SITE,
    service: DATADOG_SERVICE,
    env: env.NEXT_PUBLIC_DATADOG_ENV,
    version: env.NEXT_PUBLIC_DATADOG_VERSION,
    sessionSampleRate: 50,
    sessionReplaySampleRate: 10,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    defaultPrivacyLevel: "mask-user-input",
    allowedTracingUrls: DATADOG_ALLOWED_TRACING_URLS,
    plugins: [reactPlugin()],
  }
}

export function reportDatadogRumError(
  error: unknown,
  context: Record<string, unknown>,
) {
  try {
    datadogRum.addError(error, context)
  } catch (reportError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[datadog-rum] failed to report error:", reportError)
    }
  }
}

export default function DatadogRum() {
  const isInitialized = useRef(false)

  useEffect(() => {
    if (isInitialized.current) return

    const config = getDatadogRumInitConfig()
    if (config == null) return

    try {
      datadogRum.init(config)
      isInitialized.current = true
    } catch (error) {
      console.error("[datadog-rum] failed to initialize:", error)
    }
  }, [])

  return null
}
