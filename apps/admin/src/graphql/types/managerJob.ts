import { builder } from "@/graphql/builder"
import type {
  ManagerJobRecord,
  ManagerJobStep,
  ManagerJobStatus,
  ManagerStepStatus,
} from "@/services/manager-job.service"

const ManagerJobStatusEnum = builder.enumType("ManagerJobStatus", {
  values: {
    pending: { value: "pending" },
    running: { value: "running" },
    completed: { value: "completed" },
    failed: { value: "failed" },
  } as const,
})

const ManagerJobStepStatusEnum = builder.enumType("ManagerJobStepStatus", {
  values: {
    pending: { value: "pending" },
    running: { value: "running" },
    completed: { value: "completed" },
    failed: { value: "failed" },
    skipped: { value: "skipped" },
  } as const,
})

const ManagerJobStepInput = builder.inputType("ManagerJobStepInput", {
  fields: (t) => ({
    name: t.string({ required: true }),
    status: t.field({ type: ManagerJobStepStatusEnum, required: true }),
    retries: t.int({ required: false }),
    startedAt: t.string({ required: false }),
    finishedAt: t.string({ required: false }),
    error: t.string({ required: false }),
    details: t.field({ type: "JSON", required: false }),
  }),
})

const ManagerJobStepRef = builder
  .objectRef<ManagerJobStep>("ManagerJobStep")
  .implement({
    fields: (t) => ({
      name: t.exposeString("name"),
      status: t.exposeString("status"),
      retries: t.exposeInt("retries"),
      startedAt: t.exposeString("startedAt", { nullable: true }),
      finishedAt: t.exposeString("finishedAt", { nullable: true }),
      error: t.exposeString("error", { nullable: true }),
      details: t.field({
        type: "JSON",
        nullable: true,
        resolve: (row) => row.details,
      }),
    }),
  })

const ManagerJobRef = builder
  .objectRef<ManagerJobRecord>("ManagerJob")
  .implement({
    fields: (t) => ({
      id: t.exposeID("id"),
      muxAssetId: t.exposeString("muxAssetId"),
      muxPlaybackId: t.exposeString("muxPlaybackId"),
      videoDocumentId: t.exposeString("videoDocumentId", { nullable: true }),
      languages: t.field({ type: ["String"], resolve: (row) => row.languages }),
      sourceLanguageId: t.exposeString("sourceLanguageId", { nullable: true }),
      sourceLanguageCode: t.exposeString("sourceLanguageCode", {
        nullable: true,
      }),
      sourceSelectionReason: t.exposeString("sourceSelectionReason", {
        nullable: true,
      }),
      primaryRequestedTargetLanguageCode: t.exposeString(
        "primaryRequestedTargetLanguageCode",
        { nullable: true },
      ),
      resolvedTargetLanguageCodes: t.field({
        type: ["String"],
        resolve: (row) => row.resolvedTargetLanguageCodes ?? [],
      }),
      sourceCollectionTitle: t.exposeString("sourceCollectionTitle", {
        nullable: true,
      }),
      sourceMediaTitle: t.exposeString("sourceMediaTitle", { nullable: true }),
      requestedLanguageAbbreviations: t.field({
        type: ["String"],
        resolve: (row) => row.requestedLanguageAbbreviations ?? [],
      }),
      options: t.field({ type: "JSON", resolve: (row) => row.options }),
      status: t.exposeString("status"),
      currentStep: t.exposeString("currentStep", { nullable: true }),
      retries: t.exposeInt("retries"),
      createdAt: t.exposeString("createdAt"),
      updatedAt: t.exposeString("updatedAt"),
      startedAt: t.exposeString("startedAt", { nullable: true }),
      completedAt: t.exposeString("completedAt", { nullable: true }),
      artifacts: t.field({ type: "JSON", resolve: (row) => row.artifacts }),
      steps: t.field({
        type: [ManagerJobStepRef],
        resolve: (row) => row.steps,
      }),
      errors: t.field({ type: "JSON", resolve: (row) => row.errors }),
    }),
  })

function parseStepInputs(
  steps:
    | Array<{
        name: string
        status: ManagerStepStatus
        retries?: number | null
        startedAt?: string | null
        finishedAt?: string | null
        error?: string | null
        details?: unknown
      }>
    | null
    | undefined,
): ManagerJobStep[] | undefined {
  return steps?.map((step) => ({
    name: step.name,
    status: step.status,
    retries: step.retries ?? 0,
    ...(step.startedAt ? { startedAt: step.startedAt } : {}),
    ...(step.finishedAt ? { finishedAt: step.finishedAt } : {}),
    ...(step.error ? { error: step.error } : {}),
    ...(step.details !== undefined ? { details: step.details } : {}),
  }))
}

function parseErrors(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : []
}

builder.queryFields((t) => ({
  managerJobs: t.field({
    type: [ManagerJobRef],
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      limit: t.arg.int({ required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.managerJob.list({
        user: ctx.user,
        limit: args.limit ?? 50,
      }),
  }),
  managerJob: t.field({
    type: ManagerJobRef,
    authScopes: { hasPermission: "write:manager-jobs" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.managerJob.get({ user: ctx.user, id: String(args.id) }),
  }),
}))

builder.mutationFields((t) => ({
  createManagerJob: t.field({
    type: ManagerJobRef,
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      muxAssetId: t.arg.string({ required: true }),
      muxPlaybackId: t.arg.string({ required: false }),
      videoDocumentId: t.arg.string({ required: false }),
      languages: t.arg.stringList({ required: false }),
      options: t.arg({ type: "JSON", required: false }),
      steps: t.arg({ type: [ManagerJobStepInput], required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.managerJob.create({
        user: ctx.user,
        input: {
          muxAssetId: args.muxAssetId,
          ...(args.muxPlaybackId != null
            ? { muxPlaybackId: args.muxPlaybackId }
            : {}),
          ...(args.videoDocumentId != null
            ? { videoDocumentId: args.videoDocumentId }
            : {}),
          languages: args.languages?.filter(Boolean) ?? [],
          ...(args.options !== undefined ? { options: args.options } : {}),
          steps: parseStepInputs(args.steps),
        },
      }),
  }),
  updateManagerJob: t.field({
    type: ManagerJobRef,
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      id: t.arg.id({ required: true }),
      status: t.arg({ type: ManagerJobStatusEnum, required: false }),
      currentStep: t.arg.string({ required: false }),
      retries: t.arg.int({ required: false }),
      startedAt: t.arg.string({ required: false }),
      completedAt: t.arg.string({ required: false }),
      artifacts: t.arg({ type: "JSON", required: false }),
      steps: t.arg({ type: [ManagerJobStepInput], required: false }),
      errors: t.arg({ type: "JSON", required: false }),
      options: t.arg({ type: "JSON", required: false }),
    },
    resolve: (_root, args, ctx) =>
      ctx.services.managerJob.update({
        user: ctx.user,
        id: String(args.id),
        input: {
          ...(args.status != null
            ? { status: args.status as ManagerJobStatus }
            : {}),
          ...(args.currentStep !== undefined
            ? { currentStep: args.currentStep ?? undefined }
            : {}),
          ...(args.retries !== undefined
            ? { retries: args.retries ?? undefined }
            : {}),
          ...(args.startedAt !== undefined
            ? { startedAt: args.startedAt ? new Date(args.startedAt) : null }
            : {}),
          ...(args.completedAt !== undefined
            ? {
                completedAt: args.completedAt
                  ? new Date(args.completedAt)
                  : null,
              }
            : {}),
          ...(args.artifacts !== undefined
            ? { artifacts: args.artifacts }
            : {}),
          ...(args.steps !== undefined
            ? { steps: parseStepInputs(args.steps) }
            : {}),
          ...(args.errors !== undefined
            ? { errors: parseErrors(args.errors) }
            : {}),
          ...(args.options !== undefined && args.options !== null
            ? { options: args.options }
            : {}),
        },
      }),
  }),
}))
