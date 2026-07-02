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
  getDatadogRumConfig,
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

  // Dev-only: surface the disabled gate so a creds-less build is diagnosable.
  useEffect(() => {
    if (!__DEV__ || provisioned) return
    console.warn(
      "[datadog] RUM disabled: set EXPO_PUBLIC_DATADOG_CLIENT_TOKEN and EXPO_PUBLIC_DATADOG_APPLICATION_ID to enable telemetry",
    )
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
