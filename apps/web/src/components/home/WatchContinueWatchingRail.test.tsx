/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const progressState = vi.hoisted(() => ({
  entries: [
    {
      videoId: "video-1",
      languageSlug: "spanish-castilian",
      positionSeconds: 300,
      durationSeconds: 600,
      updatedAt: 1,
    },
  ],
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}))

vi.mock("@/lib/watch-progress-client", () => ({
  getWatchProgressRatio: (entry: {
    positionSeconds: number
    durationSeconds: number
  }) =>
    entry.durationSeconds > 0
      ? entry.positionSeconds / entry.durationSeconds
      : 0,
  useWatchProgressEntries: () => progressState.entries,
}))

import { WatchContinueWatchingRail } from "./WatchContinueWatchingRail"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("WatchContinueWatchingRail", () => {
  it("shows matching progress with a canonical resume link and remaining time", () => {
    act(() => {
      root.render(
        <WatchContinueWatchingRail
          fallbackLanguageSlug="english"
          items={[
            {
              videoId: "video-1",
              title: "The Gospel",
              videoSlug: "the-gospel",
              languageSlug: null,
              imageUrl: null,
            },
          ]}
        />,
      )
    })

    const card = container.querySelector(
      '[data-testid="continue-watching-card"]',
    ) as HTMLAnchorElement
    expect(card.getAttribute("href")).toBe(
      "/the-gospel.html/spanish-castilian.html",
    )
    expect(card.textContent).toContain("The Gospel")
    expect(card.textContent).toContain("5 min")
    expect(container.querySelector('[aria-label="title"]')).not.toBeNull()
  })

  it("does not render without an incomplete matching progress entry", () => {
    act(() => {
      root.render(
        <WatchContinueWatchingRail fallbackLanguageSlug="english" items={[]} />,
      )
    })

    expect(
      container.querySelector('[data-testid="continue-watching-rail"]'),
    ).toBeNull()
  })
})
