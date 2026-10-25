import { normalizeDatadogEnv } from "./datadog-env"

const DATADOG_SITE_VALUES = [
  "datadoghq.com",
  "us3.datadoghq.com",
  "us5.datadoghq.com",
  "datadoghq.eu",
  "ddog-gov.com",
  "ap1.datadoghq.com",
  "ap2.datadoghq.com",
] as const

type DatadogSite = (typeof DATADOG_SITE_VALUES)[number]

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === "" ? undefined : value
}

function datadogVersionFallback(): string | undefined {
  return (
    emptyToUndefined(process.env.NEXT_PUBLIC_DATADOG_VERSION) ??
    emptyToUndefined(process.env.RAILWAY_GIT_COMMIT_SHA) ??
    emptyToUndefined(process.env.VERCEL_GIT_COMMIT_SHA) ??
    emptyToUndefined(process.env.GIT_COMMIT_SHA)
  )
}

function normalizeDatadogSite(value: string | undefined): DatadogSite {
  const site = emptyToUndefined(value)
  return (
    DATADOG_SITE_VALUES.find((candidate) => candidate === site) ??
    "datadoghq.com"
  )
}

export const datadogRumEnv = {
  NEXT_PUBLIC_DATADOG_APPLICATION_ID: emptyToUndefined(
    process.env.NEXT_PUBLIC_DATADOG_APPLICATION_ID,
  ),
  NEXT_PUBLIC_DATADOG_CLIENT_TOKEN: emptyToUndefined(
    process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN,
  ),
  NEXT_PUBLIC_DATADOG_SITE: normalizeDatadogSite(
    process.env.NEXT_PUBLIC_DATADOG_SITE,
  ),
  NEXT_PUBLIC_DATADOG_ENV:
    normalizeDatadogEnv(
      process.env.NEXT_PUBLIC_DATADOG_ENV ?? process.env.NODE_ENV,
    ) ?? "development",
  NEXT_PUBLIC_DATADOG_VERSION: datadogVersionFallback(),
}
