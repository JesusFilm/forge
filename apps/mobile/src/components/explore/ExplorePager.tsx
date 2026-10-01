/**
 * The Explore feed's vertical pager (KTD1). Three permanent slots hold
 * what the feed supplies per key, and a swipe rotates roles. Video views go in
 * the underlay: a view inside a slot would change slots and remount.
 */

import {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react"
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderHandlers,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { useReduceMotion } from "../../hooks/useReduceMotion"
import { EXPLORE_COPY } from "../../lib/explore/copy"

/** KTD25: the pager rests this long with no new pan before loads may start. */
export const EXPLORE_PAGER_REST_DWELL_MS = 200

/** A release past this share of the page height commits the move. */
const EXPLORE_PAGER_COMMIT_DISTANCE = 0.2

/** A release faster than this, in PanResponder's px/ms, commits the move. */
const EXPLORE_PAGER_COMMIT_VELOCITY = 0.5

/** Vertical travel before the pager takes a pan from its children. */
const PAN_SLOP_PX = 10

/** A drag toward a move the feed refuses follows the finger at this share. */
const EDGE_RESISTANCE = 0.25

// Clamped: past the target sits the empty page beyond the third slot.
const SETTLE_SPRING = {
  stiffness: 500,
  damping: 40,
  mass: 1,
  overshootClamping: true,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 10,
} as const

const EXPLORE_PAGER_SLOT_KEYS = [0, 1, 2] as const
export type ExplorePagerSlotKey = (typeof EXPLORE_PAGER_SLOT_KEYS)[number]
export type ExplorePagerRole = "previous" | "current" | "next"
export type ExplorePagerMove = "next" | "previous"

/** R35: spread these on the current clip's focusable element. */
export type ExplorePagerAccessibility = {
  accessibilityActions: { name: ExplorePagerMove; label: string }[]
  onAccessibilityAction: (event: AccessibilityActionEvent) => void
}

export type ExplorePagerSlot = {
  /** Never changes for a slot, so its content never remounts. */
  key: ExplorePagerSlotKey
  role: ExplorePagerRole
  /** Set on the current slot only. */
  accessibility: ExplorePagerAccessibility | null
}

/** A child placed with `pageStyle(role)` moves with that role's page. */
export type ExplorePagerUnderlay = {
  pageStyle: (role: ExplorePagerRole) => StyleProp<ViewStyle>
}

/** The feed's own move, as at a clip's end. False when the pager cannot move now. */
export type ExplorePagerHandle = {
  requestMove: (move: ExplorePagerMove) => boolean
}

export type ExplorePagerProps = {
  ref?: Ref<ExplorePagerHandle>
  renderSlot: (slot: ExplorePagerSlot) => ReactNode
  /**
   * A layer under the slots that stays mounted, so a child keeps one position
   * in the tree. A child that follows a clip changes `pageStyle`, not parent.
   */
  renderUnderlay?: (underlay: ExplorePagerUnderlay) => ReactNode
  canSwipeNext: boolean
  canSwipePrevious: boolean
  /** A move commits as its settle lands, in the render that rotates roles. */
  onMove: (move: ExplorePagerMove) => void
  /** KTD25: the pager rested for the dwell after a gesture streak. */
  onRest: () => void
  /** KTD22: set from a streak's first pan grant until `onRest`. */
  onGestureLatchChange: (latched: boolean) => void
}

type Placement = {
  /** Pages count committed moves and never reset (see `createPagerEngine`). */
  current: number
  pages: readonly [number, number, number]
  /** Layout offsets that cancel `settle` and `drag` at rest (see `rebase`). */
  settleTop: number
  dragTop: number
}

const INITIAL_PLACEMENT: Placement = {
  current: 0,
  pages: [0, 1, -1],
  settleTop: 0,
  dragTop: 0,
}

/** The slot left two pages behind the new current wraps to the far side. */
function rotate(placement: Placement, step: 1 | -1): Placement {
  const current = placement.current + step
  const wrap = (page: number) =>
    page === current - 2 * step ? current + step : page
  const [a, b, c] = placement.pages
  return { ...placement, current, pages: [wrap(a), wrap(b), wrap(c)] }
}

/** A role's page, counted from the current page. */
function roleOffset(role: ExplorePagerRole): number {
  if (role === "current") return 0
  return role === "next" ? 1 : -1
}

function roleOf(
  placement: Placement,
  key: ExplorePagerSlotKey,
): ExplorePagerRole {
  const offset = placement.pages[key] - placement.current
  if (offset === 0) return "current"
  return offset < 0 ? "previous" : "next"
}

function releaseStep(
  dy: number,
  vy: number,
  height: number,
  canSwipeNext: boolean,
  canSwipePrevious: boolean,
): -1 | 0 | 1 {
  const distance = height * EXPLORE_PAGER_COMMIT_DISTANCE
  const fast = EXPLORE_PAGER_COMMIT_VELOCITY
  if (canSwipeNext && dy < 0 && (-dy >= distance || -vy >= fast)) return 1
  if (canSwipePrevious && dy > 0 && (dy >= distance || vy >= fast)) return -1
  return 0
}

type LiveProps = Omit<
  ExplorePagerProps,
  "ref" | "renderSlot" | "renderUnderlay"
> & {
  reduceMotion: boolean
}

type PagerEngine = {
  panHandlers: GestureResponderHandlers
  requestMove: (move: ExplorePagerMove, by: "feed" | "viewer") => boolean
  hold: ExplorePagerHold
  layout: (height: number) => void
  dispose: () => void
}

// The finger writes `drag` with setValue; only native animations move
// `settle`, since a setValue after a native stop can lose to its late report.
// Neither is reset: each settle rebases layout offsets instead (see `rebase`).
function createPagerEngine({
  drag,
  settle,
  live,
  initialHeight,
  showPlacement,
  showHeight,
}: {
  drag: Animated.Value
  settle: Animated.Value
  live: { current: LiveProps }
  initialHeight: number
  showPlacement: (placement: Placement) => void
  showHeight: (height: number) => void
}): PagerEngine {
  let placement = INITIAL_PLACEMENT
  let height = initialHeight
  let dragAt = 0
  /** Where the settle node comes to rest once its animation ends. */
  let settleAt = 0
  let grab = 0
  let settling: {
    animation: Animated.CompositeAnimation
    to: number
    page: number
  } | null = null
  let restTimer: ReturnType<typeof setTimeout> | null = null
  let latched = false
  /** A finger holds the pager: from the pan grant to its release. */
  let panning = false
  /** What children hold, by scope (`useExplorePagerHold`). */
  const holds: Record<ExplorePagerHoldScope, Set<object>> = {
    drag: new Set(),
    feedMove: new Set(),
  }

  const setLatch = (next: boolean) => {
    if (latched === next) return
    latched = next
    live.current.onGestureLatchChange(next)
  }

  const cancelRest = () => {
    if (restTimer != null) clearTimeout(restTimer)
    restTimer = null
  }

  const armRest = () => {
    cancelRest()
    restTimer = setTimeout(() => {
      restTimer = null
      live.current.onRest()
      setLatch(false)
    }, EXPLORE_PAGER_REST_DWELL_MS)
  }

  const writeDrag = (value: number) => {
    dragAt = value
    drag.setValue(value)
  }

  // iOS drops a view from the accessibility tree when its frame misses its
  // parent, even if an ancestor's transform puts it back on screen. One render
  // moves these offsets and the slots together, so the screen does not move.
  const rebase = () => {
    const settleTop = Math.round(-settleAt)
    placement = {
      ...placement,
      settleTop,
      dragTop: placement.current * height - settleTop,
    }
  }

  const commit = (page: number) => {
    const step = page - placement.current
    if (step !== 0 && step !== 1 && step !== -1) return
    const before = placement
    if (step !== 0) placement = rotate(placement, step)
    rebase()
    if (
      step !== 0 ||
      placement.settleTop !== before.settleTop ||
      placement.dragTop !== before.dragTop
    ) {
      showPlacement(placement)
    }
    if (step !== 0) live.current.onMove(step === 1 ? "next" : "previous")
  }

  /** KTD25: jump a running settle to its end and commit its move. */
  const finishSettle = () => {
    const run = settling
    if (run == null) return
    settling = null
    run.animation.stop()
    Animated.timing(settle, {
      toValue: run.to,
      duration: 0,
      useNativeDriver: true,
    }).start()
    commit(run.page)
  }

  const settleTo = (page: number, velocity: number) => {
    const target = -page * height
    if (live.current.reduceMotion) {
      writeDrag(target - settleAt)
      commit(page)
      armRest()
      return
    }
    const from = settleAt
    const to = target - dragAt
    settleAt = to
    const animation = Animated.spring(settle, {
      ...SETTLE_SPRING,
      toValue: to,
      // A fling away from the target would swing further out before it turns.
      velocity: (to - from) * velocity > 0 ? velocity : 0,
      useNativeDriver: true,
    })
    const run = { animation, to, page }
    settling = run
    animation.start(({ finished }) => {
      if (settling !== run) return
      settling = null
      if (!finished) return
      commit(page)
      armRest()
    })
  }

  const resisted = (dy: number) => {
    const { canSwipeNext, canSwipePrevious } = live.current
    const allowed = dy < 0 ? canSwipeNext : canSwipePrevious
    const value = allowed ? dy : dy * EDGE_RESISTANCE
    return Math.max(-height, Math.min(height, value))
  }

  const responder = PanResponder.create({
    // Taps, and the progress bar's horizontal drag, belong to the children.
    // Never capture: a child that already holds the responder is asked first.
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      holds.drag.size === 0 &&
      Math.abs(gesture.dy) > PAN_SLOP_PX &&
      Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      panning = true
      cancelRest()
      setLatch(true)
      finishSettle()
      grab = dragAt
    },
    onPanResponderMove: (_event, gesture) => {
      writeDrag(grab + resisted(gesture.dy))
    },
    onPanResponderRelease: (_event, gesture) => {
      panning = false
      const { canSwipeNext, canSwipePrevious } = live.current
      const step = releaseStep(
        gesture.dy,
        gesture.vy,
        height,
        canSwipeNext,
        canSwipePrevious,
      )
      // PanResponder measures px/ms; the spring takes px/s.
      settleTo(placement.current + step, gesture.vy * 1000)
    },
    onPanResponderTerminate: () => {
      panning = false
      settleTo(placement.current, 0)
    },
  })

  return {
    panHandlers: responder.panHandlers,
    requestMove: (move, by) => {
      // The props still describe the page a running settle leaves, and a
      // finger on the pager, or on a child that holds it, owns the next move.
      if (settling != null || panning || holds.drag.size > 0) return false
      if (by === "feed" && holds.feedMove.size > 0) return false
      const { canSwipeNext, canSwipePrevious } = live.current
      if (move === "next" ? !canSwipeNext : !canSwipePrevious) return false
      cancelRest()
      setLatch(true)
      settleTo(placement.current + (move === "next" ? 1 : -1), 0)
      return true
    },
    layout: (next) => {
      if (!(next > 0) || next === height) return
      // A settle cut short here never reaches its own rest, so arm one below,
      // or the latch holds the next load until another swipe.
      const wasSettling = settling != null
      finishSettle()
      // The drag node takes the shift: the settle node is never written.
      const shift = -placement.current * (next - height)
      height = next
      if (shift !== 0) {
        grab += shift
        writeDrag(dragAt + shift)
      }
      rebase()
      showPlacement(placement)
      showHeight(next)
      if (wasSettling) armRest()
    },
    hold: (scope) => {
      const token = {}
      holds[scope].add(token)
      return () => {
        holds[scope].delete(token)
      }
    },
    dispose: () => {
      cancelRest()
      const run = settling
      settling = null
      panning = false
      holds.drag.clear()
      holds.feedMove.clear()
      run?.animation.stop()
      setLatch(false)
    },
  }
}

/**
 * `drag`: the child keeps every drag, and the feed's own moves wait.
 * `feedMove`: only the feed's own moves wait, so a clip end loops.
 */
export type ExplorePagerHoldScope = "drag" | "feedMove"

/** Holds the pager, and returns the one release; a second call does nothing. */
export type ExplorePagerHold = (scope: ExplorePagerHoldScope) => () => void

const ExplorePagerHoldContext = createContext<ExplorePagerHold | null>(null)

/** For a child that scrolls on the pager's axis: on Fabric iOS, a pager that
 *  takes the drag stops a nested scroll view. Null outside a pager. */
export function useExplorePagerHold(): ExplorePagerHold | null {
  return useContext(ExplorePagerHoldContext)
}

export function ExplorePager({
  ref,
  renderSlot,
  renderUnderlay,
  canSwipeNext,
  canSwipePrevious,
  onMove,
  onRest,
  onGestureLatchChange,
}: ExplorePagerProps) {
  const reduceMotion = useReduceMotion()
  const [placement, setPlacement] = useState(INITIAL_PLACEMENT)
  const [height, setHeight] = useState(() => Dimensions.get("window").height)

  // The responder is built once, so everything it reads lives in a ref.
  const liveProps: LiveProps = {
    canSwipeNext,
    canSwipePrevious,
    onMove,
    onRest,
    onGestureLatchChange,
    reduceMotion,
  }
  const live = useRef(liveProps)
  live.current = liveProps

  const drag = useRef(new Animated.Value(0)).current
  const settle = useRef(new Animated.Value(0)).current
  const engineRef = useRef<PagerEngine | null>(null)
  if (engineRef.current == null) {
    engineRef.current = createPagerEngine({
      drag,
      settle,
      live,
      initialHeight: height,
      showPlacement: setPlacement,
      showHeight: setHeight,
    })
  }
  const engine = engineRef.current

  // Dispose leaves only valid idle state, so StrictMode's remount needs no
  // restore step.
  useEffect(() => () => engine.dispose(), [engine])
  useImperativeHandle(
    ref,
    () => ({ requestMove: (move) => engine.requestMove(move, "feed") }),
    [engine],
  )

  const accessibility = useMemo<ExplorePagerAccessibility>(() => {
    const actions: ExplorePagerAccessibility["accessibilityActions"] = []
    if (canSwipeNext) {
      actions.push({ name: "next", label: EXPLORE_COPY.pagerActions.next })
    }
    if (canSwipePrevious) {
      actions.push({
        name: "previous",
        label: EXPLORE_COPY.pagerActions.previous,
      })
    }
    return {
      accessibilityActions: actions,
      onAccessibilityAction: (event) => {
        const name = event.nativeEvent.actionName
        if (name === "next" || name === "previous") {
          engine.requestMove(name, "viewer")
        }
      },
    }
  }, [canSwipeNext, canSwipePrevious, engine])

  const underlay = useMemo<ExplorePagerUnderlay>(
    () => ({
      pageStyle: (role) => [
        styles.slot,
        {
          height,
          transform: [{ translateY: roleOffset(role) * height }],
        },
      ],
    }),
    [height],
  )

  return (
    <View
      style={styles.root}
      onLayout={(event) => engine.layout(event.nativeEvent.layout.height)}
      {...engine.panHandlers}
    >
      <ExplorePagerHoldContext.Provider value={engine.hold}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { top: placement.settleTop, bottom: -placement.settleTop },
            { transform: [{ translateY: settle }] },
          ]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { top: placement.dragTop, bottom: -placement.dragTop },
              { transform: [{ translateY: drag }] },
            ]}
          >
            {renderUnderlay != null && (
              <View
                testID="explore-pager-underlay"
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {renderUnderlay(underlay)}
              </View>
            )}
            {EXPLORE_PAGER_SLOT_KEYS.map((key) => {
              const role = roleOf(placement, key)
              const isCurrent = role === "current"
              return (
                <View
                  key={key}
                  pointerEvents={isCurrent ? "auto" : "none"}
                  accessibilityElementsHidden={!isCurrent}
                  importantForAccessibility={
                    isCurrent ? "auto" : "no-hide-descendants"
                  }
                  style={underlay.pageStyle(role)}
                >
                  {renderSlot({
                    key,
                    role,
                    accessibility: isCurrent ? accessibility : null,
                  })}
                </View>
              )
            })}
          </Animated.View>
        </Animated.View>
      </ExplorePagerHoldContext.Provider>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  slot: { position: "absolute", top: 0, left: 0, right: 0 },
})
