/**
 * @vitest-environment jsdom
 *
 * Pins that the category rail's links are prefetch-eligible.
 *
 * The rail is a bounded tile set, so eager prefetch is deliberate here — the
 * opposite of the intent-gated card latch in `MediaCollection`. `next/link`
 * strips `prefetch` before spreading onto the anchor, so the sibling suite
 * (which renders through `renderToStaticMarkup` with a real Link) cannot see
 * it. Without this file, restoring `prefetch={false}` on either link passes
 * every other test.
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

import enMessages from "../../../../messages/en.json"

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: {
    href: string
    prefetch?: boolean
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("@/components/ui/carousel", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Carousel: Passthrough,
    CarouselContent: Passthrough,
    CarouselItem: Passthrough,
    CarouselNext: () => null,
    CarouselPrevious: () => null,
  }
})

import { NextIntlClientProvider } from "next-intl"

import { WatchHomeCategoryRail } from "../WatchHomeCategoryRail"

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

describe("WatchHomeCategoryRail prefetch posture", () => {
  it("leaves the tile links and the see-all link prefetch-eligible", () => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <WatchHomeCategoryRail languageSlug="english" />
        </NextIntlClientProvider>,
      )
    })

    const seeAll = container.querySelector(
      '[data-testid="watch-home-category-see-all"]',
    )
    const tile = container.querySelector(
      '[data-testid^="watch-home-category-card-"]',
    )

    expect(seeAll, "see-all link should render").not.toBeNull()
    expect(tile, "at least one tile should render").not.toBeNull()

    // "undefined" is the default strategy — the prop is absent. "false" would
    // mean prefetch was disabled again.
    expect(seeAll?.getAttribute("data-prefetch")).toBe("undefined")
    expect(tile?.getAttribute("data-prefetch")).toBe("undefined")
  })
})
