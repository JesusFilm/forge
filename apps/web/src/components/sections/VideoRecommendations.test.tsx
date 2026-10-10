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
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
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
    durationSeconds: 125,
    similarity: 0.87,
    themes: ["hope"],
    demographics: [],
    spiritualContext: [],
    playbackId: "mux playback 1",
    ...overrides,
  }
}

describe("VideoRecommendations", () => {
  it("preserves the scene-start timestamp by default for legacy callers", () => {
    act(() => {
      root.render(
        <VideoRecommendations
          recommendations={[
            makeRecommendation({ startSeconds: 45, durationSeconds: 4_946 }),
          ]}
          locale="english"
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="video-recommendation-duration"]')
        ?.textContent,
    ).toBe("0:45")
  })

  it("renders video runtime when the caller selects video-duration mode", () => {
    act(() => {
      root.render(
        <VideoRecommendations
          recommendations={[
            makeRecommendation({ startSeconds: 0, durationSeconds: 4_946 }),
          ]}
          locale="english"
          recommendationTimeMode="video-duration"
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="video-recommendation-duration"]')
        ?.textContent,
    ).toBe("1:22:26")
    expect(container.textContent).toContain("87% match")
    expect(container.textContent).toContain("hope")
  })

  it("hides ranking metadata without removing title, description, or runtime", () => {
    act(() => {
      root.render(
        <VideoRecommendations
          recommendations={[makeRecommendation()]}
          locale="english"
          showRankingMetadata={false}
          recommendationTimeMode="video-duration"
        />,
      )
    })

    expect(container.textContent).toContain("JESUS")
    expect(container.textContent).toContain("A scene description")
    expect(container.textContent).toContain("2:05")
    expect(container.textContent).not.toContain("87% match")
    expect(container.textContent).not.toContain("hope")
  })

  it("omits the runtime badge when duration is unavailable", () => {
    act(() => {
      root.render(
        <VideoRecommendations
          recommendations={[makeRecommendation({ durationSeconds: null })]}
          locale="english"
          recommendationTimeMode="video-duration"
        />,
      )
    })

    expect(
      container.querySelector('[data-testid="video-recommendation-duration"]'),
    ).toBeNull()
  })

  it("uses an existing localized thumbnail label when an image is unavailable", () => {
    act(() => {
      root.render(
        <VideoRecommendations
          recommendations={[makeRecommendation({ imageUrl: null })]}
          locale="english"
        />,
      )
    })

    expect(container.textContent).toContain("Video thumbnail")
  })

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
    const frame = container.querySelector<HTMLElement>(
      '[data-testid="video-recommendation-thumbnail-frame"]',
    )
    expect(link?.className).toContain("focus-visible:outline-none")
    expect(frame?.className).toContain("rounded-[inherit]")
    expect(frame?.className).toContain("border-4")
    expect(frame?.className).toContain("border-white")
    expect(frame?.className).toContain("group-hover:opacity-100")
    expect(frame?.className).toContain("group-focus-visible:opacity-100")
    expect(frame?.className).not.toMatch(/red|amber|gradient|shadow/)
    act(() => {
      link?.dispatchEvent(new Event("pointerenter", { bubbles: false }))
    })

    const images = Array.from(
      container.querySelectorAll('[data-testid="next-image-mock"]'),
    )
    expect(images).toHaveLength(2)
    expect(images[1]?.getAttribute("data-src")).toBe(
      "https://image.mux.com/mux%20playback%201/animated.webp?start=2&end=6&width=448&fps=8",
    )
    expect(images[1]?.getAttribute("data-unoptimized")).toBe("true")
  })
})
