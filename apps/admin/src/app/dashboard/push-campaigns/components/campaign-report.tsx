/**
 * R25 to R27 — one campaign's outcome, split by language and by country.
 *
 * The aggregate is re-read on every render, so a refresh is the whole
 * mechanism: opens and attributed watch starts keep arriving for about a day
 * after the last group (KTD10).
 */
import { DataTable, PageSection, SecondaryButton } from "@/components/admin-ui"
import type { AdminMessages } from "@/i18n/messages"
import type {
  PushCampaignReport,
  PushReportCounts,
  PushReportSlice,
} from "@/services/push/report.service"

import { refreshReportAction } from "../actions"
import { InlineNotice } from "./action-feedback"
import { formatPushUtcDate } from "./campaign-view"

type ReportMessages = AdminMessages["pages"]["pushCampaigns"]["report"]

const COUNT_KEYS = [
  "audience",
  "accepted",
  "handedOff",
  "unknown",
  "pending",
  "failed",
  "invalid",
  "suppressed",
  "unreachable",
  "missed",
  "opened",
  "attributed",
  "attributedWatchStarts",
] as const satisfies ReadonlyArray<keyof PushReportCounts>

function columns(messages: ReportMessages): string[] {
  return [
    messages.columns.key,
    ...COUNT_KEYS.map((key) => messages.columns[key]),
  ]
}

function countRow(key: string, counts: PushReportCounts) {
  return [
    <span key={`${key}-key`} className="mono-meta">
      {key}
    </span>,
    ...COUNT_KEYS.map((countKey) => (
      <span
        key={`${key}-${countKey}`}
        data-testid={`push-report-${countKey}`}
        className="mono-meta"
      >
        {counts[countKey]}
      </span>
    )),
  ]
}

function SliceTable({
  title,
  slices,
  messages,
  testId,
}: {
  title: string
  slices: readonly PushReportSlice[]
  messages: ReportMessages
  testId: string
}) {
  return (
    <PageSection title={title}>
      {slices.length === 0 ? (
        <p className="px-4 py-4 text-[12px] text-[var(--color-text-muted)]">
          No row carries this split yet.
        </p>
      ) : (
        <div data-testid={testId}>
          <DataTable
            columns={columns(messages)}
            rows={slices.map((slice) => countRow(slice.key, slice.counts))}
          />
        </div>
      )}
    </PageSection>
  )
}

export function CampaignReport({
  report,
  messages,
  workerState,
  workerMessage,
}: {
  report: PushCampaignReport
  messages: ReportMessages
  workerState: "online" | "stale" | "unknown"
  workerMessage: string
}) {
  const refresh = (
    <form action={refreshReportAction}>
      <input type="hidden" name="campaignId" value={report.campaignId} />
      <SecondaryButton type="submit" data-testid="push-report-refresh">
        {messages.refresh}
      </SecondaryButton>
    </form>
  )

  return (
    <div className="grid gap-4">
      {workerState === "online" ? null : (
        <InlineNotice
          tone={workerState === "stale" ? "danger" : "warning"}
          testId="push-report-worker-state"
        >
          {workerMessage}
        </InlineNotice>
      )}

      {report.sendingStartedAt === null ? (
        <PageSection title={messages.title} actions={refresh}>
          <div
            data-testid="push-report-not-started"
            className="flex flex-col gap-2 p-6"
          >
            <h3 className="text-[15px] font-medium">
              {messages.notStartedTitle}
            </h3>
            <p className="text-[12px] leading-5 text-[var(--color-text-muted)]">
              {messages.notStartedDescription}
            </p>
          </div>
        </PageSection>
      ) : (
        <>
          <PageSection
            title={messages.totals}
            meta={`${messages.generatedAt} ${formatPushUtcDate(report.generatedAt)}`}
            actions={refresh}
          >
            <div data-testid="push-report-totals">
              <DataTable
                columns={columns(messages)}
                rows={[countRow(messages.totals, report.totals)]}
              />
            </div>
          </PageSection>

          <SliceTable
            title={messages.byLanguage}
            slices={report.byLanguage}
            messages={messages}
            testId="push-report-by-language"
          />

          <SliceTable
            title={messages.byCountry}
            slices={report.byCountry}
            messages={messages}
            testId="push-report-by-country"
          />
        </>
      )}
    </div>
  )
}
