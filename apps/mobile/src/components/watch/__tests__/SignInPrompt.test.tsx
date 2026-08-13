/**
 * Hosted-auth wiring for the sign-in banner (U3/R2): busy guard, quiet
 * cancel + in-session re-arm, and the dismissible inline error.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package. The renderer is jest-expo's own transitive
 * react-test-renderer (KTD11: no new test dependencies).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

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
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../../lib/authActions", () => ({
  signInWithHostedPage: jest.fn(),
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
import AsyncStorage from "@react-native-async-storage/async-storage"

import { SignInPrompt } from "../SignInPrompt"
import {
  signInWithHostedPage,
  type SignInOutcome,
} from "../../../lib/authActions"
import {
  PROMPT_MIN_WATCHED_SECONDS,
  SIGN_IN_PROMPT_DISMISSED_AT_STORAGE_KEY,
  __resetSignInPromptSession,
  isSignInPromptArmed,
  noteSignedOutPlaybackStop,
} from "../../../lib/watchProgress/signInPrompt"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockedSignIn = jest.mocked(signInWithHostedPage)

async function renderArmedBanner(): Promise<TestInstance> {
  noteSignedOutPlaybackStop(PROMPT_MIN_WATCHED_SECONDS + 1)
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<SignInPrompt />)
  })
  // The show effect resolves the cooldown read async; flush it.
  await act(async () => {})
  expect(hasText(renderer, "Sign in")).toBe(true)
  return renderer
}

beforeEach(async () => {
  __resetSignInPromptSession()
  mockedSignIn.mockReset()
  await AsyncStorage.clear()
  jest.mocked(AsyncStorage.setItem).mockClear()
})

describe("SignInPrompt hosted-auth wiring (U3)", () => {
  it("keeps the existing dd-action-name attributes", async () => {
    const renderer = await renderArmedBanner()
    const accept = pressableByLabel(renderer, "Sign in")
    const dismiss = pressableByLabel(renderer, "Dismiss")
    expect(accept.props["dd-action-name"]).toBe("signin-prompt-accept")
    expect(dismiss.props["dd-action-name"]).toBe("signin-prompt-dismiss")
    await unmount(renderer)
  })

  it("a tap during an in-flight attempt does not launch a second flow", async () => {
    let resolveFlight!: (outcome: SignInOutcome) => void
    mockedSignIn.mockReturnValue(
      new Promise<SignInOutcome>((resolve) => {
        resolveFlight = resolve
      }),
    )
    const renderer = await renderArmedBanner()

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

  it("a cancelled attempt returns quietly and re-arms the banner in-session", async () => {
    mockedSignIn.mockResolvedValue({ status: "cancelled" })
    const renderer = await renderArmedBanner()
    expect(isSignInPromptArmed()).toBe(false) // shown → shot burned

    await press(pressableByLabel(renderer, "Sign in"))

    // Quiet: banner still up, idle label, no error UI (R2).
    expect(hasText(renderer, "Sign in")).toBe(true)
    expect(hasText(renderer, "Signing in…")).toBe(false)
    expect(hasText(renderer, "Something went wrong")).toBe(false)
    // Re-armed: a later remount in this session can show the banner again.
    expect(isSignInPromptArmed()).toBe(true)
    await unmount(renderer)
  })

  it("a successful sign-in does NOT re-arm the session shot", async () => {
    mockedSignIn.mockResolvedValue({ status: "success" })
    const renderer = await renderArmedBanner()
    expect(isSignInPromptArmed()).toBe(false) // shown → shot burned

    await press(pressableByLabel(renderer, "Sign in"))

    // Unlike a cancel, success must leave the shot burned — a later
    // remount in this session must not renudge a signed-in user.
    expect(isSignInPromptArmed()).toBe(false)
    await unmount(renderer)
  })

  it("a retryable error renders a dismissible inline message (AE6)", async () => {
    mockedSignIn.mockResolvedValue({ status: "error" })
    const renderer = await renderArmedBanner()

    await press(pressableByLabel(renderer, "Sign in"))
    expect(hasText(renderer, "Something went wrong")).toBe(true)

    // Dismissing the error returns to the banner so the user can retry.
    await press(pressableByLabel(renderer, "Dismiss"))
    expect(hasText(renderer, "Something went wrong")).toBe(false)
    expect(hasText(renderer, "Sign in")).toBe(true)
    await unmount(renderer)
  })

  it("an explicit dismiss still persists the cooldown", async () => {
    const renderer = await renderArmedBanner()

    await press(pressableByLabel(renderer, "Dismiss"))

    expect(hasText(renderer, "Sign in")).toBe(false)
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      SIGN_IN_PROMPT_DISMISSED_AT_STORAGE_KEY,
      expect.stringMatching(/^\d+$/),
    )
    // Dismiss burns the session shot again — no cancel-driven re-show race.
    expect(isSignInPromptArmed()).toBe(false)
    await unmount(renderer)
  })
})
