// Only the cold-start read is under test here; every other method is the thin
// native seam that the device pass covers (KTD1).
const mockLastResponse: { data: unknown } = { data: null }
jest.mock("expo-notifications", () => ({
  setNotificationHandler: () => {},
  getLastNotificationResponse: () =>
    mockLastResponse.data == null
      ? null
      : {
          notification: {
            request: { content: { data: mockLastResponse.data } },
          },
        },
}))
jest.mock("expo-constants", () => ({ __esModule: true, default: {} }))
const mockDirection: { afterReturnReload: boolean } = {
  afterReturnReload: false,
}
jest.mock("../../../i18n/layoutDirection", () => ({
  afterReturnReload: () => mockDirection.afterReturnReload,
}))

import { lapseReminderNotifications } from "../notificationsAdapter"

const TAP = { kind: "announcement", slug: "jesus" }

beforeEach(() => {
  mockLastResponse.data = TAP
  mockDirection.afterReturnReload = false
})

describe("getLastResponseData (feat-694 KTD9)", () => {
  it("replays the tap that started the session after a start reload", () => {
    expect(lapseReminderNotifications.getLastResponseData()).toEqual(TAP)
  })

  it("does not replay it after an Android return reload", () => {
    mockDirection.afterReturnReload = true
    expect(lapseReminderNotifications.getLastResponseData()).toBeNull()
  })
})
