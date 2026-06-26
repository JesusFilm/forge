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

function normalizeDatadogEnv(value: string | undefined): string {
  const normalized = emptyToUndefined(value)?.toLowerCase()

  switch (normalized) {
    case "production":
    case "prod":
      return "prod"
    case "staging":
    case "stage":
      return "stage"
    case "preview":
      return "preview"
    case "development":
    case "dev":
      return "development"
    case "test":
      return "test"
    case undefined:
      return "development"
    default:
      return normalized
  }
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
  NEXT_PUBLIC_DATADOG_ENV: normalizeDatadogEnv(
    process.env.NEXT_PUBLIC_DATADOG_ENV ?? process.env.NODE_ENV,
  ),
  NEXT_PUBLIC_DATADOG_VERSION: emptyToUndefined(
    process.env.NEXT_PUBLIC_DATADOG_VERSION,
  ),
}
