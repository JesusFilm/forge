/**
 * @vitest-environment jsdom
 *
 * CarouselVideo — Mux-only path. The flag-off (video.js) branch was
 * removed once `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` graduated.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Embla / next/image are heavy. Mock the carousel & next/image down to
// trivial pass-throughs so the test focuses on the player path.
vi.mock("@/components/ui/carousel", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Carousel: Pass,
    CarouselContent: Pass,
    CarouselItem: Pass,
    CarouselPrevious: () => null,
    CarouselNext: () => null,
  }
})

vi.mock("next/image", () => ({
  default: () => null,
}))

import { CarouselVideo } from "@/components/sections/CarouselVideo"

const baseFragment = {
  t: "videoCarousel",
  sectionKey: "carousel",
  title: "Series",
  subtitle: undefined,
  description: undefined,
  itemsSource: "manual",
  items: [
    {
      streamingUrl: "https://example.com/one.m3u8",
      imageUrl: undefined,
      imageOverrideUrl: undefined,
      titleOverride: "First",
      backgroundColor: undefined,
      videoId: undefined,
    },
  ],
} as Parameters<typeof CarouselVideo>[0]["data"]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
    Promise.resolve(),
  )
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
})

describe("CarouselVideo", () => {
  it("mounts via Mux Video for the selected item", async () => {
    await act(async () => {
      root.render(<CarouselVideo data={baseFragment} />)
    })

    // @mux/mux-video-react renders a plain <video> element.
    expect(container.querySelector("video")).not.toBeNull()
    expect(container.textContent).toContain("Series")
  })
})
