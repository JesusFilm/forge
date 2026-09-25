/**
 * The three-slot pager (U15): the swipe, the settle, the rest, the latch, the
 * accessibility actions, and reduced motion, driven through the real handlers.
 */

jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: jest.fn(() => false),
}))

import {
  StrictMode,
  act,
  useEffect,
  type ReactElement,
  type ReactNode,
} from "react"
import {
  Animated,
  Text,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  EXPLORE_PAGER_REST_DWELL_MS,
  ExplorePager,
  type ExplorePagerMove,
  type ExplorePagerSlot,
  type ExplorePagerUnderlay,
} from "../ExplorePager"
import { EXPLORE_COPY } from "../../../lib/explore/copy"

const { useReduceMotion } = jest.requireMock(
  "../../../hooks/useReduceMotion",
) as { useReduceMotion: jest.Mock }

const PAGE = 800
/** Under the 0.2 x PAGE distance, and slow enough to be no fling. */
const SHORT = 100
/** Past the distance threshold. */
const LONG = 300
const SLOW_MS = 1000

type AnimationCall = {
  kind: "spring" | "timing"
  value: Animated.Value
  config: {
    toValue: number
    useNativeDriver: boolean
    duration?: number
    velocity?: number
  }
  stopped: boolean
  land: () => void
}

let animations: AnimationCall[] = []
let setValueSpy: jest.SpyInstance

// Jest has no native driver, so every animation is held here and landed by
// the test. The settle node rests where its last animation was sent.
function heldAnimation(kind: AnimationCall["kind"]) {
  return (value: unknown, config: unknown) => {
    const call: AnimationCall = {
      kind,
      value: value as Animated.Value,
      config: config as AnimationCall["config"],
      stopped: false,
      land: () => {},
    }
    animations.push(call)
    let onEnd: ((result: { finished: boolean }) => void) | undefined
    return {
      start: (callback?: (result: { finished: boolean }) => void) => {
        onEnd = callback
        call.land = () => onEnd?.({ finished: true })
      },
      // A real spring reports `finished: false` inside its own stop().
      stop: () => {
        call.stopped = true
        onEnd?.({ finished: false })
      },
      reset: () => {},
    } as unknown as Animated.CompositeAnimation
  }
}

beforeEach(() => {
  jest.useFakeTimers()
  animations = []
  jest.spyOn(Animated, "spring").mockImplementation(heldAnimation("spring"))
  jest.spyOn(Animated, "timing").mockImplementation(heldAnimation("timing"))
  setValueSpy = jest.spyOn(Animated.Value.prototype, "setValue")
  useReduceMotion.mockReturnValue(false)
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

// ── Harness ─────────────────────────────────────────────────────────────

type Harness = {
  renderer: TestInstance
  moves: ExplorePagerMove[]
  rests: number
  latch: boolean[]
  mounts: number
  roles: Map<number, string>
  slots: Map<number, ExplorePagerSlot>
}

function SlotProbe({
  slot,
  onMount,
}: {
  slot: ExplorePagerSlot
  onMount: () => void
}) {
  useEffect(onMount, [onMount])
  return (
    <View testID={`clip-${slot.key}`} {...(slot.accessibility ?? {})}>
      <Text>{slot.role}</Text>
    </View>
  )
}

async function renderPager(
  options: {
    canSwipeNext?: boolean
    canSwipePrevious?: boolean
    strict?: boolean
    underlay?: (underlay: ExplorePagerUnderlay, harness: Harness) => ReactNode
  } = {},
): Promise<Harness> {
  const harness = {
    moves: [],
    rests: 0,
    latch: [],
    mounts: 0,
    roles: new Map(),
    slots: new Map(),
  } as unknown as Harness
  const onMount = () => {
    harness.mounts += 1
  }
  const element = (canNext: boolean, canPrevious: boolean): ReactElement => {
    const pager = (
      <ExplorePager
        canSwipeNext={canNext}
        canSwipePrevious={canPrevious}
        onMove={(move) => harness.moves.push(move)}
        onRest={() => {
          harness.rests += 1
        }}
        onGestureLatchChange={(latched) => harness.latch.push(latched)}
        renderUnderlay={
          options.underlay == null
            ? undefined
            : (underlay) => options.underlay!(underlay, harness)
        }
        renderSlot={(slot) => {
          harness.roles.set(slot.key, slot.role)
          harness.slots.set(slot.key, slot)
          return <SlotProbe slot={slot} onMount={onMount} />
        }}
      />
    )
    return options.strict ? <StrictMode>{pager}</StrictMode> : pager
  }
  await act(async () => {
    harness.renderer = TestRenderer.create(
      element(options.canSwipeNext ?? true, options.canSwipePrevious ?? true),
    )
  })
  await layoutPager(harness.renderer, PAGE)
  return harness
}

async function layoutPager(renderer: TestInstance, height: number) {
  const onLayout = root(renderer).props.onLayout as (
    event: LayoutChangeEvent,
  ) => void
  await act(async () => {
    onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
    } as LayoutChangeEvent)
  })
}

function hostNodes(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
): RenderedNode[] {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

function root(renderer: TestInstance): RenderedNode {
  return hostNodes(
    renderer,
    (node) => typeof node.props.onMoveShouldSetResponder === "function",
  )[0]
}

type PanHandlers = {
  onStartShouldSetResponderCapture: (e: GestureResponderEvent) => boolean
  onStartShouldSetResponder: (e: GestureResponderEvent) => boolean
  onMoveShouldSetResponderCapture: (e: GestureResponderEvent) => boolean
  onMoveShouldSetResponder: (e: GestureResponderEvent) => boolean
  onResponderGrant: (e: GestureResponderEvent) => void
  onResponderMove: (e: GestureResponderEvent) => void
  onResponderRelease: (e: GestureResponderEvent) => void
  onResponderTerminate: (e: GestureResponderEvent) => void
}

function handlers(renderer: TestInstance): PanHandlers {
  return root(renderer).props as unknown as PanHandlers
}

/**
 * One finger at (x, y), last seen at (fromX, fromY) `stepMs` earlier. The
 * history is what `PanResponder` derives its own dx, dy, and vy from.
 */
let clock = 1000
function touch(
  x: number,
  y: number,
  fromX: number,
  fromY: number,
  stepMs: number,
): GestureResponderEvent {
  clock += stepMs
  return {
    nativeEvent: { touches: [{}], changedTouches: [], pageX: x, pageY: y },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: clock,
      touchBank: [
        {
          touchActive: true,
          startPageX: 0,
          startPageY: 0,
          startTimeStamp: clock - stepMs,
          currentPageX: x,
          currentPageY: y,
          currentTimeStamp: clock,
          previousPageX: fromX,
          previousPageY: fromY,
          previousTimeStamp: clock - stepMs,
        },
      ],
    },
  } as unknown as GestureResponderEvent
}

/** Capture first, then bubble: only capture folds the move into the state. */
function offerMove(pan: PanHandlers, event: GestureResponderEvent) {
  const captured = pan.onMoveShouldSetResponderCapture(event)
  const claimed = pan.onMoveShouldSetResponder(event)
  return { captured, claimed }
}

/**
 * Touch down, claim with a move just past the slop, then move `dy` further in
 * `stepMs`. The gesture's dy is then exactly `dy` and its vy is `dy / stepMs`.
 */
function grantAndMove(pan: PanHandlers, dy: number, stepMs: number): number {
  pan.onStartShouldSetResponderCapture(touch(0, 0, 0, 0, 16))
  const claimY = Math.sign(dy) * 12
  const claim = touch(0, claimY, 0, 0, 16)
  expect(offerMove(pan, claim)).toEqual({ captured: false, claimed: true })
  pan.onResponderGrant(claim)
  pan.onResponderMove(touch(0, claimY + dy, 0, claimY, stepMs))
  return claimY + dy
}

async function swipe(
  harness: Harness,
  dy: number,
  stepMs: number = SLOW_MS,
): Promise<void> {
  await act(async () => {
    const pan = handlers(harness.renderer)
    const endY = grantAndMove(pan, dy, stepMs)
    pan.onResponderRelease(touch(0, endY, 0, endY, 16))
  })
}

function springs(): AnimationCall[] {
  return animations.filter((call) => call.kind === "spring")
}

async function landSettle(): Promise<void> {
  const running = springs().at(-1)
  expect(running).toBeDefined()
  await act(async () => {
    running!.land()
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

// ── On-screen geometry ──────────────────────────────────────────────────

function dragNodes(): Set<unknown> {
  return new Set(setValueSpy.mock.contexts)
}

function dragValue(): number {
  const calls = setValueSpy.mock.calls
  return calls.length === 0 ? 0 : (calls[calls.length - 1][0] as number)
}

/** Where the native settle node comes to rest: its last animation's target. */
function settleValue(): number {
  return animations.at(-1)?.config.toValue ?? 0
}

function flatStyle(node: RenderedNode): Record<string, unknown> {
  return ([] as unknown[])
    .concat(node.props.style)
    .flat(Infinity)
    .filter(Boolean)
    .reduce<Record<string, unknown>>(
      (acc, part) => ({ ...acc, ...(part as Record<string, unknown>) }),
      {},
    )
}

function offsetOf(node: RenderedNode): number {
  const transform = (flatStyle(node).transform ?? []) as Array<{
    translateY?: number
  }>
  return transform.reduce((sum, part) => sum + (part.translateY ?? 0), 0)
}

/** The settle layer, then the drag layer: the two Animated views, outer first. */
function layers(renderer: TestInstance): RenderedNode[] {
  const found = hostNodes(renderer, (node) => node.props.collapsable === false)
  expect(found).toHaveLength(2)
  return found
}

function topOf(node: RenderedNode): number {
  const top = flatStyle(node).top
  return typeof top === "number" ? top : 0
}

/** Where the layers put page 0 on screen, in layout plus transform. */
function layerY(renderer: TestInstance): number {
  const [settleLayer, dragLayer] = layers(renderer)
  return topOf(settleLayer) + settleValue() + topOf(dragLayer) + dragValue()
}

/** Each frame against its parent: settle layer, drag layer, current slot. */
function frameOffsets(harness: Harness): number[] {
  const [settleLayer, dragLayer] = layers(harness.renderer)
  const current = slotOffsets(harness.renderer)[keyWithRole(harness, "current")]
  return [
    topOf(settleLayer) + settleValue(),
    topOf(dragLayer) + dragValue(),
    current,
  ]
}

/** The three slots, in key order. The underlay layer is not a slot. */
function slotOffsets(renderer: TestInstance): number[] {
  return hostNodes(
    renderer,
    (node) =>
      node.props.importantForAccessibility != null &&
      node.props.testID !== "explore-pager-underlay",
  ).map(offsetOf)
}

/** Each slot key's on-screen y at rest: 0 is the screen, ±PAGE off it. */
function screenY(harness: Harness): number[] {
  const base = layerY(harness.renderer)
  return slotOffsets(harness.renderer).map((offset) => base + offset)
}

function keyWithRole(harness: Harness, role: string): number {
  for (const [key, value] of harness.roles) if (value === role) return key
  throw new Error(`no slot holds ${role}`)
}

function expectRolesOnScreen(harness: Harness) {
  const y = screenY(harness)
  expect(y[keyWithRole(harness, "current")]).toBeCloseTo(0)
  expect(y[keyWithRole(harness, "next")]).toBeCloseTo(PAGE)
  expect(y[keyWithRole(harness, "previous")]).toBeCloseTo(-PAGE)
}

// ── Swipes ──────────────────────────────────────────────────────────────

describe("swipe (R5, KTD1)", () => {
  it("starts with one slot per role and the current one on screen", async () => {
    const harness = await renderPager()

    expect(new Set(harness.roles.values())).toEqual(
      new Set(["previous", "current", "next"]),
    )
    expectRolesOnScreen(harness)
  })

  it("emits next when an upward pan passes the distance threshold", async () => {
    const harness = await renderPager()
    const before = keyWithRole(harness, "next")

    await swipe(harness, -LONG)
    // The move commits when the settle lands, with the roles in one render.
    expect(harness.moves).toEqual([])
    await landSettle()

    expect(harness.moves).toEqual(["next"])
    expect(keyWithRole(harness, "current")).toBe(before)
    expectRolesOnScreen(harness)
  })

  it("emits next for a short but fast upward fling", async () => {
    const harness = await renderPager()

    // 60 px in 20 ms is 3 px/ms, far past the velocity threshold.
    await swipe(harness, -60, 20)
    await landSettle()

    expect(harness.moves).toEqual(["next"])
  })

  it("snaps a short, slow pan back and emits nothing", async () => {
    const harness = await renderPager()
    const current = keyWithRole(harness, "current")

    await swipe(harness, -SHORT)
    await landSettle()

    expect(harness.moves).toEqual([])
    expect(keyWithRole(harness, "current")).toBe(current)
    expectRolesOnScreen(harness)
  })

  it("emits previous for a downward pan after a move, and keeps the roles on screen", async () => {
    const harness = await renderPager()

    await swipe(harness, -LONG)
    await landSettle()
    await swipe(harness, -LONG)
    await landSettle()
    const before = keyWithRole(harness, "previous")
    await swipe(harness, LONG)
    await landSettle()

    expect(harness.moves).toEqual(["next", "next", "previous"])
    expect(keyWithRole(harness, "current")).toBe(before)
    expectRolesOnScreen(harness)
  })

  it("emits nothing for a downward pan at the first clip", async () => {
    const harness = await renderPager({ canSwipePrevious: false })

    await swipe(harness, LONG)
    // The drag resists a refused move rather than following the finger.
    expect(Math.abs(dragValue())).toBeLessThan(LONG)
    await landSettle()

    expect(harness.moves).toEqual([])
    expectRolesOnScreen(harness)
  })

  it("emits nothing for an upward pan with no next clip", async () => {
    const harness = await renderPager({ canSwipeNext: false })

    await swipe(harness, -LONG, 20)
    await landSettle()

    expect(harness.moves).toEqual([])
  })

  it("drags on the JS node and settles on a separate native node (KTD22)", async () => {
    const harness = await renderPager()

    await swipe(harness, -LONG)
    await swipe(harness, -LONG)
    await landSettle()

    const settleNodes = new Set(animations.map((call) => call.value))
    expect(settleNodes.size).toBe(1)
    expect(animations.every((call) => call.config.useNativeDriver)).toBe(true)
    // The settle node is never written with setValue, and the drag node is
    // never animated: one driver per node.
    const [settle] = settleNodes
    expect(dragNodes().has(settle)).toBe(false)
    expect(dragNodes().size).toBe(1)
    expectRolesOnScreen(harness)
  })
})

// ── Latch, rest, and streaks ────────────────────────────────────────────

describe("gesture latch and rest (KTD22, KTD25)", () => {
  it("sets the latch on the pan grant and clears it at rest after the settle", async () => {
    const harness = await renderPager()

    await act(async () => {
      grantAndMove(handlers(harness.renderer), -LONG, SLOW_MS)
    })
    expect(harness.latch).toEqual([true])

    await act(async () => {
      handlers(harness.renderer).onResponderRelease(touch(0, 0, 0, 0, 16))
    })
    await advance(EXPLORE_PAGER_REST_DWELL_MS * 5)
    // Still settling: no rest runs while the spring is in flight.
    expect(harness.latch).toEqual([true])
    expect(harness.rests).toBe(0)

    await landSettle()
    await advance(EXPLORE_PAGER_REST_DWELL_MS - 1)
    expect(harness.latch).toEqual([true])
    expect(harness.rests).toBe(0)

    await advance(1)
    expect(harness.latch).toEqual([true, false])
    expect(harness.rests).toBe(1)
  })

  it("rests after a snap-back too, so the latch never sticks", async () => {
    const harness = await renderPager()

    await swipe(harness, -SHORT)
    await landSettle()
    await advance(EXPLORE_PAGER_REST_DWELL_MS)

    expect(harness.moves).toEqual([])
    expect(harness.latch).toEqual([true, false])
    expect(harness.rests).toBe(1)
  })

  it("commits a settling move before a pan that starts during it, and loses none", async () => {
    const harness = await renderPager()

    await swipe(harness, -LONG)
    const first = springs().at(-1)!
    expect(harness.moves).toEqual([])

    await act(async () => {
      grantAndMove(handlers(harness.renderer), -LONG, SLOW_MS)
    })
    // The grant jumped the first spring to its end and committed its move
    // before the second pan could move anything.
    expect(harness.moves).toEqual(["next"])
    expect(first.stopped).toBe(true)
    const jump = animations.at(-1)!
    expect(jump.kind).toBe("timing")
    expect(jump.value).toBe(first.value)
    expect(jump.config).toMatchObject({
      toValue: first.config.toValue,
      duration: 0,
      useNativeDriver: true,
    })

    await act(async () => {
      handlers(harness.renderer).onResponderRelease(touch(0, 0, 0, 0, 16))
    })
    await landSettle()

    expect(harness.moves).toEqual(["next", "next"])
    expectRolesOnScreen(harness)
  })

  it("emits twenty moves and one rest for twenty fast swipes, latched throughout", async () => {
    const harness = await renderPager()

    for (let swipeIndex = 0; swipeIndex < 20; swipeIndex += 1) {
      await swipe(harness, -LONG, 20)
      // Half the settles land before the next pan, and their rest dwell is
      // cut short by it; the other half are jumped by the next grant.
      if (swipeIndex % 2 === 0) await landSettle()
      await advance(EXPLORE_PAGER_REST_DWELL_MS - 50)
      expect(harness.latch).toEqual([true])
      expect(harness.rests).toBe(0)
    }
    await landSettle()
    await advance(EXPLORE_PAGER_REST_DWELL_MS)

    expect(harness.moves).toEqual(Array(20).fill("next"))
    expect(harness.rests).toBe(1)
    expect(harness.latch).toEqual([true, false])
    expectRolesOnScreen(harness)
  })

  it("keeps all three slots mounted across ten swipes and rotates their roles", async () => {
    const harness = await renderPager()
    expect(harness.mounts).toBe(3)
    const currentKeys = new Set<number>()

    for (let swipeIndex = 0; swipeIndex < 10; swipeIndex += 1) {
      await swipe(harness, -LONG)
      await landSettle()
      currentKeys.add(keyWithRole(harness, "current"))
      expectRolesOnScreen(harness)
    }

    expect(harness.moves).toHaveLength(10)
    expect(harness.mounts).toBe(3)
    expect(currentKeys).toEqual(new Set([0, 1, 2]))
  })

  it("keeps the current slot on screen when the page height changes", async () => {
    const harness = await renderPager()
    await swipe(harness, -LONG)
    await landSettle()

    await layoutPager(harness.renderer, 700)

    const y = screenY(harness)
    expect(y[keyWithRole(harness, "current")]).toBeCloseTo(0)
    expect(y[keyWithRole(harness, "next")]).toBeCloseTo(700)
  })

  it("still rests when the page height changes during a settle", async () => {
    const harness = await renderPager()
    await swipe(harness, -LONG)

    await layoutPager(harness.renderer, 700)
    // The layout jumped the spring to its end and committed its move.
    expect(harness.moves).toEqual(["next"])
    // The stopped spring still reports; it must neither commit nor rest.
    await landSettle()
    await advance(EXPLORE_PAGER_REST_DWELL_MS)

    expect(harness.moves).toEqual(["next"])
    expect(harness.latch).toEqual([true, false])
    expect(harness.rests).toBe(1)
  })

  it("works under StrictMode's mount, unmount, and remount", async () => {
    const harness = await renderPager({ strict: true })

    await swipe(harness, -LONG)
    await landSettle()
    await advance(EXPLORE_PAGER_REST_DWELL_MS)

    expect(harness.moves).toEqual(["next"])
    expect(harness.rests).toBe(1)
    expect(harness.latch).toEqual([true, false])
  })

  it("releases the latch and drops the settle when it unmounts mid-streak", async () => {
    const harness = await renderPager()
    await swipe(harness, -LONG)

    await act(async () => {
      harness.renderer.unmount()
    })
    await advance(EXPLORE_PAGER_REST_DWELL_MS * 2)

    expect(springs().at(-1)!.stopped).toBe(true)
    expect(harness.moves).toEqual([])
    expect(harness.rests).toBe(0)
    expect(harness.latch).toEqual([true, false])
  })
})

// ── The persistent underlay (KTD1) ─────────────────────────────────────

function UnderlayProbe({
  id,
  style,
  onMount,
}: {
  id: string
  style: StyleProp<ViewStyle>
  onMount: () => void
}) {
  useEffect(onMount, [onMount])
  return <View testID={`underlay-${id}`} style={style} />
}

/** Two children that swap current and next on every move, as two players do. */
function swappingUnderlay(counter: { mounts: number }) {
  const onMount = () => {
    counter.mounts += 1
  }
  return ({ pageStyle }: ExplorePagerUnderlay, harness: Harness) => {
    const aCurrent = harness.moves.length % 2 === 0
    return (
      <>
        <UnderlayProbe
          key="a"
          id="a"
          style={pageStyle(aCurrent ? "current" : "next")}
          onMount={onMount}
        />
        <UnderlayProbe
          key="b"
          id="b"
          style={pageStyle(aCurrent ? "next" : "current")}
          onMount={onMount}
        />
      </>
    )
  }
}

function underlayNode(harness: Harness, id: string): RenderedNode {
  const [node] = hostNodes(
    harness.renderer,
    (candidate) => candidate.props.testID === `underlay-${id}`,
  )
  expect(node).toBeDefined()
  return node
}

function underlayScreenY(harness: Harness, id: string): number {
  return layerY(harness.renderer) + offsetOf(underlayNode(harness, id))
}

describe("the underlay (KTD1)", () => {
  it("keeps its children mounted across ten swipes, each on its role's page", async () => {
    const counter = { mounts: 0 }
    const harness = await renderPager({ underlay: swappingUnderlay(counter) })
    expect(counter.mounts).toBe(2)

    for (let swipeIndex = 0; swipeIndex < 10; swipeIndex += 1) {
      const aCurrent = harness.moves.length % 2 === 0
      const incoming = aCurrent ? "b" : "a"

      await swipe(harness, -LONG)
      // Where the settle will land the incoming child, before roles rotate.
      const landing = underlayScreenY(harness, incoming)
      await landSettle()

      // The rotation and its rebase keep the child where it landed: no jump.
      expect(landing).toBeCloseTo(0)
      expect(underlayScreenY(harness, incoming)).toBeCloseTo(0)
      const outgoing = incoming === "a" ? "b" : "a"
      expect(underlayScreenY(harness, outgoing)).toBeCloseTo(PAGE)
      expectRolesOnScreen(harness)
    }

    expect(harness.moves).toHaveLength(10)
    expect(counter.mounts).toBe(2)
  })

  it("follows a swipe back to the previous page", async () => {
    const harness = await renderPager({
      underlay: ({ pageStyle }) => (
        <>
          <UnderlayProbe
            id="current"
            style={pageStyle("current")}
            onMount={() => {}}
          />
          <UnderlayProbe
            id="previous"
            style={pageStyle("previous")}
            onMount={() => {}}
          />
        </>
      ),
    })
    await swipe(harness, -LONG)
    await landSettle()
    await swipe(harness, LONG)
    await landSettle()

    expect(harness.moves).toEqual(["next", "previous"])
    expect(underlayScreenY(harness, "current")).toBeCloseTo(0)
    expect(underlayScreenY(harness, "previous")).toBeCloseTo(-PAGE)
  })

  it("draws beneath the slots, takes no touch, and is hidden from a screen reader", async () => {
    const harness = await renderPager({
      underlay: swappingUnderlay({ mounts: 0 }),
    })
    const [layer] = hostNodes(
      harness.renderer,
      (node) => node.props.testID === "explore-pager-underlay",
    )
    expect(layer.props.pointerEvents).toBe("none")
    expect(layer.props.accessibilityElementsHidden).toBe(true)
    expect(layer.props.importantForAccessibility).toBe("no-hide-descendants")

    // Tree order is paint order: the probes come before every slot.
    const order = hostNodes(
      harness.renderer,
      (node) =>
        node.props.testID === "underlay-a" ||
        /^clip-\d$/.test(String(node.props.testID)),
    ).map((node) => node.props.testID)
    expect(order[0]).toBe("underlay-a")
  })

  it("renders no underlay layer when the feed passes none", async () => {
    const harness = await renderPager()
    expect(
      hostNodes(
        harness.renderer,
        (node) => node.props.testID === "explore-pager-underlay",
      ),
    ).toHaveLength(0)
  })
})

// ── Progress-bar drags ──────────────────────────────────────────────────

describe("children keep their own gestures", () => {
  it("never claims a touch start, and never claims in the capture phase", async () => {
    const harness = await renderPager()
    const pan = handlers(harness.renderer)

    expect(pan.onStartShouldSetResponderCapture(touch(0, 0, 0, 0, 16))).toBe(
      false,
    )
    expect(pan.onStartShouldSetResponder(touch(0, 0, 0, 0, 16))).toBe(false)
    // A clearly vertical move is claimed only in the bubble phase, so a child
    // that already holds the responder is asked first.
    expect(offerMove(pan, touch(4, -40, 0, 0, 16))).toEqual({
      captured: false,
      claimed: true,
    })
  })

  it("does not move for a horizontal drag that starts on the progress bar", async () => {
    const harness = await renderPager()
    const pan = handlers(harness.renderer)

    await act(async () => {
      pan.onStartShouldSetResponderCapture(touch(0, 0, 0, 0, 16))
      expect(offerMove(pan, touch(40, 4, 0, 0, 16))).toEqual({
        captured: false,
        claimed: false,
      })
      expect(offerMove(pan, touch(160, 20, 40, 4, 16))).toEqual({
        captured: false,
        claimed: false,
      })
    })
    await advance(EXPLORE_PAGER_REST_DWELL_MS)

    expect(setValueSpy).not.toHaveBeenCalled()
    expect(animations).toEqual([])
    expect(harness.moves).toEqual([])
    expect(harness.latch).toEqual([])
  })
})

// ── Accessibility and reduced motion ────────────────────────────────────

function clipElement(harness: Harness, key: number): RenderedNode {
  return hostNodes(
    harness.renderer,
    (node) => node.props.testID === `clip-${key}`,
  )[0]
}

async function accessibilityAction(harness: Harness, name: string) {
  const element = clipElement(harness, keyWithRole(harness, "current"))
  await act(async () => {
    ;(
      element.props.onAccessibilityAction as (
        event: AccessibilityActionEvent,
      ) => void
    )({ nativeEvent: { actionName: name } } as AccessibilityActionEvent)
  })
}

describe("accessibility (R35)", () => {
  it("offers next and previous only on the current clip, and hides the other slots", async () => {
    const harness = await renderPager()
    const current = keyWithRole(harness, "current")

    const actions = clipElement(harness, current).props.accessibilityActions
    expect(actions).toEqual([
      { name: "next", label: EXPLORE_COPY.pagerActions.next },
      { name: "previous", label: EXPLORE_COPY.pagerActions.previous },
    ])
    for (const [key, slot] of harness.slots) {
      if (key === current) continue
      expect(slot.accessibility).toBeNull()
    }
    const hidden = hostNodes(
      harness.renderer,
      (node) => node.props.importantForAccessibility === "no-hide-descendants",
    )
    expect(hidden).toHaveLength(2)
    expect(
      hidden.every((node) => node.props.accessibilityElementsHidden === true),
    ).toBe(true)
  })

  it("offers only the moves the feed allows", async () => {
    const harness = await renderPager({ canSwipePrevious: false })

    const element = clipElement(harness, keyWithRole(harness, "current"))
    expect(element.props.accessibilityActions).toEqual([
      { name: "next", label: EXPLORE_COPY.pagerActions.next },
    ])

    await accessibilityAction(harness, "previous")
    expect(animations).toEqual([])
    expect(harness.latch).toEqual([])
  })

  it("emits the same events for the next and previous actions as for swipes", async () => {
    const harness = await renderPager()

    await accessibilityAction(harness, "next")
    expect(harness.latch).toEqual([true])
    expect(springs().at(-1)!.config.useNativeDriver).toBe(true)
    await landSettle()
    await advance(EXPLORE_PAGER_REST_DWELL_MS)
    expect(harness.moves).toEqual(["next"])
    expect(harness.rests).toBe(1)
    expect(harness.latch).toEqual([true, false])
    expectRolesOnScreen(harness)

    await accessibilityAction(harness, "previous")
    await landSettle()
    await advance(EXPLORE_PAGER_REST_DWELL_MS)
    expect(harness.moves).toEqual(["next", "previous"])
    expect(harness.rests).toBe(2)
    expect(harness.latch).toEqual([true, false, true, false])
    expectRolesOnScreen(harness)
  })
})

describe("accessibility tree geometry (R35)", () => {
  function expectFramesInsideParents(harness: Harness) {
    for (const offset of frameOffsets(harness)) {
      expect(Math.abs(offset)).toBeLessThan(1)
    }
  }

  it("keeps each layer and the current slot inside its parent after 1, 2, and 10 moves each way", async () => {
    const harness = await renderPager()
    expectFramesInsideParents(harness)

    for (const dy of [-LONG, LONG]) {
      for (let move = 1; move <= 10; move += 1) {
        await swipe(harness, dy)
        await landSettle()
        await advance(EXPLORE_PAGER_REST_DWELL_MS)
        if (move === 1 || move === 2 || move === 10) {
          expectFramesInsideParents(harness)
          expectRolesOnScreen(harness)
        }
      }
    }
    expect(harness.moves).toEqual([
      ...Array(10).fill("next"),
      ...Array(10).fill("previous"),
    ])
  })

  it("keeps them inside after snap-backs, whose drags would otherwise add up", async () => {
    const harness = await renderPager()

    for (let snap = 0; snap < 10; snap += 1) {
      await swipe(harness, -SHORT)
      await landSettle()
    }

    expect(harness.moves).toEqual([])
    expectFramesInsideParents(harness)
    expectRolesOnScreen(harness)
  })

  it("keeps them inside after the grant jumps a running settle", async () => {
    const harness = await renderPager()

    await swipe(harness, -LONG)
    await swipe(harness, -LONG)
    await landSettle()

    expect(harness.moves).toEqual(["next", "next"])
    expectFramesInsideParents(harness)
    expectRolesOnScreen(harness)
  })

  it("moves no content when the page height changes during a drag", async () => {
    const harness = await renderPager()
    await swipe(harness, -LONG)
    await landSettle()

    await act(async () => {
      grantAndMove(handlers(harness.renderer), -SHORT, SLOW_MS)
    })
    const dragged = screenY(harness)[keyWithRole(harness, "current")]
    await layoutPager(harness.renderer, 700)

    expect(screenY(harness)[keyWithRole(harness, "current")]).toBeCloseTo(
      dragged,
    )
    await act(async () => {
      handlers(harness.renderer).onResponderRelease(touch(0, 0, 0, 0, 16))
    })
    await landSettle()
    expectFramesInsideParents(harness)
    const y = screenY(harness)
    expect(y[keyWithRole(harness, "current")]).toBeCloseTo(0)
    expect(y[keyWithRole(harness, "next")]).toBeCloseTo(700)
    expect(y[keyWithRole(harness, "previous")]).toBeCloseTo(-700)
  })
})

describe("reduced motion (R35)", () => {
  beforeEach(() => {
    useReduceMotion.mockReturnValue(true)
  })

  it("changes the clip at release with no animation", async () => {
    const harness = await renderPager()
    const before = keyWithRole(harness, "next")

    await swipe(harness, -LONG)

    expect(harness.moves).toEqual(["next"])
    expect(animations).toEqual([])
    expect(keyWithRole(harness, "current")).toBe(before)
    expectRolesOnScreen(harness)

    await advance(EXPLORE_PAGER_REST_DWELL_MS)
    expect(harness.rests).toBe(1)
    expect(harness.latch).toEqual([true, false])
  })

  it("puts a short pan back at once with no animation", async () => {
    const harness = await renderPager()

    await swipe(harness, -SHORT)

    expect(harness.moves).toEqual([])
    expect(animations).toEqual([])
    expectRolesOnScreen(harness)
  })

  it("changes the clip for an accessibility action with no animation", async () => {
    const harness = await renderPager()

    await accessibilityAction(harness, "next")

    expect(harness.moves).toEqual(["next"])
    expect(animations).toEqual([])
    expectRolesOnScreen(harness)
  })
})
