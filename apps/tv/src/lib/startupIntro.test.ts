import { createStartupIntroSession } from "./startupIntro"

test("a fresh app session offers the intro", () => {
  expect(createStartupIntroSession().isActive()).toBe(true)
})

test("completion stops audio before releasing playback", () => {
  const session = createStartupIntroSession()
  const stop = jest.fn(() => expect(session.isActive()).toBe(true))
  expect(session.finish(stop)).toBe(true)
  expect(stop).toHaveBeenCalledTimes(1)
  expect(session.isActive()).toBe(false)
})

test("warm resume, navigation and duplicate end events cannot replay it", () => {
  const session = createStartupIntroSession()
  const stop = jest.fn()
  session.finish(stop)
  expect(session.finish(stop)).toBe(false)
  expect(session.isActive()).toBe(false)
  expect(stop).toHaveBeenCalledTimes(1)
  expect(createStartupIntroSession().isActive()).toBe(true)
})
