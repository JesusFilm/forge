"use client"

/**
 * R10, R11, R17 — test, schedule, send now, cancel.
 *
 * Nothing here decides whether a transition is legal. The buttons stay live
 * whenever a transition is conceivable, so the editor reads the service's own
 * refusal rather than a guess this component made.
 */
import { startTransition, useActionState, useState } from "react"

import {
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "@/components/admin-ui"
import { PUSH_DEFAULT_LOCAL_HOUR } from "@/services/push/contracts"
import type { PushTestSendOutcome } from "@/services/push/campaign.service"

import {
  cancelCampaignAction,
  scheduleCampaignAction,
  sendNowAction,
  sendTestAction,
} from "../actions"
import { ActionFeedback, InlineNotice } from "./action-feedback"
import { PUSH_ACTION_IDLE } from "./action-state"
import { ConfirmSendModal } from "./confirm-send-modal"

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`
}

function outcomeTone(
  status: string,
): "success" | "warning" | "danger" | "muted" {
  if (status === "ACCEPTED" || status === "HANDED_OFF") return "success"
  if (status === "FAILED" || status === "INVALID") return "danger"
  if (status === "UNKNOWN") return "warning"
  return "muted"
}

export function CampaignActions({
  campaignId,
  tested,
  frozen,
  cancellable,
  campaignsEnabled,
  audience,
  unreachable,
  countries,
  audienceScope,
  sendDate,
  localHour,
  testOutcome,
}: {
  campaignId: string
  tested: boolean
  frozen: boolean
  cancellable: boolean
  campaignsEnabled: boolean
  audience: number
  unreachable: number
  countries: readonly string[]
  audienceScope: "EVERYWHERE" | "COUNTRIES"
  sendDate: string
  localHour: number | null
  testOutcome: readonly PushTestSendOutcome[]
}) {
  const [testState, testFormAction, testPending] = useActionState(
    sendTestAction,
    PUSH_ACTION_IDLE,
  )
  const [scheduleState, scheduleFormAction, schedulePending] = useActionState(
    scheduleCampaignAction,
    PUSH_ACTION_IDLE,
  )
  const [sendState, sendFormAction, sendPending] = useActionState(
    sendNowAction,
    PUSH_ACTION_IDLE,
  )
  const [cancelState, cancelFormAction, cancelPending] = useActionState(
    cancelCampaignAction,
    PUSH_ACTION_IDLE,
  )
  const [sendOpen, setSendOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const where =
    audienceScope === "EVERYWHERE"
      ? "every country"
      : countries.length > 0
        ? countries.join(", ")
        : "no country yet"

  // The confirmation collects the typed count, so the dispatch happens outside
  // a form. Without the transition React never moves `isPending`.
  function confirmSendNow(typed: string) {
    const data = new FormData()
    data.set("campaignId", campaignId)
    data.set("confirmCount", typed)
    startTransition(() => sendFormAction(data))
    setSendOpen(false)
  }

  function confirmCancel() {
    const data = new FormData()
    data.set("campaignId", campaignId)
    startTransition(() => cancelFormAction(data))
    setCancelOpen(false)
  }

  return (
    <div className="grid gap-5 p-4">
      {campaignsEnabled ? null : (
        <InlineNotice
          tone="warning"
          testId="push-flag-off"
          title="Push campaigns are turned off"
        >
          Admin refuses to test, schedule, or send while PUSH_CAMPAIGNS_ENABLED
          is not true. Saving copy still works.
        </InlineNotice>
      )}

      {frozen ? (
        <InlineNotice tone="warning" testId="push-frozen-actions">
          This campaign is frozen. You can cancel the zones that have not
          started; you cannot edit or re-test it.
        </InlineNotice>
      ) : null}

      {frozen ? null : (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold">Test send</h3>
          <p className="text-[12px] leading-5 text-[var(--color-text-muted)]">
            A test send reaches every device on the test-device list and never
            claims that device&apos;s day, so the live campaign still reaches
            it.
          </p>
          <form action={testFormAction}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <SecondaryButton
              type="submit"
              data-testid="push-send-test"
              disabled={testPending}
            >
              {testPending ? "Sending..." : "Send to test devices"}
            </SecondaryButton>
          </form>
          <ActionFeedback state={testState} />

          {testOutcome.length === 0 ? (
            <p
              data-testid="push-test-outcome-empty"
              className="text-[12px] text-[var(--color-text-muted)]"
            >
              {tested
                ? "A test send has run, but no per-device row is readable yet."
                : "No test send has run yet."}
            </p>
          ) : (
            <ul data-testid="push-test-outcome" className="grid gap-1">
              {testOutcome.map((row) => (
                <li
                  key={row.deliveryId}
                  data-testid="push-test-outcome-row"
                  data-status={row.status}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--color-hairline)] px-3 py-2"
                >
                  <span className="text-[12px]">
                    {row.label ?? row.testDeviceId ?? "Unnamed device"}
                  </span>
                  <span className="flex items-center gap-2">
                    {row.error ? (
                      <span className="mono-meta text-[var(--color-text-muted)]">
                        {row.error}
                      </span>
                    ) : null}
                    <StatusPill tone={outcomeTone(row.status)}>
                      {row.status}
                    </StatusPill>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {frozen ? null : (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold">Schedule a wave</h3>
          {tested ? null : (
            <InlineNotice tone="muted" testId="push-untested-notice">
              Send this campaign to a test device before you schedule it or send
              it now.
            </InlineNotice>
          )}
          <form
            action={scheduleFormAction}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="campaignId" value={campaignId} />
            <label className="grid gap-1">
              <span className="label-text">Send date</span>
              <input
                type="date"
                name="sendDate"
                required
                defaultValue={sendDate}
                data-testid="push-send-date"
                className="h-8 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-2 text-[13px]"
              />
            </label>
            <label className="grid gap-1">
              <span className="label-text">Local hour</span>
              <select
                name="localHour"
                defaultValue={String(localHour ?? PUSH_DEFAULT_LOCAL_HOUR)}
                data-testid="push-local-hour"
                className="h-8 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-2 text-[13px]"
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={String(hour)}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </label>
            <PrimaryButton
              type="submit"
              data-testid="push-schedule"
              disabled={schedulePending}
            >
              {schedulePending ? "Scheduling..." : "Schedule"}
            </PrimaryButton>
          </form>
          <p className="text-[12px] leading-5 text-[var(--color-text-muted)]">
            Each device receives it at that hour in its own time zone, as a wave
            across the zones.
          </p>
          <ActionFeedback state={scheduleState} />
        </section>
      )}

      {frozen ? null : (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold">Send now everywhere</h3>
          <p className="text-[12px] leading-5 text-[var(--color-text-muted)]">
            This ignores the local hour and reaches {audience} device(s) at
            once.
            {unreachable > 0
              ? ` ${unreachable} more device(s) are on the list that no transport can reach.`
              : null}
          </p>
          <SecondaryButton
            type="button"
            data-testid="push-send-now-open"
            onClick={() => setSendOpen(true)}
            disabled={sendPending}
          >
            {sendPending ? "Sending..." : "Send now everywhere"}
          </SecondaryButton>
          <ActionFeedback state={sendState} />
        </section>
      )}

      {cancellable ? (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold">Cancel</h3>
          <SecondaryButton
            type="button"
            data-testid="push-cancel-open"
            onClick={() => setCancelOpen(true)}
            disabled={cancelPending}
          >
            {cancelPending ? "Cancelling..." : "Cancel this campaign"}
          </SecondaryButton>
          <ActionFeedback state={cancelState} />
        </section>
      ) : null}

      <ConfirmSendModal
        open={sendOpen}
        testId="push-send-now-confirm"
        title="Send this announcement now?"
        consequence={`This reaches ${audience} device(s) in ${where} at once. It ignores the local hour, so some viewers receive it in the middle of their night.`}
        detail={
          unreachable > 0
            ? `${unreachable} device(s) in the audience cannot be reached by any transport and count as unreachable.`
            : undefined
        }
        requiredValue={String(audience)}
        requiredLabel={`Type ${audience} to confirm`}
        confirmLabel="Send now"
        pending={sendPending}
        onCancel={() => setSendOpen(false)}
        onConfirm={confirmSendNow}
      />

      <ConfirmSendModal
        open={cancelOpen}
        testId="push-cancel-confirm"
        title="Cancel this campaign?"
        consequence="Every zone that has not started is not sent. Devices already reached keep the notification, and cancelling cannot be undone."
        confirmLabel="Cancel the campaign"
        pending={cancelPending}
        onCancel={() => setCancelOpen(false)}
        onConfirm={confirmCancel}
      />
    </div>
  )
}
