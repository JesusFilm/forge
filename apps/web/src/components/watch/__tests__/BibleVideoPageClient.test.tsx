/**
 * @vitest-environment jsdom
 */

import { act, type ComponentType } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { watchPageClientMock } = vi.hoisted(() => ({
  watchPageClientMock: vi.fn((_props: Record<string, unknown>) => null),
}))

vi.mock("@/components/watch/WatchPageClient", () => ({
  WatchPageClient: watchPageClientMock,
}))

import { BibleVideoPageClient } from "@/components/watch/BibleVideoPageClient"
import { bibleVideoPath } from "@/lib/routes"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  watchPageClientMock.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("BibleVideoPageClient", () => {
  it("keeps Bible Video links isolated and hides shared hero chrome", () => {
    const Component = BibleVideoPageClient as ComponentType<
      Record<string, unknown>
    >

    act(() => {
      root.render(<Component mergedBlocks={[]} variant={{}} video={{}} />)
    })

    const props = watchPageClientMock.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined

    expect(props?.videoPathBuilder).toBe(bibleVideoPath)
    expect(props?.showRelatedQuestions).toBe(false)
    expect(props?.showHeroCta).toBe(false)
    expect(props?.showHeroOverlay).toBe(false)
    expect(props?.showHeroTitle).toBe(false)
    expect(props?.showHeroBottomGradient).toBe(false)
    expect(props?.hideBibleQuotes).toBe(true)
    expect(props?.transcriptPlacement).toBe("belowHero")
    expect(props?.transcriptDisplayMode).toBe("inlineFlow")
    expect(props?.showTranscriptHeader).toBe(false)
    expect(props?.heroViewportHeight).toBe("half")
  })
})
