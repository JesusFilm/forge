/**
 * Hosted-auth wiring for the Profile sign-in CTA (U3/R2): busy guard,
 * quiet cancel back to the idle CTA, and the dismissible inline error.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package. The renderer is jest-expo's own transitive
 * react-test-renderer (KTD11: no new test dependencies).
 */

// No @types/node here (KTD11 forbids new test deps) — type locally. A
// `declare const require` binding would trip babel-plugin-jest-hoist, so
// the ambient global is cast at each use instead.
type NodeRequireLike = {
  (id: string): unknown
  resolve: (request: string, options?: { paths?: string[] }) => string
}
type NodePath = {
  dirname: (p: string) => string
  join: (...parts: string[]) => string
}

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  // `react/package.json` escapes the `^react$` mapping and finds the package.
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
jest.mock("@datadog/mobile-react-native-session-replay", () => ({
  SessionReplayView: { MaskAll: () => null },
}))
jest.mock("../../../lib/authActions", () => ({
  signInWithHostedPage: jest.fn(),
  signOut: jest.fn(),
  deleteAccount: jest.fn(),
}))
jest.mock("../../../lib/authSession", () => {
  // Stable snapshot identity — useSyncExternalStore loops on a fresh object.
  const snapshot = { status: "signedOut" as const }
  return {
    getAuthSession: () => ({
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    }),
  }
})

import { act } from "react"

import { AccountSection } from "../AccountSection"
import {
  signInWithHostedPage,
  type SignInOutcome,
} from "../../../lib/authActions"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockedSignIn = jest.mocked(signInWithHostedPage)

async function renderSignedOut(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<AccountSection />)
  })
  expect(hasText(renderer, "Sign in")).toBe(true)
  return renderer
}

beforeEach(() => {
  mockedSignIn.mockReset()
})

describe("AccountSection hosted-auth wiring (U3)", () => {
  it("keeps the existing dd-action-name on the signed-out CTA", async () => {
    const renderer = await renderSignedOut()
    const cta = pressableByLabel(renderer, "Sign in")
    expect(cta.props["dd-action-name"]).toBe("profile-sign-in")
    await unmount(renderer)
  })

  it("a tap during an in-flight attempt does not launch a second flow", async () => {
    let resolveFlight!: (outcome: SignInOutcome) => void
    mockedSignIn.mockReturnValue(
      new Promise<SignInOutcome>((resolve) => {
        resolveFlight = resolve
      }),
    )
    const renderer = await renderSignedOut()

    await press(pressableByLabel(renderer, "Sign in"))
    expect(hasText(renderer, "Signing in…")).toBe(true)
    // Second tap invokes the handler directly, bypassing `disabled` — the
    // component-level busy guard must still make it a no-op.
    await press(pressableByLabel(renderer, "Sign in"))

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    resolveFlight({ status: "cancelled" })
    await act(async () => {})
    await unmount(renderer)
  })

  it("a cancelled attempt returns quietly to the idle CTA (R2)", async () => {
    mockedSignIn.mockResolvedValue({ status: "cancelled" })
    const renderer = await renderSignedOut()

    await press(pressableByLabel(renderer, "Sign in"))

    expect(hasText(renderer, "Signing in…")).toBe(false)
    expect(hasText(renderer, "Something went wrong")).toBe(false)
    expect(pressableByLabel(renderer, "Sign in").props.disabled).toBe(false)
    await unmount(renderer)
  })

  it("a retryable error renders a dismissible inline message (AE6)", async () => {
    mockedSignIn.mockResolvedValue({ status: "error" })
    const renderer = await renderSignedOut()

    await press(pressableByLabel(renderer, "Sign in"))
    expect(hasText(renderer, "Something went wrong")).toBe(true)

    // Dismissing returns to the idle CTA so the user can retry.
    await press(pressableByLabel(renderer, "Dismiss"))
    expect(hasText(renderer, "Something went wrong")).toBe(false)
    expect(pressableByLabel(renderer, "Sign in").props.disabled).toBe(false)
    await unmount(renderer)
  })
})
