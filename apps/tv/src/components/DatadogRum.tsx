import { useEffect } from "react"
import type { ReactNode } from "react"
import {
  DatadogProvider,
  DatadogProviderConfiguration,
  SdkVerbosity,
  TrackingConsent,
} from "@datadog/mobile-react-native"

import {
  DATADOG_SERVICE,
  datadogLog,
  getDatadogRumConfig,
  reportDatadogError,
  toFirstPartyHostConfigs,
} from "../lib/datadog"

/**
 * Wraps the app in Datadog RUM when provisioned; transparent pass-through otherwise.
 * The ErrorBoundary above only catches render-time throws (config construction) —
 * SDK native init is async fire-and-forget, so init failure no-ops telemetry, never crashes.
 */
export function TvDatadogProvider({ children }: { children: ReactNode }) {
  const config = getDatadogRumConfig()
  const provisioned = config != null

  // Dev-only: surface the disabled gate in logs, and fire one RUM error + one
  // log so a freshly provisioned run self-confirms the pipe (search "tv boot
  // smoke" in Datadog). Smoke is TEMPORARY scaffolding — remove once verified.
  useEffect(() => {
    if (!__DEV__) return
    if (!provisioned) {
      console.warn(
        "[datadog] RUM disabled: set EXPO_PUBLIC_DATADOG_CLIENT_TOKEN and EXPO_PUBLIC_DATADOG_APPLICATION_ID to enable telemetry",
      )
      return
    }
    reportDatadogError(new Error("[datadog] tv boot smoke"), { origin: "boot" })
    datadogLog.info("[datadog] tv boot smoke", { origin: "boot" })
  }, [provisioned])

  if (!config) return <>{children}</>

  const configuration = new DatadogProviderConfiguration(
    config.clientToken,
    config.envName,
    TrackingConsent.GRANTED,
    {
      site: config.site,
      service: DATADOG_SERVICE,
      verbosity: __DEV__ ? SdkVerbosity.DEBUG : SdkVerbosity.WARN,
      version: config.version,
      // Enable the Logs feature (v3 requires it explicitly) so DdLogs works.
      logsConfiguration: {},
      rumConfiguration: {
        applicationId: config.applicationId,
        trackInteractions: true,
        trackResources: true, // auto-instruments fetch/XHR into per-request RUM
        trackErrors: true,
        nativeCrashReportEnabled: true,
        sessionSampleRate: config.sessionSampleRate,
        resourceTraceSampleRate: 100,
        firstPartyHosts: toFirstPartyHostConfigs(config.firstPartyHosts),
      },
    },
  )

  return (
    <DatadogProvider configuration={configuration}>{children}</DatadogProvider>
  )
}
