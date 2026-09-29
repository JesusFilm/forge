/**
 * R21's message surface. The tap handler publishes from a timer or a native
 * listener, so the host must show a notice that was published BEFORE it
 * mounted — which is what a cold tap does.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package.
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
// A REAL inset, not 0: at bottom 0 a geometry defect is invisible.
const mockInsets = { top: 59, bottom: 34, left: 0, right: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
let mockSegments: string[] = ["(tabs)", "index"]
jest.mock("expo-router", () => ({
  useSegments: () => mockSegments,
}))

import { act } from "react"

import { PUSH_UNRESOLVABLE_DESTINATION_MESSAGE } from "../../lib/push/copy"
import {
  clearPushNotice,
  publishPushNotice,
  resetPushNoticesForTests,
} from "../../lib/push/notice"
import {
  TestRenderer,
  hasText,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import { PushNoticeHost } from "../PushNoticeHost"

/** Every renderer this file made, so each one is unmounted before teardown. */
const mounted: TestInstance[] = []

async function renderHost(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<PushNoticeHost />)
  })
  mounted.push(renderer)
  return renderer
}

beforeEach(() => {
  resetPushNoticesForTests()
  mockSegments = ["(tabs)", "index"]
})

afterEach(async () => {
  // A visible Snackbar arms its own REAL auto-dismiss timer, and the unmount
  // cleanup is what clears it. Left armed, it fires after Jest has torn the
  // module registry down and crashes the worker on an undefined `Animated`.
  await act(async () => {
    for (const renderer of mounted.splice(0, mounted.length)) renderer.unmount()
  })
})

describe("the push notice host", () => {
  it("renders nothing while there is no notice", async () => {
    const renderer = await renderHost()

    expect(renderer.toJSON()).toBeNull()
  })

  it("shows a notice published after it mounted", async () => {
    const renderer = await renderHost()

    await act(async () => {
      publishPushNotice(PUSH_UNRESOLVABLE_DESTINATION_MESSAGE)
    })

    expect(hasText(renderer, PUSH_UNRESOLVABLE_DESTINATION_MESSAGE)).toBe(true)
  })

  it("shows a notice published BEFORE it mounted (the cold tap)", async () => {
    // The tap handler runs from the last-response read, which can settle before
    // this host's first render. A channel with no buffer loses that notice.
    publishPushNotice(PUSH_UNRESOLVABLE_DESTINATION_MESSAGE)

    const renderer = await renderHost()

    expect(hasText(renderer, PUSH_UNRESOLVABLE_DESTINATION_MESSAGE)).toBe(true)
  })

  it("stops rendering once the notice is cleared", async () => {
    publishPushNotice(PUSH_UNRESOLVABLE_DESTINATION_MESSAGE)
    const renderer = await renderHost()

    await act(async () => {
      clearPushNotice()
    })

    expect(renderer.toJSON()).toBeNull()
  })

  it("replaces a showing notice with the newer one", async () => {
    publishPushNotice("first")
    const renderer = await renderHost()

    await act(async () => {
      publishPushNotice("second")
    })

    expect(hasText(renderer, "second")).toBe(true)
    expect(hasText(renderer, "first")).toBe(false)
  })

  it("ignores an empty message rather than showing a blank bar", async () => {
    const renderer = await renderHost()

    await act(async () => {
      publishPushNotice("")
    })

    expect(renderer.toJSON()).toBeNull()
  })
})
