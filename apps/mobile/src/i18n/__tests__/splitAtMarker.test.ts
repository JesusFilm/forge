import { INLINE_MARK, splitAtMarker } from "../splitAtMarker"
import { FIRST_STRONG_ISOLATE, POP_DIRECTIONAL_ISOLATE } from "../translator"

const isolated = (value: string) =>
  `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`

describe("splitAtMarker", () => {
  it("splits a sentence at the marker, wherever a language puts it", () => {
    expect(
      splitAtMarker(`I agree to the ${INLINE_MARK}.`, INLINE_MARK),
    ).toEqual(["I agree to the ", "."])
    expect(splitAtMarker(`${INLINE_MARK} first`, INLINE_MARK)).toEqual([
      "",
      " first",
    ])
    expect(splitAtMarker(`last ${INLINE_MARK}`, INLINE_MARK)).toEqual([
      "last ",
      "",
    ])
  })

  it("keeps the whole sentence before the marker when it is absent", () => {
    expect(splitAtMarker("No marker here", INLINE_MARK)).toEqual([
      "No marker here",
      "",
    ])
  })

  it("strips the isolate marks a right-to-left catalog adds (KTD13)", () => {
    const sentence = `أوافق على ${isolated(INLINE_MARK)} الآن`
    expect(splitAtMarker(sentence, INLINE_MARK)).toEqual([
      "أوافق على ",
      " الآن",
    ])
  })

  it("strips isolate marks around other values in the same sentence", () => {
    const sentence = `${isolated("Ana")} ${INLINE_MARK} ${isolated("Bo")}`
    expect(splitAtMarker(sentence, INLINE_MARK)).toEqual(["Ana ", " Bo"])
  })
})
