import type { Section } from "@/components/sections"

const LEGACY_HOME_HERO_BLOCK_TYPES = new Set(["VideoHeroBlock", "videoHero"])

function blockKind(block: Section): string | null {
  const record = block as Record<string, unknown>
  const typename = record.__typename
  if (typeof typename === "string") return typename
  const t = record.t
  return typeof t === "string" ? t : null
}

export function isLegacyWatchHomeIntroBlock(block: Section): boolean {
  const kind = blockKind(block)
  return kind != null && LEGACY_HOME_HERO_BLOCK_TYPES.has(kind)
}

export function filterWatchHomeBelowFoldBlocks(blocks: Section[]): Section[] {
  const [firstBlock, ...rest] = blocks
  if (firstBlock && isLegacyWatchHomeIntroBlock(firstBlock)) return rest
  return blocks
}
