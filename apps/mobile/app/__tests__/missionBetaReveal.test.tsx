/**
 * R31's hidden reveal on the mission screen. A hold of five seconds on "Become
 * a beta tester" shows the notification test ID; any shorter press still opens
 * the signup page. The press runs through React Native's own Pressability
 * timers, driven by responder events on the button's host view, so this suite
 * fails if the hold length or the press-versus-hold split changes.
 */

jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({}) }))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../src/components/ui/FloatingBackButton", () => ({
  FloatingBackButton: () => null,
}))
jest.mock("../../src/lib/openExternalUrl", () => ({
  openExternalUrl: jest.fn(),
}))
jest.mock("../../src/lib/push/testIdReveal", () => ({
  revealPushTestId: jest.fn(async () => {}),
}))

import { act } from "react"

import MissionScreen from "../mission"
import { BETA_SIGNUP_URL } from "../../src/components/home/missionContent"
import { openExternalUrl } from "../../src/lib/openExternalUrl"
import { PUSH_TEST_ID_REVEAL_HOLD_MS } from "../../src/lib/push/constants"
import { revealPushTestId } from "../../src/lib/push/testIdReveal"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"

// The English catalog text (`Mission.betaCta`), written out so a broken key
// cannot pass.
const BETA_CTA_LABEL = "Become a beta tester"

const mockedOpen = jest.mocked(openExternalUrl)
const mockedReveal = jest.mocked(revealPushTestId)

type ResponderHandler = (event: unknown) => void

let renderer: TestInstance | null = null

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(async () => {
  if (renderer != null) await unmount(renderer)
  renderer = null
  jest.useRealTimers()
  mockedOpen.mockClear()
  mockedReveal.mockClear()
})

async function renderMission(): Promise<TestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(<MissionScreen />)
  })
  return renderer!
}

/** The beta button's HOST view: the one Pressability gives its responder props. */
function betaHostView(instance: TestInstance): RenderedNode {
  const hosts = instance.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === BETA_CTA_LABEL &&
      typeof node.props.onResponderGrant === "function",
  )
  expect(hosts).toHaveLength(1)
  return hosts[0]
}

function responderEvent() {
  const nativeEvent = {
    locationX: 10,
    locationY: 10,
    pageX: 100,
    pageY: 400,
    timestamp: Date.now(),
    touches: [],
    changedTouches: [],
  }
  return {
    nativeEvent,
    currentTarget: { measure: () => {} },
    persist: () => {},
  }
}

async function holdFor(node: RenderedNode, ms: number) {
  const grant = node.props.onResponderGrant as ResponderHandler
  const release = node.props.onResponderRelease as ResponderHandler
  await act(async () => {
    grant(responderEvent())
  })
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
  await act(async () => {
    release(responderEvent())
  })
}

describe("the mission screen's beta button", () => {
  it("waits five seconds, the length the product asked for", () => {
    expect(PUSH_TEST_ID_REVEAL_HOLD_MS).toBe(5_000)
  })

  it("reveals the test ID after a five-second hold, and does not open signup", async () => {
    const instance = await renderMission()

    await holdFor(betaHostView(instance), PUSH_TEST_ID_REVEAL_HOLD_MS)

    expect(mockedReveal).toHaveBeenCalledTimes(1)
    expect(mockedOpen).not.toHaveBeenCalled()
  })

  it("opens signup and reveals nothing when the hold ends a moment early", async () => {
    const instance = await renderMission()

    await holdFor(betaHostView(instance), PUSH_TEST_ID_REVEAL_HOLD_MS - 1)

    expect(mockedReveal).not.toHaveBeenCalled()
    expect(mockedOpen).toHaveBeenCalledTimes(1)
    expect(mockedOpen).toHaveBeenCalledWith(BETA_SIGNUP_URL)
  })

  it("keeps a quick tap on the signup page", async () => {
    const instance = await renderMission()

    await holdFor(betaHostView(instance), 100)

    expect(mockedReveal).not.toHaveBeenCalled()
    expect(mockedOpen).toHaveBeenCalledWith(BETA_SIGNUP_URL)
  })
})
