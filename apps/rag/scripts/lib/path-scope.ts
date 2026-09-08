import { RagOperationalError } from "../../src/contracts/index.js"
import type { SourceEntry } from "../../src/registry/index.js"

/** Only explicitly registered slices can change discovery/extraction scope. */
export function scopeSource(
  entry: SourceEntry,
  pathPrefix?: string,
): SourceEntry {
  if (!pathPrefix) return entry
  const crawl = entry.pathCrawls?.[pathPrefix]
  if (!crawl)
    throw new RagOperationalError(
      "argument_invalid",
      `unregistered path scope '${pathPrefix}' for '${entry.key}'`,
    )
  return { ...entry, crawl }
}

export function canonicalPrefix(
  entry: SourceEntry,
  pathPrefix?: string,
): string | undefined {
  if (!pathPrefix) return undefined
  scopeSource(entry, pathPrefix)
  return new URL(pathPrefix, entry.crawl.baseUrl).href
}
