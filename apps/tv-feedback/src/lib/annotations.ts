export type Mark = {
  id: string
  type: "draw" | "arrow" | "box" | "text" | "redact"
  x: number
  y: number
  points?: number[]
  width?: number
  height?: number
  label?: string
  fontSize?: number
}

export function moveMark(
  marks: Mark[],
  id: string,
  x: number,
  y: number,
): Mark[] {
  return marks.map((mark) => (mark.id === id ? { ...mark, x, y } : mark))
}

export function deleteMark(marks: Mark[], id: string): Mark[] {
  return marks.filter((mark) => mark.id !== id)
}

export function resizeMark(
  marks: Mark[],
  id: string,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
): Mark[] {
  return marks.map((mark) =>
    mark.id === id
      ? {
          ...mark,
          x,
          y,
          width: mark.width === undefined ? undefined : mark.width * scaleX,
          height: mark.height === undefined ? undefined : mark.height * scaleY,
          points: mark.points?.map(
            (point, index) => point * (index % 2 === 0 ? scaleX : scaleY),
          ),
          fontSize:
            mark.fontSize === undefined ? undefined : mark.fontSize * scaleY,
        }
      : mark,
  )
}
