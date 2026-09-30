/**
 * R31's reveal: the alert a five-second hold on the mission screen's beta
 * button shows. The alert is built from the registration store's snapshot, so
 * one case runs the REAL store over an in-memory storage to prove the reveal
 * reads the stored ID and not the empty snapshot a launch starts with.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }))

import { Alert, type AlertButton } from "react-native"

import {
  PUSH_REGISTRATION_RECORD_VERSION,
  PUSH_REGISTRATION_STORAGE_KEY,
  PUSH_TEST_ID_ALERT_TITLE,
  PUSH_TEST_ID_CLOSE_ACTION,
  PUSH_TEST_ID_COPY_ACTION,
  PUSH_TEST_ID_HELP,
  PUSH_TEST_ID_NOTIFICATIONS_OFF,
  PUSH_TEST_ID_REGISTERING,
} from "../constants"
import {
  createPushRegistrationStore,
  getPushRegistrationStore,
  resetPushRegistrationStoreForTests,
  type PushRegistrationSnapshot,
} from "../store"
import {
  pushTestIdAlert,
  revealPushTestId,
  type PushTestIdRevealDeps,
} from "../testIdReveal"

const TEST_ID = "k3v9x2m7q4"

function snapshot(
  overrides: Partial<PushRegistrationSnapshot> = {},
): PushRegistrationSnapshot {
  return { testDeviceId: TEST_ID, permission: "granted", ...overrides }
}

function labels(buttons: AlertButton[]): Array<string | undefined> {
  return buttons.map((button) => button.text)
}

describe("pushTestIdAlert", () => {
  it("shows the ID with the help line, and offers Close and Copy", () => {
    const alert = pushTestIdAlert(snapshot())

    expect(alert.title).toBe(PUSH_TEST_ID_ALERT_TITLE)
    expect(alert.message).toBe(`${TEST_ID}\n\n${PUSH_TEST_ID_HELP}`)
    expect(labels(alert.buttons)).toEqual([
      PUSH_TEST_ID_CLOSE_ACTION,
      PUSH_TEST_ID_COPY_ACTION,
    ])
    expect(alert.buttons[0].style).toBe("cancel")
  })

  it("copies exactly the shown ID when Copy is pressed", () => {
    const copy = jest.fn()
    const alert = pushTestIdAlert(snapshot(), copy)

    alert.buttons[1].onPress?.()

    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy).toHaveBeenCalledWith(TEST_ID)
  })

  it("does nothing but close when Close is pressed", () => {
    const copy = jest.fn()
    const alert = pushTestIdAlert(snapshot(), copy)

    alert.buttons[0].onPress?.()

    expect(copy).not.toHaveBeenCalled()
  })

  it("still shows a stored ID while permission is denied, with the denial note", () => {
    const alert = pushTestIdAlert(snapshot({ permission: "denied" }))

    expect(alert.message).toBe(
      `${TEST_ID}\n\n${PUSH_TEST_ID_NOTIFICATIONS_OFF}`,
    )
    expect(labels(alert.buttons)).toEqual([
      PUSH_TEST_ID_CLOSE_ACTION,
      PUSH_TEST_ID_COPY_ACTION,
    ])
  })

  it.each([
    ["no ID yet", null],
    ["an empty ID", ""],
  ])("reads as registering with only Close for %s", (_label, testDeviceId) => {
    const alert = pushTestIdAlert(
      snapshot({ testDeviceId, permission: "unknown" }),
    )

    expect(alert.message).toBe(PUSH_TEST_ID_REGISTERING)
    expect(labels(alert.buttons)).toEqual([PUSH_TEST_ID_CLOSE_ACTION])
  })

  it("says notifications are off, with only Close, when denied and no ID", () => {
    const alert = pushTestIdAlert(
      snapshot({ testDeviceId: null, permission: "denied" }),
    )

    expect(alert.message).toBe(PUSH_TEST_ID_NOTIFICATIONS_OFF)
    expect(labels(alert.buttons)).toEqual([PUSH_TEST_ID_CLOSE_ACTION])
  })
})

describe("revealPushTestId", () => {
  it("reads the stored ID from the real store, after it hydrates", async () => {
    const storage = new Map<string, string>([
      [
        PUSH_REGISTRATION_STORAGE_KEY,
        JSON.stringify({
          version: PUSH_REGISTRATION_RECORD_VERSION,
          testDeviceId: TEST_ID,
          installId: "install-1234",
          payloadHash: "hash",
          lastSuccessAt: 1_000,
          revocationReportedAt: null,
        }),
      ],
    ])
    const store = createPushRegistrationStore({
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => {
        storage.set(key, value)
      },
      now: () => 1_000,
      mintInstallId: () => "install-5678",
    })
    // A launch starts empty: nothing has read the record yet.
    expect(store.getSnapshot().testDeviceId).toBeNull()
    const alert = jest.fn<void, Parameters<PushTestIdRevealDeps["alert"]>>()

    await revealPushTestId({ store, alert })

    expect(alert).toHaveBeenCalledTimes(1)
    const [title, message, buttons, options] = alert.mock.calls[0]
    expect(title).toBe(PUSH_TEST_ID_ALERT_TITLE)
    expect(message).toBe(`${TEST_ID}\n\n${PUSH_TEST_ID_HELP}`)
    expect(labels(buttons ?? [])).toEqual([
      PUSH_TEST_ID_CLOSE_ACTION,
      PUSH_TEST_ID_COPY_ACTION,
    ])
    expect(options).toEqual({ cancelable: true })
  })

  it("reads the app's own store and shows the native alert by default", async () => {
    // The production call passes no deps. Permission is launch state that only
    // the app-wide store holds, so a default that built its own store would lose it.
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {})
    try {
      getPushRegistrationStore().setPermission("denied")

      await revealPushTestId()

      expect(alert).toHaveBeenCalledTimes(1)
      expect(alert.mock.calls[0][1]).toBe(PUSH_TEST_ID_NOTIFICATIONS_OFF)
    } finally {
      alert.mockRestore()
      resetPushRegistrationStoreForTests()
    }
  })

  it("still shows the alert when the stored record cannot be read", async () => {
    const store = createPushRegistrationStore({
      getItem: async () => {
        throw new Error("storage unavailable")
      },
      setItem: async () => {},
      now: () => 1_000,
      mintInstallId: () => "install-5678",
    })
    const alert = jest.fn<void, Parameters<PushTestIdRevealDeps["alert"]>>()

    await revealPushTestId({ store, alert })

    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0][1]).toBe(PUSH_TEST_ID_REGISTERING)
  })
})
