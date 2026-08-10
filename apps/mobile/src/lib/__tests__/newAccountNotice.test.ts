import {
  NEW_ACCOUNT_WINDOW_MS,
  clearNewAccountNotice,
  getNewAccountNotice,
  noteAccountCreated,
  subscribeToNewAccountNotice,
  wasAccountJustCreated,
} from "../newAccountNotice"

const NOW = 1_800_000_000_000

beforeEach(() => {
  clearNewAccountNotice()
})

describe("wasAccountJustCreated", () => {
  it("treats an account created moments ago as new", () => {
    expect(
      wasAccountJustCreated(new Date(NOW - 2_000).toISOString(), NOW),
    ).toBe(true)
  })

  it("does not treat a long-standing account as new", () => {
    // The returning user signing in on a second device — the case that must
    // never be told their history is missing because the account is new.
    const lastYear = new Date(NOW - 365 * 24 * 3600 * 1000).toISOString()
    expect(wasAccountJustCreated(lastYear, NOW)).toBe(false)
  })

  it("accepts a Date as well as an ISO string", () => {
    expect(wasAccountJustCreated(new Date(NOW - 1_000), NOW)).toBe(true)
  })

  it("absorbs clock skew in both directions", () => {
    // createdAt is the SERVER's clock, `now` the device's; a device running
    // fast would otherwise read a just-created account as future-dated.
    expect(
      wasAccountJustCreated(new Date(NOW + 60_000).toISOString(), NOW),
    ).toBe(true)
    expect(
      wasAccountJustCreated(new Date(NOW - 60_000).toISOString(), NOW),
    ).toBe(true)
  })

  it("is bounded by the declared window on both sides", () => {
    const past = new Date(NOW - NEW_ACCOUNT_WINDOW_MS - 1).toISOString()
    const future = new Date(NOW + NEW_ACCOUNT_WINDOW_MS + 1).toISOString()
    expect(wasAccountJustCreated(past, NOW)).toBe(false)
    expect(wasAccountJustCreated(future, NOW)).toBe(false)
  })

  it("says no rather than guessing when createdAt is absent or unparseable", () => {
    // Silence beats a wrong "this is a new account" on a returning user.
    expect(wasAccountJustCreated(undefined, NOW)).toBe(false)
    expect(wasAccountJustCreated(null, NOW)).toBe(false)
    expect(wasAccountJustCreated("not a date", NOW)).toBe(false)
  })
})

describe("the notice store", () => {
  it("starts empty and holds the account the notice belongs to", () => {
    expect(getNewAccountNotice()).toBeNull()
    noteAccountCreated("user-1")
    expect(getNewAccountNotice()).toBe("user-1")
  })

  it("clears on dismiss", () => {
    noteAccountCreated("user-1")
    clearNewAccountNotice()
    expect(getNewAccountNotice()).toBeNull()
  })

  it("notifies subscribers on raise and on clear", () => {
    const listener = jest.fn()
    const unsubscribe = subscribeToNewAccountNotice(listener)

    noteAccountCreated("user-1")
    clearNewAccountNotice()

    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it("does not notify when nothing actually changed", () => {
    // useSyncExternalStore re-reads on every emit; a redundant emit on a
    // repeated sign-in would re-render Profile for no reason.
    noteAccountCreated("user-1")
    const listener = jest.fn()
    const unsubscribe = subscribeToNewAccountNotice(listener)

    noteAccountCreated("user-1")
    clearNewAccountNotice()
    clearNewAccountNotice()

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("stops notifying after unsubscribe", () => {
    const listener = jest.fn()
    subscribeToNewAccountNotice(listener)()

    noteAccountCreated("user-1")

    expect(listener).not.toHaveBeenCalled()
  })

  it("re-points at the newer account when a different one signs in", () => {
    noteAccountCreated("user-1")
    noteAccountCreated("user-2")
    expect(getNewAccountNotice()).toBe("user-2")
  })
})
