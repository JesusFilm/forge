// Viewer-scoped learning progress (feat-731, KTD8–KTD9). The account comes
// solely from a checked WEB_USER principal; no argument carries a user id, and
// every course/lesson/step/card id is checked against the code allowlist.

import { GraphQLError } from "graphql"

import { builder } from "@/graphql/builder"
import type { Principal } from "@/auth/principal"
import {
  WatchLearningSubjectErasedError,
  WatchLearningValidationError,
  listWatchLearningProgress,
  resetWatchLearningProgress,
  saveWatchLearningProgress,
  type WatchLearningProgressView,
  type WatchLearningSaveResult,
} from "@/services/watch-learning-progress.service"

// Scope-auth already limits these keys to WEB_USER; this repeats it at the
// subject read so a future permission edit cannot hand a non-user principal
// (an editor's own id, a bearer) a learning record.
function requireLearningSubject(user: Principal | null): string {
  if (
    user?.role !== "WEB_USER" ||
    typeof user.id !== "string" ||
    user.id.length === 0
  ) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    })
  }
  return user.id
}

async function mapLearningErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof WatchLearningValidationError) {
      throw new GraphQLError(error.message, {
        extensions: { code: "BAD_USER_INPUT" },
      })
    }
    if (error instanceof WatchLearningSubjectErasedError) {
      throw new GraphQLError(error.message, {
        extensions: { code: "FORBIDDEN" },
      })
    }
    throw error
  }
}

const WatchLearningLessonProgressRef = builder
  .objectRef<WatchLearningProgressView>("WatchLearningLessonProgress")
  .implement({
    fields: (t) => ({
      courseId: t.exposeString("courseId", { nullable: false }),
      contentVersion: t.exposeString("contentVersion", { nullable: false }),
      lessonId: t.exposeString("lessonId", { nullable: false }),
      completedMovementIds: t.exposeStringList("completedMovementIds", {
        nullable: false,
      }),
      completedStepIds: t.exposeStringList("completedStepIds", {
        nullable: false,
      }),
      completed: t.exposeBoolean("completed", { nullable: false }),
      completedAt: t.exposeString("completedAt", { nullable: true }),
      resumeCardId: t.exposeString("resumeCardId", { nullable: true }),
      revision: t.exposeInt("revision", { nullable: false }),
      updatedAt: t.exposeString("updatedAt", { nullable: true }),
    }),
  })

const WatchLearningSaveStatus = builder.enumType("WatchLearningSaveStatus", {
  values: ["SAVED", "CONFLICT"] as const,
})

const WatchLearningSaveResultRef = builder
  .objectRef<WatchLearningSaveResult>("WatchLearningSaveResult")
  .implement({
    fields: (t) => ({
      status: t.field({
        type: WatchLearningSaveStatus,
        nullable: false,
        resolve: (result) => result.status,
      }),
      progress: t.field({
        type: WatchLearningLessonProgressRef,
        nullable: false,
        resolve: (result) => result.progress,
      }),
    }),
  })

const WatchLearningProgressSaveInput = builder.inputType(
  "WatchLearningProgressSaveInput",
  {
    fields: (t) => ({
      courseId: t.string({ required: true }),
      contentVersion: t.string({ required: true }),
      lessonId: t.string({ required: true }),
      // The revision the client last read; 0 when it read no row.
      expectedRevision: t.int({ required: true }),
      completedMovementIds: t.stringList({ required: true }),
      completedStepIds: t.stringList({ required: true }),
      completed: t.boolean({ required: true }),
      resumeCardId: t.string({ required: false }),
    }),
  },
)

builder.queryFields((t) => ({
  myWatchLearningProgress: t.field({
    type: [WatchLearningLessonProgressRef],
    nullable: false,
    authScopes: { hasPermission: "read:watch-learning-progress:own" },
    args: {
      courseId: t.arg.string({ required: true }),
      contentVersion: t.arg.string({ required: true }),
    },
    resolve: (_root, args, ctx) => {
      const userId = requireLearningSubject(ctx.user)
      return mapLearningErrors(() =>
        listWatchLearningProgress({
          userId,
          courseId: args.courseId,
          contentVersion: args.contentVersion,
        }),
      )
    },
  }),
}))

builder.mutationFields((t) => ({
  saveMyWatchLearningProgress: t.field({
    type: WatchLearningSaveResultRef,
    nullable: false,
    authScopes: { hasPermission: "write:watch-learning-progress:own" },
    args: {
      input: t.arg({ type: WatchLearningProgressSaveInput, required: true }),
    },
    resolve: (_root, { input }, ctx) => {
      const userId = requireLearningSubject(ctx.user)
      return mapLearningErrors(() =>
        saveWatchLearningProgress({
          userId,
          courseId: input.courseId,
          contentVersion: input.contentVersion,
          lessonId: input.lessonId,
          expectedRevision: input.expectedRevision,
          completedMovementIds: input.completedMovementIds,
          completedStepIds: input.completedStepIds,
          completed: input.completed,
          resumeCardId: input.resumeCardId ?? null,
        }),
      )
    },
  }),
  resetMyWatchLearningProgress: t.field({
    type: WatchLearningSaveResultRef,
    nullable: false,
    authScopes: { hasPermission: "delete:watch-learning-progress:own" },
    args: {
      courseId: t.arg.string({ required: true }),
      contentVersion: t.arg.string({ required: true }),
      lessonId: t.arg.string({ required: true }),
      expectedRevision: t.arg.int({ required: true }),
    },
    resolve: (_root, args, ctx) => {
      const userId = requireLearningSubject(ctx.user)
      return mapLearningErrors(() =>
        resetWatchLearningProgress({
          userId,
          courseId: args.courseId,
          contentVersion: args.contentVersion,
          lessonId: args.lessonId,
          expectedRevision: args.expectedRevision,
        }),
      )
    },
  }),
}))
