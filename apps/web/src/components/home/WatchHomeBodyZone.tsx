import type { ReactNode } from "react"

/**
 * The panel that scrolls up over the pinned intro.
 *
 * It carries the same glass treatment the watch page's body zone uses
 * (`.watch-body-backdrop` — including its Firefox `backdrop-filter` fallback),
 * and it bleeds full width because the intro media does: a 1920px panel would
 * leave the video showing sharp down both sides of a wider screen. The inner
 * wrapper restores the content rail for everything below.
 *
 * Shared by both home shells so the two cannot drift — the same reason the hero
 * copy block became `WatchHeroOverlay`.
 */
export function WatchHomeBodyZone({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="watch-home-body-zone"
      className="watch-body-backdrop relative left-1/2 z-10 w-screen max-w-none -translate-x-1/2 backdrop-blur-2xl"
    >
      <div className="mx-auto max-w-[1920px]">{children}</div>
    </div>
  )
}
