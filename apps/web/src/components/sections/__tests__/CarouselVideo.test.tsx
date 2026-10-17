/**
 * @vitest-environment jsdom
 *
 * CarouselVideo — Mux-only path. The flag-off (video.js) branch was
 * removed once `NEXT_PUBLIC_FORGE_WATCH_PLAYER_MIGRATION` graduated.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

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
    CarouselPrevious: ({ label }: { label: string }) => (
      <button data-slot="carousel-previous" aria-label={label} />
    ),
    CarouselNext: ({ label }: { label: string }) => (
      <button data-slot="carousel-next" aria-label={label} />
    ),
  }
})

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}))

import {
  holdDeferredChunk,
  rejectDeferredChunk,
  resetDeferredChunk,
} from "@/__mocks__/next-dynamic-sync"
import { CarouselVideo } from "@/components/sections/CarouselVideo"
import {
  WatchModalActivityProvider,
  useWatchModalActivity,
} from "@/components/watch/WatchModalActivityProvider"
// This section defers `@forge/video-player/mux-video` through `next/dynamic`
// so hls.js and mux-embed stay out of the Watch routes' first-load script set
// (feat-719 / FGE-138). Resolve it synchronously here so the cases below keep
// driving a real <video>. See the mock module for what that erases.
vi.mock("next/dynamic", async () => import("@/__mocks__/next-dynamic-sync"))
// `React.lazy` settles its payload across microtask turns, and the real
// `@mux/mux-video-react` module graph needs more than one. Warming the module
// registry first means the loader's promise is already resolved, so the very
// first `await act(...)` render commits the player instead of suspending.
beforeAll(async () => {
  await import("@forge/video-player/mux-video")
})

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
  resetDeferredChunk()
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

  const posterFragment = {
    ...baseFragment,
    items: [
      {
        ...baseFragment.items![0],
        imageUrl: "https://image.mux.com/poster-id/thumbnail.jpg",
      },
    ],
  } as Parameters<typeof CarouselVideo>[0]["data"]

  function posterImage() {
    return container.querySelector(
      '[data-testid="deferred-video-poster"] img',
    ) as HTMLImageElement | null
  }

  // `ssr: false` leaves no <video> to carry the poster on the server or while
  // the chunk is in flight; the pending stub stands in for both.
  it("paints the selected item's poster without the player chunk", async () => {
    holdDeferredChunk()

    const html = renderToString(<CarouselVideo data={posterFragment} />)
    expect(html).not.toContain("<video")
    expect(html).toContain('data-testid="deferred-video-poster"')

    await act(async () => {
      root.render(<CarouselVideo data={posterFragment} />)
    })

    expect(container.querySelector("video")).toBeNull()
    expect(posterImage()?.getAttribute("src")).toBe(
      "https://image.mux.com/poster-id/thumbnail.jpg",
    )
  })

  it("keeps the poster and a way out when the player chunk fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    rejectDeferredChunk()

    await act(async () => {
      root.render(<CarouselVideo data={posterFragment} />)
    })

    expect(container.querySelector("video")).toBeNull()
    expect(posterImage()).not.toBeNull()
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("Something went wrong.")
    expect(alert?.querySelector("button")?.textContent).toBe("Try again")
    expect(container.querySelector('input[type="range"]')).toBeNull()
    // The rest of the section survives: copy and the item picker.
    expect(container.textContent).toContain("Series")
    expect(
      container.querySelector('button[data-slot="carousel-next"]'),
    ).not.toBeNull()
  })

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
    expect(
      container.querySelector(
        'button[data-slot="carousel-previous"][aria-label="Previous video preview"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector(
        'button[data-slot="carousel-next"][aria-label="Next video preview"]',
      ),
    ).not.toBeNull()
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
