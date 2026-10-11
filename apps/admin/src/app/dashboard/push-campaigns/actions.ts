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

import { prisma } from "@/db/client"
import { getAdminMessages } from "@/i18n/server"
import { countPushAudience } from "@/services/push/audience.service"
import {
  createPushCampaignDraft,
  deletePushCampaign,
  updatePushCampaign,
} from "@/services/push/campaign.service"
import {
  readPushActorNames,
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
import {
  PushNotFoundError,
  PushServiceError,
  PushStaleContentVersionError,
} from "@/services/push/errors"
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
import { formatPushActorMessage } from "./components/campaign-view"
import { requirePushPrincipal } from "./access"

const DESTINATION_KINDS = ["VIDEO", "SERIES", "EXPERIENCE"] as const
type PushDestinationKindInput = (typeof DESTINATION_KINDS)[number]

function ok(message: string, contentVersion?: number): PushActionState {
  return contentVersion === undefined
    ? { status: "ok", message }
    : { status: "ok", message, contentVersion }
}

function refuse(reason: string): PushActionState {
  return { status: "error", reason }
}

/**
 * R28 — any signed-in admin user, at the viewer tier. A principal without
 * the key never reaches a service call.
 */
async function requirePushActor(): Promise<string> {
  const principal = await requirePushPrincipal()
  if (!principal.id) redirect("/dashboard")
  return principal.id
}

/** A service refusal is the editor's answer; anything else is a real fault. */
function toRefusal(error: unknown): PushActionState {
  if (error instanceof PushServiceError) return refuse(error.message)
  throw error
}

/**
 * R34 and KTD15 — names the newer change: who made the last change and when,
 * then the agent write when there is one. It returns a state, not a throw,
 * because a production server action hides a thrown error's message.
 */
async function toStaleRefusal(
  campaignId: string,
  error: PushStaleContentVersionError,
): Promise<PushActionState> {
  const [messages, current, names] = await Promise.all([
    getAdminMessages(),
    readPushCampaignDetail(prisma, campaignId),
    readPushActorNames(prisma, [error.lastActorId]),
  ])
  const review = messages.pages.pushCampaigns.review
  const lastActor =
    (error.lastActorId && names.get(error.lastActorId)) || review.unknownPerson
  const marker = current?.aiMarker
  const sentences = [
    formatPushActorMessage(review.staleChange, lastActor, error.updatedAt),
    ...(marker
      ? [
          formatPushActorMessage(
            review.aiMarker,
            marker.actorName,
            marker.writtenAt,
          ),
        ]
      : []),
    review.staleNextStep,
  ]
  return {
    status: "stale",
    reason: sentences.join(" "),
    contentVersion: error.currentContentVersion,
  }
}

async function toWriteRefusal(
  campaignId: string,
  error: unknown,
): Promise<PushActionState> {
  if (error instanceof PushStaleContentVersionError) {
    return toStaleRefusal(campaignId, error)
  }
  return toRefusal(error)
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

/** R34 — the content version the page loaded, or null when the form has none. */
function readContentVersion(formData: FormData): number | null {
  const value = text(formData, "contentVersion")
  return /^\d+$/.test(value) ? Number(value) : null
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
 * R6 to R8 — one save of the words, destination, and audience. The copy rows are a
 * set, so a removed row is deleted. A real change returns TESTED to DRAFT, a no-op
 * keeps the status (R36), and a save from an older page is refused (R34).
 */
export async function saveCampaignAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (!campaignId) return refuse("This form carries no campaign")
  const expectedContentVersion = readContentVersion(formData)
  if (expectedContentVersion === null) {
    return refuse("This form carries no campaign version. Reload the page.")
  }

  const copies = readCopies(formData)
  if (copies.length === 0) return refuse("Write the English copy first")

  const destinationKind = readDestinationKind(text(formData, "destinationKind"))
  const destinationSlug = text(formData, "destinationSlug")
  const byCountry = text(formData, "audienceScope") === "COUNTRIES"

  let written: boolean
  let contentVersion: number
  try {
    const result = await updatePushCampaign(prisma, {
      campaignId,
      actorId,
      expectedContentVersion,
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
    written = result.written
    contentVersion = result.after.contentVersion
  } catch (error) {
    return toWriteRefusal(campaignId, error)
  }

  revalidateCampaign(campaignId)
  return ok(
    written
      ? "Saved. This campaign is a draft again, so test it before you send it."
      : "Nothing changed, so the campaign keeps its status.",
    contentVersion,
  )
}

/**
 * R10 — the test send that has to precede every real send. It carries the
 * version the page loaded, so a test from a stale page is refused (KTD5).
 */
export async function sendTestAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (!campaignId) return refuse("This form carries no campaign")
  const expectedContentVersion = readContentVersion(formData)
  if (expectedContentVersion === null) {
    return refuse("This form carries no campaign version. Reload the page.")
  }

  try {
    await sendPushCampaignTestRun({
      campaignId,
      actorId,
      expectedContentVersion,
    })
  } catch (error) {
    return toWriteRefusal(campaignId, error)
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
  return ok(`Sending to ${audience} devices now.`)
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

/**
 * Deletes the campaign and its report, then opens the list. A campaign that is
 * already gone counts as deleted, so a second tab lands on the list too.
 */
export async function deleteCampaignAction(
  _previous: PushActionState,
  formData: FormData,
): Promise<PushActionState> {
  const actorId = await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (!campaignId) return refuse("This form carries no campaign")

  try {
    await deletePushCampaign(prisma, { campaignId, actorId })
  } catch (error) {
    if (!(error instanceof PushNotFoundError)) return toRefusal(error)
  }

  revalidateCampaign(campaignId)
  redirect(PUSH_CAMPAIGNS_PATH)
}

/** The report re-aggregates on every read, so a refresh is a revalidation. */
export async function refreshReportAction(formData: FormData): Promise<void> {
  await requirePushActor()
  const campaignId = text(formData, "campaignId")
  if (campaignId) revalidatePath(pushCampaignPath(campaignId))
}

/** R31 — an admin user pastes the ID the app reveals on its mission screen. */
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
