/**
 * @vitest-environment jsdom
 */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
    unoptimized,
  }: {
    src: string
    alt: string
    className?: string
    unoptimized?: boolean
  }) => (
    <div
      data-testid="next-image-mock"
      data-src={src}
      data-alt={alt}
      data-unoptimized={String(Boolean(unoptimized))}
      className={className}
    />
  ),
}))

import { MuxHoverPreview } from "@/components/watch/MuxHoverPreview"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function renderPreview(
  previewUrl: string | null = "https://image.mux.com/pb/animated.webp",
) {
  act(() => {
    root.render(
      <button type="button">
        <MuxHoverPreview previewUrl={previewUrl} sizes="100vw" />
      </button>,
    )
  })
}

describe("MuxHoverPreview", () => {
  it("does not request the animated image before hover or focus", () => {
    renderPreview("https://image.mux.com/playback/animated.webp?width=448")

    expect(
      container.querySelector('[data-testid="mux-hover-preview"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="next-image-mock"]'),
    ).toBeNull()
  })

  it("loads an unoptimized animated image after card hover", () => {
    const previewUrl = "https://image.mux.com/playback/animated.webp?width=448"
    renderPreview(previewUrl)

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(new Event("pointerenter", { bubbles: false }))
    })

    const image = container.querySelector('[data-testid="next-image-mock"]')
    expect(image?.getAttribute("data-src")).toBe(previewUrl)
    expect(image?.getAttribute("data-alt")).toBe("")
    expect(image?.getAttribute("data-unoptimized")).toBe("true")
  })

  it("loads the preview after keyboard focus reaches the card", () => {
    const previewUrl = "https://image.mux.com/playback/animated.webp?width=448"
    renderPreview(previewUrl)

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(new FocusEvent("focus"))
    })

    expect(
      container
        .querySelector('[data-testid="next-image-mock"]')
        ?.getAttribute("data-src"),
    ).toBe(previewUrl)
  })

  it("renders nothing when no Mux preview URL is available", () => {
    renderPreview(null)

    expect(
      container.querySelector('[data-testid="mux-hover-preview"]'),
    ).toBeNull()
  })
})
