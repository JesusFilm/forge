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
    onLoad,
  }: {
    src: string
    alt: string
    className?: string
    unoptimized?: boolean
    onLoad?: () => void
  }) => {
    latestImageOnLoad = onLoad
    return (
      <div
        data-testid="next-image-mock"
        data-src={src}
        data-alt={alt}
        data-unoptimized={String(Boolean(unoptimized))}
        className={className}
        onClick={onLoad}
      />
    )
  },
}))

import { MuxHoverPreview } from "@/components/watch/MuxHoverPreview"

let container: HTMLDivElement
let root: Root
let latestImageOnLoad: (() => void) | undefined

beforeEach(() => {
  latestImageOnLoad = undefined
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderPreview(
  previewUrl: string | null = "https://image.mux.com/pb/animated.webp",
  onPreviewLoadedChange?: (loaded: boolean) => void,
) {
  act(() => {
    root.render(
      <button type="button">
        <MuxHoverPreview
          previewUrl={previewUrl}
          sizes="100vw"
          onPreviewLoadedChange={onPreviewLoadedChange}
        />
      </button>,
    )
  })
}

function makePointerEnterEvent(pointerType: "mouse" | "pen" | "touch") {
  const event = new Event("pointerenter", { bubbles: false })
  Object.defineProperty(event, "pointerType", { value: pointerType })
  Object.defineProperty(event, "buttons", { value: 0 })
  return event
}

describe("MuxHoverPreview", () => {
  it("does not request the animated image before hover or focus", () => {
    renderPreview("https://image.mux.com/playback/animated.webp?width=448")

    expect(
      container.querySelector('[data-testid="mux-hover-preview"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="mux-hover-preview"]')?.className,
    ).toContain("pointer-events-none")
    expect(
      container.querySelector('[data-testid="next-image-mock"]'),
    ).toBeNull()
  })

  it("does not load the animated image after touch pointer entry", () => {
    renderPreview("https://image.mux.com/playback/animated.webp?width=448")

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(makePointerEnterEvent("touch"))
    })

    expect(
      container
        .querySelector('[data-testid="mux-hover-preview"]')
        ?.getAttribute("data-active"),
    ).toBe("false")
    expect(
      container.querySelector('[data-testid="next-image-mock"]'),
    ).toBeNull()
  })

  it("does not load the animated image without a hover-capable fine pointer", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false,
    } as MediaQueryList)
    renderPreview("https://image.mux.com/playback/animated.webp?width=448")

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(makePointerEnterEvent("mouse"))
    })

    expect(
      container
        .querySelector('[data-testid="mux-hover-preview"]')
        ?.getAttribute("data-active"),
    ).toBe("false")
    expect(
      container.querySelector('[data-testid="next-image-mock"]'),
    ).toBeNull()
  })

  it("loads an unoptimized animated image after mouse hover", () => {
    const previewUrl = "https://image.mux.com/playback/animated.webp?width=448"
    renderPreview(previewUrl)

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(makePointerEnterEvent("mouse"))
    })

    const image = container.querySelector('[data-testid="next-image-mock"]')
    expect(image?.getAttribute("data-src")).toBe(previewUrl)
    expect(image?.getAttribute("data-alt")).toBe("")
    expect(image?.getAttribute("data-unoptimized")).toBe("true")

    act(() => {
      button?.dispatchEvent(makePointerEnterEvent("mouse"))
    })
    expect(
      container.querySelectorAll('[data-testid="next-image-mock"]'),
    ).toHaveLength(1)
  })

  it("recognizes a fine hover pointer on a touch-first hybrid device", () => {
    vi.mocked(window.matchMedia).mockImplementation(
      (query) =>
        ({
          matches: query === "(any-hover: hover) and (any-pointer: fine)",
        }) as MediaQueryList,
    )
    renderPreview("https://image.mux.com/playback/animated.webp?width=448")

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(makePointerEnterEvent("mouse"))
    })

    expect(window.matchMedia).toHaveBeenCalledWith(
      "(any-hover: hover) and (any-pointer: fine)",
    )
    expect(
      container.querySelector('[data-testid="next-image-mock"]'),
    ).not.toBeNull()
  })

  it("fades in the animated image after the image finishes loading", () => {
    const previewUrl = "https://image.mux.com/playback/animated.webp?width=448"
    renderPreview(previewUrl)

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(makePointerEnterEvent("mouse"))
    })

    const image = container.querySelector('[data-testid="next-image-mock"]')
    expect(image?.className).toContain("opacity-0")
    expect(image?.className).not.toContain("opacity-100")

    act(() => {
      image?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(
      container.querySelector('[data-testid="next-image-mock"]')?.className,
    ).toContain("opacity-100")
  })

  it("reports loaded state only after the animated image finishes loading", () => {
    const onPreviewLoadedChange = vi.fn()
    const previewUrl = "https://image.mux.com/playback/animated.webp?width=448"
    renderPreview(previewUrl, onPreviewLoadedChange)

    expect(onPreviewLoadedChange).toHaveBeenLastCalledWith(false)

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(makePointerEnterEvent("mouse"))
    })
    expect(onPreviewLoadedChange).toHaveBeenLastCalledWith(false)

    const image = container.querySelector('[data-testid="next-image-mock"]')
    act(() => {
      image?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onPreviewLoadedChange).toHaveBeenLastCalledWith(true)
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

  it("removes activation listeners on unmount", () => {
    const addEventListenerSpy = vi.spyOn(
      HTMLElement.prototype,
      "addEventListener",
    )
    const removeEventListenerSpy = vi.spyOn(
      HTMLElement.prototype,
      "removeEventListener",
    )
    renderPreview()

    const focusListener = addEventListenerSpy.mock.calls.find(
      ([type]) => type === "focus",
    )?.[1]
    const pointerEnterListener = addEventListenerSpy.mock.calls.find(
      ([type]) => type === "pointerenter",
    )?.[1]
    expect(focusListener).toBeTypeOf("function")
    expect(pointerEnterListener).toBeTypeOf("function")

    act(() => {
      root.unmount()
    })

    expect(removeEventListenerSpy).toHaveBeenCalledWith("focus", focusListener)
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "pointerenter",
      pointerEnterListener,
    )
  })

  it("ignores stale image loads after unmount", () => {
    const onPreviewLoadedChange = vi.fn()
    renderPreview(undefined, onPreviewLoadedChange)

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(makePointerEnterEvent("mouse"))
    })
    const staleImageOnLoad = latestImageOnLoad
    expect(staleImageOnLoad).toBeTypeOf("function")

    act(() => {
      root.unmount()
    })

    act(() => {
      staleImageOnLoad?.()
    })
    expect(onPreviewLoadedChange).not.toHaveBeenCalledWith(true)
  })

  it("renders nothing when no Mux preview URL is available", () => {
    renderPreview(null)

    expect(
      container.querySelector('[data-testid="mux-hover-preview"]'),
    ).toBeNull()
  })
})
