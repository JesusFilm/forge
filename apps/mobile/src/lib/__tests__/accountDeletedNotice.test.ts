import {
  clearAccountDeletedNotice,
  getAccountDeletedNotice,
  noteAccountDeleted,
  subscribeToAccountDeletedNotice,
} from "../accountDeletedNotice"

beforeEach(() => {
  clearAccountDeletedNotice()
})

describe("the account-deleted notice store (R20)", () => {
  it("starts clear and holds the notice once raised", () => {
    expect(getAccountDeletedNotice()).toBe(false)
    noteAccountDeleted()
    expect(getAccountDeletedNotice()).toBe(true)
  })

  it("clears on dismiss", () => {
    noteAccountDeleted()
    clearAccountDeletedNotice()
    expect(getAccountDeletedNotice()).toBe(false)
  })

  it("notifies subscribers on raise and on clear", () => {
    const listener = jest.fn()
    const unsubscribe = subscribeToAccountDeletedNotice(listener)

    noteAccountDeleted()
    clearAccountDeletedNotice()

    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it("does not notify when nothing actually changed", () => {
    noteAccountDeleted()
    const listener = jest.fn()
    const unsubscribe = subscribeToAccountDeletedNotice(listener)

    noteAccountDeleted()
    clearAccountDeletedNotice()
    clearAccountDeletedNotice()

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("stops notifying after unsubscribe", () => {
    const listener = jest.fn()
    subscribeToAccountDeletedNotice(listener)()

    noteAccountDeleted()

    expect(listener).not.toHaveBeenCalled()
  })
})
