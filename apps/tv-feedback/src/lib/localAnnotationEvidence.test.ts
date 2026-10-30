import { expect, it } from "vitest"
import type { Mark } from "./annotations"
import { localAnnotationEvidence } from "./localAnnotationEvidence"

it("keeps a simple drawing and reports when supplementary precision is reduced", () => {
  const mark: Mark = { id: "a", type: "draw", x: 0, y: 0, points: [1, 2, 3, 4] }
  expect(localAnnotationEvidence([mark])).toMatchObject({
    annotationMarks: [mark],
    annotationMetadataSimplified: false,
  })
  expect(
    localAnnotationEvidence([{ ...mark, x: 1.12345 }])
      .annotationMetadataSimplified,
  ).toBe(true)
})

it("bounds realistic lengthy drawings and many marks beneath the request budget", () => {
  const marks: Mark[] = Array.from({ length: 100 }, (_, index) => ({
    id: `${index}-` + "🎨".repeat(100),
    type: "draw",
    x: 1234.56789,
    y: 2345.67891,
    width: 100000,
    height: 100000,
    fontSize: 100000,
    label: "🎨 annotation".repeat(100),
    points: Array.from({ length: 12000 }, (_, point) => 1800 * Math.sin(point)),
  }))
  const evidence = localAnnotationEvidence(marks)
  expect(evidence.annotationMetadataSimplified).toBe(true)
  expect(evidence.annotationMarks.length).toBeLessThanOrEqual(50)
  expect(
    evidence.annotationMarks.reduce(
      (sum, mark) => sum + (mark.points?.length ?? 0),
      0,
    ),
  ).toBeLessThanOrEqual(2000)
  // Reserve 10 KiB for the bounded note, context and other submission fields.
  expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThan(54 * 1024)
  expect(marks[0].points).toHaveLength(12000)
})
