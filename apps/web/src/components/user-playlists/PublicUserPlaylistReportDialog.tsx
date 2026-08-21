"use client"

import { useEffect, useState } from "react"
import { Flag } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { submitPublicUserPlaylistReport } from "@/lib/user-playlist-public-actions"
import {
  USER_PLAYLIST_REPORT_CATEGORIES,
  type UserPlaylistReportCategory,
} from "@/lib/user-playlist-public-contract"

const DETAIL_LIMIT = 1_000

type ReportState =
  | "idle"
  | "validation"
  | "submitting"
  | "uniform-success"
  | "retryable-network-error"
  | "unavailable-intent"

const REPORT_STATUS_MESSAGE_KEYS = {
  validation: "report.validation",
  "uniform-success": "report.success",
  "retryable-network-error": "report.networkError",
  "unavailable-intent": "report.intentUnavailable",
} as const satisfies Record<Exclude<ReportState, "idle" | "submitting">, string>

function reportStatusMessageKey(state: ReportState) {
  return state === "idle" || state === "submitting"
    ? null
    : REPORT_STATUS_MESSAGE_KEYS[state]
}

export function PublicUserPlaylistReportDialog({
  reportIntent,
  intentTtlMs,
}: {
  reportIntent: string
  intentTtlMs: number
}) {
  const t = useTranslations("PublicUserPlaylist")
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<UserPlaylistReportCategory | "">("")
  const [detail, setDetail] = useState("")
  const [state, setState] = useState<ReportState>("idle")
  const [intentAvailable, setIntentAvailable] = useState(intentTtlMs > 0)

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setIntentAvailable(false),
      Math.max(0, intentTtlMs),
    )
    return () => window.clearTimeout(timeout)
  }, [intentTtlMs])

  async function submit() {
    if (state === "submitting" || state === "uniform-success") return
    if (!intentAvailable) {
      setState("unavailable-intent")
      return
    }
    if (!category || detail.length > DETAIL_LIMIT) {
      setState("validation")
      return
    }
    setState("submitting")
    try {
      const result = await submitPublicUserPlaylistReport({
        reportIntent,
        category,
        detail,
      })
      setState(result.ok ? "uniform-success" : "retryable-network-error")
    } catch {
      setState("retryable-network-error")
    }
  }

  const statusMessageKey = reportStatusMessageKey(state)
  const statusMessage = statusMessageKey ? t(statusMessageKey) : null

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && state === "submitting") return
        setOpen(nextOpen)
        if (nextOpen && !intentAvailable) {
          setState("unavailable-intent")
        } else if (nextOpen && state !== "uniform-success") {
          setState("idle")
        }
      }}
    >
      <DialogTrigger className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-white/25 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 focus-visible:outline-none">
        <Flag className="h-4 w-4" aria-hidden="true" />
        {t("report.action")}
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto border border-white/15 bg-stone-950 text-stone-100 sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {t("report.title")}
          </DialogTitle>
          <DialogDescription className="leading-6 text-stone-300">
            {t("report.description")}
          </DialogDescription>
        </DialogHeader>

        {state === "uniform-success" ? (
          <div
            role="status"
            tabIndex={-1}
            autoFocus
            className="rounded-lg border border-emerald-300/30 bg-emerald-950/40 p-4 text-sm leading-6 text-emerald-100 outline-none"
          >
            {t("report.success")}
          </div>
        ) : (
          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              {t("report.categoryLabel")}
              <select
                value={category}
                disabled={state === "submitting"}
                className="min-h-11 rounded-lg border border-white/20 bg-stone-900 px-3 text-white focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:outline-none"
                onChange={(event) => {
                  setCategory(
                    event.target.value as UserPlaylistReportCategory | "",
                  )
                  if (state === "validation") setState("idle")
                }}
              >
                <option value="">{t("report.categoryPlaceholder")}</option>
                {USER_PLAYLIST_REPORT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`report.categories.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              {t("report.detailLabel")}
              <textarea
                value={detail}
                maxLength={DETAIL_LIMIT}
                rows={5}
                disabled={state === "submitting"}
                className="resize-y rounded-lg border border-white/20 bg-stone-900 px-3 py-2 text-white focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:outline-none"
                onChange={(event) => setDetail(event.target.value)}
              />
              <span className="text-right text-xs font-normal text-stone-400">
                {t("report.charactersRemaining", {
                  count: DETAIL_LIMIT - detail.length,
                })}
              </span>
            </label>
          </div>
        )}

        {statusMessage && state !== "uniform-success" ? (
          <p
            role={state === "validation" ? "alert" : "status"}
            aria-live="polite"
            className="text-sm leading-6 text-red-200"
          >
            {statusMessage}
          </p>
        ) : null}

        <DialogFooter className="border-white/10 bg-white/5">
          <DialogClose
            disabled={state === "submitting"}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/20 px-4 font-semibold hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "uniform-success"
              ? t("report.close")
              : t("report.cancel")}
          </DialogClose>
          {state !== "uniform-success" ? (
            <button
              type="button"
              disabled={
                state === "submitting" || state === "unavailable-intent"
              }
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 font-bold text-stone-950 hover:bg-stone-200 focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void submit()}
            >
              {state === "submitting"
                ? t("report.submitting")
                : t("report.submit")}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
