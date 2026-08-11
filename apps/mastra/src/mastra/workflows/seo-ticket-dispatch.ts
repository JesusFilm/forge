import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { getSeoConfig, type SeoConfig } from "../../config/seo"
import {
  claimSeoTickets,
  updateSeoTicket,
} from "../../services/admin-seo-client"
import {
  createLinearTicket,
  reconcileLinearTicket,
} from "../../services/linear-ticket-client"

export const SeoTicketDispatchInputSchema = z
  .object({ scheduledFor: z.string().datetime().optional() })
  .strict()
export const SeoTicketDispatchOutputSchema = z
  .object({
    ok: z.boolean(),
    mode: z.enum(["off", "dry_run", "live"]),
    claimed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    retryable: z.number().int().nonnegative(),
    manualReconcile: z.number().int().nonnegative(),
    staleFence: z.number().int().nonnegative(),
  })
  .strict()

export async function runSeoTicketDispatch(
  rawInput: z.input<typeof SeoTicketDispatchInputSchema>,
  deps: {
    config?: SeoConfig
    claim?: typeof claimSeoTickets
    update?: typeof updateSeoTicket
    reconcile?: typeof reconcileLinearTicket
    create?: typeof createLinearTicket
  } = {},
) {
  const input = SeoTicketDispatchInputSchema.parse(rawInput)
  const config = deps.config ?? getSeoConfig()
  if (config.automationMode !== "live") {
    return SeoTicketDispatchOutputSchema.parse({
      ok: true,
      mode: config.automationMode,
      claimed: 0,
      completed: 0,
      retryable: 0,
      manualReconcile: 0,
      staleFence: 0,
    })
  }
  const scheduledFor = input.scheduledFor ?? new Date().toISOString()
  const claim = await (deps.claim ?? claimSeoTickets)({
    action: "claim",
    leaseSeconds: 180,
  })
  if (!claim.ok) {
    return SeoTicketDispatchOutputSchema.parse({
      ok: false,
      mode: "live",
      claimed: 0,
      completed: 0,
      retryable: 1,
      manualReconcile: 0,
      staleFence: 0,
    })
  }
  let completed = 0
  let retryable = 0
  let manualReconcile = 0
  let staleFence = 0
  for (const entry of claim.result.entries) {
    const fence = {
      outboxId: entry.outboxId,
      generation: entry.generation,
      leaseToken: entry.leaseToken,
    }
    let ticket: { id: string; url: string } | null = null
    const reconciled = await (deps.reconcile ?? reconcileLinearTicket)(
      { marker: entry.marker, payloadDigest: entry.payloadDigest },
      { config },
    )
    if (reconciled.ok && reconciled.status === "found") {
      ticket = reconciled.ticket
    } else if (!reconciled.ok && reconciled.ambiguous) {
      const update = await (deps.update ?? updateSeoTicket)({
        action: "manual_reconcile",
        ...fence,
        errorCode: "reconciliation_ambiguous",
        candidates: reconciled.candidates ?? [],
      })
      if (update.ok) manualReconcile += 1
      else staleFence += 1
      continue
    } else if (!reconciled.ok) {
      const update = await (deps.update ?? updateSeoTicket)({
        action: "retry",
        ...fence,
        errorCode: reconciled.reason,
        nextAttemptAt: new Date(
          Date.parse(scheduledFor) + 5 * 60_000,
        ).toISOString(),
      })
      if (update.ok) retryable += 1
      else staleFence += 1
      continue
    } else {
      const created = await (deps.create ?? createLinearTicket)(
        {
          marker: entry.marker,
          payloadDigest: entry.payloadDigest,
          brief: entry.payload,
        },
        { config },
      )
      if (created.ok) ticket = created.ticket
      else if (created.ambiguous) {
        // A timeout may have succeeded remotely. Reconcile exactly once and
        // fence off automatic creation when visibility is delayed or unclear.
        const afterAmbiguous = await (deps.reconcile ?? reconcileLinearTicket)(
          { marker: entry.marker, payloadDigest: entry.payloadDigest },
          { config },
        )
        if (afterAmbiguous.ok && afterAmbiguous.status === "found") {
          ticket = afterAmbiguous.ticket
        } else {
          const update = await (deps.update ?? updateSeoTicket)({
            action: "manual_reconcile",
            ...fence,
            errorCode: "remote_success_ambiguous",
            candidates: !afterAmbiguous.ok
              ? (afterAmbiguous.candidates ?? [])
              : [],
          })
          if (update.ok) manualReconcile += 1
          else staleFence += 1
          continue
        }
      } else {
        const update = await (deps.update ?? updateSeoTicket)({
          action: "retry",
          ...fence,
          errorCode: created.reason,
          nextAttemptAt: new Date(
            Date.parse(scheduledFor) + 5 * 60_000,
          ).toISOString(),
        })
        if (update.ok) retryable += 1
        else staleFence += 1
        continue
      }
    }
    const update = await (deps.update ?? updateSeoTicket)({
      action: "complete",
      ...fence,
      remoteId: ticket!.id,
      remoteUrl: ticket!.url,
    })
    if (update.ok) completed += 1
    else staleFence += 1
  }
  return SeoTicketDispatchOutputSchema.parse({
    ok: staleFence === 0,
    mode: "live",
    claimed: claim.result.entries.length,
    completed,
    retryable,
    manualReconcile,
    staleFence,
  })
}

const dispatchStep = createStep({
  id: "dispatch-seo-tickets",
  inputSchema: SeoTicketDispatchInputSchema,
  outputSchema: SeoTicketDispatchOutputSchema,
  execute: async ({ inputData }) => runSeoTicketDispatch(inputData),
})

export const seoTicketDispatchWorkflow = createWorkflow({
  id: "seo-ticket-dispatch",
  description:
    "Default-off fenced delivery of already-approved immutable engineering briefs.",
  inputSchema: SeoTicketDispatchInputSchema,
  outputSchema: SeoTicketDispatchOutputSchema,
  schedule: { cron: "*/10 * * * *", timezone: "UTC" },
})
  .then(dispatchStep)
  .commit()
