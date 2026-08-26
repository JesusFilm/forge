/**
 * The surface-side half of the hoist (U6): what a screen publishes, and what
 * its unmount decides.
 *
 * The StrictMode case is not decoration. This component's mount effect CLEANS
 * UP by detaching its slot, which is the same signal a committed back press
 * sends — under dev StrictMode's setup/cleanup/setup cycle a slot that did not
 * re-attach would leave the screen with no player and no way to notice.
 *
 * The measure IS covered here. jest-expo's `View` mock carries
 * `measureInWindow` on its PROTOTYPE as a shared `jest.fn()` that never calls
 * back, so `armMeasure` overrides that one method and the component's own
 * `measureIntoStore` runs unchanged — the store write, the zero-size refusal
 * and the published-rect latch are the real ones, not an injected fake.
 *
 * The unarmed mock is also a faithful model of the failure the retry pump
 * exists for: on a cold open `measureInWindow` really does drop its callback,
 * and `onLayout` fires once, so without a retry the rect never lands and the
 * host draws nothing behind an opaque slot. Leaving the seam unarmed
 * reproduces exactly that, which is how the exhaustion report is exercised.
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

jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))

import { StrictMode, act, type ReactElement } from "react"
import { View } from "react-native"

import { PlayerPoster } from "../PlayerPoster"
import { MEASURE_RETRY_FRAMES, PlayerSlot } from "../PlayerSlot"
import { getPlaybackRequestStore } from "../../../lib/miniPlayer/playbackRequest"
import { getMiniPlayerStore } from "../../../lib/miniPlayer/store"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const requestStore = getPlaybackRequestStore()
const sessionStore = getMiniPlayerStore()
const datadog = jest.requireMock("../../../lib/datadog") as {
  datadogLog: { info: jest.Mock; warn: jest.Mock; error: jest.Mock }
}

const URL_A = "https://stream.mux.com/assetAAA111.m3u8"

const SESSION_A = {
  videoId: "video-a",
  videoSlug: "video-a-slug",
  title: "Video A",
  posterUrl: null,
  languageSlug: "english",
  originPattern: "watch/[slug]",
}

const POSTER = "https://images.example/a.jpg"

function slot(props: { session?: typeof SESSION_A | null } = {}): ReactElement {
  return (
    <PlayerSlot
      streamingUrl={URL_A}
      posterUrl={POSTER}
      autostart
      progressIdentity={{ videoId: "video-a", languageSlug: "english" }}
      session={props.session === undefined ? SESSION_A : props.session}
    />
  )
}

let mounted: TestInstance | null = null

async function render(element: ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  mounted = renderer
  return renderer
}

/**
 * The poster is the slot's own visible state, and it is shown exactly when the
 * root player is drawing SOMEWHERE ELSE — which the slot decides by comparing
 * the store's owning slot against the id its mount effect wrote.
 */
function posters(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.recyclingKey === "player-slot-poster",
  )
}

/** The no-stream placeholder. By component type, not a prop: it is the whole
 *  visual the host would otherwise cover with its frame. */
function placeholders(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => (node as { type?: unknown }).type === PlayerPoster,
  )
}

type Rect = { x: number; y: number; width: number; height: number }
type MeasureCallback = (
  x: number,
  y: number,
  width: number,
  height: number,
) => void

const GOOD_RECT: Rect = { x: 0, y: 62, width: 440, height: 248 }

/**
 * The ONE method the component calls on its native node, and the whole measure
 * seam. jest-expo puts it on the View mock's PROTOTYPE as a shared `jest.fn()`
 * that drops its callback, so the instance behind the slot's ref reads it and
 * the component never learns a test is present. It is taken directly rather
 * than through `jest.spyOn`, which returns an already-mocked property
 * unchanged — a previous test's implementation and call count would leak in.
 */
const viewProto = View as unknown as {
  prototype: { measureInWindow: (callback: MeasureCallback) => void }
}
const measure = viewProto.prototype.measureInWindow as unknown as jest.Mock

/** Makes every `measureInWindow` answer with `rect`. Unarmed, the mock DROPS
 *  the callback — the cold-open failure the retry pump exists for. */
function armMeasure(rect: Rect): void {
  measure.mockImplementation((callback: MeasureCallback) => {
    callback(rect.x, rect.y, rect.width, rect.height)
  })
}

/**
 * Hands the pump's frames back one at a time, so a test decides when the slot
 * gets to measure. The slot schedules its first frame on mount, which makes
 * `scheduled[0]` its first measure attempt.
 */
const scheduled: FrameRequestCallback[] = []
let raf: jest.SpyInstance | null = null
let cancelFrame: jest.SpyInstance | null = null

async function runFrame(index: number): Promise<void> {
  await act(async () => {
    scheduled[index](0)
  })
}

/** The host draws only once it has a rect, so the slot keeps its own poster up
 *  until one exists. Drives the component's own measure, never the store. */
async function measureRect(): Promise<void> {
  armMeasure(GOOD_RECT)
  // The LAST frame, not the first: StrictMode cancels its first effect pass,
  // and that dead frame refuses to measure.
  await runFrame(scheduled.length - 1)
}

beforeEach(() => {
  requestStore.reset()
  sessionStore.end("abandoned")
  datadog.datadogLog.warn.mockClear()
  // Back to dropping the callback, which is both the mock's own default and
  // the cold open this component defends against.
  measure.mockReset()
  scheduled.length = 0
  raf = jest
    .spyOn(globalThis, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback) => {
      scheduled.push(callback)
      return scheduled.length
    })
  cancelFrame = jest
    .spyOn(globalThis, "cancelAnimationFrame")
    .mockImplementation(() => {})
})

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  raf?.mockRestore()
  cancelFrame?.mockRestore()
  requestStore.reset()
  sessionStore.end("abandoned")
})

describe("PlayerSlot", () => {
  it("publishes what the root player should own, and creates none itself", async () => {
    const renderer = await render(slot())

    const snapshot = requestStore.getSnapshot()
    expect(snapshot.request).toMatchObject({
      streamingUrl: URL_A,
      autostart: true,
      progressVideoId: "video-a",
      progressLanguageSlug: "english",
      session: SESSION_A,
    })
    expect(snapshot.slotId).not.toBeNull()
    // No video surface of its own — the host draws into the rect measured here.
    expect(
      renderer.root.findAll((node) => node.props.nativeControls === false),
    ).toHaveLength(0)
    // Attached but not yet measured: the host has nothing to draw, so the slot
    // must NOT clear its poster — that gap is what showed as a black box.
    expect(posters(renderer).length).toBeGreaterThan(0)

    await measureRect()
    // Now the host draws, so nothing of the slot's own covers its video view.
    expect(posters(renderer)).toHaveLength(0)
  })

  it("shows its poster while the root player is drawing somewhere else", async () => {
    const renderer = await render(slot())
    await measureRect()
    expect(posters(renderer)).toHaveLength(0)

    // A newer surface takes the player — the series screen's trailer opening
    // beneath a watch screen, or any later slot.
    await act(async () => {
      requestStore.attachSlot({
        ...(requestStore.getSnapshot().request as NonNullable<
          ReturnType<typeof requestStore.getSnapshot>["request"]
        >),
        streamingUrl: "https://stream.mux.com/assetBBB222.m3u8",
      })
    })

    expect(posters(renderer).length).toBeGreaterThan(0)
  })

  it("owns the player with no stream to hand it, and stands in for the frame", async () => {
    // The state the watch screen used to render NO slot for. Dropping the slot
    // hands the player to the route beneath — the series trailer, which then
    // paints over this screen — and its unmount reads as a back press.
    const renderer = await render(
      <PlayerSlot
        streamingUrl={null}
        posterUrl={POSTER}
        autostart
        session={SESSION_A}
      />,
    )

    const snapshot = requestStore.getSnapshot()
    expect(snapshot.slotId).not.toBeNull()
    expect(snapshot.request).toMatchObject({
      streamingUrl: null,
      session: SESSION_A,
    })
    // The host draws no video here, so the placeholder is what fills the box.
    expect(placeholders(renderer)).toHaveLength(1)
  })

  it("drops the request when the screen goes with no playback behind it", async () => {
    const renderer = await render(slot())
    expect(requestStore.getSnapshot().request).not.toBeNull()

    await act(async () => {
      renderer.unmount()
    })
    mounted = null

    expect(requestStore.getSnapshot().request).toBeNull()
    expect(sessionStore.getSnapshot().session).toBeNull()
  })

  it("survives StrictMode's mount, unmount, remount cycle with one live slot", async () => {
    const attach = jest.spyOn(requestStore, "attachSlot")
    await render(<StrictMode>{slot()}</StrictMode>)

    // Anti-vacuous: without a doubled effect cycle there is nothing to survive.
    expect(attach).toHaveBeenCalledTimes(2)
    const liveId = attach.mock.results[1].value as number
    const renderer = mounted as TestInstance
    expect(requestStore.getSnapshot().request?.streamingUrl).toBe(URL_A)
    expect(requestStore.getSnapshot().slotId).toBe(liveId)
    // The second setup restored the slot id the cleanup cleared: a screen left
    // holding the DETACHED id reads as "someone else is drawing" and covers the
    // host's video view with its poster. Same predicate gates the measure.
    await measureRect()
    expect(posters(renderer)).toHaveLength(0)
    attach.mockRestore()
  })

  it("keeps asking for a rect on later frames, and stops asking on unmount", async () => {
    // The pump is the whole fix for the cold-open black frame: measureInWindow
    // drops its callback (exactly as this View mock does) and onLayout fires
    // once, so a single measure attempt can leave the host with no rect.
    const renderer = await render(slot())
    expect(scheduled).toHaveLength(1)

    // Running the frame re-arms, because no rect landed.
    await runFrame(0)
    expect(scheduled.length).toBeGreaterThan(1)

    await act(async () => {
      renderer.unmount()
    })
    mounted = null
    expect(cancelFrame).toHaveBeenCalled()
  })

  it("refuses a zero-size measurement and keeps its own poster up", async () => {
    // A node attached but not laid out answers 0x0. Publishing that hands the
    // host an empty frame, which draws nothing — the black box with no poster.
    armMeasure({ x: 0, y: 0, width: 0, height: 0 })
    const setSlotRect = jest.spyOn(requestStore, "setSlotRect")
    const renderer = await render(slot())

    await runFrame(0)

    // Anti-vacuous: the seam really drove the component's own measure.
    expect(measure).toHaveBeenCalledTimes(1)
    expect(setSlotRect).not.toHaveBeenCalled()
    expect(requestStore.getSnapshot().rect).toBeNull()
    expect(posters(renderer).length).toBeGreaterThan(0)
    // No rect landed, so the pump has not given up on this slot.
    expect(scheduled.length).toBeGreaterThan(1)

    setSlotRect.mockRestore()
  })

  it("publishes exactly the window rect it measured", async () => {
    armMeasure({ x: 12, y: 62, width: 440, height: 248 })
    const setSlotRect = jest.spyOn(requestStore, "setSlotRect")
    const renderer = await render(slot())
    const id = requestStore.getSnapshot().slotId

    await runFrame(0)

    expect(setSlotRect).toHaveBeenCalledWith(id, {
      x: 12,
      y: 62,
      width: 440,
      height: 248,
    })
    expect(requestStore.getSnapshot().rect).toEqual({
      x: 12,
      y: 62,
      width: 440,
      height: 248,
    })
    // The host draws now, so nothing of the slot's own covers its video view.
    expect(posters(renderer)).toHaveLength(0)

    setSlotRect.mockRestore()
  })

  it("stops asking once a rect lands", async () => {
    armMeasure(GOOD_RECT)
    await render(slot())

    await runFrame(0)
    // The successful frame re-armed once. That next frame is the one that must
    // read the published rect and let the chain end.
    const armed = scheduled.length
    expect(armed).toBeGreaterThan(1)

    await runFrame(armed - 1)

    expect(scheduled).toHaveLength(armed)
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it("reports one exhaustion when no measure ever lands", async () => {
    // The seam stays unarmed, so every measureInWindow drops its callback —
    // the cold-open failure, held for the pump's whole budget.
    await render(slot())

    await act(async () => {
      for (let i = 0; i < MEASURE_RETRY_FRAMES - 1; i++) scheduled[i](0)
    })
    // Never per frame: the budget is not spent yet, so nothing is reportable.
    expect(datadog.datadogLog.warn).not.toHaveBeenCalled()

    await runFrame(MEASURE_RETRY_FRAMES - 1)

    expect(measure).toHaveBeenCalledTimes(MEASURE_RETRY_FRAMES)
    expect(datadog.datadogLog.warn).toHaveBeenCalledTimes(1)
    expect(datadog.datadogLog.warn).toHaveBeenCalledWith(
      "player_slot.measure_exhausted",
      {
        "player_slot.frames": MEASURE_RETRY_FRAMES,
        "player_slot.has_poster": true,
        "player_slot.fullscreen": false,
      },
    )
    // The pump gave up rather than running forever.
    expect(scheduled).toHaveLength(MEASURE_RETRY_FRAMES)
  })
})
