/**
 * @vitest-environment jsdom
 */

import { act, createElement, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WhatsNewShot } from "@/components/whats-new/WhatsNewShot"

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement("img", { alt, src }),
}))

const SHOT = {
  src: "/watch/images/whats-new/home.webp",
  alt: "The Watch home page, scrolled",
}
const CLIP = {
  webm: "/watch/assets/whats-new/home.webm",
  mp4: "/watch/assets/whats-new/home.mp4",
}

let container: HTMLDivElement
let root: Root

/**
 * One record per constructed observer, so a test can drive the FETCH one
 * and the PLAY one separately — the component's whole shape is that those
 * are two observers with different thresholds, and a single shared fake
 * would let a regression that collapses them into one still pass.
 */
type FakeObserver = {
  options: IntersectionObserverInit | undefined
  callback: IntersectionObserverCallback
  disconnected: boolean
  observed: Element[]
}
let observers: FakeObserver[]

const fetchObserver = () => observers.find((it) => it.options?.rootMargin)!
const playObserver = () => observers.find((it) => it.options?.threshold)!
const fire = (observer: FakeObserver, isIntersecting: boolean) =>
  act(() => {
    observer.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  })

const clip = () =>
  container.querySelector<HTMLVideoElement>(
    '[data-testid="whats-new-shot-clip"]',
  )

function mount(node: React.ReactNode) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(node)
  })
}

beforeEach(() => {
  observers = []
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        const record: FakeObserver = {
          callback,
          options,
          disconnected: false,
          observed: [],
        }
        observers.push(record)
        Object.assign(this, {
          observe: (element: Element) => record.observed.push(element),
          disconnect: () => {
            record.disconnected = true
          },
          unobserve: () => {},
          takeRecords: () => [],
        })
      }
    },
  )
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
  // jsdom implements neither, and an unstubbed play() throws "not
  // implemented" straight through the intersection callback. The stubs
  // drive `paused` as well as recording the call, because the component
  // reads it to avoid issuing a redundant pause.
  let paused = true
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(
    () => paused,
  )
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => {
    paused = false
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {
    paused = true
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("WhatsNewShot", () => {
  it("renders the still with its alt text before anything is observed", () => {
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)

    const still = container.querySelector("img")
    expect(still?.getAttribute("src")).toBe(SHOT.src)
    expect(still?.getAttribute("alt")).toBe(SHOT.alt)
  })

  it("requests no clip bytes for a card the reader never reaches", () => {
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)

    // The element is absent, not merely paused: a mounted <video> with a
    // <source> is a request the reader never asked for.
    expect(clip()).toBeNull()
  })

  it("attaches the clip only once the card is approached", () => {
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)
    fire(fetchObserver(), true)

    const sources = [...(clip()?.querySelectorAll("source") ?? [])]
    expect(sources.map((source) => source.getAttribute("src"))).toEqual([
      CLIP.webm,
      CLIP.mp4,
    ])
    // WebM first or the smaller file is never the one taken.
    expect(sources.map((source) => source.getAttribute("type"))).toEqual([
      "video/webm",
      "video/mp4",
    ])
  })

  it("keeps the still mounted underneath the clip", () => {
    // The clip is decoration layered over the still, not a replacement:
    // a 404 or a refused codec leaves no React error to catch, so the
    // still has to already be there.
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)
    fire(fetchObserver(), true)

    expect(container.querySelector("img")).not.toBeNull()
    expect(clip()?.getAttribute("aria-hidden")).toBe("true")
    expect(clip()?.getAttribute("tabindex")).toBe("-1")
  })

  it("clips the media in its own box, not on the frame", () => {
    // The frame stays unclipped and untinted: the colour around the shot is
    // the CELL's gradient showing through the cell's padding. Put
    // `overflow-hidden` back on the frame and nothing breaks visually here,
    // but the shadow that lifts the shot off that colour gets cut off.
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)
    fire(fetchObserver(), true)

    const frame = container.querySelector<HTMLElement>(
      '[data-testid="whats-new-shot-frame"]',
    )!
    expect(frame.className).not.toMatch(/\bbg-\[linear-gradient/)
    expect(frame.getAttribute("style")).toBeNull()

    const inset = clip()!.parentElement!
    expect(inset).not.toBe(frame)
    expect(inset.className).toMatch(/\boverflow-hidden\b/)
    expect(container.querySelector("img")!.parentElement).toBe(inset)
  })

  it("plays on the way in and pauses on the way out", () => {
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)
    fire(fetchObserver(), true)

    fire(playObserver(), true)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)

    fire(playObserver(), false)
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
  })

  it("still plays when it was already visible before the clip mounted", () => {
    // The production ordering, and the one that was broken: the play
    // observer crosses FIRST, while <video> does not exist yet. Driving
    // play() from inside that callback drops the only intersection the
    // card will ever get — it never leaves the viewport, so no second
    // entry arrives and it holds the poster forever.
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)

    fire(playObserver(), true)
    expect(clip()).toBeNull()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()

    fire(fetchObserver(), true)
    expect(clip()).not.toBeNull()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
  })

  it("holds the clip hidden until it can actually paint a frame", () => {
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)
    fire(fetchObserver(), true)

    expect(clip()?.className).toContain("opacity-0")
    act(() => {
      clip()?.dispatchEvent(new Event("canplay"))
    })
    expect(clip()?.className).toContain("opacity-100")
  })

  it("never fetches a clip under reduced motion", () => {
    // The discriminating case: the card IS approached, and the only thing
    // holding the clip back is the media query. Every other test here runs
    // with `matches: false`, so without this one the reduced-motion branch
    // could be deleted and nothing would go red.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)

    expect(observers).toHaveLength(0)
    expect(clip()).toBeNull()
    expect(container.querySelector("img")).not.toBeNull()
  })

  it("re-arms its observers across a StrictMode remount", () => {
    // StrictMode runs setup → cleanup → setup on the SAME instance, so a
    // cleanup that disconnects without setup rebuilding leaves a card that
    // never loads or plays. Only the observers from the surviving setup
    // are live, so the assertion is on the LAST pair.
    mount(
      <StrictMode>
        <WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />
      </StrictMode>,
    )

    expect(observers.length).toBeGreaterThanOrEqual(4)
    const live = observers.slice(-2)
    expect(live.every((observer) => observer.disconnected)).toBe(false)

    fire(fetchObserver(), true)
    expect(clip()).not.toBeNull()
  })

  it("disconnects both observers when the card unmounts", () => {
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)
    const started = observers.length
    expect(started).toBe(2)

    act(() => {
      root.unmount()
    })
    expect(observers.every((observer) => observer.disconnected)).toBe(true)

    // afterEach unmounts again; make that a no-op rather than a throw.
    root = createRoot(document.createElement("div"))
  })

  it("crops to the featured ratio only when featured", () => {
    mount(<WhatsNewShot shot={SHOT} clip={CLIP} featured />)
    expect(container.firstElementChild?.className).toContain("aspect-[21/7]")

    act(() => {
      root.render(<WhatsNewShot shot={SHOT} clip={CLIP} featured={false} />)
    })
    expect(container.firstElementChild?.className).toContain("aspect-[16/9]")
  })
})
