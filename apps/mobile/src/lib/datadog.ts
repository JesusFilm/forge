import {
  DATADOG_GRAPH_QL_OPERATION_NAME_HEADER,
  DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER,
  DdLogs,
  DdRum,
  ErrorSource,
  PropagatorType,
  RumActionType,
} from "@datadog/mobile-react-native"

import { env } from "../env"
import { getGraphQLUrl } from "./config"

/** Datadog service name for the mobile app (mirrors web `forge-web` / tv `forge-tv`). */
export const DATADOG_SERVICE = "forge-mobile"

/** Re-exported so consumers read the op-name header without importing the SDK. */
export { DATADOG_GRAPH_QL_OPERATION_NAME_HEADER }

export type DatadogRumConfig = {
  clientToken: string
  applicationId: string
  site: string
  envName: string
  version?: string
  sessionSampleRate: number
  replaySampleRate: number
  firstPartyHosts: string[]
}

// Bare hostname, no port: the SDK matches first-party hosts against the
// request's port-less hostname, so "localhost:3003" would never match.
export function hostFromUrl(url: string): string {
  return new URL(url).hostname
}

/** Maps bare hosts to the SDK's first-party shape (tracecontext → admin APM). */
export function toFirstPartyHostConfigs(
  hosts: string[],
): { match: string; propagatorTypes: PropagatorType[] }[] {
  return hosts.map((match) => ({
    match,
    propagatorTypes: [PropagatorType.TRACECONTEXT],
  }))
}

// Session/replay rates are env vars (R5) so production can be dialed toward
// web's 50% without a code change. TV hardcodes 100; mobile reads env.
export function parseSampleRate(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw == null || raw === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback
}

// Single source of truth for the provisioning gate, so isDatadogProvisioned and
// getDatadogRumConfig stay in lockstep if the required-credential set ever grows.
function getDatadogCredentials(): {
  clientToken: string
  applicationId: string
} | null {
  const clientToken = env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN
  const applicationId = env.EXPO_PUBLIC_DATADOG_APPLICATION_ID
  if (!clientToken || !applicationId) return null
  return { clientToken, applicationId }
}

// Mirrors web's getDatadogRumInitConfig: returns null (a no-op) unless BOTH the
// client token and application id are provisioned, so a build without Datadog env
// still boots instead of crashing on init.
export function getDatadogRumConfig(): DatadogRumConfig | null {
  const credentials = getDatadogCredentials()
  if (credentials == null) return null

  return {
    ...credentials,
    site: env.EXPO_PUBLIC_DATADOG_SITE ?? "US1",
    // Default by build type: a provisioned release fleet missing the ENV var
    // must not file its telemetry under env:development.
    envName:
      env.EXPO_PUBLIC_DATADOG_ENV ?? (__DEV__ ? "development" : "production"),
    version: env.EXPO_PUBLIC_DATADOG_VERSION,
    // 100% by default (catch every crash/trace while early); env-tunable toward
    // web's 50% once mobile's volume and cost are known.
    sessionSampleRate: parseSampleRate(
      env.EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE,
      100,
    ),
    // Session Replay rate — same env-tunable posture as sessions (100% dev/preview,
    // dialed toward ~20% in prod via the per-EAS-env var). Masked at capture (U11).
    replaySampleRate: parseSampleRate(
      env.EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE,
      100,
    ),
    // Point trace propagation at admin's GraphQL host → links mobile RUM resources
    // to admin's server-side APM (mirrors web's allowedTracingUrls).
    firstPartyHosts: [hostFromUrl(getGraphQLUrl())],
  }
}

// Pattern-named views keep RUM view-name cardinality bounded (one "series/[slug]"
// facet, not one name per slug); the literal-pathname key still restarts the view
// on every navigation, including slug-to-slug.
export function resolveViewName(
  segments: readonly string[],
  pathname: string,
): { key: string; name: string } {
  const pattern = segments.filter(Boolean).join("/")
  const name = pattern || (pathname === "/" ? "home" : pathname)
  return { key: pathname, name }
}

/** Cheap provisioning gate for hot paths — no URL parse or config allocation. */
export function isDatadogProvisioned(): boolean {
  return getDatadogCredentials() != null
}

// Telemetry must never throw into the app: swallow sync throws and rejections.
function safeDatadogCall(call: () => Promise<unknown>): void {
  try {
    void call().catch(() => undefined)
  } catch {
    // Telemetry must never break the app.
  }
}

// The SDK's XHR interception strips these headers post-init and attaches the
// operation name/type to the RUM resource; anonymous operations get none.
export function datadogGraphqlHeaders(
  operationName: string | undefined,
  operationType: string | undefined,
): Record<string, string> {
  if (!operationName) return {}
  const headers: Record<string, string> = {
    [DATADOG_GRAPH_QL_OPERATION_NAME_HEADER]: operationName,
  }
  if (operationType) {
    headers[DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER] = operationType
  }
  return headers
}

/** Starts a RUM view — fire-and-forget, never throws into navigation. */
export function startDatadogView(key: string, name: string): void {
  safeDatadogCall(() => DdRum.startView(key, name))
}

/** Records a timing on the active RUM view — fire-and-forget, never throws. */
export function addDatadogTiming(name: string): void {
  safeDatadogCall(() => DdRum.addTiming(name))
}

const INIT_WATCHDOG_DEADLINE_MS = 10_000

/**
 * Dev-only watchdog for silent SDK init failure (provisioned but native init
 * never completes, e.g. a JS-only reload against a stale binary). One-shot per
 * JS process: onInitialization fires at most once (globalThis init singleton),
 * so a per-mount timer would false-warn on every remount.
 */
export function createDatadogInitWatchdog({
  deadlineMs = INIT_WATCHDOG_DEADLINE_MS,
  dev = __DEV__,
}: { deadlineMs?: number; dev?: boolean } = {}) {
  let armed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    arm(): void {
      if (!dev || armed) return
      armed = true
      timer = setTimeout(() => {
        timer = null
        console.warn(
          `[datadog] SDK init has not completed within ${deadlineMs / 1000}s of a provisioned mount — telemetry is likely dead (stale binary or rejected native init)`,
        )
      }, deadlineMs)
    },
    markInitialized(): void {
      // Once initialized, later arms are meaningless for this process.
      armed = true
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

/** Process-wide watchdog instance, mirroring the SDK's one-shot init behavior. */
export const datadogInitWatchdog = createDatadogInitWatchdog()

/** Reports a handled JS error to Datadog RUM. Mirrors web's reportDatadogRumError. */
export function reportDatadogError(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  safeDatadogCall(() => {
    const err = error instanceof Error ? error : new Error(String(error))
    return DdRum.addError(
      err.message,
      ErrorSource.SOURCE,
      err.stack ?? "",
      context,
    )
  })
}

/** Reports a custom RUM action to Datadog — fire-and-forget, never throws. */
export function reportDatadogAction(name: string, context: object = {}): void {
  safeDatadogCall(() => DdRum.addAction(RumActionType.CUSTOM, name, context))
}

/** Thin Datadog Logs wrapper — fire-and-forget, never throws into the caller. */
export const datadogLog = {
  info: (message: string, context: object = {}): void =>
    safeDatadogCall(() => DdLogs.info(message, context)),
  warn: (message: string, context: object = {}): void =>
    safeDatadogCall(() => DdLogs.warn(message, context)),
  error: (message: string, context: object = {}): void =>
    safeDatadogCall(() => DdLogs.error(message, context)),
}
