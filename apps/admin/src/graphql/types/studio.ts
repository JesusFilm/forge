import { builder } from "@/graphql/builder"
import { StudioAuthoringService } from "@/services/studio-authoring"
import type {
  StudioActor,
  ShortAttempt,
  StudioCommandResult,
  Short,
  StudioProjectSummary,
  StudioRevision,
  ShortApproval,
} from "@forge/studio-contracts"

const lifecycle = builder.enumType("ShortsLifecycle", {
  values: ["DRAFT", "PUBLISHED", "UNPUBLISHED"] as const,
})
const attemptKind = builder.enumType("ShortsAttemptKind", {
  values: ["GENERATION", "NARRATION", "RENDER"] as const,
})
const attemptStatus = builder.enumType("ShortsAttemptStatus", {
  values: [
    "QUEUED",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "STALE",
  ] as const,
})
const approvalKind = builder.enumType("ShortsApprovalKind", {
  values: ["SCRIPT", "PUBLICATION"] as const,
})
/** @classification public-shape */
const actor = builder.objectRef<StudioActor>("ShortsActor").implement({
  fields: (t) => ({ kind: t.exposeString("kind"), id: t.exposeID("id") }),
})
/** @classification abac-gated */
const project = builder.objectRef<Short>("ShortsProject").implement({
  authScopes: { loggedIn: true },
  fields: (t) => ({
    sourceVideoDubId: t.exposeID("sourceVideoDubId", { nullable: true }),
    projectId: t.exposeID("projectId"),
    revision: t.exposeInt("revision"),
    lifecycle: t.field({ type: lifecycle, resolve: (row) => row.lifecycle }),
    firstPublishedAt: t.exposeString("firstPublishedAt", { nullable: true }),
    document: t.field({ type: "JSON", resolve: (row) => row.document }),
    actor: t.field({ type: actor, resolve: (row) => row.actor }),
  }),
})
/** @classification abac-gated */
const summary = builder
  .objectRef<StudioProjectSummary>("ShortsProjectSummary")
  .implement({
    authScopes: { loggedIn: true },
    fields: (t) => ({
      projectId: t.exposeID("projectId"),
      revision: t.exposeInt("revision"),
      lifecycle: t.field({ type: lifecycle, resolve: (row) => row.lifecycle }),
    }),
  })
/** @classification abac-gated */
const attempt = builder.objectRef<ShortAttempt>("ShortsAttempt").implement({
  authScopes: { loggedIn: true },
  fields: (t) => ({
    id: t.exposeID("id"),
    projectId: t.exposeID("projectId"),
    baseRevision: t.exposeInt("baseRevision"),
    kind: t.field({ type: attemptKind, resolve: (row) => row.kind }),
    status: t.field({ type: attemptStatus, resolve: (row) => row.status }),
    inputHash: t.exposeString("inputHash"),
    actor: t.field({ type: actor, resolve: (row) => row.actor }),
    instructions: t.field({ type: "JSON", resolve: (row) => row.instructions }),
    result: t.field({
      type: "JSON",
      nullable: true,
      resolve: (row) => row.result,
    }),
    jobReference: t.exposeString("jobReference", { nullable: true }),
  }),
})
/** @classification public-shape */
const result = builder
  .objectRef<StudioCommandResult>("ShortsCommandResult")
  .implement({
    fields: (t) => ({
      projectId: t.exposeID("projectId"),
      revision: t.exposeInt("revision"),
      outcome: t.exposeString("outcome"),
      attemptId: t.exposeID("attemptId", { nullable: true }),
      approvalId: t.exposeID("approvalId", { nullable: true }),
    }),
  })
/** @classification abac-gated */
const revision = builder.objectRef<StudioRevision>("ShortsRevision").implement({
  authScopes: { loggedIn: true },
  fields: (t) => ({
    revision: t.exposeInt("revision"),
    document: t.field({ type: "JSON", resolve: (row) => row.document }),
    actor: t.field({ type: actor, resolve: (row) => row.actor }),
  }),
})
/** @classification abac-gated */
const approval = builder.objectRef<ShortApproval>("ShortsApproval").implement({
  authScopes: { loggedIn: true },
  fields: (t) => ({
    id: t.exposeID("id"),
    projectId: t.exposeID("projectId"),
    revision: t.exposeInt("revision"),
    kind: t.field({ type: approvalKind, resolve: (row) => row.kind }),
    dependencyHash: t.exposeString("dependencyHash"),
    renderAttemptId: t.exposeID("renderAttemptId", { nullable: true }),
    actor: t.field({ type: actor, resolve: (row) => row.actor }),
  }),
})
const base = builder.inputType("ShortsRevisionCommandInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
  }),
})
const create = builder.inputType("ShortsCreateInput", {
  fields: (t) => ({
    sourceVideoDubId: t.id(),
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    document: t.field({ type: "JSON", required: true }),
  }),
})
const apply = builder.inputType("ShortsApplyInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    operations: t.field({ type: "JSON", required: true }),
  }),
})
const request = builder.inputType("ShortsRequestInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    kind: t.field({ type: attemptKind, required: true }),
    instructions: t.field({ type: "JSON", required: true }),
  }),
})
const approve = builder.inputType("ShortsApproveInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    kind: t.field({ type: approvalKind, required: true }),
    renderAttemptId: t.id(),
  }),
})
const start = builder.inputType("ShortsStartInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    attemptId: t.id({ required: true }),
    jobReference: t.string({ required: true }),
  }),
})
const complete = builder.inputType("ShortsCompleteInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    attemptId: t.id({ required: true }),
    status: t.field({ type: attemptStatus, required: true }),
    result: t.field({ type: "JSON", required: true }),
    operations: t.field({ type: "JSON", required: true }),
  }),
})

builder.queryFields((t) => ({
  shortsHistory: t.field({
    type: [revision],
    authScopes: { loggedIn: true },
    args: {
      projectId: t.arg.id({ required: true }),
      beforeRevision: t.arg.int(),
      limit: t.arg.int(),
    },
    resolve: (_, args, ctx) =>
      new StudioAuthoringService(ctx.prisma).history(ctx.user, args.projectId, {
        beforeRevision: args.beforeRevision ?? undefined,
        limit: args.limit ?? undefined,
      }),
  }),
  shortsAttempts: t.field({
    type: [attempt],
    authScopes: { loggedIn: true },
    args: {
      projectId: t.arg.id({ required: true }),
      cursor: t.arg.id(),
      limit: t.arg.int(),
    },
    resolve: (_, args, ctx) =>
      new StudioAuthoringService(ctx.prisma).attempts(
        ctx.user,
        args.projectId,
        { cursor: args.cursor ?? undefined, limit: args.limit ?? undefined },
      ),
  }),
  shortsApprovals: t.field({
    type: [approval],
    authScopes: { loggedIn: true },
    args: {
      projectId: t.arg.id({ required: true }),
      cursor: t.arg.id(),
      limit: t.arg.int(),
    },
    resolve: (_, args, ctx) =>
      new StudioAuthoringService(ctx.prisma).approvals(
        ctx.user,
        args.projectId,
        { cursor: args.cursor ?? undefined, limit: args.limit ?? undefined },
      ),
  }),
  shortsProject: t.field({
    type: project,
    authScopes: { loggedIn: true },
    args: { projectId: t.arg.id({ required: true }) },
    resolve: (_, args, ctx) =>
      new StudioAuthoringService(ctx.prisma).read(ctx.user, args.projectId),
  }),
  shortsProjects: t.field({
    type: [summary],
    authScopes: { loggedIn: true },
    args: { cursor: t.arg.id(), limit: t.arg.int() },
    resolve: (_, args, ctx) =>
      new StudioAuthoringService(ctx.prisma).list(ctx.user, {
        cursor: args.cursor ?? undefined,
        limit: args.limit ?? undefined,
      }),
  }),
  shortsAttempt: t.field({
    type: attempt,
    authScopes: { loggedIn: true },
    args: {
      projectId: t.arg.id({ required: true }),
      attemptId: t.arg.id({ required: true }),
    },
    resolve: (_, args, ctx) =>
      new StudioAuthoringService(ctx.prisma).readAttempt(
        ctx.user,
        args.projectId,
        args.attemptId,
      ),
  }),
}))
builder.mutationFields((t) => ({
  createShortsProject: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: create, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).create(ctx.user, input),
  }),
  applyShortsOperations: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: apply, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).apply(ctx.user, input),
  }),
  requestShortsAttempt: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: request, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).request(ctx.user, input),
  }),
  approveShortsProject: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: approve, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).approve(ctx.user, {
        ...input,
        renderAttemptId: input.renderAttemptId ?? undefined,
      }),
  }),
  startShortsAttempt: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: start, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).start(ctx.user, input),
  }),
  completeShortsAttempt: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: complete, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).complete(ctx.user, input),
  }),
  unpublishShortsProject: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: base, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).unpublish(ctx.user, input),
  }),
}))
