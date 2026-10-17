export const WATCH_AUDIENCE_NON_TEMPLATE_MESSAGE =
  "The Watch audience questionnaire can only be added to the default template. Other pages never publish it."

export const WATCH_AUDIENCE_SINGLE_MESSAGE =
  "An Experience can contain one Watch audience questionnaire."

function isWatchAudienceBlock(block: unknown) {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { t?: unknown }).t === "watchAudience"
  )
}

// Public reads project only the default template's published questionnaire
// (WatchSettingService.getWatchAudience), so adding the block anywhere else
// would preview content that publish never delivers. Returns the reason the
// block cannot be inserted, or null when it can. Existing blocks are never
// removed; this only gates new insertions.
export function watchAudienceInsertBlocker({
  isDefaultTemplate,
  blocks,
}: {
  isDefaultTemplate: boolean
  blocks: readonly unknown[]
}): string | null {
  if (!isDefaultTemplate) return WATCH_AUDIENCE_NON_TEMPLATE_MESSAGE
  if (blocks.some(isWatchAudienceBlock)) return WATCH_AUDIENCE_SINGLE_MESSAGE
  return null
}
