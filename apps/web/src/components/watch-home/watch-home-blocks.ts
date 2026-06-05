import type { Section } from "@/components/sections"

const LEGACY_HOME_INTRO_BLOCK_TYPES = new Set([
  "VideoHeroBlock",
  "NavigationCarouselBlock",
  "videoHero",
  "navigationCarousel",
])

function blockKind(block: Section): string | null {
  const record = block as Record<string, unknown>
  const typename = record.__typename
  if (typeof typename === "string") return typename
  const t = record.t
  return typeof t === "string" ? t : null
}

export function isLegacyWatchHomeIntroBlock(block: Section): boolean {
  const kind = blockKind(block)
  return kind != null && LEGACY_HOME_INTRO_BLOCK_TYPES.has(kind)
}

export function filterWatchHomeBelowFoldBlocks(blocks: Section[]): Section[] {
  const result: Section[] = []
  let stillAtIntro = true

  for (const block of blocks) {
    if (stillAtIntro && isLegacyWatchHomeIntroBlock(block)) {
      continue
    }
    stillAtIntro = false
    result.push(block)
  }

  return result
}
