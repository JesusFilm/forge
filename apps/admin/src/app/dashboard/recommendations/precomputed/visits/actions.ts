"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { configurePrivatePrecomputedExperiment } from "@/services/recommendations/precomputed/visit-admission"

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
