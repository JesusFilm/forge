/**
 * @vitest-environment jsdom
 */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WatchHomeCarouselSlide } from "@/lib/watch-home-carousel"

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    React.createElement("img", { src, alt }),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { WatchHomeFallbackSections } from "./WatchHomeFallbackSections"

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

function videoSlide(
  overrides: Partial<Extract<WatchHomeCarouselSlide, { kind: "video" }>> = {},
): Extract<WatchHomeCarouselSlide, { kind: "video" }> {
  return {
    kind: "video",
    id: "video-1",
    videoId: "video-1",
    videoSlug: "video-one",
    languageSlug: "english",
    href: "/video-one.html/english.html",
    title: "Video One",
    label: "SHORT FILM",
    collectionTitle: null,
    description: "A video description",
    posterUrl: "https://cdn.example/poster.jpg",
    thumbnailUrl: "https://cdn.example/thumb.jpg",
    src: "https://stream.example/video.m3u8",
    muxPlaybackId: "mux-video",
    durationSeconds: 120,
    ...overrides,
  }
}

function muxSlide(): Extract<WatchHomeCarouselSlide, { kind: "mux" }> {
  return {
    kind: "mux",
    id: "mux-1",
    title: "Mux Insert",
    label: "ITEM",
    collectionTitle: null,
    description: null,
    posterUrl: "https://cdn.example/mux-poster.jpg",
    thumbnailUrl: "https://cdn.example/mux-thumb.jpg",
    src: "https://stream.example/mux.m3u8",
    muxPlaybackId: "mux-insert",
    durationSeconds: 60,
    action: null,
    logo: false,
  }
}

function render(slides: WatchHomeCarouselSlide[]) {
  act(() => {
    root.render(<WatchHomeFallbackSections slides={slides} />)
  })
}

describe("WatchHomeFallbackSections", () => {
  it("renders admin video slides as below-fold links", () => {
    render([videoSlide(), muxSlide()])

    expect(
      container.querySelector('[data-testid="watch-home-fallback-sections"]'),
    ).not.toBeNull()
    expect(container.textContent).toContain("More to Watch")
    expect(container.textContent).toContain("Video One")
    expect(container.textContent).not.toContain("Mux Insert")
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/video-one.html/english.html",
    )
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/thumb.jpg",
    )
  })

  it("does not render without a usable admin video image", () => {
    render([videoSlide({ posterUrl: null, thumbnailUrl: null }), muxSlide()])

    expect(
      container.querySelector('[data-testid="watch-home-fallback-sections"]'),
    ).toBeNull()
  })
})
