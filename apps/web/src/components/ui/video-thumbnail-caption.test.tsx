// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  VideoThumbnailCaption,
  VideoThumbnailEyebrow,
  VideoThumbnailTitle,
} from "./video-thumbnail-caption"

describe("video thumbnail caption", () => {
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

  it("keeps default side and bottom insets equal", () => {
    act(() => {
      root.render(
        <VideoThumbnailCaption data-testid="caption">
          Caption
        </VideoThumbnailCaption>,
      )
    })

    const classes =
      container.querySelector<HTMLElement>('[data-testid="caption"]')
        ?.className ?? ""

    expect(classes).toContain("px-4")
    expect(classes).toContain("pb-4")
    expect(classes).not.toContain("pb-5")
  })

  it("keeps compact side and bottom insets equal at each breakpoint", () => {
    act(() => {
      root.render(
        <VideoThumbnailCaption data-testid="caption" inset="compact">
          Caption
        </VideoThumbnailCaption>,
      )
    })

    const classes =
      container.querySelector<HTMLElement>('[data-testid="caption"]')
        ?.className ?? ""

    expect(classes).toContain("px-3")
    expect(classes).toContain("pb-3")
    expect(classes).toContain("sm:px-4")
    expect(classes).toContain("sm:pb-4")
  })

  it("uses one medium-weight contract for thumbnail labels and titles", () => {
    act(() => {
      root.render(
        <VideoThumbnailCaption>
          <VideoThumbnailEyebrow>Collection</VideoThumbnailEyebrow>
          <VideoThumbnailTitle>Life of Jesus</VideoThumbnailTitle>
        </VideoThumbnailCaption>,
      )
    })

    const eyebrow = container.querySelector("span")
    const title = container.querySelector("h3")
    expect(eyebrow?.className).toContain("font-medium")
    expect(eyebrow?.className).toContain("tracking-media-label")
    expect(title?.className).toContain("font-media-card-title")
    expect(title?.className).not.toMatch(/font-(semi|extra)?bold/)
  })
})
