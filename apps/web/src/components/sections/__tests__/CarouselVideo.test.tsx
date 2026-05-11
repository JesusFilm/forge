/**
 * @vitest-environment jsdom
 *
 * U12 — CarouselVideo dual-branch tests.
 *
 * - Flag-off: smoke. videojs() invoked once for the active item.
 * - Flag-on: smoke. Mux Video custom element mounted; videojs() not called.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { videojsMock } = vi.hoisted(() => ({
  videojsMock: vi.fn(),
}))
vi.mock("video.js", () => ({
  default: videojsMock,
}))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: false },
}))

// Embla / next/image are heavy. Mock the carousel & next/image down to
// trivial pass-throughs so the test focuses on the player branch logic.
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

import { env } from "@/env"

import { CarouselVideo } from "@/components/sections/CarouselVideo"

type MutableEnv = {
  NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION: boolean
}
function setFlag(value: boolean) {
  ;(env as unknown as MutableEnv).NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION =
    value
}

function createMockPlayer() {
  let muted = true
  return {
    el: () => document.createElement("div"),
    ready: (cb: () => void) => cb(),
    on: vi.fn(),
    off: vi.fn(),
    src: vi.fn(),
    poster: vi.fn(),
    addRemoteTextTrack: vi.fn(),
    removeRemoteTextTrack: vi.fn(),
    textTracks: vi.fn(() => []),
    paused: vi.fn(() => true),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    muted: vi.fn((next?: boolean) => {
      if (typeof next === "boolean") muted = next
      return muted
    }),
    currentTime: vi.fn(() => 0),
    duration: vi.fn(() => 0),
    dispose: vi.fn(),
  }
}

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
  videojsMock.mockImplementation(() => createMockPlayer())
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  videojsMock.mockReset()
  setFlag(false)
  vi.restoreAllMocks()
})

describe("CarouselVideo — flag-off (videojs branch)", () => {
  it("mounts via videojs for the selected item", async () => {
    setFlag(false)

    await act(async () => {
      root.render(<CarouselVideo data={baseFragment} />)
    })

    expect(videojsMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Series")
  })
})

describe("CarouselVideo — flag-on (Mux branch)", () => {
  it("mounts via Mux Video, no videojs() call", async () => {
    setFlag(true)

    await act(async () => {
      root.render(<CarouselVideo data={baseFragment} />)
    })

    expect(videojsMock).not.toHaveBeenCalled()
    // @mux/mux-video-react renders a plain <video> element.
    expect(container.querySelector("video")).not.toBeNull()
    expect(container.textContent).toContain("Series")
  })
})
