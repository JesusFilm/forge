// Code-owned allowlist for account learning progress (feat-731, KTD9).
//
// Progress stores only ids this module knows. Admin is the authority: Web
// renders the course, but a write naming a course, version, lesson, movement,
// step, or card that is not listed here is rejected before any SQL runs, so
// the table can never hold free text or ids from a retired content version.
//
// Derived from "Beginning With Jesus" v2 (© 2023 Jesus Film Project): the
// Looking Back / Looking Forward prompt ids repeat on every lesson; Looking Up
// varies by the lesson's discussion-question and conclusion-point counts.
// Never renumber or reuse an id inside a content version — publish a new
// version instead.

export const WATCH_LEARNING_COURSE_ID = "beginning-with-jesus"
export const WATCH_LEARNING_CONTENT_VERSION = "2026-10-17-v1"

export const WATCH_LEARNING_MOVEMENT_IDS = ["back", "up", "forward"] as const

const LOOKING_BACK_STEP_IDS = [
  "back-how",
  "back-carrying",
  "back-give",
  "back-want",
  "back-quiet",
  "back-went-right",
] as const

const LOOKING_FORWARD_STEP_IDS = [
  "forward-trustworthy",
  "forward-differently",
  "forward-retell",
  "forward-thanks",
  "forward-lands",
  "forward-for-them",
] as const

// Guide order; counts are lesson.questions / lesson.points lengths.
const LESSON_SHAPES = [
  { lessonId: "lesson-1", questions: 4, truths: 4 },
  { lessonId: "lesson-2", questions: 7, truths: 3 },
  { lessonId: "lesson-3", questions: 6, truths: 3 },
  { lessonId: "lesson-4", questions: 7, truths: 0 },
  { lessonId: "lesson-5", questions: 7, truths: 5 },
  { lessonId: "lesson-6", questions: 7, truths: 5 },
  { lessonId: "lesson-7", questions: 8, truths: 0 },
  { lessonId: "lesson-8", questions: 6, truths: 0 },
  { lessonId: "lesson-9", questions: 6, truths: 4 },
] as const

export type WatchLearningLessonDefinition = {
  lessonId: string
  /** Completable steps, in deck order. */
  stepIds: readonly string[]
  /** Every resumable card, in deck order (steps plus cover/up-intro/end). */
  cardIds: readonly string[]
}

function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`)
}

function defineLesson(
  shape: (typeof LESSON_SHAPES)[number],
): WatchLearningLessonDefinition {
  const lookingUp = [
    "up-watch",
    "up-retell",
    ...numbered("up-question", shape.questions),
    "up-conclusion",
    ...numbered("up-truth", shape.truths),
  ]
  return {
    lessonId: shape.lessonId,
    stepIds: [
      ...LOOKING_BACK_STEP_IDS,
      ...lookingUp,
      ...LOOKING_FORWARD_STEP_IDS,
    ],
    cardIds: [
      "cover",
      ...LOOKING_BACK_STEP_IDS,
      "up-intro",
      ...lookingUp,
      ...LOOKING_FORWARD_STEP_IDS,
      "end",
    ],
  }
}

const LESSONS = new Map(
  LESSON_SHAPES.map((shape) => [shape.lessonId, defineLesson(shape)]),
)

const COURSES: ReadonlyMap<
  string,
  ReadonlyMap<string, ReadonlyMap<string, WatchLearningLessonDefinition>>
> = new Map([
  [
    WATCH_LEARNING_COURSE_ID,
    new Map([[WATCH_LEARNING_CONTENT_VERSION, LESSONS]]),
  ],
])

export function isKnownWatchLearningCourseVersion(
  courseId: string,
  contentVersion: string,
): boolean {
  return COURSES.get(courseId)?.has(contentVersion) ?? false
}

export function findWatchLearningLesson(
  courseId: string,
  contentVersion: string,
  lessonId: string,
): WatchLearningLessonDefinition | null {
  return COURSES.get(courseId)?.get(contentVersion)?.get(lessonId) ?? null
}
