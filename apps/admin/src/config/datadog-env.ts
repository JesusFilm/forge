function emptyToUndefined(value: string | undefined): string | undefined {
  return value === "" ? undefined : value
}

export function normalizeDatadogEnv(
  value: string | undefined,
): string | undefined {
  const normalized = emptyToUndefined(value)?.toLowerCase()

  switch (normalized) {
    case undefined:
      return undefined
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
    default:
      return normalized
  }
}
