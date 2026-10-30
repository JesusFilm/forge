import { projectWatchAudienceConfiguration } from "@forge/experience-schema"

export type WatchAudienceConfigurationProjection = {
  configJson: string | null
  sourceLocale: string
  sourceBlockId: string
  rejected: boolean
}

/** Canonical published rows only. Deliberately does not query drafts or choose
 * a locale: WatchSettingService owns both publication/source predicates. */
export function projectPublishedWatchAudience(
  row: {
    id: string
    locale: string
    blocks: unknown
  } | null,
): WatchAudienceConfigurationProjection | null {
  if (!row || !Array.isArray(row.blocks)) return null
  const candidates = row.blocks.flatMap((block: unknown, index) => {
    if (
      !block ||
      typeof block !== "object" ||
      Array.isArray(block) ||
      !("t" in block) ||
      block.t !== "watchAudience"
    )
      return []
    return [{ block: block as Record<string, unknown>, index }]
  })
  const first = candidates[0]
  if (!first) return null
  const sourceBlockId =
    typeof first.block.sectionKey === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/.test(first.block.sectionKey)
      ? first.block.sectionKey
      : `${row.id}:block:${first.index}`
  const config =
    candidates.length === 1
      ? projectWatchAudienceConfiguration(first.block.configuration)
      : null
  return {
    sourceLocale: row.locale,
    sourceBlockId,
    configJson: config ? JSON.stringify(config) : null,
    rejected: config === null,
  }
}
