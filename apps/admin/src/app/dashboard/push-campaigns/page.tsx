/**
 * KTD10 — the campaign list, what day one wants to watch beside it, and the
 * one action that starts a campaign.
 *
 * Registrations per day and the worker state live here rather than on the
 * editor: they are the two signals that say whether a wave can send at all.
 */
import type { Route } from "next"
import Link from "next/link"

import {
  DashboardPageHeader,
  DataTable,
  PageSection,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "@/components/admin-ui"
import { prisma } from "@/db/client"
import { getAdminMessages } from "@/i18n/server"
import {
  listPushCampaigns,
  readPushRegistrationsPerDay,
  readPushWorkerState,
  type PushRegistrationDay,
} from "@/services/push/dashboard.service"
import { resolvePushSendConfig } from "@/services/push/transport"

import { createCampaignAction } from "./actions"
import { InlineNotice } from "./components/action-feedback"
import {
  PUSH_TEST_DEVICES_PATH,
  pushCampaignPath,
} from "./components/action-state"
import {
  formatPushAudience,
  formatPushDestination,
  formatPushSchedule,
  formatPushUtcDate,
  pushStatusView,
} from "./components/campaign-view"
import { requirePushPrincipal } from "./access"

function RegistrationTrend({
  days,
  emptyLabel,
}: {
  days: readonly PushRegistrationDay[]
  emptyLabel: string
}) {
  const peak = Math.max(...days.map((day) => day.count), 1)
  const total = days.reduce((sum, day) => sum + day.count, 0)

  if (total === 0) {
    return (
      <p
        data-testid="push-registrations-empty"
        className="px-4 py-4 text-[12px] text-[var(--color-text-muted)]"
      >
        {emptyLabel}
      </p>
    )
  }

  return (
    <div data-testid="push-registrations" className="flex flex-col gap-3 p-4">
      <div className="flex items-end gap-1 overflow-x-auto">
        {days.map((day) => (
          <div
            key={day.day}
            title={`${day.day}: ${day.count}`}
            className="flex min-w-6 flex-1 flex-col items-center gap-1"
          >
            <span className="mono-meta text-[10px] text-[var(--color-text-muted)]">
              {day.count}
            </span>
            <span
              aria-hidden
              style={{ height: `${Math.round((day.count / peak) * 56) + 2}px` }}
              className="w-full rounded-sm bg-[var(--color-brand)]"
            />
            <span className="mono-meta text-[10px] text-[var(--color-text-muted)]">
              {day.day.slice(5)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-[var(--color-text-muted)]">
        {total} phone(s) registered across these {days.length} days.
      </p>
    </div>
  )
}

export default async function PushCampaignsPage() {
  await requirePushPrincipal()

  const messages = await getAdminMessages()
  const page = messages.pages.pushCampaigns

  const [campaigns, registrations, worker] = await Promise.all([
    listPushCampaigns(prisma),
    readPushRegistrationsPerDay(prisma),
    readPushWorkerState(),
  ])
  const campaignsEnabled = resolvePushSendConfig().campaignsEnabled

  const workerCopy =
    worker.kind === "online"
      ? page.workerOnline
      : worker.kind === "stale"
        ? page.workerStale
        : page.workerUnknown

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={PUSH_TEST_DEVICES_PATH as Route}>
              <SecondaryButton type="button">
                {page.testDevices}
              </SecondaryButton>
            </Link>
            <form action={createCampaignAction}>
              <PrimaryButton type="submit" data-testid="push-new-campaign">
                {page.newCampaign}
              </PrimaryButton>
            </form>
          </div>
        }
      />

      {campaignsEnabled ? null : (
        <InlineNotice
          tone="warning"
          testId="push-flag-off-banner"
          title={page.flagOffTitle}
        >
          {page.flagOffDescription}
        </InlineNotice>
      )}

      {campaigns.length === 0 ? (
        <PageSection title={page.title} meta="PUSH_CAMPAIGN">
          <div
            data-testid="push-campaigns-empty"
            className="flex flex-col gap-2 p-6"
          >
            <h2 className="text-[15px] font-medium">{page.emptyTitle}</h2>
            <p className="text-[12px] leading-5 text-[var(--color-text-muted)]">
              {page.emptyDescription}
            </p>
            <form action={createCampaignAction} className="mt-2">
              <PrimaryButton
                type="submit"
                data-testid="push-new-campaign-empty"
              >
                {page.newCampaign}
              </PrimaryButton>
            </form>
          </div>
        </PageSection>
      ) : (
        <PageSection title={page.title} meta="PUSH_CAMPAIGN">
          <DataTable
            columns={[
              page.columns.title,
              page.columns.status,
              page.columns.destination,
              page.columns.audience,
              page.columns.schedule,
              page.columns.languages,
              page.columns.updated,
            ]}
            rowHrefs={campaigns.map(
              (campaign) => pushCampaignPath(campaign.id) as Route,
            )}
            rows={campaigns.map((campaign) => {
              const status = pushStatusView(campaign.status)
              return [
                <span
                  key={`${campaign.id}-title`}
                  className="text-[13px] font-medium"
                >
                  {campaign.englishTitle ?? "Untitled campaign"}
                </span>,
                <StatusPill key={`${campaign.id}-status`} tone={status.tone}>
                  {status.label}
                </StatusPill>,
                <span key={`${campaign.id}-destination`} className="mono-meta">
                  {formatPushDestination(campaign)}
                </span>,
                <span
                  key={`${campaign.id}-audience`}
                  className="text-[12px] text-[var(--color-text-muted)]"
                >
                  {formatPushAudience(campaign)}
                </span>,
                <span
                  key={`${campaign.id}-schedule`}
                  className="text-[12px] text-[var(--color-text-muted)]"
                >
                  {formatPushSchedule(campaign)}
                </span>,
                <span key={`${campaign.id}-languages`} className="mono-meta">
                  {campaign.languageCount}
                </span>,
                <span key={`${campaign.id}-updated`} className="mono-meta">
                  {formatPushUtcDate(campaign.updatedAt)}
                </span>,
              ]
            })}
          />
        </PageSection>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <PageSection
          title={page.registrationsTitle}
          meta={page.registrationsMeta}
        >
          <RegistrationTrend
            days={registrations}
            emptyLabel={page.registrationsEmpty}
          />
        </PageSection>

        <PageSection title={page.workerTitle} meta="WORKFLOW_WORKER_HEARTBEAT">
          <div
            data-testid="push-worker-state"
            className="flex flex-col gap-3 p-4"
          >
            <StatusPill
              tone={
                worker.kind === "online"
                  ? "success"
                  : worker.kind === "stale"
                    ? "danger"
                    : "muted"
              }
            >
              {worker.kind}
            </StatusPill>
            <p className="text-[12px] leading-5 text-[var(--color-text-secondary)]">
              {workerCopy}
            </p>
            {worker.workers.map((row) => (
              <div key={row.id} className="grid gap-0.5">
                <span className="mono-meta truncate">{row.id}</span>
                <span className="mono-meta text-[var(--color-text-muted)]">
                  {row.meta}
                </span>
              </div>
            ))}
          </div>
        </PageSection>
      </div>
    </div>
  )
}
