// systemStatus query — exposes per-phase sync watermarks and lag.
// triggerSync mutation — ADMIN-only, enqueues a Core sync run.

import { builder } from "@/graphql/builder"
import { getSyncStatus } from "@/services/core-sync/orchestrator"
import { dispatchCoreSync } from "@/services/core-sync/job"

export function parseSyncScopeArg(scope?: string | null): string[] | undefined {
  if (!scope) return undefined
  return scope
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

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
      "Enqueue a Core sync run. ADMIN only. Returns workflow dispatch metadata.",
    args: {
      scope: t.arg.string({
        required: false,
        description:
          'Phase scope: "all" or a comma-separated list like "languages,videos"',
      }),
      incremental: t.arg.boolean({ required: false, defaultValue: true }),
    },
    resolve: async (_root, args, ctx) => {
      void ctx
      return dispatchCoreSync({
        scope: parseSyncScopeArg(args.scope),
        incremental: args.incremental ?? true,
        trigger: "graphql",
      })
    },
  }),
}))
