/**
 * @vitest-environment jsdom
 *
 * §5.6 404 hardening for the single-segment /watch/[slug] route.
 *
 * Verifies guard B (uppercase/empty content slug → 404) WITHOUT over-404ing
 * the must-200 cases: 1-segment collections (kind "experience") and localized
 * homes still render.
 *
 * NOTE: guard C (single-video-at-1-segment → 404) was DEFERRED — it needs
 * real-data verification that collections resolve as kind:"experience" before
 * it can ship without over-404ing them. Tracked in todo 031. The must-200
 * cases below also pin that guard B does not over-reach.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { notFoundMock, resolveWatchPageMock, isWatchPageMissingErrorMock } =
  vi.hoisted(() => ({
    notFoundMock: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND")
    }),
    resolveWatchPageMock: vi.fn(),
    isWatchPageMissingErrorMock: vi.fn(() => false),
  }))

vi.mock("next/navigation", () => ({ notFound: notFoundMock }))
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }))
vi.mock("@/i18n/locales", () => ({ hasUiLocale: () => true }))
vi.mock("@/lib/experience-metadata", () => ({
  getWatchPageMetadata: vi.fn(),
}))
vi.mock("@/lib/content", () => ({
  resolveWatchPage: resolveWatchPageMock,
  isWatchPageMissingError: isWatchPageMissingErrorMock,
}))
vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: () => null,
}))
vi.mock("@/components/ExperienceEmpty", () => ({
  ExperienceEmpty: () => null,
}))
vi.mock("@/components/ExperienceError", () => ({
  ExperienceError: () => null,
}))

import SlugPage from "../page"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  notFoundMock.mockClear()
  resolveWatchPageMock.mockReset()
  isWatchPageMissingErrorMock.mockReturnValue(false)
  container = document.createElement("div")
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

async function render1Seg(slug: string) {
  const element = await SlugPage({ params: Promise.resolve({ slug }) })
  act(() => root.render(element))
}

describe("/watch/[slug] — §5.6 404 hardening", () => {
  it("guard B: 404s an uppercase content slug before resolving", async () => {
    await expect(render1Seg("JESUS")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalled()
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("guard B: 404s an empty slug (/watch/.html) before resolving", async () => {
    // `/watch/.html` → param ".html" → stripHtmlSuffix → "".
    await expect(render1Seg(".html")).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalled()
    expect(resolveWatchPageMock).not.toHaveBeenCalled()
  })

  it("must-200: does NOT 404 a 1-segment COLLECTION (kind experience)", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: { blocks: [{ id: "b1", __typename: "Hero" }] },
      },
      error: null,
    })
    await render1Seg("easter")
    expect(notFoundMock).not.toHaveBeenCalled()
  })

  it("must-200: does NOT 404 a localized home (bcp47 slug, no resolution guard)", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: { blocks: [{ id: "b1", __typename: "Hero" }] },
      },
      error: null,
    })
    await render1Seg("en")
    expect(notFoundMock).not.toHaveBeenCalled()
  })
})
