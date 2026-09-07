import { builder } from "@/graphql/builder"
import { StudioAuthoringService } from "@/services/studio-authoring"
import type {
  StudioActor,
  StudioAttempt,
  StudioCommandResult,
  StudioProject,
  StudioProjectSummary,
  StudioRevision,
  StudioApproval,
} from "@forge/studio-contracts"

const lifecycle = builder.enumType("StudioLifecycle", {
  values: ["DRAFT", "PUBLISHED", "UNPUBLISHED"] as const,
})
const attemptKind = builder.enumType("StudioAttemptKind", {
  values: ["GENERATION", "NARRATION", "RENDER"] as const,
})
const attemptStatus = builder.enumType("StudioAttemptStatus", {
  values: [
    "QUEUED",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "STALE",
  ] as const,
})
const approvalKind = builder.enumType("StudioApprovalKind", {
  values: ["SCRIPT", "PUBLICATION"] as const,
})
/** @classification public-shape */
const actor = builder.objectRef<StudioActor>("StudioActor").implement({
  fields: (t) => ({ kind: t.exposeString("kind"), id: t.exposeID("id") }),
})
/** @classification abac-gated */
const project = builder.objectRef<StudioProject>("StudioProject").implement({
  authScopes: { loggedIn: true },
  fields: (t) => ({
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
  .objectRef<StudioProjectSummary>("StudioProjectSummary")
  .implement({
    authScopes: { loggedIn: true },
    fields: (t) => ({
      projectId: t.exposeID("projectId"),
      revision: t.exposeInt("revision"),
      lifecycle: t.field({ type: lifecycle, resolve: (row) => row.lifecycle }),
    }),
  })
/** @classification abac-gated */
const attempt = builder.objectRef<StudioAttempt>("StudioAttempt").implement({
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
  .objectRef<StudioCommandResult>("StudioCommandResult")
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
const revision = builder.objectRef<StudioRevision>("StudioRevision").implement({
  authScopes: { loggedIn: true },
  fields: (t) => ({
    revision: t.exposeInt("revision"),
    document: t.field({ type: "JSON", resolve: (row) => row.document }),
    actor: t.field({ type: actor, resolve: (row) => row.actor }),
  }),
})
/** @classification abac-gated */
const approval = builder.objectRef<StudioApproval>("StudioApproval").implement({
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
const base = builder.inputType("StudioRevisionCommandInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
  }),
})
const create = builder.inputType("StudioCreateInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    document: t.field({ type: "JSON", required: true }),
  }),
})
const apply = builder.inputType("StudioApplyInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    operations: t.field({ type: "JSON", required: true }),
  }),
})
const request = builder.inputType("StudioRequestInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    kind: t.field({ type: attemptKind, required: true }),
    instructions: t.field({ type: "JSON", required: true }),
  }),
})
const approve = builder.inputType("StudioApproveInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    kind: t.field({ type: approvalKind, required: true }),
    renderAttemptId: t.id(),
  }),
})
const start = builder.inputType("StudioStartInput", {
  fields: (t) => ({
    projectId: t.id({ required: true }),
    expectedRevision: t.int({ required: true }),
    idempotencyKey: t.string({ required: true }),
    attemptId: t.id({ required: true }),
    jobReference: t.string({ required: true }),
  }),
})
const complete = builder.inputType("StudioCompleteInput", {
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
  studioHistory: t.field({
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
  studioAttempts: t.field({
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
  studioApprovals: t.field({
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
  studioProject: t.field({
    type: project,
    authScopes: { loggedIn: true },
    args: { projectId: t.arg.id({ required: true }) },
    resolve: (_, args, ctx) =>
      new StudioAuthoringService(ctx.prisma).read(ctx.user, args.projectId),
  }),
  studioProjects: t.field({
    type: [summary],
    authScopes: { loggedIn: true },
    args: { cursor: t.arg.id(), limit: t.arg.int() },
    resolve: (_, args, ctx) =>
      new StudioAuthoringService(ctx.prisma).list(ctx.user, {
        cursor: args.cursor ?? undefined,
        limit: args.limit ?? undefined,
      }),
  }),
  studioAttempt: t.field({
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
  createStudioProject: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: create, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).create(ctx.user, input),
  }),
  applyStudioOperations: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: apply, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).apply(ctx.user, input),
  }),
  requestStudioAttempt: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: request, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).request(ctx.user, input),
  }),
  approveStudioProject: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: approve, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).approve(ctx.user, {
        ...input,
        renderAttemptId: input.renderAttemptId ?? undefined,
      }),
  }),
  startStudioAttempt: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: start, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).start(ctx.user, input),
  }),
  completeStudioAttempt: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: complete, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).complete(ctx.user, input),
  }),
  unpublishStudioProject: t.field({
    type: result,
    authScopes: { loggedIn: true },
    args: { input: t.arg({ type: base, required: true }) },
    resolve: (_, { input }, ctx) =>
      new StudioAuthoringService(ctx.prisma).unpublish(ctx.user, input),
  }),
}))
