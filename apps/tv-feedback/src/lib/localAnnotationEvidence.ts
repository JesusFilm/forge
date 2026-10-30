import type { Mark } from "./annotations"

/** The submitted image preserves every mark. Keep its supplementary geometry
 * below the 64 KiB JSON limit even for a long, high-frequency pointer stroke. */
export function localAnnotationEvidence(marks: Mark[]) {
  let simplified = false
  const retained = marks.slice(0, 50)
  if (retained.length !== marks.length) simplified = true
  const strokes = retained.filter((mark) => mark.points?.length).length
  const pointsPerStroke = Math.min(
    2000,
    Math.floor(2000 / Math.max(1, strokes) / 2) * 2,
  )
  const number = (value: number | undefined) => {
    if (value === undefined) return undefined
    const bounded =
      Math.round(
        Math.max(
          -100_000,
          Math.min(100_000, Number.isFinite(value) ? value : 0),
        ) * 100,
      ) / 100
    if (bounded !== value) simplified = true
    return bounded
  }
  const annotationMarks = retained.map((mark): Mark => {
    const source = mark.points ?? []
    let points = source
    if (source.length > pointsPerStroke) {
      simplified = true
      const pairs = Math.floor(source.length / 2)
      const retainedPairs = pointsPerStroke / 2
      points = Array.from({ length: retainedPairs }, (_, index) => {
        const pair = Math.round((index * (pairs - 1)) / (retainedPairs - 1))
        return [source[pair * 2], source[pair * 2 + 1]]
      }).flat()
    }
    if (mark.id.length > 100 || (mark.label?.length ?? 0) > 100)
      simplified = true
    return {
      ...mark,
      id: mark.id.slice(0, 100),
      x: number(mark.x)!,
      y: number(mark.y)!,
      ...(mark.points ? { points: points.map((value) => number(value)!) } : {}),
      width: number(mark.width),
      height: number(mark.height),
      fontSize: number(mark.fontSize),
      ...(mark.label === undefined ? {} : { label: mark.label.slice(0, 100) }),
    }
  })
  while (
    new TextEncoder().encode(JSON.stringify(annotationMarks)).length >
    48 * 1024
  ) {
    annotationMarks.pop()
    simplified = true
  }
  return { annotationMarks, annotationMetadataSimplified: simplified }
}
