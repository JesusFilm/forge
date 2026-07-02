import {
  DATADOG_GRAPH_QL_OPERATION_NAME_HEADER,
  DATADOG_GRAPH_QL_OPERATION_TYPE_HEADER,
  DdLogs,
  DdRum,
  ErrorSource,
  PropagatorType,
} from "@datadog/mobile-react-native"

import { env } from "../env"
import { getGraphQLUrl } from "./config"

/** Datadog service name for the TV app (mirrors web `forge-web` / admin `forge-admin`). */
export const DATADOG_SERVICE = "forge-tv"

export type DatadogRumConfig = {
  clientToken: string
  applicationId: string
  site: string
  envName: string
  version?: string
  sessionSampleRate: number
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

// Mirrors web's getDatadogRumInitConfig: returns null (a no-op) unless BOTH the
// client token and application id are provisioned, so a build without Datadog env
// still boots instead of crashing on init.
export function getDatadogRumConfig(): DatadogRumConfig | null {
  const clientToken = env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN
  const applicationId = env.EXPO_PUBLIC_DATADOG_APPLICATION_ID
  if (!clientToken || !applicationId) return null

  return {
    clientToken,
    applicationId,
    site: env.EXPO_PUBLIC_DATADOG_SITE ?? "US1",
    // Default by build type: a provisioned release fleet missing the ENV var
    // must not file its telemetry under env:development.
    envName:
      env.EXPO_PUBLIC_DATADOG_ENV ?? (__DEV__ ? "development" : "production"),
    version: env.EXPO_PUBLIC_DATADOG_VERSION,
    // Real TV sessions are comparatively rare, so sample everything.
    sessionSampleRate: 100,
    // Point trace propagation at admin's GraphQL host → links TV RUM resources to
    // admin's server-side APM (mirrors web's allowedTracingUrls).
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
  try {
    void DdRum.startView(key, name).catch(() => undefined)
  } catch {
    // Telemetry must never break the app.
  }
}

/** Reports a handled JS error to Datadog RUM. Mirrors web's reportDatadogRumError. */
export function reportDatadogError(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error))
    // .catch too: post-init the SDK returns the raw native promise, whose
    // rejection would escape this synchronous try/catch.
    void DdRum.addError(
      err.message,
      ErrorSource.SOURCE,
      err.stack ?? "",
      context,
    ).catch(() => undefined)
  } catch {
    // Telemetry must never break the app.
  }
}

/** Thin Datadog Logs wrapper — fire-and-forget, never throws into the caller. */
export const datadogLog = {
  info: (message: string, context: object = {}): void => {
    void DdLogs.info(message, context).catch(() => undefined)
  },
  warn: (message: string, context: object = {}): void => {
    void DdLogs.warn(message, context).catch(() => undefined)
  },
  error: (message: string, context: object = {}): void => {
    void DdLogs.error(message, context).catch(() => undefined)
  },
}
