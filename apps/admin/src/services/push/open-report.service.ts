/**
 * R23 and KTD14 — the app reports a tap by the delivery nonce it carried.
 *
 * The nonce is the only campaign identifier the app ever holds, and it is
 * opaque to it. Admin resolves it to the delivery, stores one open per
 * delivery, and snapshots the language and country the delivery went out
 * with, so the report reads the same numbers a year later.
 *
 * SECURITY: no log line here carries the nonce, a handle, or a digest.
 */
import type { PrismaClient } from "@prisma/client"
import { z } from "zod"

import { PushOpenReportInputSchema } from "./contracts"
import { PushInputError } from "./errors"

export type PushOpenOutcome = "STORED" | "DUPLICATE" | "UNKNOWN"

export type PushOpenReceipt = Readonly<{ outcome: PushOpenOutcome }>

export type PushOpenReportRequest = Readonly<{
  input: unknown
  viewerDigest: string | null
  sessionDigest: string | null
}>

/** What the stored open hands the attribution seam. */
export type PushStoredOpen = Readonly<{
  id: string
  deliveryId: string
  campaignId: string
  registrationId: string | null
  viewerDigest: string | null
  sessionDigest: string | null
  languageSlug: string | null
  country: string | null
  viewerMismatch: boolean
  receivedAt: Date
  /** KTD8 reads this to bound which episodes may attribute. */
  deliverySendingAt: Date | null
}>

/**
 * U5's seam. KTD8 materializes attribution from both directions, and this is
 * the open-report direction's single call site. It runs after the open is
 * stored, and a failure here never changes the receipt.
 */
export type PushOpenStoredHook = (open: PushStoredOpen) => void | Promise<void>

const DELIVERY_SELECT = {
  id: true,
  campaignId: true,
  registrationId: true,
  languageSlug: true,
  country: true,
  sendingAt: true,
  registration: { select: { viewerDigest: true } },
} as const

type DeliveryRow = {
  id: string
  campaignId: string
  registrationId: string | null
  languageSlug: string | null
  country: string | null
  sendingAt: Date | null
  registration: { viewerDigest: string | null } | null
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  )
}

export async function reportPushOpen(
  prisma: PrismaClient,
  request: PushOpenReportRequest,
  options: { afterOpenStored?: PushOpenStoredHook } = {},
): Promise<PushOpenReceipt> {
  let nonce: string
  try {
    nonce = PushOpenReportInputSchema.parse(request.input).nonce
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new PushInputError(
        error.issues.map((issue) => issue.message).join("; "),
      )
    }
    throw error
  }

  const delivery = (await prisma.pushDelivery.findUnique({
    where: { nonce },
    select: DELIVERY_SELECT,
  })) as DeliveryRow | null

  if (delivery === null) {
    // A nonce nobody issued. It is counted, never stored, and never echoed.
    console.info(`[push] event=open_unknown_nonce`)
    return { outcome: "UNKNOWN" }
  }

  const storedDigest = delivery.registration?.viewerDigest ?? null
  const handleDigest = request.viewerDigest
  const viewerMismatch =
    handleDigest != null &&
    storedDigest != null &&
    handleDigest !== storedDigest

  const data = {
    deliveryId: delivery.id,
    campaignId: delivery.campaignId,
    registrationId: delivery.registrationId,
    // A handle-less open binds to the delivery's own registration, so a phone
    // with no viewer identity still attributes through the row it was sent to.
    viewerDigest: handleDigest ?? storedDigest,
    sessionDigest: request.sessionDigest,
    languageSlug: delivery.languageSlug,
    country: delivery.country,
    viewerMismatch,
    receivedAt: new Date(),
  }

  let stored: { id: string } | null = null
  try {
    stored = (await prisma.pushOpen.create({
      data,
      select: { id: true },
    })) as { id: string }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // The open table is unique on the delivery, so a replayed report is the
    // same tap arriving twice. It is a receipt, not a failure.
    console.info(
      `[push] event=open outcome=duplicate viewer_mismatch=${viewerMismatch}`,
    )
    return { outcome: "DUPLICATE" }
  }

  console.info(
    `[push] event=open outcome=stored viewer_mismatch=${viewerMismatch} handle=${handleDigest != null}`,
  )

  if (options.afterOpenStored) {
    try {
      await options.afterOpenStored({
        ...data,
        id: stored.id,
        deliverySendingAt: delivery.sendingAt,
      })
    } catch (error) {
      // The open is stored. Reporting a failure would make the app retry a
      // write that already landed.
      console.error(
        `[push] event=open_attribution_failed error=${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return { outcome: "STORED" }
}
