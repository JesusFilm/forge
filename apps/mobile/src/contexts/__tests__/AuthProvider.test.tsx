/**
 * The provider's wiring, not the lifecycle's behaviour: the record's clear
 * must reach the progress lifecycle from here, because that lifecycle never
 * imports the record module (KTD5).
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("../../lib/datadog", () => ({
  setDatadogRumUser: jest.fn(),
}))
jest.mock("../../lib/authSession", () => {
  const snapshot = { status: "signedOut" as const }
  return {
    getAuthSession: () => ({
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      refresh: jest.fn(async () => {}),
    }),
    rumUserFromSession: () => null,
  }
})
jest.mock("../../lib/newAccountNotice", () => ({
  getNewAccountNotice: () => null,
  clearNewAccountNotice: jest.fn(),
}))
jest.mock("../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({
    hydrateFromSnapshot: jest.fn(async () => {}),
    hydrateFromServer: jest.fn(async () => {}),
    flushQueue: jest.fn(async () => {}),
  }),
  getSignedInAccountId: () => null,
}))
jest.mock("../../lib/watchProgress/store", () => ({
  resetToSignedOut: jest.fn(),
}))
jest.mock("../../lib/watchProgress/lifecycle", () => ({
  attachProgressLifecycle: jest.fn(() => jest.fn()),
}))
jest.mock("../../lib/lastWatched/store", () => {
  // One promise object, so identity proves the wiring hands the removal back.
  const removal = Promise.resolve()
  const clear = jest.fn(() => removal)
  return {
    getLastWatchedStore: () => ({ clear }),
    __clear: clear,
  }
})

import { StrictMode, act } from "react"

import { AuthProvider } from "../AuthProvider"
import { attachProgressLifecycle } from "../../lib/watchProgress/lifecycle"
import { getLastWatchedStore } from "../../lib/lastWatched/store"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const mockedAttach = jest.mocked(attachProgressLifecycle)

function render(strict = false): TestInstance {
  let renderer: TestInstance | null = null
  act(() => {
    const tree = <AuthProvider>{null}</AuthProvider>
    renderer = TestRenderer.create(
      strict ? <StrictMode>{tree}</StrictMode> : tree,
    )
  })
  return renderer as unknown as TestInstance
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("AuthProvider → progress lifecycle wiring", () => {
  it("passes a clearLastWatched dependency", () => {
    render()

    expect(mockedAttach).toHaveBeenCalledTimes(1)
    expect(typeof mockedAttach.mock.calls[0][0].clearLastWatched).toBe(
      "function",
    )
  })

  it("wires that dependency to the record store's own clear", () => {
    render()

    mockedAttach.mock.calls[0][0].clearLastWatched()

    expect(getLastWatchedStore().clear).toHaveBeenCalledTimes(1)
  })

  it("hands the clear's removal back, so the sign-out can await it", () => {
    render()

    expect(mockedAttach.mock.calls[0][0].clearLastWatched()).toBe(
      getLastWatchedStore().clear(),
    )
  })

  it("never clears the record just by mounting", () => {
    render()

    expect(getLastWatchedStore().clear).not.toHaveBeenCalled()
  })

  it("re-attaches a working lifecycle after a StrictMode remount", () => {
    const detach = jest.fn()
    mockedAttach.mockReturnValue(detach)

    render(true)

    expect(mockedAttach).toHaveBeenCalledTimes(2)
    expect(detach).toHaveBeenCalledTimes(1)
    mockedAttach.mock.calls[1][0].clearLastWatched()
    expect(getLastWatchedStore().clear).toHaveBeenCalledTimes(1)
  })
})
