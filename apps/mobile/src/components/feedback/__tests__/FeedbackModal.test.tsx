/**
 * The player door's sheet host (U6, KTD4): an RN Modal that opens the shared
 * form body on step two, refuses every dismissal while a submission is in
 * flight (R19), and registers with the non-route sheet counter (R11).
 *
 * The real `FeedbackSheetContent` renders inside it — only the Apollo client is
 * replaced — so the lock this host obeys is the one a real send produces.
 */

// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../../lib/apolloClient", () => ({
  getApolloClient: jest.fn(),
}))
// Getters, not plain values: Babel's namespace interop COPIES the module at
// import time, so a plain object would freeze at its defaults.
jest.mock("expo-application", () => ({
  __esModule: true,
  get nativeApplicationVersion() {
    return "1.4.2"
  },
  get nativeBuildVersion() {
    return "31"
  },
}))
jest.mock("expo-device", () => ({
  __esModule: true,
  get modelName() {
    return "iPhone17,2"
  },
}))

import { act } from "react"
import { AccessibilityInfo } from "react-native"

import { FeedbackModal } from "../FeedbackModal"
import {
  FEEDBACK_COMPOSE_HEADING,
  FEEDBACK_PICK_KIND_HEADING,
  type FeedbackSheetContext,
} from "../feedbackFlow"
import { getApolloClient } from "../../../lib/apolloClient"
import { getNonRouteSheetCounter } from "../../../lib/miniPlayer/suppression"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const PLAYER_CONTEXT: FeedbackSheetContext = {
  kind: "BROKEN",
  video: {
    title: "JESUS",
    positionSeconds: 4324,
    slug: "jesus",
    languageSlug: "english",
  },
}

const VALID_MESSAGE = "The audio stops after the first minute."

const mutate = jest.fn()
const mockedGetApolloClient = jest.mocked(getApolloClient)

beforeEach(() => {
  jest.useFakeTimers()
  mutate.mockReset()
  mutate.mockResolvedValue({
    data: { submitFeedback: { accepted: true, refusal: null } },
  })
  mockedGetApolloClient.mockReset()
  mockedGetApolloClient.mockReturnValue({
    mutate,
  } as unknown as ReturnType<typeof getApolloClient>)
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => {})
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation(
      () =>
        ({ remove: jest.fn() }) as unknown as ReturnType<
          typeof AccessibilityInfo.addEventListener
        >,
    )
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function render(onClose: jest.Mock = jest.fn()) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <FeedbackModal context={PLAYER_CONTEXT} onClose={onClose} />,
    )
  })
  return { renderer, onClose }
}

/** Comfortably past the exit duration; the exact value is the host's business. */
async function runExitAnimation() {
  await act(async () => {
    jest.advanceTimersByTime(400)
  })
}

function modalNode(renderer: TestInstance): RenderedNode {
  const modals = renderer.root.findAll(
    (n) =>
      n.props.transparent === true &&
      typeof n.props.onRequestClose === "function",
  )
  expect(modals.length).toBeGreaterThan(0)
  return modals[0]
}

async function requestClose(renderer: TestInstance) {
  await act(async () => {
    ;(modalNode(renderer).props.onRequestClose as () => void)()
  })
}

/** Types a valid message and sends, leaving the request unsettled. */
async function startSend(renderer: TestInstance) {
  mutate.mockReturnValue(new Promise(() => {}))
  const input = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "Your message" &&
      typeof node.props.onChangeText === "function",
  )[0]
  await act(async () => {
    ;(input.props.onChangeText as (next: string) => void)(VALID_MESSAGE)
  })
  await press(pressableByLabel(renderer, "Send feedback"))
}

describe("presentation", () => {
  it("allows both orientations, so it can open over the fullscreen player", async () => {
    // Fullscreen locks the app to landscape while RN's Modal defaults to
    // portrait-only; no common orientation aborts the app in UIKit.
    const { renderer } = await render()
    expect(modalNode(renderer).props.supportedOrientations).toEqual(
      expect.arrayContaining(["portrait", "landscape"]),
    )
    await unmount(renderer)
  })

  it("animates nothing itself, so the scrim and panel can differ", async () => {
    const { renderer } = await render()
    expect(modalNode(renderer).props.animationType).toBe("none")
    await unmount(renderer)
  })
})

describe("context (R2/R6/AE1)", () => {
  it("opens on step two with the kind preset and the video tag", async () => {
    const { renderer } = await render()
    expect(hasText(renderer, FEEDBACK_COMPOSE_HEADING)).toBe(true)
    expect(hasText(renderer, FEEDBACK_PICK_KIND_HEADING)).toBe(false)
    expect(hasText(renderer, "Something's broken")).toBe(true)
    expect(hasText(renderer, "About: JESUS at 1:12:04")).toBe(true)
    await unmount(renderer)
  })

  it("sends the person back to step one on Back, and never closes", async () => {
    // KTD5: Back belongs to the form. Closing here would drop them onto the
    // player, and re-opening the settings sheet would be a third destination.
    const { renderer, onClose } = await render()
    await press(pressableByLabel(renderer, "Back"))
    expect(hasText(renderer, FEEDBACK_PICK_KIND_HEADING)).toBe(true)
    await runExitAnimation()
    expect(onClose).not.toHaveBeenCalled()
    await unmount(renderer)
  })
})

describe("dismissal (R19/AE10)", () => {
  it("closes on the system back, after the exit animation", async () => {
    const { renderer, onClose } = await render()
    await requestClose(renderer)
    expect(onClose).not.toHaveBeenCalled()
    await runExitAnimation()
    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("closes on a backdrop tap, after the exit animation", async () => {
    const { renderer, onClose } = await render()
    await press(pressableByLabel(renderer, "Dismiss feedback"))
    expect(onClose).not.toHaveBeenCalled()
    await runExitAnimation()
    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("ignores the system back and the backdrop while sending", async () => {
    const { renderer, onClose } = await render()
    await startSend(renderer)
    expect(hasText(renderer, "Sending…")).toBe(true)

    await requestClose(renderer)
    await press(pressableByLabel(renderer, "Dismiss feedback"))
    await runExitAnimation()
    expect(onClose).not.toHaveBeenCalled()
    // Still the form, not a torn-down sheet.
    expect(hasText(renderer, FEEDBACK_COMPOSE_HEADING)).toBe(true)
    await unmount(renderer)
  })
})

describe("suppression (R11)", () => {
  it("presents a non-route sheet while open and releases it on close", async () => {
    const counter = getNonRouteSheetCounter()
    expect(counter.count()).toBe(0)
    const { renderer } = await render()
    expect(counter.isPresented()).toBe(true)
    await unmount(renderer)
    expect(counter.count()).toBe(0)
  })
})
