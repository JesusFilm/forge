import { useCallback, useEffect } from "react"
import type { ReactNode } from "react"
import {
  DatadogProvider,
  DatadogProviderConfiguration,
  SdkVerbosity,
  TrackingConsent,
} from "@datadog/mobile-react-native"
import {
  ImagePrivacyLevel,
  SessionReplay,
  TextAndInputPrivacyLevel,
  TouchPrivacyLevel,
} from "@datadog/mobile-react-native-session-replay"

import {
  DATADOG_SERVICE,
  datadogInitWatchdog,
  getDatadogRumConfig,
  toFirstPartyHostConfigs,
} from "../lib/datadog"

/**
 * Wraps the app in Datadog RUM when provisioned; transparent pass-through otherwise.
 * The ErrorBoundary above only catches render-time throws (config construction) —
 * SDK native init is async fire-and-forget, so init failure no-ops telemetry, never crashes.
 */
export function MobileDatadogProvider({ children }: { children: ReactNode }) {
  const config = getDatadogRumConfig()
  const provisioned = config != null

  // Dev-only: surface the disabled gate so a creds-less build is diagnosable,
  // and arm the init watchdog so a provisioned-but-dead SDK warns within ~10s.
  useEffect(() => {
    if (!__DEV__) return
    if (!provisioned) {
      console.warn(
        "[datadog] RUM disabled: set EXPO_PUBLIC_DATADOG_CLIENT_TOKEN and EXPO_PUBLIC_DATADOG_APPLICATION_ID to enable telemetry",
      )
      return
    }
    datadogInitWatchdog.arm()
  }, [provisioned])

  // Session Replay must start only after native SDK init, so it rides the
  // provider's onInitialization callback (never a mount effect, which can race
  // ahead of init). config is null on unprovisioned builds → replay never enables.
  const replaySampleRate = config?.replaySampleRate ?? 100
  const handleInitialization = useCallback(() => {
    datadogInitWatchdog.markInitialized()
    try {
      // MASK_ALL_INPUTS blanks the search field in the visual replay (raw terms
      // still go to Logs by design); the native video texture is uncapturable, so
      // it never leaks frames — no per-view mask needed (U11).
      void SessionReplay.enable({
        replaySampleRate,
        textAndInputPrivacyLevel: TextAndInputPrivacyLevel.MASK_ALL_INPUTS,
        imagePrivacyLevel: ImagePrivacyLevel.MASK_NONE,
        touchPrivacyLevel: TouchPrivacyLevel.SHOW,
      }).catch(() => undefined)
    } catch {
      // Replay must never break the app.
    }
  }, [replaySampleRate])

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
      // Enable the Logs feature (SDK v3 requires it explicitly, or DdLogs
      // silently no-ops) — the entire caught-path strategy emits via datadogLog.
      logsConfiguration: {},
      rumConfiguration: {
        applicationId: config.applicationId,
        // Auto tap-actions are named from accessibilityLabel; U9 adds
        // dd-action-name overrides so no typed/PII text leaks (KTD10).
        trackInteractions: true,
        trackResources: true, // auto-instruments fetch/XHR into per-request RUM
        // Preview-smoke finding: cancelled/superseded GraphQL requests surface
        // here as -999 + "Aborted" RUM errors (noise, not real failures). A clean
        // filter needs errorEventMapper — file-config-only (see the RN mapper doc).
        trackErrors: true,
        nativeCrashReportEnabled: true,
        sessionSampleRate: config.sessionSampleRate,
        resourceTraceSampleRate: 100,
        firstPartyHosts: toFirstPartyHostConfigs(config.firstPartyHosts),
      },
    },
  )

  return (
    <DatadogProvider
      configuration={configuration}
      onInitialization={handleInitialization}
    >
      {children}
    </DatadogProvider>
  )
}
