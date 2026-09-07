export function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl)
    const user = parsed.username || "?"
    const host = parsed.hostname || "?"
    const port = parsed.port ? `:${parsed.port}` : ""
    const database = parsed.pathname.replace(/^\//, "") || "?"
    return `${parsed.protocol}//${user}:***@${host}${port}/${database}`
  } catch {
    return "(unparseable)"
  }
}
