/** The shared top bar for My Watch and the three screens it opens (KTD2): a
 *  header title, an optional back control with a navigate fallback, and an
 *  optional trailing action. Every control is a 44pt target. */

// apps/mobile's tsconfig maps `react` to its .d.ts. These mocks re-point
// `react` at the real package (see apps/mobile/CLAUDE.md "Component render tests").
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
const mockIconRenders: string[] = []
const mockIconProps: { name: string; size: number; color: string }[] = []
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: (props: { name: string; size: number; color: string }) => {
    mockIconRenders.push(props.name)
    mockIconProps.push(props)
    return null
  },
}))
// jest-expo reports Liquid Glass as available, so each case pins the branch.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
// A host stand-in that renders its children, so the glyph inside is visible.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  navigate: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
}
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}))
const mockInsets = { top: 59, right: 0, bottom: 34, left: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))

import { act, type ReactElement } from "react"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import { ACCENT, TEXT_PRIMARY } from "../../../lib/color"
import { FLOATING_BACK_SIZE } from "../../../lib/playerLayout"
import { feedback } from "../../../styles/shared"
import { ScreenTopBar, type ScreenTopBarProps } from "../ScreenTopBar"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

async function render(props: ScreenTopBarProps): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<ScreenTopBar {...props} />)
  })
  return renderer
}

/** Host nodes only: a composite and its host carry the same props. */
function hostNodes(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
): RenderedNode[] {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

function styleOf(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}
}

function rootPaddingTop(renderer: TestInstance): number {
  const [root] = hostNodes(renderer, (node) => node.type === "View")
  return Number(styleOf(root).paddingTop ?? 0)
}

beforeEach(() => {
  mockRouter.back.mockReset()
  mockRouter.navigate.mockReset()
  mockRouter.push.mockReset()
  mockRouter.replace.mockReset()
  mockRouter.canGoBack.mockReset()
  mockRouter.canGoBack.mockReturnValue(true)
  mockIconRenders.length = 0
  mockIconProps.length = 0
  mockInsets.top = 59
  mockGate.glass = true
})

describe("ScreenTopBar", () => {
  it("renders the title as an accessibility header", async () => {
    const renderer = await render({ title: "My Watch" })

    const headers = hostNodes(
      renderer,
      (node) =>
        node.props.accessibilityRole === "header" &&
        node.props.children === "My Watch",
    )
    expect(headers).toHaveLength(1)
    await unmount(renderer)
  })

  it("gives both controls fixed tap names, so a translated label keeps one series", async () => {
    const renderer = await render({
      title: "Account",
      showBack: true,
      trailingAction: {
        icon: "menu",
        accessibilityLabel: "Más",
        onPress: () => {},
        actionName: "test-menu",
      },
    })

    // On the host node: a wrapper that drops the prop would fail here.
    const named = hostNodes(renderer, (node) => "dd-action-name" in node.props)
    expect(named.map((node) => node.props["dd-action-name"])).toEqual([
      "screen-top-bar-back",
      "test-menu",
    ])
    await unmount(renderer)
  })

  it("renders no header text when the title is omitted, and keeps the trailing action", async () => {
    const renderer = await render({
      trailingAction: {
        icon: "menu",
        accessibilityLabel: "More",
        onPress: () => {},
      },
    })

    expect(
      hostNodes(renderer, (node) => node.props.accessibilityRole === "header")
        .length,
    ).toBe(0)
    expect(hostNodes(renderer, (node) => node.type === "Text").length).toBe(0)
    expect(pressableByLabel(renderer, "More")).toBeDefined()
    await unmount(renderer)
  })

  it("overlay: floats over the page, backs only the status bar, and passes touches beside its controls", async () => {
    const onPress = jest.fn()
    const renderer = await render({
      overlay: true,
      trailingAction: { icon: "menu", accessibilityLabel: "More", onPress },
    })

    const [root] = hostNodes(renderer, (node) => node.type === "View")
    expect(styleOf(root).position).toBe("absolute")
    expect(root.props.pointerEvents).toBe("box-none")
    const backdrops = hostNodes(
      renderer,
      (node) =>
        node.type === "View" &&
        node.props.pointerEvents === "none" &&
        styleOf(node).height === mockInsets.top,
    )
    expect(backdrops.length).toBe(1)
    // Every non-control View lets a drag through to the page underneath.
    const blocking = hostNodes(
      renderer,
      (node) =>
        node.type === "View" &&
        typeof node.props.onClick !== "function" &&
        node.props.accessibilityRole !== "button" &&
        node.props.pointerEvents !== "box-none" &&
        node.props.pointerEvents !== "none",
    )
    expect(blocking.length).toBe(0)
    await press(pressableByLabel(renderer, "More"))
    expect(onPress).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("keeps a row in the layout when not overlaid", async () => {
    const renderer = await render({ title: "Downloads", showBack: true })

    const [root] = hostNodes(renderer, (node) => node.type === "View")
    expect(styleOf(root).position).toBeUndefined()
    await unmount(renderer)
  })

  it("renders no back control when none is asked for", async () => {
    const renderer = await render({ title: "My Watch" })

    expect(
      hostNodes(renderer, (node) => node.props.accessibilityLabel === "Go back")
        .length,
    ).toBe(0)
    expect(
      hostNodes(renderer, (node) => node.props.accessibilityRole === "button")
        .length,
    ).toBe(0)
    await unmount(renderer)
  })

  it("goes back when the stack can go back", async () => {
    mockRouter.canGoBack.mockReturnValue(true)
    const renderer = await render({ title: "Downloads", showBack: true })

    await press(pressableByLabel(renderer, "Go back"))

    expect(mockRouter.back).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("navigates to My Watch when the stack cannot go back (cold deep link)", async () => {
    mockRouter.canGoBack.mockReturnValue(false)
    const renderer = await render({ title: "Downloads", showBack: true })

    await press(pressableByLabel(renderer, "Go back"))

    expect(mockRouter.back).toHaveBeenCalledTimes(0)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledWith("/(tabs)/profile")
    // KTD12: navigate, never push or replace.
    expect(mockRouter.push).toHaveBeenCalledTimes(0)
    expect(mockRouter.replace).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("renders the trailing action with its own label and calls its handler", async () => {
    const onPress = jest.fn()
    const renderer = await render({
      title: "My Watch",
      trailingAction: { icon: "menu", accessibilityLabel: "More", onPress },
    })

    expect(mockIconRenders).toContain("menu")
    await press(pressableByLabel(renderer, "More"))

    expect(onPress).toHaveBeenCalledTimes(1)
    expect(mockRouter.navigate).toHaveBeenCalledTimes(0)
    await unmount(renderer)
  })

  it("keeps the back control and the trailing action at 44pt or more", async () => {
    const renderer = await render({
      title: "My Watch",
      showBack: true,
      trailingAction: {
        icon: "menu",
        accessibilityLabel: "More",
        onPress: () => {},
      },
    })

    for (const label of ["Go back", "More"]) {
      const [target] = hostNodes(
        renderer,
        (node) => node.props.accessibilityLabel === label,
      )
      const style = styleOf(target)
      expect(Number(style.width ?? style.minWidth)).toBeGreaterThanOrEqual(44)
      expect(Number(style.height ?? style.minHeight)).toBeGreaterThanOrEqual(44)
    }
    await unmount(renderer)
  })

  it("pads the top safe-area inset itself", async () => {
    mockInsets.top = 59
    const notched = await render({ title: "My Watch" })
    const notchedTop = rootPaddingTop(notched)
    await unmount(notched)

    mockInsets.top = 0
    const flat = await render({ title: "My Watch" })
    const flatTop = rootPaddingTop(flat)
    await unmount(flat)

    expect(notchedTop - flatTop).toBe(59)
  })
})

/** The back control's composite Pressable, which owns the render callback. */
function backPressable(renderer: TestInstance): RenderedNode {
  const [node] = renderer.root.findAll(
    (candidate) =>
      typeof candidate.type !== "string" &&
      candidate.props["dd-action-name"] === "screen-top-bar-back" &&
      typeof candidate.props.children === "function",
  )
  expect(node).toBeDefined()
  return node!
}

/** Renders the back control's content as it looks while a finger is down. */
async function renderPressedContent(renderer: TestInstance) {
  const content = backPressable(renderer).props.children as (state: {
    pressed: boolean
    hovered: boolean
  }) => ReactElement
  let pressed!: TestInstance
  await act(async () => {
    pressed = TestRenderer.create(content({ pressed: true, hovered: false }))
  })
  return pressed
}

function backTarget(renderer: TestInstance): RenderedNode {
  const [target] = hostNodes(
    renderer,
    (node) => node.props["dd-action-name"] === "screen-top-bar-back",
  )
  expect(target).toBeDefined()
  return target!
}

// FLOATING_BACK_SIZE: FloatingBackButton's glass circle, the reference look (R9).

describe("ScreenTopBar back control on Liquid Glass (R9)", () => {
  it("draws the floating back button's glass inside the 44pt target", async () => {
    const renderer = await render({ title: "Downloads", showBack: true })

    const target = backTarget(renderer)
    const glass = hostNodes(renderer, (node) => node.type === "GlassView")
    expect(glass).toHaveLength(1)
    // The glass sits inside the target that carries the tap name.
    let ancestor = glass[0]!.parent
    while (ancestor != null && ancestor !== target) ancestor = ancestor.parent
    expect(ancestor).toBe(target)

    const circle = styleOf(glass[0]!)
    expect(circle.width).toBe(FLOATING_BACK_SIZE)
    expect(circle.height).toBe(FLOATING_BACK_SIZE)
    expect(circle.borderRadius).toBe(FLOATING_BACK_SIZE / 2)
    // A fill on the glass covers it.
    expect(circle.backgroundColor).toBeUndefined()
    expect(glass[0]!.props.colorScheme).toBe("dark")
    expect(glass[0]!.props.isInteractive).toBe(true)

    expect(mockIconProps).toContainEqual({
      name: "chevron-back",
      size: 24,
      color: ACCENT,
    })
    const style = styleOf(target)
    expect(style.width).toBe(44)
    expect(style.height).toBe(44)
    await unmount(renderer)
  })

  it("puts the glass circle's edge on the content edge, as the floating back button does", async () => {
    const renderer = await render({ title: "Downloads", showBack: true })

    const pull = Number(styleOf(backTarget(renderer)).marginLeft ?? 0)
    expect(pull + (44 - FLOATING_BACK_SIZE) / 2).toBe(0)
    await unmount(renderer)
  })

  it("keeps a gap between the glass circle and the title", async () => {
    // The 40pt circle fills its 44pt target; without a margin the title
    // sat 2pt from the glass on the simulator.
    const renderer = await render({ title: "Downloads", showBack: true })

    const gap =
      (44 - FLOATING_BACK_SIZE) / 2 +
      Number(styleOf(backTarget(renderer)).marginRight ?? 0)
    expect(gap).toBeGreaterThanOrEqual(8)
    await unmount(renderer)
  })

  it("leaves the press to the glass and never dims the target", async () => {
    const renderer = await render({ title: "Downloads", showBack: true })

    // An opacity below 1 on any ancestor stops the glass drawing.
    expect(typeof backPressable(renderer).props.style).not.toBe("function")
    expect(styleOf(backTarget(renderer)).opacity).toBeUndefined()
    const pressed = await renderPressedContent(renderer)
    const [glass] = hostNodes(pressed, (node) => node.type === "GlassView")
    expect(glass!.props.isInteractive).toBe(true)
    expect(styleOf(glass!).transform).toBeUndefined()
    expect(
      hostNodes(pressed, (node) => styleOf(node).opacity != null),
    ).toHaveLength(0)
    await unmount(pressed)
    await unmount(renderer)
  })
})

describe("ScreenTopBar back control without Liquid Glass (R1)", () => {
  beforeEach(() => {
    mockGate.glass = false
  })

  it("keeps today's bare chevron, with no glass and no fill", async () => {
    const renderer = await render({ title: "Downloads", showBack: true })

    expect(
      hostNodes(renderer, (node) => node.type === "GlassView"),
    ).toHaveLength(0)
    expect(
      hostNodes(renderer, (node) => styleOf(node).backgroundColor != null)
        .length,
    ).toBe(1) // The bar's own ground, nothing inside the target.
    expect(mockIconProps).toContainEqual({
      name: "chevron-back",
      size: 28,
      color: TEXT_PRIMARY,
    })
    const style = styleOf(backTarget(renderer))
    expect(style.width).toBe(44)
    expect(style.height).toBe(44)
    // Today's pull lines the bare glyph up with the content edge.
    expect(style.marginLeft).toBe(-10)
    await unmount(renderer)
  })

  it("keeps today's press dim on the glyph", async () => {
    const renderer = await render({ title: "Downloads", showBack: true })

    const pressed = await renderPressedContent(renderer)
    const dimmed = hostNodes(pressed, (node) => styleOf(node).opacity === 0.85)
    expect(dimmed).toHaveLength(1)
    expect(
      hostNodes(pressed, (node) => styleOf(node).transform != null),
    ).toHaveLength(0)
    await unmount(pressed)
    await unmount(renderer)
  })
})

describe("ScreenTopBar trailing action on Liquid Glass", () => {
  const menu = {
    icon: "menu" as const,
    accessibilityLabel: "More",
    onPress: () => {},
    actionName: "test-menu",
  }

  /** Renders the trailing control's content as it looks while pressed. */
  async function pressedTrailing(renderer: TestInstance) {
    const [node] = renderer.root.findAll(
      (candidate) =>
        typeof candidate.type !== "string" &&
        candidate.props["dd-action-name"] === "test-menu" &&
        typeof candidate.props.children === "function",
    )
    const content = node!.props.children as (state: {
      pressed: boolean
      hovered: boolean
    }) => ReactElement
    let pressed!: TestInstance
    await act(async () => {
      pressed = TestRenderer.create(content({ pressed: true, hovered: false }))
    })
    return pressed
  }

  it("draws the action in the back button's glass circle, with Apple's press response", async () => {
    const renderer = await render({ trailingAction: menu })
    const glass = hostNodes(renderer, (node) => node.type === "GlassView")
    expect(glass).toHaveLength(1)
    const circle = styleOf(glass[0]!)
    expect([circle.width, circle.height, circle.borderRadius]).toEqual([
      FLOATING_BACK_SIZE,
      FLOATING_BACK_SIZE,
      FLOATING_BACK_SIZE / 2,
    ])
    expect(glass[0]!.props.isInteractive).toBe(true)
    expect(mockIconRenders).toContain("menu")
    // A style function on the target could dim it, and a dim stops the glass.
    const [target] = renderer.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props["dd-action-name"] === "test-menu" &&
        typeof node.props.children === "function",
    )
    expect(typeof target!.props.style).not.toBe("function")

    // An opacity below 1 on any ancestor stops the glass drawing.
    const pressed = await pressedTrailing(renderer)
    expect(
      hostNodes(pressed, (node) => styleOf(node).opacity != null),
    ).toHaveLength(0)
    await unmount(pressed)
    await unmount(renderer)
  })

  it("keeps the bare glyph without Liquid Glass, and dims it on a press", async () => {
    mockGate.glass = false
    const renderer = await render({ trailingAction: menu })
    expect(
      hostNodes(renderer, (node) => node.type === "GlassView"),
    ).toHaveLength(0)
    const pressed = await pressedTrailing(renderer)
    expect(
      hostNodes(pressed, (node) => styleOf(node).opacity != null).map(
        (node) => styleOf(node).opacity,
      ),
    ).toEqual([feedback.pressed.opacity])
    await unmount(pressed)
    await unmount(renderer)
  })
})
