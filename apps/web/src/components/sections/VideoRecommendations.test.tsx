/**
 * @vitest-environment jsdom
 */

import React, { act, type ReactNode } from "react"
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

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { VideoRecommendations } from "@/components/sections/VideoRecommendations"
import type { SceneRecommendation } from "@/lib/recommendations"

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

function makeRecommendation(
  overrides: Partial<SceneRecommendation> = {},
): SceneRecommendation {
  return {
    videoId: "video-1",
    videoSlug: "jesus",
    videoTitle: "JESUS",
    imageUrl: "https://cdn.example/jesus.jpg",
    sceneIndex: 1,
    description: "A scene description",
    startSeconds: 5,
    endSeconds: 12,
    similarity: 0.87,
    themes: ["hope"],
    demographics: [],
    spiritualContext: [],
    playbackId: "mux playback 1",
    ...overrides,
  }
}

describe("VideoRecommendations", () => {
  it("lazy-loads a Mux animated preview when a recommendation card is hovered", () => {
    act(() => {
      root.render(
        <VideoRecommendations
          recommendations={[makeRecommendation()]}
          locale="english"
        />,
      )
    })

    const preview = container.querySelector('[data-testid="mux-hover-preview"]')
    expect(preview).not.toBeNull()
    expect(preview?.getAttribute("data-active")).toBe("false")
    expect(
      Array.from(container.querySelectorAll('[data-testid="next-image-mock"]')),
    ).toHaveLength(1)

    const link = container.querySelector("a")
    act(() => {
      link?.dispatchEvent(new Event("pointerenter", { bubbles: false }))
    })

    const images = Array.from(
      container.querySelectorAll('[data-testid="next-image-mock"]'),
    )
    expect(images).toHaveLength(2)
    expect(images[1]?.getAttribute("data-src")).toBe(
      "https://image.mux.com/mux%20playback%201/animated.gif?start=2&end=6&width=448&fps=8",
    )
    expect(images[1]?.getAttribute("data-unoptimized")).toBe("true")
  })
})
