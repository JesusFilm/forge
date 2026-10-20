/**
 * The toast's bottom offset, across both platforms and both callers, and its
 * motion on each glass branch.
 *
 * `useTabBarClearance()` already carries `insets.bottom`, so adding the inset
 * beside it double-counts. The first fix for that keyed on `clearsTabBar`
 * alone, which silently moved the ANDROID toast: the clearance is 0 there, so
 * the tab caller fell into the clearance branch and lost the whole inset. Both
 * axes therefore need a case, and the Android pair is the regression guard.
 */
import { act, type ComponentProps } from "react"
import {
  Animated,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { TAB_BAR_CLEARANCE_GAP } from "../../../lib/tabBar"
import { Snackbar } from "../Snackbar"

// The `mock` prefix is required: babel-plugin-jest-hoist lifts jest.mock above
// this declaration and rejects any other out-of-scope name in the factory.
const mockInsets = { top: 59, right: 0, bottom: 34, left: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// jest-expo reports Liquid Glass as available, so each case pins the branch.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
const mockMotion = { reduce: false }
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockMotion.reduce,
}))
// A host stand-in that renders its children, so the message stays visible.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockInsets.top = 59
  mockInsets.right = 0
  mockInsets.bottom = 34
  mockInsets.left = 0
  mockGate.glass = true
  mockMotion.reduce = false
})

/** The flattened `bottom` the toast renders with. */
async function bottomOffset(clearsTabBar: boolean): Promise<number> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <Snackbar
        message="Deleted"
        visible
        onDismiss={() => {}}
        clearsTabBar={clearsTabBar}
      />,
    )
  })
  const root = renderer.root.findAll(
    (n) => n.props?.style != null && !n.props.accessibilityRole,
  )[0]
  const flat = ([] as unknown[])
    .concat(root.props.style)
    .filter(Boolean)
    .reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...(s as Record<string, unknown>) }),
      {},
    )
  renderer.unmount()
  return flat.bottom as number
}

// The clearance is the same number on both glass branches.
describe.each([true, false])("iOS, Liquid Glass %s", (glass) => {
  beforeEach(() => {
    mockGate.glass = glass
  })

  it("uses the clearance alone on a tab route, because it already carries the inset", async () => {
    // Inside a tab, insets.bottom carries the 49pt UIKit bar as well as the
    // 34pt indicator. Adding it beside the clearance would count it twice.
    setPlatform("ios")
    mockInsets.bottom = 83
    expect(await bottomOffset(true)).toBe(83 + TAB_BAR_CLEARANCE_GAP + 16)
  })

  it("does NOT add the inset a second time", async () => {
    // Discriminating: the pre-fix formula. This is the exact regression a
    // careless revert restores, and it is invisible by eye.
    setPlatform("ios")
    mockInsets.bottom = 83
    expect(await bottomOffset(true)).not.toBe(
      83 + 16 + (83 + TAB_BAR_CLEARANCE_GAP),
    )
  })

  it("keeps the plain inset off a tab route, where there is no bar", async () => {
    // The watch and series routes mount this too and must not move.
    setPlatform("ios")
    expect(await bottomOffset(false)).toBe(34 + 16)
  })
})

describe("Android", () => {
  beforeEach(() => {
    // Android never has Liquid Glass.
    mockGate.glass = false
  })

  it("keeps the plain inset on a tab route", async () => {
    // The regression guard. The clearance is 0 on Android, so a gate that reads
    // `clearsTabBar` alone sends this caller into the clearance branch and the
    // toast loses the whole inset. It must stay byte-identical to pre-migration.
    setPlatform("android")
    expect(await bottomOffset(true)).toBe(34 + 16)
  })

  it("keeps the plain inset off a tab route", async () => {
    setPlatform("android")
    expect(await bottomOffset(false)).toBe(34 + 16)
  })

  it("never lifts by the clearance, whatever the caller asks for", async () => {
    // Anti-vacuous partner: both Android cases above expect the SAME number, so
    // on their own they would pass even if the branch were unreachable. This
    // pins that the 16pt-only result the broken gate produced cannot occur.
    setPlatform("android")
    expect(await bottomOffset(true)).not.toBe(16)
  })
})

// ── Motion ────────────────────────────────────────────────────────────────

type AnimationCall = {
  kind: "spring" | "timing"
  /** The value's position when the animation was built: its start offset. */
  from: number
  config: {
    toValue: unknown
    duration?: number
    tension?: number
    friction?: number
  }
  started: boolean
  finish: () => void
}
let animations: AnimationCall[] = []

function recordAnimation(kind: AnimationCall["kind"]) {
  return (
    value: Animated.Value | Animated.ValueXY,
    config: AnimationCall["config"],
  ) => {
    let callback: Animated.EndCallback | undefined
    const call: AnimationCall = {
      kind,
      from: (value as unknown as { __getValue(): number }).__getValue(),
      config,
      started: false,
      finish: () => callback?.({ finished: true }),
    }
    animations.push(call)
    return {
      start: (cb?: Animated.EndCallback) => {
        call.started = true
        callback = cb
      },
      stop: () => {},
      reset: () => {},
    } as unknown as Animated.CompositeAnimation
  }
}

function started(kind: AnimationCall["kind"]): AnimationCall[] {
  return animations.filter((call) => call.kind === kind && call.started)
}

async function finishAll() {
  await act(async () => {
    for (const call of animations.splice(0)) call.finish()
  })
}

function styleOf(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}
}

function hostNodes(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
): RenderedNode[] {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

/** The outer host's `translateY`: how far below its resting place it sits. */
function translateYOf(renderer: TestInstance): number {
  const [slide] = hostNodes(renderer, (node) => styleOf(node).bottom != null)
  const transform = (styleOf(slide!).transform ?? []) as unknown as Record<
    string,
    unknown
  >[]
  const entry = transform.find((part) => "translateY" in part)
  return Number(entry?.translateY)
}

async function show(props: Partial<ComponentProps<typeof Snackbar>> = {}) {
  const onDismiss = jest.fn()
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <Snackbar message="Deleted" visible onDismiss={onDismiss} {...props} />,
    )
  })
  return { renderer, onDismiss }
}

/** Fires the measured height, as the native layout pass would. */
async function layout(renderer: TestInstance, height: number) {
  const [measured] = renderer.root.findAll(
    (node) => typeof node.props.onLayout === "function",
  )
  expect(measured).toBeDefined()
  await act(async () => {
    ;(measured!.props.onLayout as (event: unknown) => void)({
      nativeEvent: { layout: { x: 0, y: 0, width: 358, height } },
    })
  })
}

async function close(renderer: TestInstance) {
  const [button] = renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" && typeof node.props.onPress === "function",
  )
  expect(button).toBeDefined()
  await act(async () => {
    button!.props.onPress?.()
  })
}

const HEIGHT = 52
// PushNoticeHost lifts its notice clear of the iOS bar on a tab route:
// 83pt of bar + 12pt gap + 16pt margin.
const PUSH_NOTICE_BOTTOM = 111

describe("Snackbar motion", () => {
  beforeEach(() => {
    animations = []
    jest.spyOn(Animated, "spring").mockImplementation(recordAnimation("spring"))
    jest.spyOn(Animated, "timing").mockImplementation(recordAnimation("timing"))
    setPlatform("ios")
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe("on Liquid Glass (R10)", () => {
    it.each([
      ["a Downloads or watch page message", undefined, 34 + 16],
      ["a push notice", PUSH_NOTICE_BOTTOM, PUSH_NOTICE_BOTTOM],
    ])(
      "%s starts fully below the screen edge and slides in with no fade",
      async (_caller, bottomOffset, bottom) => {
        const { renderer } = await show({ bottomOffset })

        // Before the height is known, it waits off screen and does not move.
        expect(translateYOf(renderer)).toBeGreaterThanOrEqual(bottom + HEIGHT)
        expect(started("spring")).toHaveLength(0)

        await layout(renderer, HEIGHT)

        const [enter] = started("spring")
        expect(enter).toBeDefined()
        expect(enter!.config.toValue).toBe(0)
        expect(enter!.from).toBeGreaterThanOrEqual(bottom + HEIGHT)
        expect(translateYOf(renderer)).toBeGreaterThanOrEqual(bottom + HEIGHT)
        // No fade: an opacity on any layer stops the glass drawing.
        expect(started("timing")).toHaveLength(0)
        expect(
          hostNodes(renderer, (node) => styleOf(node).opacity != null),
        ).toHaveLength(0)
        expect(
          hostNodes(renderer, (node) => node.type === "GlassView"),
        ).toHaveLength(1)
        renderer.unmount()
      },
    )

    it("slides out to fully below the screen edge, and only then reports the dismissal", async () => {
      const { renderer, onDismiss } = await show({
        bottomOffset: PUSH_NOTICE_BOTTOM,
      })
      await layout(renderer, HEIGHT)
      await finishAll()

      await close(renderer)

      const [leave] = started("timing")
      expect(leave).toBeDefined()
      expect(leave!.config.toValue).toBeGreaterThanOrEqual(
        PUSH_NOTICE_BOTTOM + HEIGHT,
      )
      expect(leave!.config.duration).toBe(250)
      expect(started("timing")).toHaveLength(1)
      expect(onDismiss).not.toHaveBeenCalled()

      await finishAll()
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(renderer.toJSON()).toBeNull()
      renderer.unmount()
    })

    it("leaves below the screen edge after a taller message replaces the first", async () => {
      const { renderer } = await show()
      await layout(renderer, HEIGHT)
      await finishAll()

      await layout(renderer, 80)
      await close(renderer)

      const [leave] = started("timing")
      expect(leave!.config.toValue).toBeGreaterThanOrEqual(34 + 16 + 80)
      renderer.unmount()
    })

    it("shows at its final position and leaves at once with Reduce Motion on (R24)", async () => {
      mockMotion.reduce = true
      const { renderer, onDismiss } = await show({
        bottomOffset: PUSH_NOTICE_BOTTOM,
      })
      await layout(renderer, HEIGHT)

      expect(translateYOf(renderer)).toBe(0)
      expect(started("spring")).toHaveLength(0)
      expect(started("timing")).toHaveLength(0)

      await close(renderer)

      expect(started("timing")).toHaveLength(0)
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(renderer.toJSON()).toBeNull()
      renderer.unmount()
    })
  })

  describe("without Liquid Glass (R1)", () => {
    beforeEach(() => {
      mockGate.glass = false
    })

    it("keeps today's fade and 100pt slide on today's solid card", async () => {
      const { renderer, onDismiss } = await show()

      expect(
        hostNodes(renderer, (node) => node.type === "GlassView"),
      ).toHaveLength(0)
      const [card] = hostNodes(
        renderer,
        (node) => styleOf(node).backgroundColor === "#292524",
      )
      expect(card).toBeDefined()
      expect(styleOf(card!).opacity).toBe(0)
      expect(translateYOf(renderer)).toBe(100)

      const [enter] = started("spring")
      expect(enter).toMatchObject({
        from: 100,
        config: { toValue: 0, tension: 80, friction: 10 },
      })
      expect(started("timing")).toEqual([
        expect.objectContaining({
          from: 0,
          config: expect.objectContaining({ toValue: 1, duration: 200 }),
        }),
      ])
      await finishAll()

      await close(renderer)

      expect(
        started("timing").map((call) => [
          call.config.toValue,
          call.config.duration,
        ]),
      ).toEqual([
        [100, 250],
        [0, 250],
      ])
      await finishAll()
      expect(onDismiss).toHaveBeenCalledTimes(1)
      renderer.unmount()
    })
  })

  // The timer starts at show time, before the glass height is measured, so it
  // must reach the latest dismiss, not the one from the first render.
  describe("the auto-dismiss timer", () => {
    const DURATION = 3000

    beforeEach(() => {
      jest.useFakeTimers()
    })
    afterEach(() => {
      jest.useRealTimers()
    })

    async function runTimer() {
      await act(async () => {
        jest.advanceTimersByTime(DURATION)
      })
    }

    it("slides out by the measured height on Liquid Glass", async () => {
      const { renderer, onDismiss } = await show({
        duration: DURATION,
        bottomOffset: PUSH_NOTICE_BOTTOM,
      })
      await layout(renderer, HEIGHT)
      await finishAll()

      await runTimer()

      const [leave] = started("timing")
      expect(leave).toBeDefined()
      expect(leave!.config.toValue).toBeGreaterThanOrEqual(
        PUSH_NOTICE_BOTTOM + HEIGHT,
      )
      expect(onDismiss).not.toHaveBeenCalled()
      await finishAll()
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(renderer.toJSON()).toBeNull()
      renderer.unmount()
    })

    it("leaves at once on Liquid Glass with Reduce Motion on (R24)", async () => {
      mockMotion.reduce = true
      const { renderer, onDismiss } = await show({ duration: DURATION })
      await layout(renderer, HEIGHT)

      await runTimer()

      expect(started("timing")).toHaveLength(0)
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(renderer.toJSON()).toBeNull()
      renderer.unmount()
    })

    it("keeps the fade and 100pt slide without Liquid Glass", async () => {
      mockGate.glass = false
      const { renderer, onDismiss } = await show({ duration: DURATION })
      await finishAll()

      await runTimer()

      expect(
        started("timing").map((call) => [
          call.config.toValue,
          call.config.duration,
        ]),
      ).toEqual([
        [100, 250],
        [0, 250],
      ])
      await finishAll()
      expect(onDismiss).toHaveBeenCalledTimes(1)
      renderer.unmount()
    })
  })
})
