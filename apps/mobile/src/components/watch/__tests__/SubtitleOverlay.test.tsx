/**
 * Watch-page captions: a downloaded track reads from disk, an unsafe URL is
 * refused, a stalled fetch aborts at 8 s, each failure logs one stable
 * `subtitle.vtt_failed` reason, and a source change or an unmount clears the
 * caption and aborts the request.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})
// The overlay subscribes to the player's playingChange; return the seed.
jest.mock("expo", () => ({
  useEvent: (_player: unknown, _name: string, initial: unknown) => initial,
}))
jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: jest.fn(),
}))
jest.mock("../../../lib/offlineFileSystem", () => ({
  OFFLINE_ROOT: "file:///docs/offline-downloads",
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { act, type ComponentProps } from "react"
import { StyleSheet } from "react-native"
import { readAsStringAsync } from "expo-file-system/legacy"

import { SubtitleOverlay } from "../SubtitleOverlay"
import type { CaptionBox } from "../../../lib/captionBox"
import { datadogLog } from "../../../lib/datadog"
import * as vttCache from "../../../lib/vttCache"
import {
  TestRenderer,
  hasText,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const OFFLINE_ROOT = "file:///docs/offline-downloads"
const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello world

00:00:05.000 --> 00:00:08.000
Second line`

const readMock = readAsStringAsync as jest.MockedFunction<
  typeof readAsStringAsync
>
const warnMock = datadogLog.warn as jest.Mock
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>()
const originalFetch = globalThis.fetch

// A fresh URL per case, so no case can read another case's result.
let urlCount = 0
function nextUrl(): string {
  urlCount += 1
  return `https://cdn.example.com/subtitles/track-${urlCount}.vtt`
}

function makePlayer(currentTime = 2) {
  return { playing: false, currentTime }
}

// Rejects the way a real fetch does when its signal aborts.
function pendingFetch(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
    })
  })
}

function signalOf(call: number): AbortSignal {
  const signal = fetchMock.mock.calls[call]?.[1]?.signal
  if (!signal) throw new Error(`fetch call ${call} had no signal`)
  return signal
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function render(
  vttSrc: string | null,
  player = makePlayer(),
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <SubtitleOverlay player={player as never} vttSrc={vttSrc} />,
    )
  })
  await flush()
  return renderer
}

async function rerender(
  renderer: TestInstance,
  vttSrc: string | null,
  player: ReturnType<typeof makePlayer>,
) {
  await act(async () => {
    renderer.update(
      <SubtitleOverlay player={player as never} vttSrc={vttSrc} />,
    )
  })
  await flush()
}

function warnedReasons(): unknown[] {
  return warnMock.mock.calls
    .filter(([event]) => event === "subtitle.vtt_failed")
    .map(([, context]) => (context as { reason: unknown }).reason)
}

beforeEach(() => {
  vttCache.resetVttCacheForTests()
  fetchMock.mockReset()
  readMock.mockReset()
  warnMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

afterAll(() => {
  vttCache.resetVttCacheForTests()
  globalThis.fetch = originalFetch
})

describe("SubtitleOverlay — network tracks", () => {
  it("shows the cue under the playhead from a fetched track", async () => {
    fetchMock.mockResolvedValueOnce(new Response(VTT))
    const url = nextUrl()
    const renderer = await render(url)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url)
    expect(hasText(renderer, "Hello world")).toBe(true)
    expect(warnedReasons()).toEqual([])
    await unmount(renderer)
  })

  it("shows nothing and fetches nothing without a source", async () => {
    const renderer = await render(null)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })

  it("refuses an unsafe URL without fetching it", async () => {
    const renderer = await render("ftp://cdn.example.com/track.vtt")

    expect(fetchMock).not.toHaveBeenCalled()
    expect(renderer.toJSON()).toBeNull()
    expect(warnedReasons()).toEqual(["unsafe_url"])
    await unmount(renderer)
  })

  it("aborts a stalled fetch at 8 s and logs a timeout", async () => {
    jest.useFakeTimers()
    fetchMock.mockImplementationOnce((_url, init) => pendingFetch(init))
    const renderer = await render(nextUrl())

    await act(async () => {
      jest.advanceTimersByTime(7_999)
    })
    await flush()
    expect(signalOf(0).aborted).toBe(false)
    expect(warnedReasons()).toEqual([])

    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    await flush()
    expect(signalOf(0).aborted).toBe(true)
    expect(warnedReasons()).toEqual(["timeout"])
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })

  it.each([
    [404, "http_404"],
    [503, "http_503"],
  ])("logs a %i response as %s and shows nothing", async (status, reason) => {
    fetchMock.mockResolvedValueOnce(new Response("Not here", { status }))
    const renderer = await render(nextUrl())

    expect(warnedReasons()).toEqual([reason])
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })

  it("logs a network failure as network_error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"))
    const renderer = await render(nextUrl())

    expect(warnedReasons()).toEqual(["network_error"])
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })

  it("logs a track with no cues as parse_empty", async () => {
    fetchMock.mockResolvedValueOnce(new Response("WEBVTT\n"))
    const renderer = await render(nextUrl())

    expect(warnedReasons()).toEqual(["parse_empty"])
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })
})

describe("SubtitleOverlay — source changes and unmount", () => {
  it("clears the old caption at once when the source changes", async () => {
    const player = makePlayer()
    fetchMock.mockResolvedValueOnce(new Response(VTT))
    const renderer = await render(nextUrl(), player)
    expect(hasText(renderer, "Hello world")).toBe(true)

    // The next track stays in flight, so only the change can clear the text.
    fetchMock.mockImplementationOnce((_url, init) => pendingFetch(init))
    await rerender(renderer, nextUrl(), player)
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })

  it("aborts the old request when the source changes", async () => {
    const player = makePlayer()
    fetchMock.mockImplementationOnce((_url, init) => pendingFetch(init))
    const renderer = await render(nextUrl(), player)

    fetchMock.mockResolvedValueOnce(
      new Response(VTT.replace("Hello world", "New language")),
    )
    await rerender(renderer, nextUrl(), player)

    expect(signalOf(0).aborted).toBe(true)
    expect(hasText(renderer, "New language")).toBe(true)
    // The aborted request is a cancellation, not a failure.
    expect(warnedReasons()).toEqual([])
    await unmount(renderer)
  })

  it("clears the caption when the source becomes null", async () => {
    const player = makePlayer()
    fetchMock.mockResolvedValueOnce(new Response(VTT))
    const renderer = await render(nextUrl(), player)
    expect(hasText(renderer, "Hello world")).toBe(true)

    await rerender(renderer, null, player)
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })

  it("aborts the in-flight request on unmount", async () => {
    fetchMock.mockImplementationOnce((_url, init) => pendingFetch(init))
    const renderer = await render(nextUrl())
    expect(signalOf(0).aborted).toBe(false)

    await unmount(renderer)
    await flush()
    expect(signalOf(0).aborted).toBe(true)
    expect(warnedReasons()).toEqual([])
  })
})

describe("SubtitleOverlay — downloaded tracks", () => {
  it("reads a downloaded track from disk and never fetches it", async () => {
    const src = `${OFFLINE_ROOT}/jesus/en.vtt`
    readMock.mockResolvedValueOnce(VTT)
    const renderer = await render(src)

    expect(readMock).toHaveBeenCalledWith(src)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hasText(renderer, "Hello world")).toBe(true)
    await unmount(renderer)
  })

  it("refuses a file outside the download root", async () => {
    const renderer = await render("file:///etc/passwd")

    expect(readMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warnedReasons()).toEqual(["unsafe_url"])
    await unmount(renderer)
  })

  it("logs a failed disk read as read_error", async () => {
    readMock.mockRejectedValueOnce(new Error("ENOENT"))
    const renderer = await render(`${OFFLINE_ROOT}/jesus/missing.vtt`)

    expect(warnedReasons()).toEqual(["read_error"])
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })

  it("logs an empty downloaded track as parse_empty", async () => {
    readMock.mockResolvedValueOnce("WEBVTT\n")
    const renderer = await render(`${OFFLINE_ROOT}/jesus/empty.vtt`)

    expect(warnedReasons()).toEqual(["parse_empty"])
    await unmount(renderer)
  })

  it("never asks the shared cue cache for a downloaded track", async () => {
    const load = jest.spyOn(vttCache, "loadVttCues")
    const pin = jest.spyOn(vttCache, "pinVtt")
    const src = `${OFFLINE_ROOT}/jesus/en.vtt`
    readMock.mockResolvedValueOnce(VTT)
    const renderer = await render(src)

    expect(hasText(renderer, "Hello world")).toBe(true)
    expect(load).not.toHaveBeenCalled()
    expect(pin).not.toHaveBeenCalled()
    expect(vttCache.peekVttCues(src)).toBeUndefined()
    await unmount(renderer)
  })
})

describe("SubtitleOverlay — on the shared cue cache", () => {
  it("shows a broadcast-offset track's caption at media time", async () => {
    // The first cue sits at 01:00:05 in the file; a 30-minute video plays it at 0:05.
    fetchMock.mockResolvedValueOnce(
      new Response("WEBVTT\n\n01:00:05.000 --> 01:00:08.000\nAt five seconds"),
    )
    const renderer = await render(nextUrl(), makePlayer(6))

    expect(hasText(renderer, "At five seconds")).toBe(true)
    await unmount(renderer)
  })

  it("reads a track that is already loaded from the cache, not the network", async () => {
    const url = nextUrl()
    fetchMock.mockResolvedValueOnce(new Response(VTT))
    const inline = await render(url)
    await unmount(inline)

    const fullscreen = await render(url)
    expect(hasText(fullscreen, "Hello world")).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await unmount(fullscreen)
  })

  it("does not cancel a fetch that the clip engine shares when it unmounts", async () => {
    const url = nextUrl()
    let resolve!: (response: Response) => void
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((done, reject) => {
          resolve = done
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          })
        }),
    )
    const engine = vttCache.loadVttCues(url)
    const renderer = await render(url)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await unmount(renderer)
    await flush()
    expect(signalOf(0).aborted).toBe(false)

    resolve(new Response(VTT))
    await expect(engine).resolves.toMatchObject({ ok: true })
    expect(warnedReasons()).toEqual([])
  })

  it("pins the track it shows, and releases the pin on unmount", async () => {
    const shown = nextUrl()
    fetchMock.mockImplementation(() => Promise.resolve(new Response(VTT)))
    const renderer = await render(shown)

    // A full cache of look-ahead tracks cannot evict the track on screen.
    for (let i = 0; i < vttCache.VTT_CACHE_MAX_TRACKS; i++) {
      await vttCache.loadVttCues(nextUrl())
    }
    expect(vttCache.peekVttCues(shown)).toBeDefined()

    await unmount(renderer)
    await vttCache.loadVttCues(nextUrl())
    expect(vttCache.peekVttCues(shown)).toBeUndefined()
  })

  it("logs a track over the byte cap as over_cap and shows nothing", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(0x61)
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(chunk)
          },
        }),
      ),
    )
    const renderer = await render(nextUrl())

    expect(warnedReasons()).toEqual(["over_cap"])
    expect(renderer.toJSON()).toBeNull()
    await unmount(renderer)
  })
})

describe("SubtitleOverlay — the right inset only over a box (Explore, 2026-09-28)", () => {
  /** Mute and Share at the right edge, measured up from the bottom edge. */
  const BOXES: readonly CaptionBox[] = [
    { left: 328, right: 388, bottom: 286, top: 360 },
    { left: 332, right: 384, bottom: 200, top: 274 },
  ]
  const RIGHT_INSET = 92

  type Props = ComponentProps<typeof SubtitleOverlay>

  async function renderWith(
    player: ReturnType<typeof makePlayer>,
    props: Partial<Props>,
  ): Promise<TestInstance> {
    fetchMock.mockResolvedValueOnce(new Response(VTT))
    const vttSrc = nextUrl()
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        <SubtitleOverlay player={player as never} vttSrc={vttSrc} {...props} />,
      )
    })
    await flush()
    return renderer
  }

  function container(renderer: TestInstance) {
    const [node] = renderer.root.findAll(
      (n) => n.props.pointerEvents === "none",
    )
    return StyleSheet.flatten(node.props.style) as {
      paddingRight?: number
      opacity?: number
    }
  }

  /** The caption text's layout, as the native side reports it. */
  function layOutText(
    renderer: TestInstance,
    box: { x: number; width: number; height: number },
  ) {
    const [text] = renderer.root.findAll(
      (n) => typeof n.props.onLayout === "function",
    )
    act(() => {
      ;(text.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { y: 0, ...box } },
      })
    })
  }

  it("measures a new cue unseen, at full width, before it decides", async () => {
    const renderer = await renderWith(makePlayer(), {
      bottomOffset: 300,
      rightInset: RIGHT_INSET,
      rightInsetBoxes: BOXES,
    })

    expect(hasText(renderer, "Hello world")).toBe(true)
    expect(container(renderer).opacity).toBe(0)
    expect(container(renderer).paddingRight).toBe(16)
    await unmount(renderer)
  })

  it("keeps the full width for a caption clear of the buttons", async () => {
    // At Mute's height, but it stops at x 260, left of the rail at 328.
    const renderer = await renderWith(makePlayer(), {
      bottomOffset: 300,
      rightInset: RIGHT_INSET,
      rightInsetBoxes: BOXES,
    })
    layOutText(renderer, { x: 60, width: 200, height: 40 })

    expect(container(renderer).opacity).not.toBe(0)
    expect(container(renderer).paddingRight).toBe(16)
    await unmount(renderer)
  })

  it("keeps the full width for a caption above the buttons", async () => {
    // As wide as the page, but its bottom edge is above Mute's top at 360.
    const renderer = await renderWith(makePlayer(), {
      bottomOffset: 368,
      rightInset: RIGHT_INSET,
      rightInsetBoxes: BOXES,
    })
    layOutText(renderer, { x: 16, width: 370, height: 60 })

    expect(container(renderer).paddingRight).toBe(16)
    await unmount(renderer)
  })

  it("takes the inset for a caption that covers Mute, and holds it", async () => {
    const renderer = await renderWith(makePlayer(), {
      bottomOffset: 300,
      rightInset: RIGHT_INSET,
      rightInsetBoxes: BOXES,
    })
    layOutText(renderer, { x: 20, width: 362, height: 60 })

    expect(container(renderer).opacity).not.toBe(0)
    expect(container(renderer).paddingRight).toBe(RIGHT_INSET)

    // The inset layout no longer reaches the rail. Deciding from it would
    // widen the caption again, and the wide one covers Mute: a loop.
    layOutText(renderer, { x: 20, width: 280, height: 80 })
    expect(container(renderer).paddingRight).toBe(RIGHT_INSET)
    await unmount(renderer)
  })

  it("decides again for the next cue", async () => {
    jest.useFakeTimers()
    const player = makePlayer()
    const renderer = await renderWith(player, {
      bottomOffset: 300,
      rightInset: RIGHT_INSET,
      rightInsetBoxes: BOXES,
    })
    layOutText(renderer, { x: 20, width: 362, height: 60 })
    expect(container(renderer).paddingRight).toBe(RIGHT_INSET)

    player.currentTime = 6
    await act(async () => {
      jest.advanceTimersByTime(400)
    })
    expect(hasText(renderer, "Second line")).toBe(true)
    expect(container(renderer).opacity).toBe(0)
    expect(container(renderer).paddingRight).toBe(16)

    layOutText(renderer, { x: 150, width: 100, height: 32 })
    expect(container(renderer).opacity).not.toBe(0)
    expect(container(renderer).paddingRight).toBe(16)
    await unmount(renderer)
  })

  it("always takes the inset without boxes, as the watch page does", async () => {
    const renderer = await renderWith(makePlayer(), {
      bottomOffset: 300,
      rightInset: RIGHT_INSET,
    })

    expect(container(renderer).opacity).not.toBe(0)
    expect(container(renderer).paddingRight).toBe(RIGHT_INSET)
    await unmount(renderer)
  })
})
