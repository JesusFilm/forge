import { accountIdentity } from "../accountHooks"

describe("accountIdentity", () => {
  it("uppercases the initial in the UI language", () => {
    const user = { id: "u1", name: "irmak" }

    // Turkish maps a dotted i to a dotted capital, so a dropped tag fails here.
    expect(accountIdentity(user, "Signed in", "tr").initial).toBe("İ")
    expect(accountIdentity(user, "Signed in", "en").initial).toBe("I")
  })

  it("shows the name, then the email, then the fallback name", () => {
    expect(
      accountIdentity({ id: "u1", name: " Ana ", email: "a@x.org" }, "F", "en")
        .displayName,
    ).toBe("Ana")
    expect(
      accountIdentity({ id: "u1", name: "  ", email: "a@x.org" }, "F", "en"),
    ).toEqual({ name: undefined, displayName: "a@x.org", initial: undefined })
    expect(accountIdentity({ id: "u1" }, "Conectado", "es").displayName).toBe(
      "Conectado",
    )
  })
})
