import { buildSearchStrip } from "./keyStrip"

describe("buildSearchStrip", () => {
  const strip = buildSearchStrip()

  it("contains 26 letters + space + delete + submit, in order", () => {
    expect(strip).toHaveLength(29)
    const letters = strip.slice(0, 26)
    expect(letters.map((k) => k.label).join("")).toBe(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    )
    expect(strip[26].action).toEqual({ kind: "space" })
    expect(strip[27].action).toEqual({ kind: "backspace" })
    expect(strip[28].action).toEqual({ kind: "submit" })
  })

  it("letters dispatch their own uppercase character and are not wide", () => {
    for (const key of strip.slice(0, 26)) {
      expect(key.action).toEqual({ kind: "char", char: key.label })
      expect(key.label).toMatch(/^[A-Z]$/)
      expect(key.wide).toBe(false)
    }
  })

  it("space, delete, and submit are wide with accessibility labels", () => {
    for (const key of strip.slice(26)) {
      expect(key.wide).toBe(true)
      expect(key.accessibilityLabel).toBeTruthy()
    }
  })

  it("ids are unique (stable React keys)", () => {
    const ids = strip.map((k) => k.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
