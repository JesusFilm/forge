import { describe, expect, it } from "vitest"

import {
  WATCH_LEARNING_CONTENT_VERSION,
  WATCH_LEARNING_COURSE_ID,
  findWatchLearningLesson,
  isKnownWatchLearningCourseVersion,
} from "./watch-learning-course"

const COURSE = WATCH_LEARNING_COURSE_ID
const VERSION = WATCH_LEARNING_CONTENT_VERSION

describe("watch learning course allowlist", () => {
  it("pins the published course and content version ids", () => {
    // Web's course content and stored rows key on these strings; changing
    // either orphans every saved lesson.
    expect(COURSE).toBe("beginning-with-jesus")
    expect(VERSION).toBe("2026-10-17-v1")
    expect(isKnownWatchLearningCourseVersion(COURSE, VERSION)).toBe(true)
    expect(isKnownWatchLearningCourseVersion(COURSE, "2026-01-01-v0")).toBe(
      false,
    )
    expect(isKnownWatchLearningCourseVersion("other", VERSION)).toBe(false)
  })

  it("defines lesson 1 as the 26-card deck, in order", () => {
    expect(
      findWatchLearningLesson(COURSE, VERSION, "lesson-1")?.cardIds,
    ).toEqual([
      "cover",
      "back-how",
      "back-carrying",
      "back-give",
      "back-want",
      "back-quiet",
      "back-went-right",
      "up-intro",
      "up-watch",
      "up-retell",
      "up-question-1",
      "up-question-2",
      "up-question-3",
      "up-question-4",
      "up-conclusion",
      "up-truth-1",
      "up-truth-2",
      "up-truth-3",
      "up-truth-4",
      "forward-trustworthy",
      "forward-differently",
      "forward-retell",
      "forward-thanks",
      "forward-lands",
      "forward-for-them",
      "end",
    ])
  })

  it("never lets a navigation-only card count as a completable step", () => {
    for (let n = 1; n <= 9; n += 1) {
      const lesson = findWatchLearningLesson(COURSE, VERSION, `lesson-${n}`)
      expect(lesson).not.toBeNull()
      for (const card of ["cover", "up-intro", "end"]) {
        expect(lesson?.cardIds).toContain(card)
        expect(lesson?.stepIds).not.toContain(card)
      }
      // Every step is also a resumable card.
      for (const step of lesson?.stepIds ?? []) {
        expect(lesson?.cardIds).toContain(step)
      }
    }
  })

  it("sizes each lesson from the guide's question and point counts", () => {
    const cardCounts = Array.from(
      { length: 9 },
      (_, index) =>
        findWatchLearningLesson(COURSE, VERSION, `lesson-${index + 1}`)?.cardIds
          .length,
    )
    expect(cardCounts).toEqual([26, 28, 27, 25, 30, 30, 26, 24, 28])
  })

  it("knows no tenth lesson", () => {
    expect(findWatchLearningLesson(COURSE, VERSION, "lesson-10")).toBeNull()
    expect(findWatchLearningLesson(COURSE, VERSION, "lesson-0")).toBeNull()
  })
})
