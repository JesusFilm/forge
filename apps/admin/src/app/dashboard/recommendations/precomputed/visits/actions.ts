"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { configurePrivatePrecomputedExperiment } from "@/services/recommendations/precomputed/visit-admission"
import {
  declareFixturePrecomputedCtrPolicy,
  evaluatePrivatePrecomputedCtr,
} from "@/services/recommendations/precomputed/ctr-report"

export async function createPrivatePrecomputedTest(formData: FormData) {
  const operator = await requireSession()
  const generationId = String(formData.get("generationId") ?? "").trim()
  const startsValue = String(formData.get("startsAt") ?? "")
  const endsValue = String(formData.get("endsAt") ?? "")
  if (
    !/Z$|[+-]\d\d:\d\d$/.test(startsValue) ||
    !/Z$|[+-]\d\d:\d\d$/.test(endsValue)
  )
    throw new Error("A time-zone offset is required")
  const startsAt = new Date(startsValue)
  const endsAt = new Date(endsValue)
  if (!generationId || generationId.length > 191)
    throw new Error("Invalid generation")
  const id = `private-watch-${randomUUID()}`
  await configurePrivatePrecomputedExperiment(prisma, {
    id,
    generationId,
    startsAt,
    endsAt,
    operator,
  })
  revalidatePath("/dashboard/recommendations/precomputed/visits")
  redirect(`/dashboard/recommendations/precomputed/visits?experiment=${id}`)
}

function experimentId(formData: FormData): string {
  const id = String(formData.get("experimentId") ?? "").trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,190}$/.test(id))
    throw new Error("Invalid experiment")
  return id
}

export async function createFixturePrecomputedCtrPolicy(formData: FormData) {
  const operator = await requireSession()
  const id = experimentId(formData)
  const number = (name: string) => {
    const value = formData.get(name)
    if (typeof value !== "string" || value.trim() === "")
      throw new Error("Missing fixture policy setting")
    return Number(value)
  }
  try {
    await declareFixturePrecomputedCtrPolicy(prisma, {
      experimentId: id,
      operator,
      settings: {
        baselineHumanVisitCtr: number("baselineHumanVisitCtr"),
        minimumDetectableAbsoluteUplift: number(
          "minimumDetectableAbsoluteUplift",
        ),
        minimumPracticalAbsoluteUplift: number(
          "minimumPracticalAbsoluteUplift",
        ),
        plannedPower: number("plannedPower"),
        minimumEligibleVisitsPerArm: number("minimumEligibleVisitsPerArm"),
        minimumIndependentBrowsersPerArm: number(
          "minimumIndependentBrowsersPerArm",
        ),
        minimumDurationHours: number("minimumDurationHours"),
        lateEventCutoffHours: number("lateEventCutoffHours"),
        maximumActualFallbackRate: number("maximumActualFallbackRate"),
        maximumUnlinkedDeliveryRate: number("maximumUnlinkedDeliveryRate"),
      },
    })
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message === "precomputed_ctr_policy_must_precede_visits"
    )
      return redirect(
        `/dashboard/recommendations/precomputed/visits?experiment=${encodeURIComponent(id)}&evaluation=precomputed_ctr_policy_must_precede_visits`,
      )
    throw cause
  }
  revalidatePath("/dashboard/recommendations/precomputed/visits")
  redirect(
    `/dashboard/recommendations/precomputed/visits?experiment=${encodeURIComponent(id)}`,
  )
}

export async function evaluatePrivateCtr(formData: FormData) {
  const operator = await requireSession()
  const id = experimentId(formData)
  const result = await evaluatePrivatePrecomputedCtr(prisma, {
    experimentId: id,
    operator,
  })
  revalidatePath("/dashboard/recommendations/precomputed/visits")
  const suffix =
    result.status === "unavailable"
      ? `&evaluation=${encodeURIComponent(result.reason)}`
      : ""
  redirect(
    `/dashboard/recommendations/precomputed/visits?experiment=${encodeURIComponent(id)}${suffix}`,
  )
}
