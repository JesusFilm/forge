/**
 * Hosted-auth wiring for the Profile sign-in CTA (U3/R2): busy guard,
 * quiet cancel back to the idle CTA, and the dismissible inline error.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package. The renderer is jest-expo's own transitive
 * react-test-renderer (KTD11: no new test dependencies).
 */

// No @types/node here (KTD11 forbids new test deps). A `declare const require`
// binding would trip babel-plugin-jest-hoist, so the ambient global is cast at
// each use to a shared type-only import (erased at runtime — hoist-safe).
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
// Ionicons requires native font modules at import time under jest. The mock
// logs each icon it renders, so a case can prove that no render drew an icon.
const mockIconRenders: string[] = []
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: ({ name }: { name: string }) => {
    mockIconRenders.push(name)
    return null
  },
}))
jest.mock("@datadog/mobile-react-native-session-replay", () => ({
  SessionReplayView: {
    MaskAll: ({ children }: { children?: unknown }) => children,
  },
}))
jest.mock("../../../lib/authActions", () => ({
  signInWithHostedPage: jest.fn(),
  signOut: jest.fn(),
  deleteAccount: jest.fn(),
}))
jest.mock("../../../lib/authSession", () => {
  // Stable snapshot identity — useSyncExternalStore loops on a fresh object.
  let snapshot: unknown = { status: "signedOut", user: null }
  const listeners = new Set<() => void>()
  return {
    getAuthSession: () => ({
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getSnapshot: () => snapshot,
    }),
    __setSnapshot: (next: unknown) => {
      snapshot = next
      listeners.forEach((listener) => listener())
    },
    // A failed case skips its unmount and stays subscribed. Drop it, so that
    // it cannot render into a later case's icon log.
    __resetSnapshot: (next: unknown) => {
      listeners.clear()
      snapshot = next
    },
  }
})
// jest-expo sets __DEV__ to true, so the real gate is open in every suite. This
// holder lets a case close it and counts the reads. Each case starts open.
const mockSignInGate = { open: true, calls: 0 }
jest.mock("../../../lib/signInGate", () => ({
  isSignInAvailable: () => {
    mockSignInGate.calls += 1
    return mockSignInGate.open
  },
}))

import { act } from "react"
import { StyleSheet, type StyleProp, type TextStyle } from "react-native"

import { AccountSection } from "../AccountSection"
import {
  deleteAccount,
  signInWithHostedPage,
  type SignInOutcome,
} from "../../../lib/authActions"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockedSignIn = jest.mocked(signInWithHostedPage)
const mockedDelete = jest.mocked(deleteAccount)
const { __setSnapshot: setSnapshot, __resetSnapshot: resetSnapshot } =
  jest.requireMock("../../../lib/authSession") as {
    __setSnapshot: (next: unknown) => void
    __resetSnapshot: (next: unknown) => void
  }

const SIGNED_OUT = { status: "signedOut", user: null } as const
const SIGNED_IN = {
  status: "signedIn",
  user: { id: "user-a", name: "Test Person", email: "tester@example.com" },
} as const

const GATED_TITLE = "Sign in (Coming soon)"
const GATED_SUBTITLE = "Accounts are not available yet"
const GATED_LABEL = "Sign in, coming soon, Accounts are not available yet"
const LIVE_TITLE = "Sign in"
const LIVE_SUBTITLE = "Keep your place across devices"

async function renderSection(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<AccountSection />)
  })
  return renderer
}

async function renderSignedOut(): Promise<TestInstance> {
  const renderer = await renderSection()
  expect(hasText(renderer, "Sign in")).toBe(true)
  return renderer
}

/** `hasText` matches substrings, and "Sign in" is inside the gated title. */
function hasExactText(renderer: TestInstance, text: string): boolean {
  return (
    renderer.root.findAll((node) => node.props.children === text).length > 0
  )
}

function firstWhere(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
): RenderedNode {
  const matches = renderer.root.findAll(predicate)
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

function styleOf(node: RenderedNode): TextStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<TextStyle>) ?? {}
}

beforeEach(() => {
  mockedSignIn.mockReset()
  mockedDelete.mockReset()
  mockSignInGate.open = true
  mockSignInGate.calls = 0
  mockIconRenders.length = 0
  resetSnapshot(SIGNED_OUT)
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

  it("two taps in ONE render cycle still launch only one flow (ref guard)", async () => {
    let resolveFlight!: (outcome: SignInOutcome) => void
    mockedSignIn.mockReturnValue(
      new Promise<SignInOutcome>((resolve) => {
        resolveFlight = resolve
      }),
    )
    const renderer = await renderSignedOut()
    const cta = pressableByLabel(renderer, "Sign in")

    // Both taps hit the SAME captured node inside ONE act — no re-render
    // between them, so a state-based `phase === "busy"` guard would read the
    // stale idle closure twice and fire twice. The ref guard makes the second
    // tap a no-op.
    await act(async () => {
      cta.props.onPress?.()
      cta.props.onPress?.()
    })

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    resolveFlight({ status: "cancelled" })
    await act(async () => {})
    await unmount(renderer)
  })

  it("a rejected sign-in falls to the dismissible error, not a stuck CTA", async () => {
    // The CTA reserves busy state before the call; a rejection must release it
    // via the rejection handler, not pin the CTA on "Signing in…".
    mockedSignIn.mockRejectedValueOnce(new Error("open threw"))
    const renderer = await renderSignedOut()

    await press(pressableByLabel(renderer, "Sign in"))

    expect(hasText(renderer, "Signing in…")).toBe(false)
    expect(hasText(renderer, "Something went wrong")).toBe(true)
    await press(pressableByLabel(renderer, "Dismiss"))
    expect(pressableByLabel(renderer, "Sign in").props.disabled).toBe(false)
    await unmount(renderer)
  })
})

// KTD6: each gated case closes the gate and keeps the person signed out, the
// one other condition that would show sign-in.
describe("AccountSection sign-in gate (feat-543)", () => {
  /** WCAG 2.x relative luminance, as in src/lib/__tests__/tabBar.test.ts. */
  function luminance([r, g, b]: number[]): number {
    const lin = (c: number) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  function ratio(a: number[], b: number[]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  function over(fg: number[], alpha: number, bg: number[]): number[] {
    return fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]))
  }
  function rgbOf(hex: unknown): number[] {
    const m = String(hex).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
    if (!m) throw new Error(`not a #rrggbb value: ${String(hex)}`)
    return [m[1], m[2], m[3]].map((part) => parseInt(part, 16))
  }

  it("gate closed, signed out: shows the Coming soon card, not the live one (AE1)", async () => {
    mockSignInGate.open = false
    const renderer = await renderSection()

    expect(hasExactText(renderer, GATED_TITLE)).toBe(true)
    expect(hasExactText(renderer, GATED_SUBTITLE)).toBe(true)
    expect(hasExactText(renderer, LIVE_TITLE)).toBe(false)
    expect(hasText(renderer, LIVE_SUBTITLE)).toBe(false)
    expect(
      renderer.root.findAll((node) => node.props.name === "chevron-forward"),
    ).toHaveLength(0)
    await unmount(renderer)
  })

  it("gate closed: the card is announced as disabled and a tap starts nothing (AE1, R6)", async () => {
    mockSignInGate.open = false
    const renderer = await renderSection()
    // Found by label: pressableByLabel needs an onPress, which this card lacks.
    const card = renderer.root.findAll(
      (node) => node.props.accessibilityLabel === GATED_LABEL,
    )

    expect(card.length).toBeGreaterThan(0)
    expect(card[0].props.disabled).toBe(true)
    expect(card[0].props.accessibilityState).toEqual({ disabled: true })
    expect(
      renderer.root.findAll((node) => node.props["dd-action-name"] != null),
    ).toHaveLength(0)
    expect(
      renderer.root.findAll((node) => typeof node.props.onPress === "function"),
    ).toHaveLength(0)
    for (const node of card) await press(node)
    expect(mockedSignIn).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("gate closed: dims the icon and title, not the subtitle (R5)", async () => {
    mockSignInGate.open = false
    const renderer = await renderSection()
    const icon = firstWhere(
      renderer,
      (node) => node.props.name === "person-circle-outline",
    )
    const title = firstWhere(
      renderer,
      (node) => node.props.children === GATED_TITLE,
    )
    const subtitle = firstWhere(
      renderer,
      (node) => node.props.children === GATED_SUBTITLE,
    )

    expect(styleOf(icon).opacity).toBe(0.5)
    expect(styleOf(title).opacity).toBe(0.5)
    expect(styleOf(subtitle).opacity).toBeUndefined()
    await unmount(renderer)
  })

  it("gate closed: the dimmed title keeps 4.5:1 on the card surface (R5)", async () => {
    mockSignInGate.open = false
    const renderer = await renderSection()
    const card = styleOf(
      firstWhere(
        renderer,
        (node) => node.props.accessibilityLabel === GATED_LABEL,
      ),
    )
    const title = styleOf(
      firstWhere(renderer, (node) => node.props.children === GATED_TITLE),
    )
    const subtitle = styleOf(
      firstWhere(renderer, (node) => node.props.children === GATED_SUBTITLE),
    )
    const surface = rgbOf(card.backgroundColor)
    const dim = Number(title.opacity)

    expect(
      ratio(over(rgbOf(title.color), dim, surface), surface),
    ).toBeGreaterThanOrEqual(4.5)
    // The same dim drops the subtitle below the floor. This is why the
    // subtitle keeps full strength.
    expect(
      ratio(over(rgbOf(subtitle.color), dim, surface), surface),
    ).toBeLessThan(4.5)
    await unmount(renderer)
  })

  it("gate open, signed out: shows the live card and no gated copy (R11)", async () => {
    const renderer = await renderSection()

    expect(hasExactText(renderer, LIVE_TITLE)).toBe(true)
    expect(hasText(renderer, LIVE_SUBTITLE)).toBe(true)
    expect(mockIconRenders).toContain("chevron-forward")
    expect(hasText(renderer, "Coming soon")).toBe(false)
    expect(hasText(renderer, GATED_SUBTITLE)).toBe(false)
    const icon = firstWhere(
      renderer,
      (node) => node.props.name === "person-circle-outline",
    )
    expect(styleOf(icon).opacity).toBeUndefined()
    await unmount(renderer)
  })

  it("gate closed, signed in: identity, sign-out and deletion do not change (AE5, R8)", async () => {
    mockSignInGate.open = false
    setSnapshot(SIGNED_IN)
    const renderer = await renderSection()

    expect(hasExactText(renderer, SIGNED_IN.user.name)).toBe(true)
    expect(hasExactText(renderer, SIGNED_IN.user.email)).toBe(true)
    expect(pressableByLabel(renderer, "Sign out").props.disabled).toBe(false)
    expect(pressableByLabel(renderer, "Delete account")).toBeDefined()
    expect(hasText(renderer, "Coming soon")).toBe(false)
    expect(hasText(renderer, GATED_SUBTITLE)).toBe(false)
    expect(mockSignInGate.calls).toBe(0)
    await unmount(renderer)
  })

  it("gate closed, signed in: Sign in again inside deletion still opens the sheet (AE5, R9)", async () => {
    mockSignInGate.open = false
    setSnapshot(SIGNED_IN)
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockResolvedValue({ status: "cancelled" })
    const renderer = await renderSection()

    await press(pressableByLabel(renderer, "Delete account"))
    await press(pressableByLabel(renderer, "Permanently delete account"))
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("gate closed: signing out shows the disabled card, never the live one (AE6, AE10)", async () => {
    mockSignInGate.open = false
    setSnapshot(SIGNED_IN)
    const renderer = await renderSection()
    expect(pressableByLabel(renderer, "Sign out")).toBeDefined()

    await act(async () => {
      setSnapshot(SIGNED_OUT)
    })

    expect(hasExactText(renderer, GATED_TITLE)).toBe(true)
    expect(hasText(renderer, "Delete account")).toBe(false)
    expect(hasText(renderer, "Sign out")).toBe(false)
    expect(hasExactText(renderer, LIVE_TITLE)).toBe(false)
    // Only the live card draws a chevron, so the log shows no render drew it.
    expect(mockIconRenders).not.toContain("chevron-forward")
    await unmount(renderer)
  })

  it("gate closed, cold launch: the disabled card shows from the first render until the session read lands (AE8, AE9)", async () => {
    mockSignInGate.open = false
    const renderer = await renderSection()

    // The log covers every render, the first one too. A gate that settles in
    // an effect draws the live card once, and that fails here.
    expect(mockIconRenders[0]).toBe("person-circle-outline")
    expect(mockIconRenders).not.toContain("chevron-forward")
    expect(hasExactText(renderer, GATED_TITLE)).toBe(true)

    await act(async () => {
      setSnapshot(SIGNED_IN)
    })

    expect(pressableByLabel(renderer, "Sign out")).toBeDefined()
    expect(hasText(renderer, "Coming soon")).toBe(false)
    expect(mockIconRenders).not.toContain("chevron-forward")
    await unmount(renderer)
  })
})
