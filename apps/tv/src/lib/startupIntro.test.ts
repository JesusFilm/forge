import { createStartupIntroSession } from "./startupIntro"

test("a fresh enabled app session offers the intro", () => {
  expect(createStartupIntroSession(true).isActive()).toBe(true)
})

test("completion stops audio before releasing playback", () => {
  const session = createStartupIntroSession(true)
  const stop = jest.fn(() => expect(session.isActive()).toBe(true))
  expect(session.finish(stop)).toBe(true)
  expect(stop).toHaveBeenCalledTimes(1)
  expect(session.isActive()).toBe(false)
})

test("warm resume, navigation and duplicate end events cannot replay it", () => {
  const session = createStartupIntroSession(true)
  const stop = jest.fn()
  session.finish(stop)
  expect(session.finish(stop)).toBe(false)
  expect(session.isActive()).toBe(false)
  expect(stop).toHaveBeenCalledTimes(1)
  expect(createStartupIntroSession(true).isActive()).toBe(true)
})

test("disabled by default: startup never gates playback or starts audio", () => {
  const session = createStartupIntroSession()
  const stop = jest.fn()
  expect(session.isActive()).toBe(false)
  expect(session.finish(stop)).toBe(false)
  expect(stop).not.toHaveBeenCalled()
})
