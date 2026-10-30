// Release gate for Watch audience AUTHORING writes. While `forge.watch.audience`
// is off, no Experience write may create or change a `watchAudience` block.
// Identical existing blocks are preserved (so unrelated edits still save) and
// removing a block is always allowed. The flag is read only when a write
// actually introduces new or changed audience configuration.

import { isWatchAudienceEnabled } from "@/lib/feature-flags"

export class WatchAudienceAuthoringDisabledError extends Error {
  constructor() {
    super(
      "Watch Audience changes are off until the forge.watch.audience release flag is on. Existing questionnaires are kept as saved; remove or leave them unchanged to save other edits.",
    )
    this.name = "WatchAudienceAuthoringDisabledError"
  }
}

function isWatchAudienceBlock(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    !Array.isArray(block) &&
    (block as { t?: unknown }).t === "watchAudience"
  )
}

// Key-sorted, so a block read back from Postgres jsonb (which reorders keys)
// compares equal to the same block sent by an editor.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/**
 * True when `nextBlocks` holds a top-level `watchAudience` block with no
 * identical counterpart in `previousBlocks` (a multiset match, so copying an
 * existing block counts as new). Reordering and removal are not changes.
 */
export function hasNewOrChangedWatchAudience(
  previousBlocks: readonly unknown[],
  nextBlocks: readonly unknown[],
): boolean {
  const available = new Map<string, number>()
  for (const block of previousBlocks) {
    if (!isWatchAudienceBlock(block)) continue
    const key = canonicalJson(block)
    available.set(key, (available.get(key) ?? 0) + 1)
  }
  for (const block of nextBlocks) {
    if (!isWatchAudienceBlock(block)) continue
    const key = canonicalJson(block)
    const count = available.get(key) ?? 0
    if (count === 0) return true
    available.set(key, count - 1)
  }
  return false
}

export async function assertWatchAudienceWriteAllowed({
  previousBlocks,
  nextBlocks,
  isEnabled = isWatchAudienceEnabled,
}: {
  previousBlocks: readonly unknown[]
  nextBlocks: readonly unknown[]
  isEnabled?: () => Promise<boolean>
}): Promise<void> {
  if (!hasNewOrChangedWatchAudience(previousBlocks, nextBlocks)) return
  let enabled = false
  try {
    enabled = await isEnabled()
  } catch {
    enabled = false
  }
  if (!enabled) throw new WatchAudienceAuthoringDisabledError()
}
