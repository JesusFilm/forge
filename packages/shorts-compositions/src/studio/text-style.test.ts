import { expect, it } from "vitest"
import { textMotion, type TextItem } from "./text-style"

const item: TextItem = {
  id: "title",
  kind: "text",
  trackId: "text",
  startFrame: 30,
  durationInFrames: 60,
  text: "Hello",
  properties: {},
}

it("preserves legacy cards at every frame", () => {
  for (const frame of [0, 15, 30, 59])
    expect(textMotion(item, frame)).toEqual({ opacity: 1, translateY: 0 })
})

it("fades and slides independently on entrance and exit with stable scrubbing", () => {
  const animated = {
    ...item,
    properties: {
      entrance: "slide",
      entranceFrames: 10,
      exit: "fade",
      exitFrames: 10,
    },
  } satisfies TextItem
  expect(textMotion(animated, 0)).toEqual({ opacity: 0, translateY: 40 })
  expect(textMotion(animated, 5)).toEqual({ opacity: 0.5, translateY: 10 })
  expect(textMotion(animated, 20)).toEqual({ opacity: 1, translateY: 0 })
  expect(textMotion(animated, 59)).toEqual({ opacity: 0, translateY: 0 })
  expect(textMotion(animated, 5)).toEqual({ opacity: 0.5, translateY: 10 })
})

it("bounds overlapping durations after a card is trimmed", () => {
  const short = {
    ...item,
    durationInFrames: 6,
    properties: {
      entrance: "fade",
      exit: "slide",
      entranceFrames: 300,
      exitFrames: 300,
    },
  } satisfies TextItem
  for (let frame = 0; frame < 6; frame++) {
    const motion = textMotion(short, frame)
    expect(motion.opacity).toBeGreaterThanOrEqual(0)
    expect(motion.opacity).toBeLessThanOrEqual(1)
    expect(motion.translateY).toBeGreaterThanOrEqual(-40)
  }
  expect(textMotion(short, 3).opacity).toBeGreaterThan(0.5)
})
