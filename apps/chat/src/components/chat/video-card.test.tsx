import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type VideoAttachment } from "@/lib/conversations"

import { VideoCard, VideoRenderBoundary } from "./video-card"

// The real `next/dynamic` boundary stays in play (findBy* awaits it); only the
// leaf is mocked. `@mux/mux-video-react` is not resolvable from apps/chat under
// pnpm strict resolution, so the wrapper subpath is the mock point.
const muxProps: Array<Record<string, unknown>> = []

vi.mock("@forge/video-player/mux-video", () => ({
  default: (props: Record<string, unknown>) => {
    muxProps.push(props)
    return <video data-testid="mux-video" />
  },
}))

const VIDEO: VideoAttachment = {
  videoId: "vid_1",
  title: "Jesus Calms the Storm",
  playbackId: "abcdEFGH1234",
  durationSeconds: 754,
  watchUrl: "https://www.jesusfilm.org/watch/jesus.html",
}

beforeEach(() => {
  muxProps.length = 0
})

describe("VideoCard rendering", () => {
  it("mounts the lazy player with the derived Mux poster", async () => {
    render(<VideoCard video={VIDEO} />)
    await screen.findByTestId("mux-video")
    expect(muxProps).toHaveLength(1)
    expect(muxProps[0]).toMatchObject({
      playbackId: "abcdEFGH1234",
      poster:
        "https://image.mux.com/abcdEFGH1234/thumbnail.jpg?width=1280&height=720&fit_mode=smartcrop",
      controls: true,
      preload: "none",
    })
  })

  it("captions with the title linking to the client-built watch URL", async () => {
    render(<VideoCard video={VIDEO} />)
    const link = await screen.findByRole("link", {
      name: /Jesus Calms the Storm/,
    })
    expect(link).toHaveAttribute(
      "href",
      "https://www.jesusfilm.org/watch/jesus.html",
    )
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it("renders the duration as m:ss beside the title", async () => {
    const { container } = render(<VideoCard video={VIDEO} />)
    await screen.findByTestId("mux-video")
    expect(container.querySelector("[data-video-duration]")).toHaveTextContent(
      "12:34",
    )
  })

  it("renders a sub-minute duration as 0:SS", async () => {
    const { container } = render(
      <VideoCard video={{ ...VIDEO, durationSeconds: 7 }} />,
    )
    await screen.findByTestId("mux-video")
    expect(container.querySelector("[data-video-duration]")).toHaveTextContent(
      "0:07",
    )
  })

  it("widens the duration to h:mm:ss past an hour", async () => {
    const { container } = render(
      <VideoCard video={{ ...VIDEO, durationSeconds: 3725 }} />,
    )
    await screen.findByTestId("mux-video")
    expect(container.querySelector("[data-video-duration]")).toHaveTextContent(
      "1:02:05",
    )
  })

  it("omits the duration entirely when the wire carried none", async () => {
    const { container } = render(
      <VideoCard video={{ ...VIDEO, durationSeconds: null }} />,
    )
    await screen.findByTestId("mux-video")
    expect(container.querySelector("[data-video-duration]")).toBeNull()
    expect(screen.getByText("Jesus Calms the Storm")).toBeInTheDocument()
  })

  it("renders the title as plain text when the watch URL is not https", async () => {
    // Defence in depth: watchUrl is client-built, but the caption still goes
    // through the shared https-only gate rather than trusting that.
    render(<VideoCard video={{ ...VIDEO, watchUrl: "javascript:alert(1)" }} />)
    await screen.findByTestId("mux-video")
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByText("Jesus Calms the Storm")).toBeInTheDocument()
  })
})

describe("VideoCard title bounding (render layer only)", () => {
  const LONG = "A very long catalog title. ".repeat(200)

  async function labelFor(title: string): Promise<string> {
    render(<VideoCard video={{ ...VIDEO, title }} />)
    await screen.findByTestId("mux-video")
    return String(muxProps[0]!["aria-label"])
  }

  it("truncates the accessible name, which CSS cannot reach", async () => {
    const label = await labelFor(LONG)
    expect(label.length).toBeLessThanOrEqual(200)
    expect(label.endsWith("…")).toBe(true)
    expect(LONG.startsWith(label.slice(0, 50))).toBe(true)
  })

  it("leaves a normal-length title untouched", async () => {
    expect(await labelFor(VIDEO.title)).toBe(VIDEO.title)
  })

  it("returns a title of EXACTLY the cap verbatim, with no ellipsis", async () => {
    // Walks the boundary: flipping `<=` to `<` truncates this legitimate
    // title and turns this red. The long fixtures alone cannot catch that.
    const exact = "x".repeat(200)
    const label = await labelFor(exact)
    expect(label).toBe(exact)
    expect(label).not.toContain("…")
  })

  it("truncates one code unit over the cap back to exactly the cap", async () => {
    const label = await labelFor("x".repeat(201))
    expect(label).toBe(`${"x".repeat(199)}…`)
    expect(label.length).toBe(200)
  })

  it("never emits a lone surrogate when the cut lands inside a pair", async () => {
    // The cut index falls on the high half of the emoji; a naive slice would
    // leave an unpaired surrogate in the accessible name.
    const label = await labelFor(`${"a".repeat(198)}😀${"b".repeat(50)}`)
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(label).toBe(`${"a".repeat(198)}…`)
  })

  it("collapses whitespace so the label mirrors the rendered caption", async () => {
    // Leading runs would otherwise consume the whole budget and leave a bare
    // ellipsis as the accessible name.
    const label = await labelFor(`${" ".repeat(250)}Jesus Calms the Storm`)
    expect(label).toBe("Jesus Calms the Storm")
  })

  it("clamps the caption visually while keeping the FULL title in the DOM", async () => {
    const { container } = render(
      <VideoCard video={{ ...VIDEO, title: LONG }} />,
    )
    await screen.findByTestId("mux-video")
    const caption = container.querySelector("[data-video-caption]")!
    expect(caption).toHaveClass("line-clamp-2")
    // jsdom performs no layout, so the class mix IS the guard. Same denylist
    // as sources-list.test.tsx (source of truth) — keep the two in step; any
    // display utility here silently unclamps, browser-caught in feat-269.
    const displayUtilities = [
      "block",
      "inline-block",
      "inline",
      "flex",
      "inline-flex",
      "grid",
      "inline-grid",
      "table",
      "inline-table",
      "flow-root",
      "contents",
      "list-item",
      "hidden",
    ]
    for (const cls of displayUtilities) {
      expect(caption.classList.contains(cls)).toBe(false)
    }
    // Nothing is destroyed: selection and screen readers still get it all.
    expect(caption.textContent).toContain(LONG.trim().slice(0, 500))
  })

  it("renders the player normally for a pathological title", async () => {
    // Render-layer only. The "never rejects the row" ruling is pinned where
    // rejection could actually happen — see toVideo in chat-stub.test.ts.
    render(<VideoCard video={{ ...VIDEO, title: LONG }} />)
    expect(await screen.findByTestId("mux-video")).toBeInTheDocument()
  })
})

describe("lazy-boundary pin (plan D2 — the bundle split)", () => {
  it("keeps the player behind exactly one ssr:false dynamic import", async () => {
    // Nothing else holds D2: a static import typechecks and leaves every other
    // test green while moving the ~646 KB raw hls.js chunk into the initial
    // load. vi.mock matches by specifier, so the RTL suites cannot catch it.
    const { readFile } = await import("node:fs/promises")
    const { resolve } = await import("node:path")
    const source = await readFile(
      resolve(process.cwd(), "src/components/chat/video-card.tsx"),
      "utf8",
    )
    // Strip TRAILING // comments too, not just whole-line ones: a trailing
    // `// ssr: false` beside the call would otherwise satisfy the assertion
    // below. The [^:] guard spares the // inside https://image.mux.com.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")

    // Exactly one dynamic() call, and it must load THE PLAYER — a dynamic
    // import of anything else would otherwise satisfy a bare count.
    expect(code.match(/\bdynamic\(/g)).toHaveLength(1)
    expect(code).toContain('from "next/dynamic"')
    expect(code).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\(\s*["']@forge\/video-player\/mux-video["']/,
    )
    // Scoped to the call: a trailing `// ssr: false` survives the line-anchored
    // strip above, so a file-wide match could be satisfied by a comment.
    expect(code).toMatch(/dynamic\([\s\S]{0,200}?ssr:\s*false/)

    // No STATIC import of the package by any specifier — prefix-based and
    // newline-immune, so the barrel, the mux-player subpath, and a
    // prettier-wrapped multi-line import are all caught.
    expect(code).not.toMatch(/\bfrom\s*["']@forge\/video-player(\/[^"']*)?["']/)
  })
})

describe("VideoCard telemetry posture (plan U3)", () => {
  it("passes tracking + cookie disabling EXPLICITLY, never inherited", async () => {
    render(<VideoCard video={VIDEO} />)
    await screen.findByTestId("mux-video")
    expect(muxProps[0]!.disableTracking).toBe(true)
    expect(muxProps[0]!.disableCookies).toBe(true)
  })

  it("passes no metadata, viewer-id, or Mux Data env key prop", async () => {
    render(<VideoCard video={VIDEO} />)
    await screen.findByTestId("mux-video")
    const keys = Object.keys(muxProps[0]!)
    expect(keys).not.toContain("metadata")
    for (const key of keys) {
      expect(key).not.toMatch(/viewer|metadata|envKey|env_key|beacon/i)
    }
  })

  it("sends Mux nothing from the conversation beyond the gated playback id", async () => {
    render(<VideoCard video={VIDEO} />)
    await screen.findByTestId("mux-video")
    // Every string prop must be derived from the playbackId or the title (the
    // catalog fields) — no conversation id, message id, or user identity.
    const values = Object.values(muxProps[0]!).filter(
      (value) => typeof value === "string",
    ) as string[]
    for (const value of values) {
      expect(
        value.includes("abcdEFGH1234") ||
          value.includes(VIDEO.title) ||
          !value.includes("://"),
      ).toBe(true)
    }
  })
})

describe("VideoRenderBoundary", () => {
  function Boom(): never {
    throw new Error("hls.js exploded")
  }

  it("degrades to a plain line instead of rethrowing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { container } = render(
      <VideoRenderBoundary>{() => <Boom />}</VideoRenderBoundary>,
    )
    expect(container.querySelector('[data-video="unavailable"]')).not.toBeNull()
    spy.mockRestore()
  })

  it("renders its children untouched when nothing throws", () => {
    const { container } = render(
      <VideoRenderBoundary>
        {() => <span data-testid="child">ok</span>}
      </VideoRenderBoundary>,
    )
    expect(screen.getByTestId("child")).toBeInTheDocument()
    expect(container.querySelector('[data-video="unavailable"]')).toBeNull()
  })

  it("degrades on an ASYNC failure reported through fail(), which no boundary can catch", async () => {
    // The second failure class: an HTMLMediaElement `error` event fires
    // outside the render phase, so getDerivedStateFromError never sees it.
    function Child({ fail }: { fail: () => void }) {
      return (
        <button type="button" onClick={fail} data-testid="explode">
          boom
        </button>
      )
    }
    const { container } = render(
      <VideoRenderBoundary>
        {(fail) => <Child fail={fail} />}
      </VideoRenderBoundary>,
    )
    expect(container.querySelector('[data-video="unavailable"]')).toBeNull()
    await userEvent.click(screen.getByTestId("explode"))
    expect(container.querySelector('[data-video="unavailable"]')).not.toBeNull()
  })
})

describe("VideoCard playback failure", () => {
  it("shows the same fallback when the player reports a playback error", async () => {
    render(<VideoCard video={VIDEO} />)
    await screen.findByTestId("mux-video")
    const onError = muxProps[0]!.onError as () => void
    expect(typeof onError).toBe("function")
    await act(async () => {
      onError()
    })
    expect(screen.getByText(/can’t be played here/)).toBeInTheDocument()
    // The caption link survives so the watch page stays reachable.
    expect(
      screen.getByRole("link", { name: /Jesus Calms the Storm/ }),
    ).toBeInTheDocument()
  })

  it("collapses the reserved player box on failure, leaving no empty hole", async () => {
    const { container } = render(<VideoCard video={VIDEO} />)
    await screen.findByTestId("mux-video")
    // The box is reserved while the lazy chunk resolves…
    expect(container.querySelector(".aspect-video")).not.toBeNull()
    await act(async () => {
      ;(muxProps[0]!.onError as () => void)()
    })
    // …and goes away with the player, rather than framing the fallback line.
    expect(container.querySelector(".aspect-video")).toBeNull()
  })
})
