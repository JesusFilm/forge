/**
 * The quiz window (U11, R16) and its close button (U8, R12) draw Liquid Glass
 * where iOS 26 offers it, and keep today's look everywhere else (R1).
 */
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))
jest.mock("react-native-webview", () => ({ WebView: () => null }))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}))
// jest-expo reports Liquid Glass as available, so each case pins the branch.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
// A host stand-in that renders its children, so the window's parts stay visible.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))

import { act } from "react"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import { getT } from "../../../i18n/useT"
import type { AdminBlock } from "../../../lib/queries"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { QuizButtonRenderer } from "../QuizButtonRenderer"

const SECTION = {
  __typename: "QuizButtonBlock",
  buttonText: "Take the quiz",
  iframeSrc: "https://www.nextstep.is/quiz",
} as unknown as AdminBlock

const OPEN_LABEL = getT("Sections")("openQuizAriaLabel")
const CLOSE_LABEL = getT("Common")("closeAriaLabel")
const CLOSE_TAP_NAME = "section-quiz-close"
// Today's quiz window and close button fills.
const WINDOW_FILL = "rgba(0, 0, 0, 0.9)"
const CLOSE_FILL = "rgba(255, 255, 255, 0.15)"
// The inset top from the mock above, plus the iOS gap.
const CLOSE_TOP = 47 + 8

beforeEach(() => {
  mockGate.glass = true
})

async function openQuiz(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<QuizButtonRenderer section={SECTION} />)
  })
  await press(pressableByLabel(renderer, OPEN_LABEL))
  return renderer
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

function ancestorsOf(node: RenderedNode): RenderedNode[] {
  const out: RenderedNode[] = []
  for (let at = node.parent ?? null; at != null; at = at.parent ?? null) {
    out.push(at)
  }
  return out
}

/** True when the host Text that reads `needle` sits inside `node`. */
function holdsText(node: RenderedNode, needle: string): boolean {
  return (node as unknown as TestInstance["root"])
    .findAll((child) => child.props.children === needle)
    .some((child) => typeof child.type === "string")
}

function modalNode(renderer: TestInstance): RenderedNode {
  const [modal] = renderer.root.findAll(
    (node) =>
      node.props.transparent === true &&
      typeof node.props.onRequestClose === "function",
  )
  expect(modal).toBeDefined()
  return modal!
}

/** The host view that carries the close button's tap name. */
function closeTarget(renderer: TestInstance): RenderedNode {
  const targets = hostNodes(
    renderer,
    (node) => node.props["dd-action-name"] === CLOSE_TAP_NAME,
  )
  expect(targets).toHaveLength(1)
  return targets[0]!
}

/** Today's size and place: 48 pt, top right, above the web view. */
function expectClosePlacement(target: RenderedNode) {
  expect(styleOf(target)).toMatchObject({
    position: "absolute",
    right: 16,
    top: CLOSE_TOP,
    width: 48,
    height: 48,
    zIndex: 10,
  })
}

describe("the quiz window on Liquid Glass (U11)", () => {
  it("draws the whole window on tinted glass in place of the black overlay", async () => {
    const renderer = await openQuiz()

    const windows = hostNodes(
      renderer,
      (node) =>
        node.type === "GlassView" &&
        !ancestorsOf(node).some((at) => at.type === "GlassView"),
    )
    expect(windows).toHaveLength(1)
    const window = windows[0]!
    expect(styleOf(window).flex).toBe(1)
    expect(window.props.tintColor).toBeUndefined()
    expect(window.props.colorScheme).toBe("dark")
    // The window is a panel, so a touch on it gets no press response.
    expect(window.props.isInteractive).toBeUndefined()
    // A fill on the glass covers the material.
    expect(styleOf(window).backgroundColor).toBeUndefined()
    expect(
      hostNodes(
        renderer,
        (node) => styleOf(node).backgroundColor === WINDOW_FILL,
      ),
    ).toHaveLength(0)
    // GlassView draws nothing under an ancestor whose opacity fades.
    for (const ancestor of ancestorsOf(window)) {
      expect(styleOf(ancestor).opacity).toBeUndefined()
    }
    await unmount(renderer)
  })

  it("keeps the Modal's own slide", async () => {
    const renderer = await openQuiz()
    expect(modalNode(renderer).props.animationType).toBe("slide")
    await unmount(renderer)
  })
})

describe("the quiz close button on Liquid Glass (U8)", () => {
  it("draws a glass circle inside the target, at today's size and place", async () => {
    const renderer = await openQuiz()

    const target = closeTarget(renderer)
    expectClosePlacement(target)
    expect(styleOf(target).backgroundColor).toBeUndefined()

    const circles = hostNodes(
      renderer,
      (node) => node.type === "GlassView" && ancestorsOf(node).includes(target),
    )
    expect(circles).toHaveLength(1)
    const circle = circles[0]!
    expect(styleOf(circle)).toMatchObject({
      width: 48,
      height: 48,
      borderRadius: 24,
    })
    expect(styleOf(circle).backgroundColor).toBeUndefined()
    expect(circle.props.colorScheme).toBe("dark")
    expect(circle.props.isInteractive).toBe(true)
    expect(holdsText(circle, "✕")).toBe(true)
    for (const ancestor of ancestorsOf(circle)) {
      expect(styleOf(ancestor).opacity).toBeUndefined()
    }
    await unmount(renderer)
  })

  it("still closes the window", async () => {
    const renderer = await openQuiz()
    await press(pressableByLabel(renderer, CLOSE_LABEL))
    expect(
      renderer.root.findAll(
        (node) => node.props["dd-action-name"] === CLOSE_TAP_NAME,
      ),
    ).toHaveLength(0)
    await unmount(renderer)
  })
})

describe("the quiz window without Liquid Glass (R1)", () => {
  beforeEach(() => {
    mockGate.glass = false
  })

  it("keeps today's black overlay and the Modal's own slide", async () => {
    const renderer = await openQuiz()

    expect(
      hostNodes(renderer, (node) => node.type === "GlassView"),
    ).toHaveLength(0)
    const windows = hostNodes(
      renderer,
      (node) => styleOf(node).backgroundColor === WINDOW_FILL,
    )
    expect(windows).toHaveLength(1)
    expect(styleOf(windows[0]!).flex).toBe(1)
    expect(ancestorsOf(closeTarget(renderer))).toContain(windows[0])
    expect(modalNode(renderer).props.animationType).toBe("slide")
    await unmount(renderer)
  })

  it("keeps today's translucent close circle at today's size and place", async () => {
    const renderer = await openQuiz()

    const target = closeTarget(renderer)
    expectClosePlacement(target)
    const circles = hostNodes(
      renderer,
      (node) =>
        styleOf(node).backgroundColor === CLOSE_FILL &&
        (node === target || ancestorsOf(node).includes(target)),
    )
    expect(circles).toHaveLength(1)
    expect(styleOf(circles[0]!)).toMatchObject({
      width: 48,
      height: 48,
      borderRadius: 24,
    })
    expect(holdsText(circles[0]!, "✕")).toBe(true)
    await unmount(renderer)
  })
})
