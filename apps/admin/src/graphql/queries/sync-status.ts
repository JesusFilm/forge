// systemStatus query — exposes per-phase sync watermarks and lag.
// triggerSync mutation — ADMIN-only, kicks off a Core sync run.

import { builder } from "@/graphql/builder"
import { getSyncStatus, runSync } from "@/services/core-sync/orchestrator"

builder.queryFields((t) => ({
  systemStatus: t.field({
    type: "JSON",
    authScopes: { hasPermission: "read:reference" },
    description:
      "Per-phase Core sync watermarks and stats. Shows when each phase last synced and its row counts.",
    resolve: (_root, _args, ctx) => getSyncStatus(ctx.prisma),
  }),
}))

builder.mutationFields((t) => ({
  triggerSync: t.field({
    type: "JSON",
    authScopes: { hasPermission: "system:trigger-workflow" },
    description:
      "Trigger a Core sync run. ADMIN only. Returns sync result with per-phase stats.",
    args: {
      scope: t.arg.string({
        required: false,
        description:
          'Phase scope: "all" or a comma-separated list like "languages,videos"',
      }),
      incremental: t.arg.boolean({ required: false, defaultValue: true }),
    },
    resolve: async (_root, args, ctx) => {
      const scope = args.scope
        ? args.scope.split(",").map((s) => s.trim())
        : undefined
      return runSync(ctx.prisma, {
        scope,
        incremental: args.incremental ?? true,
      })
    },
  }),
}))
