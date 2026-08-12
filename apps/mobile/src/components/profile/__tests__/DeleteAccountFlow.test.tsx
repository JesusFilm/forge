/**
 * Deletion re-auth auto-retry wiring (U4/KTD5): the component arms the
 * decidePostReauth helper with the captured id and the refreshed snapshot,
 * so the helper stays REAL here — only authActions/authSession are mocked.
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
// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../../lib/authActions", () => ({
  signInWithHostedPage: jest.fn(),
  deleteAccount: jest.fn(),
}))
jest.mock("../../../lib/authSession", () => {
  let snapshot: unknown = { status: "signedIn", user: { id: "user-a" } }
  return {
    getAuthSession: () => ({
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    }),
    __setSnapshot: (next: unknown) => {
      snapshot = next
    },
  }
})

import { act } from "react"

import {
  DELETE_FAILED_MESSAGE,
  DELETE_UNCONFIRMED_MESSAGE,
  DeleteAccountFlow,
  REAUTH_FAILED_MESSAGE,
  REAUTH_PROMPT_MESSAGE,
  WRONG_ACCOUNT_MESSAGE,
} from "../DeleteAccountFlow"
import type { DeleteAccountOutcome } from "../../../lib/accountDeletion"
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
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const mockedSignIn = jest.mocked(signInWithHostedPage)
const mockedDelete = jest.mocked(deleteAccount)
const setSnapshot = (
  jest.requireMock("../../../lib/authSession") as {
    __setSnapshot: (next: unknown) => void
  }
).__setSnapshot

async function renderFlow(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<DeleteAccountFlow />)
  })
  expect(hasText(renderer, "Delete account")).toBe(true)
  return renderer
}

/** Entry → confirm → delete; the queued first outcome must be
 *  fresh-session-required so the flow lands in needsReauth. */
async function driveToNeedsReauth(renderer: TestInstance) {
  await press(pressableByLabel(renderer, "Delete account"))
  await press(pressableByLabel(renderer, "Permanently delete account"))
  expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(true)
}

beforeEach(() => {
  mockedSignIn.mockReset()
  mockedDelete.mockReset()
  setSnapshot({ status: "signedIn", user: { id: "user-a" } })
})

describe("DeleteAccountFlow re-auth auto-retry (U4)", () => {
  it("keeps the existing dd-action-name attributes", async () => {
    const renderer = await renderFlow()
    const entry = pressableByLabel(renderer, "Delete account")
    expect(entry.props["dd-action-name"]).toBe("delete-account-entry")
    await press(entry)
    const confirm = pressableByLabel(renderer, "Permanently delete account")
    expect(confirm.props["dd-action-name"]).toBe("delete-account-confirm")
    await unmount(renderer)
  })

  it("same-account re-auth auto-retries the deletion exactly once (AE4)", async () => {
    mockedDelete
      .mockResolvedValueOnce({ status: "fresh-session-required" })
      .mockResolvedValueOnce({ status: "deleted" })
    mockedSignIn.mockResolvedValue({ status: "success" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    expect(mockedDelete).toHaveBeenCalledTimes(1)

    await press(pressableByLabel(renderer, "Sign in again"))

    // Initial attempt + one auto-retry, nothing more.
    expect(mockedDelete).toHaveBeenCalledTimes(2)
    // The retry deleted the account: back to the idle entry row.
    expect(hasText(renderer, "Delete account")).toBe(true)
    expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(false)
    await unmount(renderer)
  })

  it("different-account re-auth never retries and explains (AE7)", async () => {
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockImplementation(async () => {
      setSnapshot({ status: "signedIn", user: { id: "user-b" } })
      return { status: "success" }
    })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, WRONG_ACCOUNT_MESSAGE)).toBe(true)
    await unmount(renderer)
  })

  it("a cancelled sheet stays in needsReauth with no retry", async () => {
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockResolvedValue({ status: "cancelled" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(true)
    expect(hasText(renderer, REAUTH_FAILED_MESSAGE)).toBe(false)
    await unmount(renderer)
  })

  it("a retryable sign-in failure shows copy distinct from the deletion-failure copy", async () => {
    expect(REAUTH_FAILED_MESSAGE).not.toBe(DELETE_FAILED_MESSAGE)
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockResolvedValue({ status: "error" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedDelete).toHaveBeenCalledTimes(1)
    expect(hasText(renderer, REAUTH_FAILED_MESSAGE)).toBe(true)
    expect(hasText(renderer, DELETE_FAILED_MESSAGE)).toBe(false)
    // Still retryable in place: the sign-in button remains.
    pressableByLabel(renderer, "Sign in again")
    await unmount(renderer)
  })

  it("wrong-account offers Try again, returns to needsReauth, and keeps the captured id", async () => {
    mockedDelete
      .mockResolvedValueOnce({ status: "fresh-session-required" })
      .mockResolvedValueOnce({ status: "deleted" })
    mockedSignIn.mockImplementationOnce(async () => {
      setSnapshot({ status: "signedIn", user: { id: "user-b" } })
      return { status: "success" }
    })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(hasText(renderer, WRONG_ACCOUNT_MESSAGE)).toBe(true)

    await press(pressableByLabel(renderer, "Try signing in again"))
    expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(true)

    // The ORIGINAL subject signs in this time: the captured id survived
    // the wrongAccount detour, so the deletion auto-retries.
    mockedSignIn.mockImplementationOnce(async () => {
      setSnapshot({ status: "signedIn", user: { id: "user-a" } })
      return { status: "success" }
    })
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(mockedDelete).toHaveBeenCalledTimes(2)
    await unmount(renderer)
  })

  it("a manual delete tap during an in-flight auto-retry is a no-op", async () => {
    let resolveRetry!: (outcome: DeleteAccountOutcome) => void
    mockedDelete
      .mockResolvedValueOnce({ status: "fresh-session-required" })
      .mockImplementationOnce(
        () =>
          new Promise<DeleteAccountOutcome>((resolve) => {
            resolveRetry = resolve
          }),
      )
    mockedSignIn.mockResolvedValue({ status: "success" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(hasText(renderer, "Deleting…")).toBe(true)

    // Direct onPress bypasses `disabled` — the ref guard must still hold.
    await press(pressableByLabel(renderer, "Permanently delete account"))
    expect(mockedDelete).toHaveBeenCalledTimes(2)

    resolveRetry({ status: "deleted" })
    await act(async () => {})
    expect(hasText(renderer, "Delete account")).toBe(true)
    await unmount(renderer)
  })

  it("a second Sign in again tap while the sheet is open does not relaunch", async () => {
    let resolveSignIn!: (outcome: SignInOutcome) => void
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockImplementationOnce(
      () =>
        new Promise<SignInOutcome>((resolve) => {
          resolveSignIn = resolve
        }),
    )
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(hasText(renderer, "Signing in…")).toBe(true)
    await press(pressableByLabel(renderer, "Sign in again"))

    expect(mockedSignIn).toHaveBeenCalledTimes(1)
    resolveSignIn({ status: "cancelled" })
    await act(async () => {})
    await unmount(renderer)
  })

  it("Cancel in needsReauth exits to idle without deleting anything", async () => {
    // The re-auth states used to offer only the button that deletes; a mis-tap
    // or a change of mind now has a non-destructive exit.
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Cancel deletion"))

    expect(hasText(renderer, "Delete account")).toBe(true)
    expect(hasText(renderer, REAUTH_PROMPT_MESSAGE)).toBe(false)
    expect(mockedDelete).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("a rejected deletion surfaces the error state instead of a stuck panel", async () => {
    // deleteAccount is contracted to resolve, but a rejection must release the
    // ref guard and show the retry — not pin the panel on "Deleting…" forever.
    mockedDelete.mockRejectedValueOnce(new Error("subscriber threw"))
    const renderer = await renderFlow()

    await press(pressableByLabel(renderer, "Delete account"))
    await press(pressableByLabel(renderer, "Permanently delete account"))

    expect(hasText(renderer, DELETE_FAILED_MESSAGE)).toBe(true)
    // Latch released — the retry actually re-enters the confirm state.
    await press(pressableByLabel(renderer, "Try deleting again"))
    expect(hasText(renderer, "Delete this account?")).toBe(true)
    await unmount(renderer)
  })

  it("a rejected re-auth sheet releases the latch and stays retryable", async () => {
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn
      .mockRejectedValueOnce(new Error("open threw"))
      .mockResolvedValueOnce({ status: "cancelled" })
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(hasText(renderer, REAUTH_FAILED_MESSAGE)).toBe(true)

    // The reauth ref released, so a second tap actually re-fires the sheet —
    // without the rejection handler it would stay pinned on "Signing in…".
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(mockedSignIn).toHaveBeenCalledTimes(2)
    await unmount(renderer)
  })

  it("shows the unconfirmed notice, distinct from the failed copy, and closes to idle", async () => {
    mockedDelete.mockResolvedValueOnce({ status: "unconfirmed" })
    const renderer = await renderFlow()

    await press(pressableByLabel(renderer, "Delete account"))
    await press(pressableByLabel(renderer, "Permanently delete account"))

    expect(hasText(renderer, DELETE_UNCONFIRMED_MESSAGE)).toBe(true)
    expect(hasText(renderer, DELETE_FAILED_MESSAGE)).toBe(false)
    await press(pressableByLabel(renderer, "Close"))
    expect(hasText(renderer, "Delete account")).toBe(true)
    await unmount(renderer)
  })

  it("does not auto-delete after the panel unmounts mid-sheet", async () => {
    let resolveSignIn!: (outcome: SignInOutcome) => void
    mockedDelete.mockResolvedValueOnce({ status: "fresh-session-required" })
    mockedSignIn.mockImplementationOnce(
      () =>
        new Promise<SignInOutcome>((resolve) => {
          resolveSignIn = resolve
        }),
    )
    const renderer = await renderFlow()

    await driveToNeedsReauth(renderer)
    await press(pressableByLabel(renderer, "Sign in again"))
    expect(mockedDelete).toHaveBeenCalledTimes(1)

    // A signed-out flip unmounts the panel while the sheet is still open.
    await unmount(renderer)

    // The sheet then resolves as the SAME subject. Without the alive guard the
    // callback would fire the irreversible delete off-screen; it must not.
    resolveSignIn({ status: "success" })
    await act(async () => {})
    expect(mockedDelete).toHaveBeenCalledTimes(1)
  })
})
