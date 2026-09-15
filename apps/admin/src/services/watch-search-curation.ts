export function normalizeWatchSearchCurationQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
}
