import type { MergedWatchBlock, WatchBlock } from "@/lib/content"

/**
 * Type guard distinguishing synthetic watch blocks from Experience blocks.
 * Kept in a tiny client-safe module so watch UI components do not import the
 * server resolver module just to read the `kind` discriminator.
 */
export function isWatchBlock(block: MergedWatchBlock): block is WatchBlock {
  return "kind" in block
}
