// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "./video-thumbnail-interaction-frame"

describe("VideoThumbnailInteractionFrame", () => {
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

  it("locks the shared white hover and keyboard-focus frame contract", () => {
    act(() => {
      root.render(<VideoThumbnailInteractionFrame data-testid="frame" />)
    })

    const frame = container.querySelector<HTMLElement>('[data-testid="frame"]')
    const classes = frame?.className ?? ""

    expect(frame?.getAttribute("aria-hidden")).toBe("true")
    expect(classes).toContain("pointer-events-none")
    expect(classes).toContain("absolute")
    expect(classes).toContain("inset-0")
    expect(classes).toContain("z-[80]")
    expect(classes).toContain("rounded-[inherit]")
    expect(classes).toContain("border-4")
    expect(classes).toContain("border-white")
    expect(classes).toContain("opacity-0")
    expect(classes).toContain("group-hover:opacity-100")
    expect(classes).toContain("group-focus-visible:opacity-100")
    expect(classes).not.toMatch(/red|amber|gradient|shadow/)
    expect(VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS).toBe(
      "focus-visible:outline-none",
    )
  })

  it("supports active-state suppression and pending-state visibility", () => {
    act(() => {
      root.render(
        <VideoThumbnailInteractionFrame
          data-testid="frame"
          interactive={false}
          visible
        />,
      )
    })

    const classes =
      container.querySelector<HTMLElement>('[data-testid="frame"]')
        ?.className ?? ""

    expect(classes).toContain("opacity-100")
    expect(classes).not.toContain("opacity-0")
    expect(classes).not.toContain("group-hover:opacity-100")
    expect(classes).not.toContain("group-focus-visible:opacity-100")
  })

  it("stays hidden when interaction and explicit visibility are disabled", () => {
    act(() => {
      root.render(
        <VideoThumbnailInteractionFrame
          data-testid="frame"
          interactive={false}
        />,
      )
    })

    const classes =
      container.querySelector<HTMLElement>('[data-testid="frame"]')
        ?.className ?? ""

    expect(classes).toContain("opacity-0")
    expect(classes).not.toContain("opacity-100")
    expect(classes).not.toContain("group-hover:opacity-100")
    expect(classes).not.toContain("group-focus-visible:opacity-100")
  })
})
