/**
 * KTD10 — one campaign: the editor on one tab, the report on the other.
 *
 * Once a campaign leaves draft the form is replaced by a read-only view with
 * the freeze rule named on it (R11), because the service refuses the save and
 * an editor should read why before they try.
 */
import type { Route } from "next"
import Link from "next/link"

import {
  DashboardPageHeader,
  PageSection,
  SecondaryButton,
  StatusPill,
  cx,
} from "@/components/admin-ui"
import { prisma } from "@/db/client"
import { getAdminMessages } from "@/i18n/server"
import { countPushAudience } from "@/services/push/audience.service"
import { readPushTestSendOutcome } from "@/services/push/campaign.service"
import {
  listPushLanguageOptions,
  readPushCampaignDetail,
  readPushDestinationTitle,
  readPushWorkerState,
} from "@/services/push/dashboard.service"
import { readPushCampaignRunState } from "@/services/push/dispatch"
import { readPushCampaignReport } from "@/services/push/report.service"
import { resolvePushSendConfig } from "@/services/push/transport"

import { InlineNotice } from "../components/action-feedback"
import {
  PUSH_CAMPAIGNS_PATH,
  pushCampaignPath,
} from "../components/action-state"
import { CampaignActions } from "../components/campaign-actions"
import { CampaignEditor } from "../components/campaign-editor"
import { CampaignReport } from "../components/campaign-report"
import {
  formatPushAudience,
  formatPushDestination,
  formatPushSchedule,
  formatPushSendDate,
  formatPushUtcDate,
  isPushCampaignCancellable,
  isPushCampaignFrozen,
  isPushCampaignTested,
  pushStatusView,
} from "../components/campaign-view"
import { requirePushPrincipal } from "../access"

type PageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstParam(
  params: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  const value = params?.[name]
  return Array.isArray(value) ? value[0] : value
}

export default async function PushCampaignPage({
  params,
  searchParams,
}: PageProps) {
  await requirePushPrincipal()

  const { id } = await params
  const query = await searchParams
  const tab = firstParam(query, "tab") === "report" ? "report" : "editor"

  const messages = await getAdminMessages()
  const page = messages.pages.pushCampaigns
  const campaign = await readPushCampaignDetail(prisma, id)

  if (campaign === null) {
    return (
      <div className="flex flex-col gap-6">
        <DashboardPageHeader
          eyebrow={page.editor.eyebrow}
          title={page.editor.notFoundTitle}
          description={page.editor.notFoundDescription}
        />
        <Link href={PUSH_CAMPAIGNS_PATH as Route}>
          <SecondaryButton type="button">{page.allCampaigns}</SecondaryButton>
        </Link>
      </div>
    )
  }

  const [
    languageOptions,
    destinationTitle,
    testOutcome,
    audience,
    worker,
    run,
  ] = await Promise.all([
    listPushLanguageOptions(prisma),
    readPushDestinationTitle(prisma, {
      kind: campaign.destinationKind,
      slug: campaign.destinationSlug,
    }),
    readPushTestSendOutcome(prisma, campaign.id),
    countPushAudience(prisma, {
      campaign: {
        audienceScope: campaign.audienceScope,
        countries: campaign.countries,
        languageFilter: campaign.languageFilter,
      },
    }),
    readPushWorkerState(),
    readPushCampaignRunState(campaign.id),
  ])

  const report =
    tab === "report" ? await readPushCampaignReport(prisma, campaign.id) : null
  const campaignsEnabled = resolvePushSendConfig().campaignsEnabled
  const status = pushStatusView(campaign.status)
  const frozen = isPushCampaignFrozen(campaign.status)
  const workerCopy =
    worker.kind === "stale" ? page.workerStale : page.workerUnknown

  const tabs: ReadonlyArray<{ key: string; label: string; href: Route }> = [
    {
      key: "editor",
      label: page.editor.tabEditor,
      href: pushCampaignPath(campaign.id) as Route,
    },
    {
      key: "report",
      label: page.editor.tabReport,
      href: `${pushCampaignPath(campaign.id)}?tab=report` as Route,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow={page.editor.eyebrow}
        title={campaign.englishTitle ?? "Untitled campaign"}
        description={`${formatPushDestination(campaign)} — ${formatPushAudience(campaign)} — ${formatPushSchedule(campaign)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <Link href={PUSH_CAMPAIGNS_PATH as Route}>
              <SecondaryButton type="button">
                {page.allCampaigns}
              </SecondaryButton>
            </Link>
          </div>
        }
      />

      <nav aria-label="Campaign views" className="flex flex-wrap gap-2">
        {tabs.map((entry) => (
          <Link
            key={entry.key}
            href={entry.href}
            data-testid={`push-tab-${entry.key}`}
            aria-current={tab === entry.key ? "page" : undefined}
            className={cx(
              "inline-flex h-8 items-center rounded-sm border px-3 text-[12px] font-medium",
              tab === entry.key
                ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]"
                : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]",
            )}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {run?.error ? (
        <InlineNotice
          tone="danger"
          testId="push-run-error"
          title="Last run error"
        >
          {run.error}
        </InlineNotice>
      ) : null}

      {tab === "report" && report ? (
        <CampaignReport
          report={report}
          messages={page.report}
          workerState={worker.kind}
          workerMessage={workerCopy}
        />
      ) : (
        <>
          {frozen ? (
            <PageSection title="Campaign" meta={campaign.status}>
              <div className="grid gap-3 p-4">
                <InlineNotice tone="warning" testId="push-freeze-notice">
                  {page.editor.frozenNotice}
                </InlineNotice>
                <dl className="grid gap-2 text-[12px] sm:grid-cols-2">
                  <div>
                    <dt className="label-text">Destination</dt>
                    <dd className="mono-meta">
                      {formatPushDestination(campaign)}
                      {destinationTitle ? ` — ${destinationTitle}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-text">Audience</dt>
                    <dd>{formatPushAudience(campaign)}</dd>
                  </div>
                  <div>
                    <dt className="label-text">Schedule</dt>
                    <dd>{formatPushSchedule(campaign)}</dd>
                  </div>
                  <div>
                    <dt className="label-text">Sending started</dt>
                    <dd className="mono-meta">
                      {formatPushUtcDate(campaign.sendingStartedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-text">Last test send</dt>
                    <dd className="mono-meta">
                      {formatPushUtcDate(campaign.testSentAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-text">Completed</dt>
                    <dd className="mono-meta">
                      {formatPushUtcDate(campaign.completedAt)}
                    </dd>
                  </div>
                </dl>
                <ul data-testid="push-frozen-copies" className="grid gap-2">
                  {campaign.copies.map((copy) => (
                    <li
                      key={copy.languageSlug}
                      className="rounded-sm border border-[var(--color-hairline)] p-3"
                    >
                      <div className="label-text">{copy.languageSlug}</div>
                      <div className="mt-1 text-[13px] font-medium">
                        {copy.title}
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                        {copy.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </PageSection>
          ) : (
            <PageSection title="Campaign" meta={campaign.status}>
              <CampaignEditor
                campaign={campaign}
                languageOptions={languageOptions}
                destinationTitle={destinationTitle}
              />
            </PageSection>
          )}

          <PageSection title="Send" meta="TEST / SCHEDULE / SEND NOW / CANCEL">
            <CampaignActions
              campaignId={campaign.id}
              tested={isPushCampaignTested(campaign.status)}
              frozen={frozen}
              cancellable={isPushCampaignCancellable(campaign.status)}
              campaignsEnabled={campaignsEnabled}
              audience={audience.audience}
              unreachable={audience.unreachable}
              countries={campaign.countries}
              audienceScope={campaign.audienceScope}
              sendDate={formatPushSendDate(campaign.sendDate)}
              localHour={campaign.localHour}
              testOutcome={testOutcome}
            />
          </PageSection>
        </>
      )}
    </div>
  )
}
