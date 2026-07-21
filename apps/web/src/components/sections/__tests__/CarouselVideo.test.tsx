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
import {
  WatchModalActivityProvider,
  useWatchModalActivity,
} from "@/components/watch/WatchModalActivityProvider"

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
  function ModalOwner({ active }: { active: boolean }) {
    useWatchModalActivity(active, { releaseDelayMs: 0 })
    return null
  }

  async function renderWithModal(active: boolean) {
    await act(async () => {
      root.render(
        <WatchModalActivityProvider>
          <ModalOwner active={active} />
          <CarouselVideo data={baseFragment} />
        </WatchModalActivityProvider>,
      )
    })
  }

  it("mounts via Mux Video for the selected item", async () => {
    await act(async () => {
      root.render(<CarouselVideo data={baseFragment} />)
    })

    // @mux/mux-video-react renders a plain <video> element.
    expect(container.querySelector("video")).not.toBeNull()
    expect(
      container.querySelector('[data-testid="carousel-copy"]'),
    ).not.toBeNull()
    expect(container.textContent).toContain("Series")
  })

  it("uses the shared focus frame and preserves selected-state framing", async () => {
    const data = {
      ...baseFragment,
      items: [
        ...baseFragment.items,
        {
          ...baseFragment.items[0],
          streamingUrl: "https://example.com/two.m3u8",
          titleOverride: "Second",
        },
      ],
    } as Parameters<typeof CarouselVideo>[0]["data"]

    await act(async () => {
      root.render(<CarouselVideo data={data} />)
    })

    const selected = container.querySelector<HTMLElement>(
      '[role="button"][aria-label="Show First"]',
    )
    const inactive = container.querySelector<HTMLElement>(
      '[role="button"][aria-label="Show Second"]',
    )
    const selectedInteractionFrame = selected?.querySelector<HTMLElement>(
      '[data-testid="carousel-video-thumbnail-frame"]',
    )
    const inactiveInteractionFrame = inactive?.querySelector<HTMLElement>(
      '[data-testid="carousel-video-thumbnail-frame"]',
    )

    expect(selected?.className).toContain("focus-visible:outline-none")
    expect(selectedInteractionFrame?.className).not.toContain(
      "group-focus-visible:opacity-100",
    )
    expect(selectedInteractionFrame?.className).toContain("opacity-100")
    expect(inactiveInteractionFrame?.className).toContain("border-white")
    expect(inactiveInteractionFrame?.className).toContain(
      "group-hover:opacity-100",
    )
    expect(inactiveInteractionFrame?.className).toContain(
      "group-focus-visible:opacity-100",
    )

    await act(async () => {
      inactive?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      )
    })

    expect(inactiveInteractionFrame?.className).toContain("opacity-100")
    expect(inactiveInteractionFrame?.className).not.toContain(
      "group-focus-visible:opacity-100",
    )
  })

  it("omits the copy block when no carousel text is authored", async () => {
    await act(async () => {
      root.render(
        <CarouselVideo
          data={{
            ...baseFragment,
            title: undefined,
            subtitle: undefined,
            carouselDescription: undefined,
          }}
        />,
      )
    })

    expect(container.querySelector("video")).not.toBeNull()
    expect(container.querySelector('[data-testid="carousel-copy"]')).toBeNull()
    expect(container.textContent).toContain("First")
  })

  it("pauses its authored carousel media when modal activity opens", async () => {
    await renderWithModal(false)
    const video = container.querySelector("video") as HTMLVideoElement
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: false,
      writable: true,
    })
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {
      Object.defineProperty(video, "paused", {
        configurable: true,
        value: true,
      })
    })

    await renderWithModal(true)

    expect(pause).toHaveBeenCalledOnce()
  })
})
