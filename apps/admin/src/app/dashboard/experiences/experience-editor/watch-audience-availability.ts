export const WATCH_AUDIENCE_NON_TEMPLATE_MESSAGE =
  "The Watch audience questionnaire can only be added to the default template. Other pages never publish it."

// Shown while `forge.watch.audience` is off. The block (if any) is kept as
// saved; only its authoring controls are hidden.
export const WATCH_AUDIENCE_AUTHORING_DISABLED_MESSAGE =
  "Watch Audience authoring is off until the forge.watch.audience release flag is on. This block is kept as saved."

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
