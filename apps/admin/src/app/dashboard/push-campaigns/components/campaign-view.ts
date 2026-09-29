/**
 * How a campaign reads on the page. Pure, so the editor and the list agree on
 * one answer for "is this frozen" and "what does this audience say".
 */
import type { PushCampaignStatus } from "@prisma/client"

import {
  PUSH_COPY_BODY_MAX_CHARS,
  PUSH_COPY_TITLE_MAX_CHARS,
} from "@/services/push/contracts"

type StatusTone = "success" | "warning" | "danger" | "info" | "muted"

const STATUS_VIEW: Record<
  PushCampaignStatus,
  { label: string; tone: StatusTone }
> = {
  DRAFT: { label: "Draft", tone: "muted" },
  TESTED: { label: "Tested", tone: "info" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  SENDING: { label: "Sending", tone: "warning" },
  SENT: { label: "Sent", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
}

export function pushStatusView(status: PushCampaignStatus): {
  label: string
  tone: StatusTone
} {
  return STATUS_VIEW[status]
}

/**
 * R11 — the two statuses the service still accepts an edit in. Everything
 * else is frozen, including a cancelled campaign, which never sends again.
 */
export function isPushCampaignFrozen(status: PushCampaignStatus): boolean {
  return status !== "DRAFT" && status !== "TESTED"
}

/** R10 — a draft has no test send behind it, so it can only be tested. */
export function isPushCampaignTested(status: PushCampaignStatus): boolean {
  return status !== "DRAFT"
}

export function isPushCampaignCancellable(status: PushCampaignStatus): boolean {
  return status === "SCHEDULED" || status === "SENDING"
}

export function formatPushUtcDate(value: Date | null): string {
  if (!value) return "—"
  return `${value.toISOString().slice(0, 10)} ${value
    .toISOString()
    .slice(11, 16)} UTC`
}

export function formatPushSendDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : ""
}

export function formatPushSchedule(campaign: {
  mode: "WAVE" | "IMMEDIATE"
  sendDate: Date | null
  localHour: number | null
}): string {
  if (campaign.mode === "IMMEDIATE") return "Send now everywhere"
  if (!campaign.sendDate) return "Not scheduled"
  const hour = String(campaign.localHour ?? 9).padStart(2, "0")
  return `${formatPushSendDate(campaign.sendDate)} at ${hour}:00 local`
}

export function formatPushAudience(campaign: {
  audienceScope: "EVERYWHERE" | "COUNTRIES"
  countries: readonly string[]
  languageFilter: readonly string[]
}): string {
  const where =
    campaign.audienceScope === "EVERYWHERE"
      ? "Everywhere"
      : `${campaign.countries.length} country/countries: ${campaign.countries.join(", ")}`
  if (campaign.languageFilter.length === 0) return where
  return `${where} — languages: ${campaign.languageFilter.join(", ")}`
}

export function formatPushDestination(campaign: {
  destinationKind: string | null
  destinationSlug: string | null
}): string {
  if (!campaign.destinationKind || !campaign.destinationSlug) {
    return "Not chosen"
  }
  return `${campaign.destinationKind.toLowerCase()} / ${campaign.destinationSlug}`
}

/**
 * KTD5 — the editor sees the cap break before submitting, because the service
 * refuses the whole save for one long row.
 */
export function pushCopyFieldError(
  field: "title" | "body",
  value: string,
): string | null {
  const trimmed = value.trim()
  const max =
    field === "title" ? PUSH_COPY_TITLE_MAX_CHARS : PUSH_COPY_BODY_MAX_CHARS
  if (trimmed.length === 0) {
    return field === "title" ? "Write a title" : "Write a body"
  }
  if (trimmed.length > max) {
    return `${trimmed.length} of ${max} characters. Shorten it by ${trimmed.length - max}.`
  }
  return null
}

/** A country chip the editor typed. Two letters, upper case, no repeats. */
export function normalizePushCountryInput(
  value: string,
  existing: readonly string[],
): { country: string } | { error: string } {
  const country = value.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) {
    return { error: "A country is a two-letter ISO code, such as SA or FR." }
  }
  if (existing.includes(country)) {
    return { error: `${country} is already on the list.` }
  }
  return { country }
}
