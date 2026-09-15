import { expect, it } from "vitest"
import { studioHash } from "./hash"

it("preserves the existing Admin canonical hash vectors and ordered arrays", () => {
  expect(studioHash({ z: { b: " x\n ", a: [2, 1] }, a: 1 })).toBe(
    "3f707389770fae83b01a65a96c2fcb341095d14c139ed7cb16343142a515b7e9",
  )
  expect(studioHash({ speech: [], language: "en" })).toBe(
    "6250993a4f51836a4496c503048f63f42e73bcfe0d07aea6f9664be3488bb2d8",
  )
  expect(studioHash({ a: 1, z: { a: [2, 1], b: " x\n " } })).toBe(
    studioHash({ z: { b: " x\n ", a: [2, 1] }, a: 1 }),
  )
  expect(studioHash([1, 2])).not.toBe(studioHash([2, 1]))
  expect(studioHash(" text ")).not.toBe(studioHash("text"))
})
