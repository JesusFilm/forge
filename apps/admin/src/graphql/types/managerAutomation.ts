import { z } from "zod"
import { builder } from "@/graphql/builder"

const createRunInput = z
  .object({
    automationDocumentId: z.string().min(1),
    leaseToken: z.string().uuid(),
    runMode: z.enum(["live", "dry_run"]),
    scheduledFor: z.string().datetime(),
    idempotencyKey: z.string().min(1).max(240).optional(),
  })
  .strict()

builder.queryFields((t) => ({
  managerAutomations: t.field({
    type: ["JSON"],
    authScopes: { hasPermission: "write:manager-jobs" },
    resolve: (_r, _a, ctx) => ctx.services.managerAutomation.list(ctx.user),
  }),
  managerAutomation: t.field({
    type: "JSON",
    nullable: true,
    authScopes: { hasPermission: "write:manager-jobs" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.get(ctx.user, String(a.id)),
  }),
  managerAutomationRun: t.field({
    type: "JSON",
    nullable: true,
    authScopes: { hasPermission: "write:manager-jobs" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.getRun(ctx.user, String(a.id)),
  }),
  managerAutomationRunByKey: t.field({
    type: "JSON",
    nullable: true,
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      automationId: t.arg.id({ required: true }),
      key: t.arg.string({ required: true }),
    },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.findRun(
        ctx.user,
        String(a.automationId),
        a.key,
      ),
  }),
  managerAutomationHasInFlight: t.field({
    type: "Boolean",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.hasInFlight(ctx.user, String(a.id)),
  }),
  managerAutomationCandidates: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.candidates(ctx.user, a.input),
  }),
  managerAutomationLanguages: t.field({
    type: ["JSON"],
    authScopes: { hasPermission: "write:manager-jobs" },
    resolve: (_r, _a, ctx) =>
      ctx.services.managerAutomation.languages(ctx.user),
  }),
}))
builder.mutationFields((t) => ({
  beginManagerAutomationDispatch: t.field({
    type: "Boolean",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      id: t.arg.id({ required: true }),
      leaseToken: t.arg.string({ required: true }),
    },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.beginDispatch(
        ctx.user,
        String(a.id),
        a.leaseToken,
      ),
  }),
  createManagerAutomation: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.create(ctx.user, a.input),
  }),
  updateManagerAutomationStatus: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      id: t.arg.id({ required: true }),
      status: t.arg.string({ required: true }),
    },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.updateStatus(
        ctx.user,
        String(a.id),
        z.enum(["active", "paused"]).parse(a.status),
      ),
  }),
  claimManagerAutomationRun: t.field({
    type: "JSON",
    nullable: true,
    authScopes: { hasPermission: "write:manager-jobs" },
    args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.claim(ctx.user, String(a.id)),
  }),
  releaseManagerAutomationRun: t.field({
    type: "Boolean",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      id: t.arg.id({ required: true }),
      leaseToken: t.arg.string({ required: true }),
    },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.release(
        ctx.user,
        String(a.id),
        a.leaseToken,
      ),
  }),
  createManagerAutomationRun: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.createRun(
        ctx.user,
        createRunInput.parse(a.input),
      ),
  }),
  completeManagerAutomationRun: t.field({
    type: "JSON",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      id: t.arg.id({ required: true }),
      leaseToken: t.arg.string({ required: true }),
      result: t.arg({ type: "JSON", required: true }),
    },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.completeRun(
        ctx.user,
        String(a.id),
        a.result,
        a.leaseToken,
      ),
  }),
  failManagerAutomationRun: t.field({
    type: "Boolean",
    authScopes: { hasPermission: "write:manager-jobs" },
    args: {
      id: t.arg.id({ required: true }),
      leaseToken: t.arg.string({ required: true }),
      error: t.arg.string({ required: true }),
    },
    resolve: (_r, a, ctx) =>
      ctx.services.managerAutomation.failIfInFlight(
        ctx.user,
        String(a.id),
        z.string().max(2000).parse(a.error),
        a.leaseToken,
      ),
  }),
}))
