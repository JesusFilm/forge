import {
  NEW_ACCOUNT_WINDOW_MS,
  clearNewAccountNotice,
  getNewAccountNotice,
  noteAccountCreated,
  subscribeToNewAccountNotice,
  wasAccountCreatedThisSignIn,
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

describe("wasAccountCreatedThisSignIn (hosted path, KTD3)", () => {
  // Both stamps come from the SERVER clock; NOW here is deliberately far
  // from the device's Date.now() so a device-clock leak fails these cases.
  const SESSION = new Date(NOW).toISOString()

  it("treats a user created moments before this session as new", () => {
    expect(
      wasAccountCreatedThisSignIn(new Date(NOW - 2_000).toISOString(), SESSION),
    ).toBe(true)
  })

  it("does not treat a long-standing account as new", () => {
    const lastYear = new Date(NOW - 365 * 24 * 3600 * 1000).toISOString()
    expect(wasAccountCreatedThisSignIn(lastYear, SESSION)).toBe(false)
  })

  it("shares the single declared window, bounded on both sides", () => {
    const past = new Date(NOW - NEW_ACCOUNT_WINDOW_MS - 1).toISOString()
    const inside = new Date(NOW - NEW_ACCOUNT_WINDOW_MS + 1).toISOString()
    const future = new Date(NOW + NEW_ACCOUNT_WINDOW_MS + 1).toISOString()
    expect(wasAccountCreatedThisSignIn(past, SESSION)).toBe(false)
    expect(wasAccountCreatedThisSignIn(inside, SESSION)).toBe(true)
    expect(wasAccountCreatedThisSignIn(future, SESSION)).toBe(false)
  })

  it("accepts Date instances on both sides", () => {
    expect(
      wasAccountCreatedThisSignIn(new Date(NOW - 1_000), new Date(NOW)),
    ).toBe(true)
  })

  it("never marks without a session stamp — the device clock does not substitute", () => {
    const freshOnDeviceClock = new Date().toISOString()
    expect(wasAccountCreatedThisSignIn(freshOnDeviceClock, undefined)).toBe(
      false,
    )
    expect(wasAccountCreatedThisSignIn(freshOnDeviceClock, null)).toBe(false)
    expect(wasAccountCreatedThisSignIn(freshOnDeviceClock, "not a date")).toBe(
      false,
    )
  })

  it("says no when the user stamp is absent or unparseable", () => {
    expect(wasAccountCreatedThisSignIn(undefined, SESSION)).toBe(false)
    expect(wasAccountCreatedThisSignIn(null, SESSION)).toBe(false)
    expect(wasAccountCreatedThisSignIn("not a date", SESSION)).toBe(false)
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
