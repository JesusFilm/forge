import { describe, expect, it } from "vitest"

import { deleteMark, moveMark, resizeMark, type Mark } from "./annotations"

describe("editable image marks", () => {
  it("moves one freehand stroke as a whole and keeps its source untouched", () => {
    const marks: Mark[] = [
      { id: "first", type: "draw", x: 10, y: 20, points: [0, 0, 20, 30] },
      { id: "second", type: "text", x: 40, y: 50, label: "ภาษาไทย" },
    ]
    const moved = moveMark(marks, "first", 80, 90)
    expect(moved[0]).toEqual({ ...marks[0], x: 80, y: 90 })
    expect(moved[1]).toBe(marks[1])
    expect(marks[0].x).toBe(10)
    expect(deleteMark(moved, "first")).toEqual([marks[1]])
  })
  it("resizes one stroke without changing its original points", () => {
    const marks: Mark[] = [
      { id: "stroke", type: "draw", x: 10, y: 20, points: [0, 0, 20, 30] },
    ]
    expect(resizeMark(marks, "stroke", 10, 20, 2, 3)[0].points).toEqual([
      0, 0, 40, 90,
    ])
    expect(marks[0].points).toEqual([0, 0, 20, 30])
  })
})
