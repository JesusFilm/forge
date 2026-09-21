/**
 * R31's Profile row: the notification test ID, with copy and share, and the two
 * placeholders that stand in its place. The ID is what an admin user pastes
 * into the test-device list, and it is never the push token.
 *
 * The REAL record store runs here over the vendor's AsyncStorage mock, so a row
 * that reads the wrong field fails. Only the two platform side effects are
 * doubled. See apps/mobile/CLAUDE.md "Component render tests" for the react
 * re-point pattern.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
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
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("../../../lib/push/testIdActions", () => ({
  copyPushTestId: jest.fn(),
  sharePushTestId: jest.fn(),
}))

import { act } from "react"

import AsyncStorage from "@react-native-async-storage/async-storage"

import { NotificationTestIdSection } from "../NotificationTestIdSection"
import {
  PUSH_REGISTRATION_STORAGE_KEY,
  PUSH_TEST_ID_COPY_LABEL,
  PUSH_TEST_ID_NOTIFICATIONS_OFF,
  PUSH_TEST_ID_REGISTERING,
  PUSH_TEST_ID_SHARE_LABEL,
} from "../../../lib/push/constants"
import {
  copyPushTestId,
  sharePushTestId,
} from "../../../lib/push/testIdActions"
import {
  getPushRegistrationStore,
  resetPushRegistrationStoreForTests,
} from "../../../lib/push/store"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const TEST_ID = "k3f9qz1m"

async function renderSection(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<NotificationTestIdSection />)
  })
  await act(async () => {})
  return renderer
}

/** The control's `disabled` prop, read off the pressable the label names. */
function disabledOf(renderer: TestInstance, label: string): boolean {
  return pressableByLabel(renderer, label).props.disabled === true
}

beforeEach(async () => {
  jest.clearAllMocks()
  resetPushRegistrationStoreForTests()
  await AsyncStorage.clear()
})

describe("the notification test ID row", () => {
  it("shows the stored ID with copy and share enabled", async () => {
    await AsyncStorage.setItem(
      PUSH_REGISTRATION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        testDeviceId: TEST_ID,
        payloadHash: "0123456789abcdef",
        lastSuccessAt: 1_000,
        revocationReportedAt: null,
      }),
    )
    getPushRegistrationStore().setPermission("granted")

    const renderer = await renderSection()

    expect(hasText(renderer, TEST_ID)).toBe(true)
    expect(disabledOf(renderer, PUSH_TEST_ID_COPY_LABEL)).toBe(false)
    expect(disabledOf(renderer, PUSH_TEST_ID_SHARE_LABEL)).toBe(false)
  })

  it("never renders a push token, whatever is stored", async () => {
    // The store has no field for one, which is the property this pins: a row
    // that reached for the token would have nothing to read.
    await AsyncStorage.setItem(
      PUSH_REGISTRATION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        testDeviceId: TEST_ID,
        expoPushToken: "ExponentPushToken[abc]",
        payloadHash: "hash",
        lastSuccessAt: 1_000,
        revocationReportedAt: null,
      }),
    )
    const renderer = await renderSection()

    expect(hasText(renderer, TEST_ID)).toBe(true)
    expect(hasText(renderer, "ExponentPushToken")).toBe(false)
  })

  it("shows the registering placeholder before the first success", async () => {
    getPushRegistrationStore().setPermission("granted")

    const renderer = await renderSection()

    expect(hasText(renderer, PUSH_TEST_ID_REGISTERING)).toBe(true)
    expect(disabledOf(renderer, PUSH_TEST_ID_COPY_LABEL)).toBe(true)
    expect(disabledOf(renderer, PUSH_TEST_ID_SHARE_LABEL)).toBe(true)
  })

  it("shows the notifications-off placeholder when permission is denied", async () => {
    getPushRegistrationStore().setPermission("denied")

    const renderer = await renderSection()

    expect(hasText(renderer, PUSH_TEST_ID_NOTIFICATIONS_OFF)).toBe(true)
    expect(hasText(renderer, PUSH_TEST_ID_REGISTERING)).toBe(false)
    expect(disabledOf(renderer, PUSH_TEST_ID_COPY_LABEL)).toBe(true)
  })

  it("keeps the ID visible when a later pass finds the permission gone", async () => {
    // The phone is out of the audience, but the ID is still what an admin user
    // has on their list, so hiding it would make the denial unexplainable.
    await AsyncStorage.setItem(
      PUSH_REGISTRATION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        testDeviceId: TEST_ID,
        payloadHash: "hash",
        lastSuccessAt: 1_000,
        revocationReportedAt: null,
      }),
    )
    const renderer = await renderSection()
    expect(hasText(renderer, TEST_ID)).toBe(true)

    await act(async () => {
      getPushRegistrationStore().setPermission("denied")
    })

    expect(hasText(renderer, TEST_ID)).toBe(true)
    expect(hasText(renderer, PUSH_TEST_ID_NOTIFICATIONS_OFF)).toBe(true)
  })

  it("copies and shares the stored ID", async () => {
    await AsyncStorage.setItem(
      PUSH_REGISTRATION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        testDeviceId: TEST_ID,
        payloadHash: "hash",
        lastSuccessAt: 1_000,
        revocationReportedAt: null,
      }),
    )
    const renderer = await renderSection()

    await press(pressableByLabel(renderer, PUSH_TEST_ID_COPY_LABEL))
    await press(pressableByLabel(renderer, PUSH_TEST_ID_SHARE_LABEL))

    expect(copyPushTestId).toHaveBeenCalledWith(TEST_ID)
    expect(sharePushTestId).toHaveBeenCalledWith(TEST_ID)
  })

  it("does neither while no ID is stored", async () => {
    const renderer = await renderSection()

    await press(pressableByLabel(renderer, PUSH_TEST_ID_COPY_LABEL))
    await press(pressableByLabel(renderer, PUSH_TEST_ID_SHARE_LABEL))

    // A disabled Pressable still has its handler in the tree, and a raw call
    // ignores `disabled`, so the guard has to be in the handler too.
    expect(copyPushTestId).not.toHaveBeenCalled()
    expect(sharePushTestId).not.toHaveBeenCalled()
  })

  it("picks up an ID that arrives after the first render", async () => {
    const renderer = await renderSection()
    expect(hasText(renderer, PUSH_TEST_ID_REGISTERING)).toBe(true)

    await act(async () => {
      await getPushRegistrationStore().recordSuccess({
        testDeviceId: TEST_ID,
        payloadHash: "hash",
      })
    })

    expect(hasText(renderer, TEST_ID)).toBe(true)
  })
})
