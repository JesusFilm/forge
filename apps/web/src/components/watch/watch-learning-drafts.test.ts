import { describe, expect, it, vi } from "vitest"
import { createWatchLearningDraftStore } from "./watch-learning-drafts"

describe("browser-session reflection drafts", () => {
  it("shares sheet/story edits by course/version/lesson/step without persistence or network", () => {
    const first = createWatchLearningDraftStore()
    const second = createWatchLearningDraftStore()
    const listener = vi.fn()
    const unsubscribe = first.subscribe(listener)
    const key = {
      courseId: "beginning-with-jesus",
      contentVersion: "2026-10-17-v1",
      lessonId: "lesson-1",
      stepId: "up-question-1",
    }
    first.set(key, "My private reflection")
    expect(first.get(key)).toBe("My private reflection")
    expect(first.get({ ...key, lessonId: "lesson-2" })).toBe("")
    expect(first.get({ ...key, contentVersion: "next" })).toBe("")
    expect(second.get(key)).toBe("")
    expect(listener).toHaveBeenCalledTimes(1)
    first.clear()
    expect(first.get(key)).toBe("")
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    first.set(key, "After unsubscribe")
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
