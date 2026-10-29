import { z } from "zod"

const identity = z.string().trim().min(1).max(160)
export const ManagerAutomationDryRunInputSchema = z
  .object({
    automationDocumentId: identity,
    requestedBy: z
      .object({
        kind: z.enum(["manager_user", "service"]),
        id: identity,
      })
      .strict(),
    idempotencyKey: z.string().trim().min(1).max(240),
  })
  .strict()

export const ManagerDryRunFailureSchema = z
  .object({
    ok: z.literal(false),
    code: z.enum([
      "unauthorized",
      "not_found",
      "invalid_automation",
      "run_in_progress",
      "idempotency_conflict",
      "config_missing",
      "manager_unavailable",
      "mastra_runtime_error",
    ]),
    message: z.string().min(1).max(2_000),
  })
  .strict()
export const ManagerDryRunSuccessSchema = z
  .object({
    ok: z.literal(true),
    automationDocumentId: identity,
    managerAutomationRunDocumentId: identity,
    runMode: z.literal("dry_run"),
    enqueuedCount: z.literal(0),
    status: z.enum(["success", "partial", "failed", "no_op"]),
    summary: z.string().max(2_000),
    reportUrl: z.string().min(1).max(2_000),
  })
  .strict()
export const ManagerDryRunResultSchema = z.discriminatedUnion("ok", [
  ManagerDryRunSuccessSchema,
  ManagerDryRunFailureSchema,
])
export const ManagerAutomationDryRunResultSchema = z.discriminatedUnion("ok", [
  ManagerDryRunSuccessSchema.extend({ agenticRunId: identity }),
  ManagerDryRunFailureSchema,
])
export type ManagerAutomationDryRunInput = z.output<
  typeof ManagerAutomationDryRunInputSchema
>
export type ManagerDryRunResult = z.output<typeof ManagerDryRunResultSchema>
export type ManagerAutomationDryRunResult = z.output<
  typeof ManagerAutomationDryRunResultSchema
>
