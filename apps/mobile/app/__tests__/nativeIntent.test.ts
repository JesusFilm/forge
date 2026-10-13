const mockDirection: { afterReturnReload: boolean; throws: boolean } = {
  afterReturnReload: false,
  throws: false,
}
jest.mock("../../src/i18n/layoutDirection", () => ({
  afterReturnReload: () => {
    if (mockDirection.throws) throw new Error("no module")
    return mockDirection.afterReturnReload
  },
}))

import { redirectSystemPath } from "../+native-intent"

const LINK = "/watch/jesus"

beforeEach(() => {
  mockDirection.afterReturnReload = false
  mockDirection.throws = false
})

describe("redirectSystemPath (KTD9)", () => {
  it("sends the launch link of a return reload to Home", () => {
    mockDirection.afterReturnReload = true
    expect(redirectSystemPath({ path: LINK, initial: true })).toBe("/")
  })

  it("keeps the launch link of a start reload or a normal cold start", () => {
    expect(redirectSystemPath({ path: LINK, initial: true })).toBe(LINK)
  })

  it("keeps a link that arrives later, also after a return reload", () => {
    mockDirection.afterReturnReload = true
    expect(redirectSystemPath({ path: LINK, initial: false })).toBe(LINK)
  })

  it("keeps the link when the controller cannot load", () => {
    mockDirection.throws = true
    expect(redirectSystemPath({ path: LINK, initial: true })).toBe(LINK)
  })
})
