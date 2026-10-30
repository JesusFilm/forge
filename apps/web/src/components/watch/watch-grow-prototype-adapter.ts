// The seam between the original Grow presentation (ported from the read-only
// prototype) and the current real course model. Nothing here stores anything.
//
// - The original course kept watched counts, "thirds", notes and community
//   shares in one localStorage key. The current model is structured step ids
//   plus an explicit lesson completion, saved only through the progress client,
//   and reflections that live in the memory-only draft store. A "third" is
//   therefore derived: it is done exactly when every completable step of that
//   movement is checked — the same rule `completedMovements` sends to the server.
// - Playback ids and runtimes are presentation art for the original rail and
//   stills. The curriculum module deliberately omits film inventory, so they
//   live here, keyed by the stable lesson id.

import {
  BWJ,
  lessonCards,
  type Lesson,
  type LessonId,
  type MovementId,
} from "@/lib/beginning-with-jesus"
import type { WatchLearningDraftKey } from "./watch-learning-drafts"

/** Admin's JESUS chapter playback ids and runtimes, read 2026-09-19. */
export const LESSON_MEDIA: Record<
  LessonId,
  { playbackId: string; seconds: number }
> = {
  "lesson-1": {
    playbackId: "gEK3tNTbj01HZSxn33ETSqCUXoQmKqakF8tMRV4eXi7A",
    seconds: 401,
  },
  "lesson-2": {
    playbackId: "maANlUyntx6jKw102mIggpfvyjBJgUyWLEDIqfualqgg",
    seconds: 177,
  },
  "lesson-3": {
    playbackId: "s02Yplrmfqag7bRkLntvGTusYkIRGigDS2fYmhSB8iPU",
    seconds: 144,
  },
  "lesson-4": {
    playbackId: "gvxFBKusJpY9kq97IR02bkF4R4G3AsEVEbYVkqy8XEKE",
    seconds: 122,
  },
  "lesson-5": {
    playbackId: "NAyxs5kPT9gXJZ7Q54EdOQECh8ewPo9pfnZkPRlzc5k",
    seconds: 76,
  },
  "lesson-6": {
    playbackId: "J00Et701rXzCRvuFmNp500rE01U2qxpdKH5Q01hs00DuXnqMM",
    seconds: 98,
  },
  "lesson-7": {
    playbackId: "Pak00Gp2jCPLb9u8uKInKZgHXPDnwM2ngxbWdVFbd021A",
    seconds: 58,
  },
  "lesson-8": {
    playbackId: "M9xUsXN3oIIDuV02bN4Pn48R101gAQCUffarkXDRFGr00Q",
    seconds: 46,
  },
  "lesson-9": {
    playbackId: "xT02Kt01yXCyHS5upincLljC27OvAp9VNX7YHXnRkXA9U",
    seconds: 139,
  },
}

/** The original's rough timing per third. Ours; the guide gives none. */
export const MOVEMENT_MINUTES: Record<MovementId, number> = {
  back: 15,
  up: 45,
  forward: 20,
}

/** Pre-generated Watch chapter-carousel derivative — cached by Mux, not rendered on demand. */
export function segmentStill(playbackId: string): string {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2`
}

export function runtimeLabel(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export type GrowLessonProgress = {
  completedStepIds: readonly string[]
  completed: boolean
}

const ORDER: MovementId[] = ["back", "up", "forward"]

/** Completable step ids of one movement, in deck order. */
export function movementStepIds(lesson: Lesson, movement: MovementId) {
  return lessonCards(lesson)
    .filter((card) => card.completable && card.movementId === movement)
    .map((card) => card.id)
}

/** The original's "thirds", derived from real checked steps. */
export function thirdsOf(
  lesson: Lesson,
  progress: GrowLessonProgress,
): MovementId[] {
  return ORDER.filter((movement) => {
    const steps = movementStepIds(lesson, movement)
    return (
      steps.length > 0 &&
      steps.every((id) => progress.completedStepIds.includes(id))
    )
  })
}

/** The original's "done" for a lesson: all three thirds, or completed explicitly. */
export function lessonDone(lesson: Lesson, progress: GrowLessonProgress) {
  return progress.completed || thirdsOf(lesson, progress).length === 3
}

/**
 * The explicit "Finish <third>" action: checks that movement's steps. Finishing
 * the last third also completes the lesson, because that button says so.
 */
export function finishThird(
  lesson: Lesson,
  progress: GrowLessonProgress,
  movement: MovementId,
): GrowLessonProgress {
  const steps = movementStepIds(lesson, movement)
  const completedStepIds = [
    ...progress.completedStepIds,
    ...steps.filter((id) => !progress.completedStepIds.includes(id)),
  ]
  return {
    completedStepIds,
    completed: progress.completed || movement === "forward",
  }
}

/* Reflection keys. The original wrote `p:<third>:<n>:<id>` and `q-<n>-<i>`
   into localStorage; here each one is a memory-only draft keyed by the card id
   the sheet and story share, so both views read the same words. */

export function stepDraftId(movement: MovementId, promptId: string) {
  return `${movement}-${promptId}`
}

export function questionDraftId(index: number) {
  return `up-question-${index + 1}`
}

export function draftKey(
  lesson: Lesson,
  stepId: string,
): WatchLearningDraftKey {
  return {
    courseId: BWJ.courseId,
    contentVersion: BWJ.contentVersion,
    lessonId: lesson.id,
    stepId,
  }
}
