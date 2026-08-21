"use client"

import { useEffect, useRef, useState } from "react"
import type { Route } from "next"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  Copy,
  ExternalLink,
  Link2Off,
  ListPlus,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
} from "lucide-react"

import type {
  UserPlaylistActionResult,
  UserPlaylistOwnerActions,
  UserPlaylistPage,
  UserPlaylistPolicy,
  UserPlaylistSummary,
} from "@/lib/user-playlist-contract"
import {
  USER_PLAYLIST_LIMIT,
  userPlaylistSharePath,
} from "@/lib/user-playlist-contract"

type UserPlaylistLibraryProps = {
  initialResult: UserPlaylistActionResult<UserPlaylistPage>
  policy: UserPlaylistPolicy | null
  actions: UserPlaylistOwnerActions
}

const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"

export function UserPlaylistLibrary({
  initialResult,
  policy,
  actions,
}: UserPlaylistLibraryProps) {
  const t = useTranslations("UserPlaylists")
  if (!initialResult.ok) {
    if (initialResult.code === "INELIGIBLE") return <EligibilityState />
    return <LibraryError message={safeErrorMessage(initialResult.code, t)} />
  }

  return (
    <ReadyLibrary
      initialPage={initialResult.data}
      policy={policy}
      actions={actions}
    />
  )
}

function ReadyLibrary({
  initialPage,
  policy,
  actions,
}: {
  initialPage: UserPlaylistPage
  policy: UserPlaylistPolicy | null
  actions: UserPlaylistOwnerActions
}) {
  const t = useTranslations("UserPlaylists")
  const [items, setItems] = useState(initialPage.items)
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor)
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const createButtonRef = useRef<HTMLButtonElement | null>(null)
  const atQuota = items.length >= USER_PLAYLIST_LIMIT

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    const result = await actions.list({ after: nextCursor, first: 20 })
    setLoadingMore(false)
    if (!result.ok) {
      setError(safeErrorMessage(result.code, t))
      return
    }
    setItems((current) => {
      const known = new Set(current.map((item) => item.id))
      return [
        ...current,
        ...result.data.items.filter((item) => !known.has(item.id)),
      ]
    })
    setNextCursor(result.data.nextCursor)
  }

  function replaceItem(playlist: UserPlaylistSummary) {
    setItems((current) =>
      current.map((item) => (item.id === playlist.id ? playlist : item)),
    )
  }

  async function perform(
    playlist: UserPlaylistSummary,
    operation: "unshare" | "reshare" | "rotate" | "delete",
  ) {
    const confirmations = {
      unshare: t("confirm.unshare"),
      reshare: t("confirm.reshare"),
      rotate: t("confirm.rotate"),
      delete: t("confirm.delete"),
    }
    if (!window.confirm(confirmations[operation])) return

    setPendingId(playlist.id)
    setError(null)
    const input = { id: playlist.id, expectedVersion: playlist.version }
    const result = await actions[operation](input)
    setPendingId(null)
    if (!result.ok) {
      setError(safeErrorMessage(result.code, t))
      return
    }
    if (operation === "delete") {
      setItems((current) => current.filter((item) => item.id !== playlist.id))
      setAnnouncement(t("announcement.deleted", { title: playlist.title }))
      return
    }
    if ("deleted" in result.data) return
    replaceItem(result.data)
    setAnnouncement(
      operation === "unshare"
        ? t("announcement.unshared", { title: playlist.title })
        : operation === "reshare"
          ? t("announcement.reshared", { title: playlist.title })
          : t("announcement.rotated", { title: playlist.title }),
    )
  }

  async function revealAndUse(
    playlist: UserPlaylistSummary,
    use: "copy" | "preview",
  ) {
    if (playlist.shareState !== "SHARED") return
    setPendingId(playlist.id)
    setError(null)
    const result = await actions.reveal(playlist.id)
    setPendingId(null)
    if (!result.ok) {
      setError(safeErrorMessage(result.code, t))
      return
    }
    const path = userPlaylistSharePath(result.data.capability)
    if (use === "preview") {
      window.open(path, "_blank", "noopener,noreferrer")
      return
    }
    try {
      await navigator.clipboard.writeText(
        new URL(path, window.location.origin).toString(),
      )
      setAnnouncement(t("announcement.copied", { title: playlist.title }))
    } catch {
      setError(t("errors.copy"))
    }
  }

  return (
    <section aria-labelledby="playlist-library-title" className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-widest text-red-400 uppercase">
            {t("library.eyebrow")}
          </p>
          <h1
            id="playlist-library-title"
            className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-5xl"
          >
            {t("library.title")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300 sm:text-base">
            {t("library.description")}
          </p>
        </div>
        <button
          ref={createButtonRef}
          type="button"
          className={primaryButton}
          disabled={atQuota || policy == null}
          aria-describedby={atQuota ? "playlist-quota-message" : undefined}
          onClick={() => setCreateOpen(true)}
        >
          <ListPlus aria-hidden="true" />
          {t("library.create")}
        </button>
      </div>

      {atQuota ? (
        <p
          id="playlist-quota-message"
          role="status"
          className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100"
        >
          {t("library.quota", { limit: USER_PLAYLIST_LIMIT })}
        </p>
      ) : policy == null ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100"
        >
          {t("library.policyUnavailable")}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-red-400/30 bg-red-950/70 p-4 text-sm text-red-100"
        >
          {error}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/20 bg-white/[0.03] px-5 py-14 text-center">
          <h2 className="text-xl font-semibold text-white">
            {t("library.emptyTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-stone-300">
            {t("library.emptyDescription")}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {items.map((playlist) => (
            <li
              key={playlist.id}
              className="flex min-w-0 flex-col rounded-2xl border border-white/15 bg-stone-900/80 p-5 shadow-xl shadow-black/15"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold text-white">
                    {playlist.title}
                  </h2>
                  <p className="mt-1 text-sm text-stone-400">
                    {playlist.locale}
                    {playlist.countryCode ? ` · ${playlist.countryCode}` : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    playlist.shareState === "SHARED"
                      ? "bg-emerald-400/15 text-emerald-200"
                      : "bg-stone-700 text-stone-200"
                  }`}
                >
                  {playlist.shareState === "SHARED"
                    ? t("library.sharingOn")
                    : t("library.sharingOff")}
                </span>
              </div>
              {playlist.description ? (
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-stone-300">
                  {playlist.description}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-stone-500">
                {t("library.savedVersion", { version: playlist.version })}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Link
                  href={
                    `/watch/playlists/${encodeURIComponent(playlist.id)}` as Route
                  }
                  className={secondaryButton}
                >
                  {t("library.edit")}
                </Link>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={
                    pendingId === playlist.id ||
                    playlist.shareState !== "SHARED"
                  }
                  onClick={() => void revealAndUse(playlist, "preview")}
                >
                  <ExternalLink aria-hidden="true" />
                  {t("library.previewSaved")}
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={
                    pendingId === playlist.id ||
                    playlist.shareState !== "SHARED"
                  }
                  onClick={() => void revealAndUse(playlist, "copy")}
                >
                  <Copy aria-hidden="true" />
                  {t("library.copySaved")}
                </button>
                {playlist.shareState === "SHARED" ? (
                  <>
                    <button
                      type="button"
                      className={secondaryButton}
                      disabled={pendingId === playlist.id}
                      onClick={() => void perform(playlist, "unshare")}
                    >
                      <Link2Off aria-hidden="true" />
                      {t("library.unshare")}
                    </button>
                    <button
                      type="button"
                      className={secondaryButton}
                      disabled={pendingId === playlist.id}
                      onClick={() => void perform(playlist, "rotate")}
                    >
                      <RotateCw aria-hidden="true" />
                      {t("library.replaceLink")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={secondaryButton}
                    disabled={pendingId === playlist.id}
                    onClick={() => void perform(playlist, "reshare")}
                  >
                    <RefreshCw aria-hidden="true" />
                    {t("library.reshare")}
                  </button>
                )}
                <button
                  type="button"
                  className={`${secondaryButton} border-red-400/30 text-red-200 hover:bg-red-950/60`}
                  disabled={pendingId === playlist.id}
                  onClick={() => void perform(playlist, "delete")}
                >
                  <Trash2 aria-hidden="true" />
                  {t("library.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <button
            type="button"
            className={secondaryButton}
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? t("library.loadingMore") : t("library.loadMore")}
          </button>
        </div>
      ) : null}

      {createOpen && policy ? (
        <CreatePlaylistDialog
          policy={policy}
          actions={actions}
          onClose={() => {
            setCreateOpen(false)
            requestAnimationFrame(() => createButtonRef.current?.focus())
          }}
          onError={setError}
        />
      ) : null}
    </section>
  )
}

function CreatePlaylistDialog({
  policy,
  actions,
  onClose,
  onError,
}: {
  policy: UserPlaylistPolicy
  actions: UserPlaylistOwnerActions
  onClose: () => void
  onError: (message: string) => void
}) {
  const t = useTranslations("UserPlaylists")
  const titleRef = useRef<HTMLInputElement | null>(null)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [locale, setLocale] = useState("en")
  const [countryCode, setCountryCode] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [pending, setPending] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  useEffect(() => {
    titleRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose, pending])

  async function create() {
    if (!title.trim() || !accepted || pending) return
    setPending(true)
    setDialogError(null)
    const result = await actions.create({
      title: title.trim(),
      description: description.trim(),
      locale: locale.trim(),
      countryCode: countryCode.trim().toUpperCase() || null,
      blocks: [],
      acceptance: {
        termsVersion: policy.terms.version,
        privacyVersion: policy.privacy.version,
        communityGuidelinesVersion: policy.communityGuidelines.version,
      },
    })
    setPending(false)
    if (!result.ok) {
      const message = safeErrorMessage(result.code, t)
      setDialogError(message)
      onError(message)
      return
    }
    // The capability is deliberately not placed in the URL, logs, or client
    // analytics here. The editor can reveal it only when the owner asks.
    window.location.assign(
      `/watch/playlists/${encodeURIComponent(result.data.id)}`,
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-playlist-title"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-stone-950 p-5 text-white shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-playlist-title" className="text-2xl font-bold">
              {t("create.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              {t("create.description")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("create.close")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            disabled={pending}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="mt-6 grid gap-5">
          <label className="grid gap-2 text-sm font-medium">
            {t("create.titleLabel")}
            <input
              ref={titleRef}
              value={title}
              maxLength={120}
              required
              className="min-h-11 rounded-lg border border-white/20 bg-stone-900 px-3 text-white focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            {t("create.descriptionLabel")}
            <textarea
              value={description}
              maxLength={2000}
              rows={3}
              className="rounded-lg border border-white/20 bg-stone-900 px-3 py-2 text-white focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              {t("create.localeLabel")}
              <input
                value={locale}
                placeholder="en"
                className="min-h-11 rounded-lg border border-white/20 bg-stone-900 px-3 text-white focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"
                onChange={(event) => setLocale(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              {t("create.countryLabel")}
              <input
                value={countryCode}
                maxLength={2}
                placeholder="KE"
                className="min-h-11 rounded-lg border border-white/20 bg-stone-900 px-3 text-white uppercase focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"
                onChange={(event) => setCountryCode(event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs leading-5 text-stone-400">
            {t("create.contextHelp")}
          </p>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/15 bg-white/5 p-4 text-sm leading-6">
            <input
              type="checkbox"
              checked={accepted}
              className="mt-1 h-5 w-5 shrink-0 accent-red-600"
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              {t("create.acceptPrefix")}{" "}
              <PolicyLink policy={policy.terms} label={t("create.terms")} />,{" "}
              <PolicyLink policy={policy.privacy} label={t("create.privacy")} />
              ,{" "}
              <PolicyLink
                policy={policy.communityGuidelines}
                label={t("create.guidelines")}
              />
              .
            </span>
          </label>
        </div>

        {dialogError ? (
          <p role="alert" className="mt-4 text-sm text-red-200">
            {dialogError}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={secondaryButton}
            disabled={pending}
            onClick={onClose}
          >
            {t("create.decline")}
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={!accepted || !title.trim() || pending}
            onClick={() => void create()}
          >
            {pending ? t("create.submitting") : t("create.submit")}
          </button>
        </div>
      </section>
    </div>
  )
}

function PolicyLink({
  policy,
  label,
}: {
  policy: { version: string; url: string }
  label: string
}) {
  const t = useTranslations("UserPlaylists")
  return (
    <a
      href={policy.url}
      target="_blank"
      rel="noreferrer"
      className="font-semibold text-red-300 underline underline-offset-2"
    >
      {t("create.policyVersion", { label, version: policy.version })}
    </a>
  )
}

function EligibilityState() {
  const t = useTranslations("UserPlaylists")
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-white/15 bg-stone-900/80 p-6 text-white sm:p-8">
      <p className="text-sm font-semibold tracking-widest text-red-400 uppercase">
        {t("eligibility.eyebrow")}
      </p>
      <h1 className="mt-3 text-3xl font-bold">{t("eligibility.title")}</h1>
      <p className="mt-4 leading-7 text-stone-300">
        {t("eligibility.description")}
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href={
            "/watch/api/auth/login?returnTo=%2Fwatch%2Fplaylists&prompt=select_account" as Route
          }
          className={primaryButton}
        >
          {t("eligibility.continue")}
        </Link>
        <Link href={"/watch" as Route} className={secondaryButton}>
          {t("eligibility.return")}
        </Link>
      </div>
    </section>
  )
}

function LibraryError({ message }: { message: string }) {
  const t = useTranslations("UserPlaylists")
  return (
    <section
      role="alert"
      className="mx-auto max-w-2xl rounded-2xl border border-red-400/30 bg-red-950/50 p-6 text-white"
    >
      <h1 className="text-2xl font-bold">{t("errors.loadTitle")}</h1>
      <p className="mt-3 text-red-100">{message}</p>
      <button
        type="button"
        className={`${primaryButton} mt-6`}
        onClick={() => window.location.reload()}
      >
        {t("retry")}
      </button>
    </section>
  )
}

type ErrorMessageKey =
  | "errors.conflict"
  | "errors.limit"
  | "errors.invalid"
  | "errors.rateLimited"
  | "errors.unauthenticated"
  | "errors.notFound"
  | "errors.unavailable"

function safeErrorMessage(
  code: string,
  t: (key: ErrorMessageKey) => string,
): string {
  switch (code) {
    case "CONFLICT":
      return t("errors.conflict")
    case "LIMIT_EXCEEDED":
      return t("errors.limit")
    case "INVALID_INPUT":
      return t("errors.invalid")
    case "RATE_LIMITED":
      return t("errors.rateLimited")
    case "UNAUTHENTICATED":
      return t("errors.unauthenticated")
    case "NOT_FOUND":
      return t("errors.notFound")
    default:
      return t("errors.unavailable")
  }
}
