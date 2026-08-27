/**
 * Two-level player settings sheet (U4): root list with current values, per-
 * setting option lists, immediate apply (R3), and the per-context variants —
 * cast strips quality (R10), non-Mux/offline hides quality (R9/R11), and a
 * cast flip mid-submenu snaps back to the root list (decision 5).
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package. The renderer is jest-expo's own transitive
 * react-test-renderer (KTD11: no new test dependencies).
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
// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
// The rate facade touches the cast SDK; the sheet's contract is WHEN it is
// called, so the mock stands in (behaviour lives in castAdapter.test.ts).
jest.mock("../../../lib/cast/castAdapter", () => ({
  setCastPlaybackRateLogged: jest.fn(),
}))

import { act } from "react"
import { Animated } from "react-native"

import { PlayerSettingsSheet } from "../PlayerSettingsSheet"
import { getPlayerSettingsStore } from "../../../lib/miniPlayer/playerSettings"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const MUX_URL = "https://stream.mux.com/abc123.m3u8"
const NON_MUX_URL = "https://cdn.example.com/video.m3u8"
const OFFLINE_URL = "file:///var/mobile/offline/birth-of-jesus.mp4"

type SheetProps = {
  onClose?: () => void
  castActive?: boolean
  streamingUrl?: string | null
}

function element(props: SheetProps = {}) {
  return (
    <PlayerSettingsSheet
      onClose={props.onClose ?? (() => {})}
      castActive={props.castActive ?? false}
      streamingUrl={
        props.streamingUrl === undefined ? MUX_URL : props.streamingUrl
      }
    />
  )
}

async function render(props: SheetProps = {}): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element(props))
  })
  return renderer
}

async function update(renderer: TestInstance, props: SheetProps) {
  await act(async () => {
    renderer.update(element(props))
  })
}

// The store is a module singleton; a fresh contentKey resets both settings to
// their defaults between tests (resetFor bails only on a matching key).
let testKeyCounter = 0
beforeEach(() => {
  getPlayerSettingsStore().resetFor(`settings-sheet-test-${testKeyCounter++}`)
})

function selectedCount(renderer: TestInstance, label: string): number {
  return renderer.root.findAll(
    (n) =>
      n.props.accessibilityLabel === label &&
      (n.props.accessibilityState as { selected?: boolean } | undefined)
        ?.selected === true,
  ).length
}

describe("root list", () => {
  it("shows both settings with their current values", async () => {
    const renderer = await render()
    expect(hasText(renderer, "Playback speed")).toBe(true)
    expect(hasText(renderer, "Quality")).toBe(true)
    expect(hasText(renderer, "Normal")).toBe(true)
    expect(hasText(renderer, "Auto")).toBe(true)
    // Option lists are not open yet.
    expect(hasText(renderer, "0.75×")).toBe(false)
    expect(hasText(renderer, "Low (480p)")).toBe(false)
    await unmount(renderer)
  })

  it("reflects non-default store values", async () => {
    const store = getPlayerSettingsStore()
    store.setSpeed(1.25)
    store.setQualityTier("high")
    const renderer = await render()
    expect(hasText(renderer, "1.25×")).toBe(true)
    expect(hasText(renderer, "High (720p)")).toBe(true)
    await unmount(renderer)
  })
})

describe("speed submenu (R3)", () => {
  it("opens from the root row and lists all seven labelled steps", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Playback speed"))
    for (const label of [
      "0.5×",
      "0.75×",
      "Normal",
      "1.25×",
      "1.5×",
      "1.75×",
      "2×",
    ]) {
      expect(hasText(renderer, label)).toBe(true)
    }
    await unmount(renderer)
  })

  it("applies a pick to the store, marks it selected, and stays open", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Playback speed"))
    await press(pressableByLabel(renderer, "1.5×"))
    expect(getPlayerSettingsStore().getSnapshot().speed).toBe(1.5)
    expect(selectedCount(renderer, "1.5×")).toBeGreaterThan(0)
    expect(selectedCount(renderer, "Normal")).toBe(0)
    // R3: still on the option list — no close, no snap to root.
    expect(hasText(renderer, "2×")).toBe(true)
    await unmount(renderer)
  })

  it("returns to the root list via the back affordance", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Playback speed"))
    await press(pressableByLabel(renderer, "Back"))
    expect(hasText(renderer, "Quality")).toBe(true)
    expect(hasText(renderer, "0.75×")).toBe(false)
    await unmount(renderer)
  })
})

describe("quality submenu", () => {
  it("applies a pick to the store, marks it selected, and stays open", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Quality"))
    expect(hasText(renderer, "Highest (1080p)")).toBe(true)
    await press(pressableByLabel(renderer, "Low (480p)"))
    expect(getPlayerSettingsStore().getSnapshot().qualityTier).toBe("low")
    expect(selectedCount(renderer, "Low (480p)")).toBeGreaterThan(0)
    expect(selectedCount(renderer, "Auto")).toBe(0)
    expect(hasText(renderer, "Highest (1080p)")).toBe(true)
    await unmount(renderer)
  })
})

describe("context variants", () => {
  it("hides the quality row for a non-Mux stream and keeps speed working (AE3/R9)", async () => {
    const renderer = await render({ streamingUrl: NON_MUX_URL })
    expect(hasText(renderer, "Quality")).toBe(false)
    await press(pressableByLabel(renderer, "Playback speed"))
    await press(pressableByLabel(renderer, "2×"))
    expect(getPlayerSettingsStore().getSnapshot().speed).toBe(2)
    await unmount(renderer)
  })

  it("offers speed only for an offline file:// source (AE7/R11)", async () => {
    const renderer = await render({ streamingUrl: OFFLINE_URL })
    expect(hasText(renderer, "Playback speed")).toBe(true)
    expect(hasText(renderer, "Quality")).toBe(false)
    await unmount(renderer)
  })

  it("offers speed only with no stream at all", async () => {
    const renderer = await render({ streamingUrl: null })
    expect(hasText(renderer, "Playback speed")).toBe(true)
    expect(hasText(renderer, "Quality")).toBe(false)
    await unmount(renderer)
  })

  it("offers speed only while a cast session is active (AE4/R10)", async () => {
    const renderer = await render({ castActive: true, streamingUrl: MUX_URL })
    expect(hasText(renderer, "Playback speed")).toBe(true)
    expect(hasText(renderer, "Quality")).toBe(false)
    await unmount(renderer)
  })
})

describe("cast speed routing (AE4/R10)", () => {
  const { setCastPlaybackRateLogged: mockSetRate } = jest.requireMock(
    "../../../lib/cast/castAdapter",
  ) as { setCastPlaybackRateLogged: jest.Mock }

  beforeEach(() => {
    mockSetRate.mockClear()
  })

  it("routes a pick to the rate facade while casting, and still writes the store", async () => {
    const renderer = await render({ castActive: true })
    await press(pressableByLabel(renderer, "Playback speed"))
    await press(pressableByLabel(renderer, "1.5×"))
    // AE4: the store stays the single truth — the receiver call is additive.
    expect(getPlayerSettingsStore().getSnapshot().speed).toBe(1.5)
    expect(mockSetRate).toHaveBeenCalledTimes(1)
    expect(mockSetRate).toHaveBeenCalledWith(1.5)
    // The sheet survived the pick: still on the option list (R3).
    expect(hasText(renderer, "2×")).toBe(true)
    await unmount(renderer)
  })

  it("never calls the facade with cast inactive", async () => {
    const renderer = await render({ castActive: false })
    await press(pressableByLabel(renderer, "Playback speed"))
    await press(pressableByLabel(renderer, "1.5×"))
    expect(getPlayerSettingsStore().getSnapshot().speed).toBe(1.5)
    expect(mockSetRate).not.toHaveBeenCalled()
    await unmount(renderer)
  })
})

describe("cast-state snap (decision 5)", () => {
  it("snaps the open quality submenu back to the root list when cast starts", async () => {
    const renderer = await render({ castActive: false })
    await press(pressableByLabel(renderer, "Quality"))
    expect(hasText(renderer, "Low (480p)")).toBe(true)
    await update(renderer, { castActive: true })
    // Root list again — and the quality row is gone with the session active.
    expect(hasText(renderer, "Playback speed")).toBe(true)
    expect(hasText(renderer, "Low (480p)")).toBe(false)
    expect(hasText(renderer, "Quality")).toBe(false)
    await unmount(renderer)
  })

  it("snaps the open speed submenu back to the root list on a cast flip", async () => {
    const renderer = await render({ castActive: false })
    await press(pressableByLabel(renderer, "Playback speed"))
    expect(hasText(renderer, "0.75×")).toBe(true)
    await update(renderer, { castActive: true })
    expect(hasText(renderer, "0.75×")).toBe(false)
    expect(hasText(renderer, "Playback speed")).toBe(true)
    await unmount(renderer)
  })

  it("snaps back when the session ends too (flip in the other direction)", async () => {
    const renderer = await render({ castActive: true })
    await press(pressableByLabel(renderer, "Playback speed"))
    expect(hasText(renderer, "0.75×")).toBe(true)
    await update(renderer, { castActive: false })
    expect(hasText(renderer, "0.75×")).toBe(false)
    // Quality returns with the session gone.
    expect(hasText(renderer, "Quality")).toBe(true)
    await unmount(renderer)
  })
})

/**
 * The sheet owns BOTH of its animations now (the Modal is `animationType="none"`,
 * because RN's own "slide" translates the scrim along with the panel). The host
 * unmounts this component on `onClose`, so the exit has to run BEFORE that call
 * lands — which makes dismissal deferred by one EXIT_MS timer rather than
 * synchronous. Each case asserts BOTH halves: nothing fires on the press, and
 * it does fire once the timer runs. Asserting only the second half would stay
 * green if the exit animation were dropped entirely.
 */
describe("dismissal", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  // Comfortably past EXIT_MS; the exact duration is the component's business.
  async function runExitAnimation() {
    await act(async () => {
      jest.advanceTimersByTime(400)
    })
  }

  it("closes from the close affordance, after the exit animation", async () => {
    const onClose = jest.fn()
    const renderer = await render({ onClose })
    await press(pressableByLabel(renderer, "Close"))
    expect(onClose).not.toHaveBeenCalled()
    await runExitAnimation()
    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("closes on a backdrop tap, after the exit animation", async () => {
    const onClose = jest.fn()
    const renderer = await render({ onClose })
    await press(pressableByLabel(renderer, "Dismiss settings"))
    expect(onClose).not.toHaveBeenCalled()
    await runExitAnimation()
    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("collapses a double dismiss into ONE close", async () => {
    // Both affordances stay mounted through the exit, so a second tap must not
    // schedule a second onClose against a host that has already been told once.
    const onClose = jest.fn()
    const renderer = await render({ onClose })
    await press(pressableByLabel(renderer, "Dismiss settings"))
    await press(pressableByLabel(renderer, "Close"))
    await runExitAnimation()
    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("presents as a transparent modal and closes on the system back", async () => {
    const onClose = jest.fn()
    const renderer = await render({ onClose })
    const modals = renderer.root.findAll(
      (n) =>
        n.props.transparent === true &&
        typeof n.props.onRequestClose === "function",
    )
    expect(modals.length).toBeGreaterThan(0)
    // Fullscreen locks the app to landscape; RN Modal defaults to
    // portrait-only. No common orientation aborts the app in UIKit's
    // presentation path (reproduced on-device 2026-08-26), so pin both.
    expect(modals[0].props.supportedOrientations).toEqual(
      expect.arrayContaining(["portrait", "landscape"]),
    )
    await act(async () => {
      ;(modals[0].props.onRequestClose as () => void)()
    })
    await runExitAnimation()
    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("lets the Modal animate nothing, so the scrim and panel can differ", async () => {
    // RN's `animationType="slide"` translates the modal's WHOLE subtree, scrim
    // included — which is the bug: the dimming arrives as a dark rectangle
    // dragged up the screen with a hard moving edge, instead of the room
    // fading. Anything but "none" hands both animations back to RN.
    const renderer = await render()
    const modal = renderer.root.findAll((n) => n.props.transparent === true)[0]
    expect(modal.props.animationType).toBe("none")
    await unmount(renderer)
  })
})

describe("presentation (scrim fades, panel slides)", () => {
  /** An Animated node exposes __getValue; a plain number does not. */
  function isAnimated(v: unknown): boolean {
    return (
      typeof v === "object" &&
      v !== null &&
      typeof (v as { __getValue?: unknown }).__getValue === "function"
    )
  }

  function flatten(style: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const walk = (s: unknown) => {
      if (Array.isArray(s)) return s.forEach(walk)
      if (s && typeof s === "object") Object.assign(out, s)
    }
    walk(style)
    return out
  }

  it("fades the scrim by animating OPACITY, never by moving it", async () => {
    const renderer = await render()
    const scrims = renderer.root.findAll((n) => {
      const st = flatten(n.props.style)
      return (
        typeof st.backgroundColor === "string" &&
        st.backgroundColor.startsWith("rgba(") &&
        st.position === "absolute" &&
        isAnimated(st.opacity)
      )
    })
    expect(scrims.length).toBeGreaterThan(0)
    // A scrim that also carried a transform would be sliding again.
    expect(flatten(scrims[0].props.style).transform).toBeUndefined()
    await unmount(renderer)
  })

  it("slides the panel by animating its OFFSET", async () => {
    const renderer = await render()
    const panels = renderer.root.findAll((n) => {
      const st = flatten(n.props.style)
      const t = st.transform as Array<Record<string, unknown>> | undefined
      return Array.isArray(t) && t.some((e) => isAnimated(e.translateY))
    })
    expect(panels.length).toBeGreaterThan(0)
    await unmount(renderer)
  })
})

/**
 * KTD5 host wiring, pinned at the source (the videoPlayerAutostart.test.ts
 * pattern): the sheet is COMPONENT STATE in VideoPlayer — the one chrome host
 * both portrait and fullscreen render — never a route push.
 */
// No @types/node (no new test deps) — type the ambient global locally. Only
// referenced outside the jest.mock factories, so the hoist plugin is safe.
declare const __dirname: string

describe("VideoPlayer hosts the sheet as component state (KTD5)", () => {
  const r = require as unknown as NodeRequireLike
  const fs = r("node:fs") as {
    readFileSync: (p: string, e: string) => string
  }
  const path = r("path") as NodePath
  const HOST_SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "VideoPlayer.tsx"),
    "utf8",
  )
  const SHEET_SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "PlayerSettingsSheet.tsx"),
    "utf8",
  )

  it("suppresses the floating window under the sheet's own id", () => {
    expect(HOST_SOURCE).toContain(
      'useNonRouteSheetSuppression(settingsOpen, "playerSettings")',
    )
  })

  it("renders the sheet regardless of the fullscreen prop (same host, both layouts)", () => {
    const start = HOST_SOURCE.indexOf("{settingsOpen && (")
    expect(start).toBeGreaterThan(-1)
    const block = HOST_SOURCE.slice(start, HOST_SOURCE.indexOf("/>", start))
    expect(block).toContain("<PlayerSettingsSheet")
    expect(block).toContain("castActive={castRemoteActive}")
    expect(block).toContain("streamingUrl={streamingUrl}")
    // Component state under BOTH chrome layouts: no layout gate on the sheet.
    expect(block).not.toContain("fullscreen")
  })

  it("is not a route push (KTD5: a form sheet cannot cover the fullscreen player)", () => {
    expect(SHEET_SOURCE).not.toContain("expo-router")
    expect(HOST_SOURCE).not.toContain("router.push")
  })

  it("threads the gear callback into the chrome, and NOT into the veil row", () => {
    const controls = HOST_SOURCE.slice(
      HOST_SOURCE.indexOf("<PlayerControls"),
      HOST_SOURCE.indexOf(
        "</Animated.View>",
        HOST_SOURCE.indexOf("<PlayerControls"),
      ),
    )
    expect(controls).toContain("onOpenSettings=")
    // R1: the gear shows/hides with the chrome; the pre-autostart veil row
    // keeps only the external-route buttons (R14).
    const veilStart = HOST_SOURCE.indexOf("styles.veilRouteRow")
    expect(veilStart).toBeGreaterThan(-1)
    const veil = HOST_SOURCE.slice(
      veilStart,
      HOST_SOURCE.indexOf(")}", veilStart),
    )
    expect(veil).not.toContain("onOpenSettings")
  })
})

/**
 * The enter animation is gated on a measured panel height, and jest-expo's
 * renderer never fires native `onLayout` — so before these cases `panelHeight`
 * stayed 0, the effect always hit its early return, and the presentation tests
 * above passed identically whether the animation existed or not.
 *
 * These drive the measurement by hand and assert the panel's OFFSET, which is
 * the thing the gate controls. The offset is read rather than the animation's
 * progress because the ramp runs on the native driver, whose JS value never
 * advances under jest.
 */
describe("enter animation (reachable only once the panel is measured)", () => {
  function panelTranslateY(renderer: TestInstance): {
    node: { props: Record<string, unknown> }
    value: () => number
  } {
    const flat = (style: unknown): Record<string, unknown> => {
      const out: Record<string, unknown> = {}
      const walk = (s: unknown) => {
        if (Array.isArray(s)) return s.forEach(walk)
        if (s && typeof s === "object") Object.assign(out, s)
      }
      walk(style)
      return out
    }
    const nodes = renderer.root.findAll((n) => {
      const t = flat(n.props.style).transform as
        | Array<Record<string, unknown>>
        | undefined
      return (
        Array.isArray(t) &&
        t.some(
          (e) =>
            typeof (e.translateY as { __getValue?: unknown })?.__getValue ===
            "function",
        )
      )
    })
    expect(nodes.length).toBeGreaterThan(0)
    const node = nodes[0]
    const t = flat(node.props.style).transform as Array<Record<string, unknown>>
    const entry = t.find(
      (e) =>
        typeof (e.translateY as { __getValue?: unknown })?.__getValue ===
        "function",
    ) as { translateY: { __getValue: () => number } }
    return { node, value: () => entry.translateY.__getValue() }
  }

  it("parks the panel offscreen until it has been measured", async () => {
    // The unmeasured park is what keeps the first frame off the screen. If this
    // ever equalled the measured height, the panel would flash in place.
    const renderer = await render()

    expect(panelTranslateY(renderer).value()).toBeGreaterThan(1000)

    await unmount(renderer)
  })

  it("starts the enter animation once onLayout lands", async () => {
    // Asserted on the timing CALL, not on the panel's offset: the offset tracks
    // panelHeight, which onLayout's setState writes on its own, so an
    // offset-only assertion stays green even with the effect's gate forced
    // permanently closed (verified by falsifying it exactly that way).
    const timing = jest.spyOn(Animated, "timing")
    const renderer = await render()
    const before = panelTranslateY(renderer)
    const enterCalls = () =>
      timing.mock.calls.filter(
        (c) => (c[1] as { toValue?: number } | undefined)?.toValue === 1,
      ).length
    expect(enterCalls()).toBe(0)

    await act(async () => {
      ;(
        before.node.props.onLayout as (e: {
          nativeEvent: { layout: { height: number } }
        }) => void
      )({ nativeEvent: { layout: { height: 320 } } })
    })

    expect(enterCalls()).toBe(1)
    // ...and the panel is now positioned from the measured height, not the park.
    expect(panelTranslateY(renderer).value()).toBe(320)
    timing.mockRestore()
    await unmount(renderer)
  })
})

describe("exit timer lifetime", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it("does not call onClose when the sheet unmounts before the timer fires", async () => {
    // The host unmounts this sheet from its own onClose, but a route pop or a
    // player handover can unmount it mid-exit. A timer left pending would then
    // fire into a torn-down tree.
    const onClose = jest.fn()
    const renderer = await render({ onClose })
    await press(pressableByLabel(renderer, "Close"))
    expect(onClose).not.toHaveBeenCalled()

    await unmount(renderer)
    await act(async () => {
      jest.advanceTimersByTime(400)
    })

    expect(onClose).not.toHaveBeenCalled()
  })
})
