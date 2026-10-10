/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// The literal helper the generators use to write values into generated source.
const { codeString, objectKey } = require("../lib/scriptFormat")

describe("codeString", () => {
  it("writes a plain value exactly as JSON.stringify does", () => {
    for (const value of ["../../messages/en.json", ["en", "zh-Hans"], "x/y"]) {
      expect(codeString(value)).toBe(JSON.stringify(value))
    }
  })

  it("escapes the characters JSON.stringify leaves in place", () => {
    const text = `</script>${String.fromCharCode(0x2028, 0x2029)}`
    const written = codeString(text)

    expect(written).toBe('"\\u003C/script\\u003E\\u2028\\u2029"')
    expect(written).not.toMatch(/[<>\u2028\u2029]/)
    // The literal still reads back as the original value.
    expect(JSON.parse(written)).toBe(text)
  })

  it("quotes an object key only when it is not an identifier", () => {
    expect(objectKey("en")).toBe("en")
    expect(objectKey("zh-Hans")).toBe('"zh-Hans"')
  })
})
