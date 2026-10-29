import { builder } from "@/graphql/builder"

// Service-only commands. JSON avoids coupling consumers to durable ledger rows;
// the service validates every field and bounds the persisted completion result.
// Both the permission and service-role checks run before invoking the service.
builder.mutationFields((t) => ({
  claimManagerExecutionOperation: t.field({
    type: "JSON",
    nullable: false,
    authScopes: {
      $all: { hasPermission: "write:manager-jobs", role: "MANAGER_BACKEND" },
    },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.managerExecution.claim({
        user: ctx.user,
        input: args.input,
      }),
  }),
  completeManagerExecutionOperation: t.field({
    type: "JSON",
    nullable: false,
    authScopes: {
      $all: { hasPermission: "write:manager-jobs", role: "MANAGER_BACKEND" },
    },
    args: { input: t.arg({ type: "JSON", required: true }) },
    resolve: (_root, args, ctx) =>
      ctx.services.managerExecution.complete({
        user: ctx.user,
        input: args.input,
      }),
  }),
}))
