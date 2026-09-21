"use server"

/**
 * R28 and KTD10 — every campaign mutation the dashboard performs.
 *
 * Each action re-reads the admin session and records that person as the
 * actor. Nothing here decides whether a transition is legal: the services
 * own that, and an action's job is to name the refusal in words an editor
 * can act on.
 */
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { countPushAudience } from "@/services/push/audience.service"
import {
  createPushCampaignDraft,
  updatePushCampaign,
} from "@/services/push/campaign.service"
import {
  readPushCampaignDetail,
  searchPushDestinations,
  type PushDestinationOption,
} from "@/services/push/dashboard.service"
import {
  cancelPushCampaignRun,
  schedulePushCampaignRun,
  sendPushCampaignNowRun,
  sendPushCampaignTestRun,
} from "@/services/push/dispatch"
import { PushServiceError } from "@/services/push/errors"
import {
  addPushTestDevice,
  removePushTestDevice,
} from "@/services/push/test-devices.service"

import {
  PUSH_CAMPAIGNS_PATH,
  PUSH_TEST_DEVICES_PATH,
  pushCampaignPath,
  type PushActionState,
} from "./components/action-state"

const DESTINATION_KINDS = ["VIDEO", "SERIES", "EXPERIENCE"] as const
type PushDestinationKindInput = (typeof DESTINATION_KINDS)[number]

function ok(message: string): PushActionState {
  return { status: "ok", message }
}

function refuse(reason: string): PushActionState {
  return { status: "error", reason }
}

/**
 * R28 — any signed-in admin user, at the viewer tier. A principal without
 * the key never reaches a service call.
 */
async function requirePushActor(): Promise<string> {
  const principal = await requireSession()
  if (!hasPermission(principal, "write:push-campaigns") || !principal.id) {
    redirect("/dashboard")
  }
  return principal.id
}

/** A service refusal is the editor's answer; anything else is a real fault. */
function toRefusal(error: unknown): PushActionState {
  if (error instanceof PushServiceError) return refuse(error.message)
  throw error
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function list(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .flatMap((value) =>
      typeof value === "string" && value.trim() !== "" ? [value.trim()] : [],
    )
}

function revalidateCampaign(campaignId: string): void {
  revalidatePath(pushCampaignPath(campaignId))
  revalidatePath(PUSH_CAMPAIGNS_PATH)
}

/** R6 — the copy rows arrive as three parallel fields, paired by index. */
function readCopies(formData: FormData) {
  const languages = formData.getAll("copyLanguage")
  const titles = formData.getAll("copyTitle")
  const bodies = formData.getAll("copyBody")
  const copies: Array<{ languageSlug: string; title: string; body: string }> =
    []
  for (const [index, language] of languages.entries()) {
    if (typeof language !== "string" || language.trim() === "") continue
    const title = titles[index]
    const body = bodies[index]
    copies.push({
      languageSlug: language.trim(),
      title: typeof title === "string" ? title.trim() : "",
      body: typeof body === "string" ? body.trim() : "",
    })
  }
  return copies
}

function readDestinationKind(value: string): PushDestinationKindInput | null {
  return (DESTINATION_KINDS as readonly string[]).includes(value)
    ? (value as PushDestinationKindInput)
    : null
}

/** The audience behind the confirmation and behind the send's log event. */
async function resolveAudienceCount(
  campaignId: string,
): Promise<number | null> {
  const campaign = await readPushCampaignDetail(prisma, campaignId)
  if (campaign === null) return null
  const { audience } = await countPushAudience(prisma, {
    campaign: {
      audienceScope: campaign.audienceScope,
      countries: campaign.countries,
      languageFilter: campaign.languageFilter,
    },
  })
  return audience
}

/** The list page's new-campaign action: a draft, then straight to its editor. */
export async function createCampaignAction(): Promise<void> {
  const actorId = await requirePushActor()
  const draft = await createPushCampaignDraft(prisma, { actorId })
  revalidatePath(PUSH_CAMPAIGNS_PATH)
  redirect(pushCampaignPath(draft.id))
}

/**
 * R6 to R8 — the words, the destination, and the audience in one save.
 *
 * Copy rows are replaced wholesale, so a row the editor removed is deleted by
 * arriving absent. A tested campaign returns to draft inside the service.
 */
export async function saveCampaignAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (!campaignId) return refuse("This form carries no campaign")

  const copies = readCopies(formData)
  if (copies.length === 0) return refuse("Write the English copy first")

  const destinationKind = readDestinationKind(text(formData, "destinationKind"))
  const destinationSlug = text(formData, "destinationSlug")
  const byCountry = text(formData, "audienceScope") === "COUNTRIES"

  try {
    await updatePushCampaign(prisma, {
      campaignId,
      actorId,
      update: {
        copies,
        ...(destinationKind && destinationSlug
          ? { destination: { kind: destinationKind, slug: destinationSlug } }
          : {}),
        audience: {
          scope: byCountry ? "COUNTRIES" : "EVERYWHERE",
          countries: byCountry ? list(formData, "country") : [],
          languageFilter: list(formData, "languageFilter"),
        },
      },
    })
  } catch (error) {
    return toRefusal(error)
  }

  revalidateCampaign(campaignId)
  return ok(
    "Saved. This campaign is a draft again, so test it before you send it.",
  )
}

/** R10 — the test send that has to precede every real send. */
export async function sendTestAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (!campaignId) return refuse("This form carries no campaign")

  try {
    await sendPushCampaignTestRun({ campaignId, actorId })
  } catch (error) {
    return toRefusal(error)
  }

  revalidateCampaign(campaignId)
  return ok("Test send started. The per-device outcome appears below.")
}

/** R9 and R16 — a date and one local hour, sent as a wave across the zones. */
export async function scheduleCampaignAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (!campaignId) return refuse("This form carries no campaign")

  const sendDate = text(formData, "sendDate")
  const localHour = Number(text(formData, "localHour"))
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    return refuse("Choose an hour between 00:00 and 23:00")
  }

  const audience = await resolveAudienceCount(campaignId)
  if (audience === null) return refuse("That campaign no longer exists")

  try {
    await schedulePushCampaignRun({
      campaignId,
      actorId,
      sendDate,
      localHour,
      audienceCount: audience,
    })
  } catch (error) {
    return toRefusal(error)
  }

  revalidateCampaign(campaignId)
  const hour = String(localHour).padStart(2, "0")
  return ok(`Scheduled for ${sendDate} at ${hour}:00 local time.`)
}

/**
 * R17 and KTD10 — send now everywhere, behind a typed audience count.
 *
 * The count is re-resolved here rather than trusted from the form: the number
 * the editor typed has to match what the audience is at this moment, not what
 * the page rendered.
 */
export async function sendNowAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (!campaignId) return refuse("This form carries no campaign")

  const typed = text(formData, "confirmCount")
  const audience = await resolveAudienceCount(campaignId)
  if (audience === null) return refuse("That campaign no longer exists")

  if (!/^\d+$/.test(typed) || Number(typed) !== audience) {
    return refuse(
      `Type the audience count to confirm. It is ${audience} right now.`,
    )
  }

  try {
    await sendPushCampaignNowRun({
      campaignId,
      actorId,
      audienceCount: audience,
    })
  } catch (error) {
    return toRefusal(error)
  }

  revalidateCampaign(campaignId)
  return ok(`Sending to ${audience} phones now.`)
}

/** R11 — cancel is allowed after sending starts; edit is not. */
export async function cancelCampaignAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (!campaignId) return refuse("This form carries no campaign")

  let zonesCancelled = 0
  try {
    const result = await cancelPushCampaignRun({ campaignId, actorId })
    zonesCancelled = result.zonesCancelled
  } catch (error) {
    return toRefusal(error)
  }

  revalidateCampaign(campaignId)
  return ok(
    `Cancelled. ${zonesCancelled} zone(s) that had not started are not sent.`,
  )
}

/** The report re-aggregates on every read, so a refresh is a revalidation. */
export async function refreshReportAction(formData: FormData): Promise<void> {
  await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (campaignId) revalidatePath(pushCampaignPath(campaignId))
}

/** R31 — an admin user pastes the ID the app shows on its Profile screen. */
export async function addTestDeviceAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const testDeviceId = text(formData, "testDeviceId")
  const label = text(formData, "label")
  if (!testDeviceId || !label) {
    return refuse("Paste the notification test ID and give it a label")
  }

  try {
    await addPushTestDevice(prisma, { testDeviceId, label, actorId })
  } catch (error) {
    return toRefusal(error)
  }

  revalidatePath(PUSH_TEST_DEVICES_PATH)
  return ok(`Added ${label} to the test-device list.`)
}

export async function removeTestDeviceAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  await requirePushActor()
  const id = text(formData, "id")
  if (!id) return refuse("That row carries no test device")

  try {
    await removePushTestDevice(prisma, id)
  } catch (error) {
    return toRefusal(error)
  }

  revalidatePath(PUSH_TEST_DEVICES_PATH)
  return ok("Removed from the test-device list.")
}

/** R7 — the destination picker's search, run in Postgres one page at a time. */
export async function searchDestinationsAction(input: {
  kind: string
  query: string
}): Promise<PushDestinationOption[]> {
  await requirePushActor()
  const kind = readDestinationKind(input.kind)
  if (!kind) return []
  return searchPushDestinations(prisma, { kind, query: input.query })
}
