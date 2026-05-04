import { z } from "zod"

export const requestedBySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manager_user"),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal("service"),
    id: z.string().min(1),
  }),
])

export const startManagerAutomationDryRunRequestSchema = z
  .object({
    automationDocumentId: z.string().min(1),
    requestedBy: requestedBySchema,
    idempotencyKey: z.string().min(1),
  })
  .strict()

export type StartManagerAutomationDryRunRequest = z.infer<
  typeof startManagerAutomationDryRunRequestSchema
>

const successStatusSchema = z.enum([
  "queued",
  "running",
  "success",
  "no_op",
  "failed",
])

export const managerFailureCodeSchema = z.enum([
  "unauthorized",
  "not_found",
  "invalid_automation",
  "run_in_progress",
  "manager_unavailable",
  "mastra_runtime_error",
])

export type ManagerFailureCode = z.infer<typeof managerFailureCodeSchema>

export const startManagerAutomationDryRunResponseSchema = z.discriminatedUnion(
  "ok",
  [
    z.object({
      ok: z.literal(true),
      agenticRunId: z.string().min(1),
      managerAutomationRunDocumentId: z.string().min(1),
      status: successStatusSchema,
      reportUrl: z.string().min(1).optional(),
      summary: z.string().min(1),
    }),
    z.object({
      ok: z.literal(false),
      code: managerFailureCodeSchema,
      message: z.string().min(1),
    }),
  ],
)

export type StartManagerAutomationDryRunResponse = z.infer<
  typeof startManagerAutomationDryRunResponseSchema
>

export const managerDryRunToolOutputSchema = z.object({
  managerAutomationRunDocumentId: z.string().min(1),
  status: successStatusSchema,
  reportUrl: z.string().min(1).optional(),
  summary: z.string().min(1),
})

export type ManagerDryRunToolOutput = z.infer<
  typeof managerDryRunToolOutputSchema
>

export const managerDryRunResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    automationDocumentId: z.string().min(1),
    managerAutomationRunDocumentId: z.string().min(1),
    status: z.enum([
      "queued",
      "running",
      "success",
      "no_op",
      "failed",
      "partial",
    ]),
    summary: z.string().min(1),
    reportUrl: z.string().min(1).optional(),
    report: z
      .object({
        data: z
          .object({
            runMode: z.literal("dry_run"),
            enqueuedCount: z.number().int().min(0).optional(),
            wouldEnqueueCount: z.number().int().min(0).optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
])

export type ManagerDryRunResponse = z.infer<typeof managerDryRunResponseSchema>
