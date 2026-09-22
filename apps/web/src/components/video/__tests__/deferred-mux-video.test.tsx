/**
 * @vitest-environment jsdom
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The failure this file exists for is a REJECTED chunk load, which the shared
// `next-dynamic-sync` stub cannot produce — it always resolves. So `next/dynamic`
// is stubbed here to return a component that throws during render, which is
// exactly what Next's `lazy()` does once its payload has rejected.
const { shouldThrow } = vi.hoisted(() => ({ shouldThrow: { value: true } }))

vi.mock("next/dynamic", () => ({
  default: () =>
    function ThrowingLazy() {
      if (shouldThrow.value) throw new Error("ChunkLoadError")
      return <video data-testid="player" />
    },
}))

const { default: DeferredMuxVideo } =
  await import("@/components/video/deferred-mux-video")

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  shouldThrow.value = true
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

describe("DeferredMuxVideo", () => {
  // Without the boundary this throw escapes to the route's `error.tsx` and
  // replaces the entire Watch page — copy, artwork and navigation included —
  // over a video engine none of it needs. feat-535 / FGE-138.
  it("contains a failed chunk load to its own box", async () => {
    // React logs the caught error; keep the suite output readable.
    vi.spyOn(console, "error").mockImplementation(() => {})

    await act(async () => {
      root.render(
        <div data-testid="siblings">
          <p>page copy</p>
          <DeferredMuxVideo src="https://stream.example/a.m3u8" />
        </div>,
      )
    })

    // The player is gone; everything around it survived.
    expect(container.querySelector('[data-testid="player"]')).toBeNull()
    expect(container.querySelector('[data-testid="siblings"]')).not.toBeNull()
    expect(container.textContent).toContain("page copy")
  })

  it("renders the player normally when the chunk resolves", async () => {
    shouldThrow.value = false

    await act(async () => {
      root.render(<DeferredMuxVideo src="https://stream.example/a.m3u8" />)
    })

    expect(container.querySelector('[data-testid="player"]')).not.toBeNull()
  })

  // The repo's StrictMode law: a stateful boundary must survive the dev
  // setup -> cleanup -> setup remount without latching its failed state on a
  // subtree that would otherwise render.
  it("still renders under StrictMode when the chunk resolves", async () => {
    shouldThrow.value = false

    await act(async () => {
      root.render(
        <StrictMode>
          <DeferredMuxVideo src="https://stream.example/a.m3u8" />
        </StrictMode>,
      )
    })

    expect(container.querySelector('[data-testid="player"]')).not.toBeNull()
  })
})
