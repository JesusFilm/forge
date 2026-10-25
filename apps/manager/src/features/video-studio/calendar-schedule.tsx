"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import type { Route } from "next"
import {
  calendarAuthorizationSchema,
  resolveCalendarTime,
  type CalendarView,
} from "@forge/studio-contracts/calendar"
import {
  studioRenderStateSchema,
  type StudioRenderState,
} from "@forge/studio-contracts/publication-state"
import { studioPublicationCandidateSchema } from "@forge/studio-contracts/publication"
import { studioCall, StudioClientError } from "./client"

type Slot = CalendarView["slots"][number]
export default function CalendarSchedule({
  view,
  slot,
  refresh,
  close,
}: {
  view: CalendarView
  slot: Slot
  refresh: () => Promise<CalendarView>
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [render, setRender] = useState<StudioRenderState | null>(null),
    [selected, setSelected] = useState(""),
    [occurrence, setOccurrence] = useState<"" | "earlier" | "later">(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [statusVersion, setStatusVersion] = useState(0),
    [error, setError] = useState(""),
    [readiness, setReadiness] = useState("")
  const pending = useRef<{
    action: "calendar-authorize" | "calendar-cancel"
    input: unknown
  } | null>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    if (!pending.current) {
      setSelected("")
      setConfirmed(false)
      setReadiness("")
    }
  }, [slot.version, view.version, slot.project?.currentRevision])
  useEffect(() => {
    let active = true
    if (slot.projectId)
      studioCall("render-state", slot.projectId)
        .then(studioRenderStateSchema.parse)
        .then((value) => {
          if (active) setRender(value)
        })
        .catch(() => {
          if (active)
            setError(
              "Render and approval status could not be loaded. Open the project to review it.",
            )
        })
    return () => {
      active = false
    }
  }, [slot.projectId, slot.project?.currentRevision, statusVersion])
  const attempts =
    render?.attempts.filter(
      (a) =>
        a.baseRevision === slot.project?.currentRevision &&
        a.status === "SUCCEEDED" &&
        a.catalogRelease &&
        render.approvals.some((approval) => approval.renderAttemptId === a.id),
    ) ?? []
  const attempt = attempts.find((a) => a.id === selected),
    approval = render?.approvals.find((a) => a.renderAttemptId === selected)
  const authorization = slot.authorizations[0]
  const active =
    authorization && !authorization.revokedAt && !authorization.consumedAt
  let due: string | null = null,
    timeError = ""
  try {
    due = resolveCalendarTime(
      slot.date,
      view.settings.publishTime,
      view.settings.timeZone,
      occurrence || undefined,
    )
  } catch (e) {
    timeError =
      e instanceof Error && e.message === "AMBIGUOUS_TIME"
        ? "This time occurs twice. Choose the earlier or later occurrence."
        : "This local time does not exist. Change the calendar publication time before scheduling."
  }
  const windowEnd = due
    ? new Date(
        Date.parse(due) + view.settings.deliveryWindowMinutes * 60000,
      ).toISOString()
    : null
  const locked =
    render?.project.firstPublishedAt || slot.project?.lifecycle !== "DRAFT"
  const binding = () => ({
    projectId: slot.projectId!,
    expectedRevision: slot.project!.currentRevision,
    approvalId: approval!.id,
    renderAttemptId: attempt!.id,
    releaseId: attempt!.catalogRelease!.id,
  })
  async function inspect(value: string) {
    setSelected(value)
    setConfirmed(false)
    setReadiness("")
    setError("")
    const chosen = attempts.find((a) => a.id === value),
      approved = render?.approvals.find((a) => a.renderAttemptId === value)
    if (!chosen?.catalogRelease || !approved) return
    try {
      const result = studioPublicationCandidateSchema.parse(
        await studioCall("publication-candidate", {
          projectId: slot.projectId,
          expectedRevision: slot.project!.currentRevision,
          approvalId: approved.id,
          renderAttemptId: chosen.id,
          releaseId: chosen.catalogRelease.id,
        }),
      )
      setReadiness(
        `Current readiness: ${result.readiness.state}. It will be checked again when due.`,
      )
    } catch {
      setReadiness(
        "Current eligibility could not be confirmed. Scheduling cannot bypass the final checks.",
      )
    }
  }
  async function submit(cancel = false) {
    setBusy(true)
    setError("")
    setConfirmed(false)
    try {
      pending.current ??= cancel
        ? {
            action: "calendar-cancel",
            input: {
              calendarId: view.calendarId,
              expectedVersion: slot.version,
              idempotencyKey: crypto.randomUUID(),
              authorizationId: authorization!.id,
            },
          }
        : {
            action: "calendar-authorize",
            input: calendarAuthorizationSchema.parse({
              ...binding(),
              calendarId: view.calendarId,
              date: slot.date,
              expectedCalendarVersion: view.version,
              expectedVersion: slot.version,
              idempotencyKey: crypto.randomUUID(),
              ...(occurrence ? { occurrence } : {}),
            }),
          }
      await studioCall(pending.current.action, pending.current.input)
      pending.current = null
      try {
        await refresh()
      } catch {
        setError(
          "The schedule request completed, but status could not be refreshed. Reload the calendar.",
        )
      }
    } catch (e) {
      if (e instanceof StudioClientError && e.status >= 400 && e.status < 500) {
        pending.current = null
        setSelected("")
        setReadiness("")
        setRender(null)
        setStatusVersion((version) => version + 1)
        try {
          await refresh()
        } catch {
          setError(
            "The request was rejected and current status could not be loaded. Refresh the calendar before choosing a new schedule.",
          )
          return
        }
      }
      setError(
        e instanceof Error
          ? e.message
          : "Schedule result unavailable. Retry the same request.",
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="calendar-dialog"
      aria-labelledby="schedule-heading"
      onCancel={(event) => {
        if (busy || pending.current) event.preventDefault()
        else close()
      }}
    >
      <div className="calendar-dialog-panel">
        <h2 id="schedule-heading">Scheduled publication</h2>
        <p>
          {slot.title || "Untitled slot"} · {slot.date}
        </p>
        <p>
          {view.settings.publishTime} · {view.settings.timeZone}. Delivery is
          allowed for {view.settings.deliveryWindowMinutes} minutes after that
          time.
        </p>
        <p>
          Only the exact approved render may publish. Missing, failed or
          unapproved work stays unpublished. Scheduling keeps this draft
          editable; an edit invalidates its authorization. First publication
          permanently locks the content.
        </p>
        {error && <p role="alert">{error}</p>}
        {authorization && (
          <section aria-label="Current schedule">
            <p>
              {authorization.consumedAt
                ? slot.project?.lifecycle === "UNPUBLISHED"
                  ? "Unpublished — permanently locked"
                  : "Published once"
                : authorization.revokedAt
                  ? "Cancelled"
                  : `Authorized for ${new Date(authorization.dueAt).toLocaleString("en", { timeZone: view.settings.timeZone })} ${view.settings.timeZone}`}
            </p>
            <p>
              Latest allowed:{" "}
              {new Date(authorization.latestAllowedAt).toLocaleString("en", {
                timeZone: view.settings.timeZone,
              })}{" "}
              {view.settings.timeZone}
            </p>
            {authorization.dispatch && (
              <p>
                Delivery: {authorization.dispatch.state.toLowerCase()}
                {authorization.dispatch.lastError
                  ? ` — ${authorization.dispatch.lastError}`
                  : ""}
                .{" "}
                {authorization.hasSubmission
                  ? "The exact submitted request is retained."
                  : "No publication request has been submitted."}
              </p>
            )}
            {active && (
              <button
                disabled={busy || !!pending.current}
                onClick={() => void submit(true)}
              >
                Cancel scheduled publication
              </button>
            )}
          </section>
        )}
        {slot.projectId && (
          <Link href={`/dashboard/shorts/${slot.projectId}` as Route}>
            Open project and review render
          </Link>
        )}
        {locked ? (
          <p>
            This project is permanently locked. Unpublishing does not allow
            editing or republication.
          </p>
        ) : !render ? (
          <p>Loading render and approval status…</p>
        ) : !attempts.length ? (
          <p>
            No approved completed render is available. Review and approve the
            exact render in the project first.
          </p>
        ) : (
          <fieldset disabled={busy || !!pending.current}>
            <label>
              Approved render
              <select
                value={selected}
                onChange={(e) => void inspect(e.target.value)}
              >
                <option value="">Choose the approved render</option>
                {attempts.map((a) => (
                  <option value={a.id} key={a.id}>
                    Revision {a.baseRevision} ·{" "}
                    {new Date(a.createdAt).toLocaleString("en", {
                      timeZone: view.settings.timeZone,
                    })}
                  </option>
                ))}
              </select>
            </label>
            {readiness && <p>{readiness}</p>}
            {timeError && <p role="alert">{timeError}</p>}
            <label>
              Repeated local time
              <select
                value={occurrence}
                onChange={(e) => {
                  setOccurrence(e.target.value as "" | "earlier" | "later")
                  setConfirmed(false)
                }}
              >
                <option value="">Require an unambiguous time</option>
                <option value="earlier">Earlier occurrence</option>
                <option value="later">Later occurrence</option>
              </select>
            </label>
            {due && (
              <p>
                Exact delivery instant: {due}. Latest allowed: {windowEnd}.
              </p>
            )}
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I authorize publication of this exact approved render within the
              displayed delivery window.
            </label>
          </fieldset>
        )}
        {pending.current ? (
          <button disabled={busy} onClick={() => void submit()}>
            Retry the same schedule request
          </button>
        ) : (
          !locked && (
            <button
              disabled={busy || !confirmed || !attempt || !approval || !due}
              onClick={() => void submit()}
            >
              {active
                ? "Replace schedule authorization"
                : "Authorize scheduled publication"}
            </button>
          )
        )}
        <button disabled={busy || !!pending.current} onClick={close}>
          Close
        </button>
        <button
          disabled={busy || !!pending.current}
          onClick={async () => {
            setBusy(true)
            setConfirmed(false)
            setSelected("")
            setReadiness("")
            setRender(null)
            try {
              await refresh()
              setStatusVersion((version) => version + 1)
              setError("")
            } catch {
              setError(
                "Current status could not be loaded. Retry refreshing the calendar.",
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          Refresh schedule status
        </button>
      </div>
    </dialog>
  )
}
