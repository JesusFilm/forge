import "server-only"

import { CombinedGraphQLErrors } from "@apollo/client"
import { adminGraphql } from "@forge/admin-graphql"

import { createUserAdminClient } from "@/lib/admin-client"

// Server-side bridge to Admin's own-data learning progress (feat-731). Every
// call runs on a request-scoped client carrying the signed-in user's access
// token; Admin derives the account from that token, so nothing here sends a
// user id. Admin is the authority on which course/lesson/step ids exist.

const MY_LEARNING_PROGRESS = adminGraphql(`
  query MyWatchLearningProgress($courseId: String!, $contentVersion: String!) {
    myWatchLearningProgress(courseId: $courseId, contentVersion: $contentVersion) {
      courseId
      contentVersion
      lessonId
      completedMovementIds
      completedStepIds
      completed
      completedAt
      resumeCardId
      revision
      updatedAt
    }
  }
`)

const SAVE_MY_LEARNING_PROGRESS = adminGraphql(`
  mutation SaveMyWatchLearningProgress($input: WatchLearningProgressSaveInput!) {
    saveMyWatchLearningProgress(input: $input) {
      status
      progress {
        courseId
        contentVersion
        lessonId
        completedMovementIds
        completedStepIds
        completed
        completedAt
        resumeCardId
        revision
        updatedAt
      }
    }
  }
`)

const RESET_MY_LEARNING_PROGRESS = adminGraphql(`
  mutation ResetMyWatchLearningProgress(
    $courseId: String!
    $contentVersion: String!
    $lessonId: String!
    $expectedRevision: Int!
  ) {
    resetMyWatchLearningProgress(
      courseId: $courseId
      contentVersion: $contentVersion
      lessonId: $lessonId
      expectedRevision: $expectedRevision
    ) {
      status
      progress {
        courseId
        contentVersion
        lessonId
        completedMovementIds
        completedStepIds
        completed
        completedAt
        resumeCardId
        revision
        updatedAt
      }
    }
  }
`)

export type LearningLessonKey = {
  courseId: string
  contentVersion: string
  lessonId: string
}

export type LearningLessonProgress = LearningLessonKey & {
  completedMovementIds: string[]
  completedStepIds: string[]
  completed: boolean
  completedAt: string | null
  resumeCardId: string | null
  /** 0 means nothing stored yet. */
  revision: number
  updatedAt: string | null
}

export type LearningSaveInput = LearningLessonKey & {
  expectedRevision: number
  completedMovementIds: string[]
  completedStepIds: string[]
  completed: boolean
  resumeCardId: string | null
}

export type LearningFailure = {
  ok: false
  /**
   * invalid: Admin rejected an id or payload. forbidden: the account was
   * deleted. unauthorized: Admin did not accept the token. upstream:
   * anything else — never reported as empty progress.
   */
  reason: "invalid" | "forbidden" | "unauthorized" | "upstream"
}

export type LearningListResult =
  | { ok: true; lessons: LearningLessonProgress[] }
  | LearningFailure

export type LearningSaveResult =
  | {
      ok: true
      status: "saved" | "conflict"
      progress: LearningLessonProgress
    }
  | LearningFailure

function failure(error: unknown): LearningFailure {
  if (CombinedGraphQLErrors.is(error)) {
    const codes = error.errors.map((reported) => reported.extensions?.code)
    if (codes.includes("BAD_USER_INPUT"))
      return { ok: false, reason: "invalid" }
    if (codes.includes("FORBIDDEN")) return { ok: false, reason: "forbidden" }
    if (codes.includes("UNAUTHENTICATED"))
      return { ok: false, reason: "unauthorized" }
  }
  console.warn(
    `[learning-progress] event=admin_failure error=${
      error instanceof Error ? error.name : "unknown"
    }`,
  )
  return { ok: false, reason: "upstream" }
}

function lesson(value: LearningLessonProgress): LearningLessonProgress {
  return {
    courseId: value.courseId,
    contentVersion: value.contentVersion,
    lessonId: value.lessonId,
    completedMovementIds: [...value.completedMovementIds],
    completedStepIds: [...value.completedStepIds],
    completed: value.completed,
    completedAt: value.completedAt ?? null,
    resumeCardId: value.resumeCardId ?? null,
    revision: value.revision,
    updatedAt: value.updatedAt ?? null,
  }
}

function saveResult(
  value:
    | { status: "SAVED" | "CONFLICT"; progress: LearningLessonProgress }
    | null
    | undefined,
): LearningSaveResult {
  if (!value) return { ok: false, reason: "upstream" }
  return {
    ok: true,
    status: value.status === "SAVED" ? "saved" : "conflict",
    progress: lesson(value.progress),
  }
}

export async function fetchLearningProgress(
  accessToken: string,
  key: { courseId: string; contentVersion: string },
): Promise<LearningListResult> {
  try {
    const { data } = await createUserAdminClient(accessToken).query({
      query: MY_LEARNING_PROGRESS,
      variables: key,
      fetchPolicy: "no-cache",
    })
    const lessons = data?.myWatchLearningProgress
    if (!lessons) return { ok: false, reason: "upstream" }
    return { ok: true, lessons: lessons.map(lesson) }
  } catch (error) {
    return failure(error)
  }
}

export async function saveLearningProgress(
  accessToken: string,
  input: LearningSaveInput,
): Promise<LearningSaveResult> {
  try {
    const { data } = await createUserAdminClient(accessToken).mutate({
      mutation: SAVE_MY_LEARNING_PROGRESS,
      variables: { input },
    })
    return saveResult(data?.saveMyWatchLearningProgress)
  } catch (error) {
    return failure(error)
  }
}

export async function resetLearningProgress(
  accessToken: string,
  input: LearningLessonKey & { expectedRevision: number },
): Promise<LearningSaveResult> {
  try {
    const { data } = await createUserAdminClient(accessToken).mutate({
      mutation: RESET_MY_LEARNING_PROGRESS,
      variables: input,
    })
    return saveResult(data?.resetMyWatchLearningProgress)
  } catch (error) {
    return failure(error)
  }
}
