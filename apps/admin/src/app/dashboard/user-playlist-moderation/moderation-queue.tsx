"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ShieldAlert, ShieldCheck } from "lucide-react"
import { PrimaryButton, SecondaryButton, cx } from "@/components/admin-ui"
import {
  moderateUserPlaylist,
  type UserPlaylistModerationActionInput,
} from "./moderation-actions"

type ReportDetailStatus = "AVAILABLE" | "ABSENT" | "EXPIRED" | "UNAVAILABLE"

export type PlaylistModeratorReportView = {
  reportId: string
  category:
    | "INAPPROPRIATE_CONTENT"
    | "MISLEADING_OR_SPAM"
    | "COPYRIGHT_OR_RIGHTS"
    | "PRIVACY_OR_PERSONAL_DATA"
    | "OTHER_SAFETY"
  detailPlainText: string | null
  detailStatus: ReportDetailStatus
  createdAt: string
}

export type PlaylistReportGroup = {
  playlistId: string
  reports: PlaylistModeratorReportView[]
}

export type ModerationQueueLabels = {
  playlistLabel: string
  reportCount: string
  reportsCount: string
  reportedAt: string
  details: Record<ReportDetailStatus, string>
  categories: Record<PlaylistModeratorReportView["category"], string>
  actions: {
    block: string
    restore: string
    blockTitle: string
    restoreTitle: string
    blockDescription: string
    restoreDescription: string
    reason: string
    selectReason: string
    confirmBlock: string
    confirmRestore: string
    cancel: string
    working: string
    blocked: string
    restored: string
    failed: string
  }
  blockReasons: Record<
    Extract<UserPlaylistModerationActionInput, { action: "BLOCK" }>["reason"],
    string
  >
  restoreReasons: Record<
    Extract<UserPlaylistModerationActionInput, { action: "RESTORE" }>["reason"],
    string
  >
}

type DialogState = {
  action: "BLOCK" | "RESTORE"
  playlistId: string
  triggerKey: string
}

const blockReasonValues = [
  "ABUSE",
  "COPYRIGHT",
  "PRIVACY",
  "SAFETY",
  "SPAM",
  "OTHER_POLICY",
] as const

const restoreReasonValues = [
  "REVIEW_CLEARED",
  "APPEAL_APPROVED",
  "ERROR_CORRECTED",
] as const

export function ModerationQueue({
  groups,
  labels,
}: {
  groups: PlaylistReportGroup[]
  labels: ModerationQueueLabels
}) {
  const router = useRouter()
  const titleId = useId()
  const descriptionId = useId()
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const reasonRef = useRef<HTMLSelectElement>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const [error, setError] = useState("")

  const focusTrigger = useCallback((triggerKey: string) => {
    triggerRefs.current.get(triggerKey)?.focus()
  }, [])

  const closeDialog = useCallback(
    (returnFocus: boolean) => {
      const triggerKey = dialog?.triggerKey
      setDialog(null)
      setReason("")
      if (returnFocus && triggerKey) focusTrigger(triggerKey)
    },
    [dialog, focusTrigger],
  )

  useEffect(() => {
    if (!dialog) return
    reasonRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        closeDialog(true)
      }
      if (event.key !== "Tab") return
      const modal = reasonRef.current?.closest<HTMLElement>("[role=dialog]")
      const focusable = modal?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),select:not([disabled])",
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeDialog, dialog, pending])

  function openDialog(
    action: DialogState["action"],
    playlistId: string,
    triggerKey: string,
  ) {
    setAnnouncement("")
    setError("")
    setReason("")
    setDialog({ action, playlistId, triggerKey })
  }

  async function confirmAction() {
    if (!dialog || !reason || pending) return
    const current = dialog
    setPending(true)
    setError("")

    let result: Awaited<ReturnType<typeof moderateUserPlaylist>>
    try {
      result =
        current.action === "BLOCK"
          ? await moderateUserPlaylist({
              playlistId: current.playlistId,
              action: "BLOCK",
              reason: reason as Extract<
                UserPlaylistModerationActionInput,
                { action: "BLOCK" }
              >["reason"],
            })
          : await moderateUserPlaylist({
              playlistId: current.playlistId,
              action: "RESTORE",
              reason: reason as Extract<
                UserPlaylistModerationActionInput,
                { action: "RESTORE" }
              >["reason"],
            })
    } catch {
      result = { status: "error" }
    }

    setPending(false)
    setDialog(null)
    setReason("")
    focusTrigger(current.triggerKey)

    if (result.status === "success") {
      setAnnouncement(
        current.action === "BLOCK"
          ? labels.actions.blocked
          : labels.actions.restored,
      )
      router.refresh()
    } else {
      setError(labels.actions.failed)
    }
  }

  const reasonValues =
    dialog?.action === "BLOCK" ? blockReasonValues : restoreReasonValues

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {error ? (
        <div
          role="alert"
          className="border-b border-[var(--color-danger-border)] px-4 py-3 text-[13px] text-[var(--color-danger)]"
        >
          {error}
        </div>
      ) : null}

      <div className="divide-y divide-[var(--color-hairline)]">
        {groups.map((group) => (
          <article
            key={group.playlistId}
            className="scroll-mt-6 px-4 py-5"
            aria-labelledby={`playlist-${group.playlistId}`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="label-text">{labels.playlistLabel}</div>
                <h3
                  id={`playlist-${group.playlistId}`}
                  className="mt-1 break-all font-mono text-[13px] font-medium text-[var(--color-text-primary)]"
                >
                  {group.playlistId}
                </h3>
                <p className="mt-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                  {group.reports.length}{" "}
                  {group.reports.length === 1
                    ? labels.reportCount
                    : labels.reportsCount}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["BLOCK", "RESTORE"] as const).map((action) => {
                  const triggerKey = `${group.playlistId}:${action}`
                  return (
                    <button
                      key={action}
                      ref={(element) => {
                        if (element)
                          triggerRefs.current.set(triggerKey, element)
                        else triggerRefs.current.delete(triggerKey)
                      }}
                      onClick={() =>
                        openDialog(action, group.playlistId, triggerKey)
                      }
                      aria-haspopup="dialog"
                      aria-label={`${
                        action === "BLOCK"
                          ? labels.actions.block
                          : labels.actions.restore
                      } ${group.playlistId}`}
                      type="button"
                      className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                    >
                      {action === "BLOCK" ? (
                        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      )}
                      {action === "BLOCK"
                        ? labels.actions.block
                        : labels.actions.restore}
                    </button>
                  )
                })}
              </div>
            </div>

            <ol className="mt-4 grid gap-3">
              {group.reports.map((report) => (
                <li
                  key={report.reportId}
                  className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-3"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-[12px] font-medium text-[var(--color-text-primary)]">
                      {labels.categories[report.category]}
                    </span>
                    <time
                      dateTime={report.createdAt}
                      className="font-mono text-[10px] text-[var(--color-text-muted)]"
                    >
                      {labels.reportedAt}{" "}
                      {report.createdAt.replace("T", " ").slice(0, 16)} UTC
                    </time>
                  </div>
                  <p
                    className={cx(
                      "mt-2 whitespace-pre-wrap break-words text-[12px] leading-5",
                      report.detailStatus === "AVAILABLE"
                        ? "text-[var(--color-text-secondary)]"
                        : "italic text-[var(--color-text-muted)]",
                    )}
                  >
                    {report.detailStatus === "AVAILABLE"
                      ? report.detailPlainText
                      : labels.details[report.detailStatus]}
                  </p>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>

      {dialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,6,10,0.78)] px-4 backdrop-blur-[8px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) {
              closeDialog(true)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-[420px] rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] p-5 shadow-[0_32px_120px_rgba(0,0,0,0.58)]"
          >
            <h2 id={titleId} className="text-[18px] font-semibold">
              {dialog.action === "BLOCK"
                ? labels.actions.blockTitle
                : labels.actions.restoreTitle}
            </h2>
            <p
              id={descriptionId}
              className="mt-2 text-[13px] leading-5 text-[var(--color-text-secondary)]"
            >
              {dialog.action === "BLOCK"
                ? labels.actions.blockDescription
                : labels.actions.restoreDescription}
            </p>
            <label className="mt-4 block">
              <span className="label-text">{labels.actions.reason}</span>
              <select
                ref={reasonRef}
                name="reason"
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-background)] px-3 py-2 text-[13px]"
              >
                <option value="">{labels.actions.selectReason}</option>
                {reasonValues.map((value) => (
                  <option key={value} value={value}>
                    {dialog.action === "BLOCK"
                      ? labels.blockReasons[
                          value as keyof ModerationQueueLabels["blockReasons"]
                        ]
                      : labels.restoreReasons[
                          value as keyof ModerationQueueLabels["restoreReasons"]
                        ]}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <SecondaryButton
                onClick={() => closeDialog(true)}
                disabled={pending}
              >
                {labels.actions.cancel}
              </SecondaryButton>
              <PrimaryButton
                onClick={confirmAction}
                disabled={!reason || pending}
              >
                {pending
                  ? labels.actions.working
                  : dialog.action === "BLOCK"
                    ? labels.actions.confirmBlock
                    : labels.actions.confirmRestore}
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
