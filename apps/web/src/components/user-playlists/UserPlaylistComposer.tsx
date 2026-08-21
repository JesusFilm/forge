"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { Route } from "next"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  ExternalLink,
  Link2Off,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Trash2,
  Video,
} from "lucide-react"

import { UserPlaylistVideoPicker } from "./UserPlaylistVideoPicker"
import type {
  UserPlaylist,
  UserPlaylistBlock,
  UserPlaylistOwnerActions,
} from "@/lib/user-playlist-contract"
import {
  USER_PLAYLIST_BLOCK_LIMIT,
  USER_PLAYLIST_ITEM_LIMIT,
  USER_PLAYLIST_TOTAL_ITEM_LIMIT,
  userPlaylistSharePath,
} from "@/lib/user-playlist-contract"

type SaveStatus =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "validation-error"
  | "network-error"
  | "stale-conflict"

type EditorBlock = {
  key: string
  value: UserPlaylistBlock
}

type PickerTarget = {
  blockKey: string
  replaceItemIndex?: number
}

const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
const fieldClass =
  "min-h-11 rounded-lg border border-white/20 bg-stone-950 px-3 text-white placeholder:text-stone-500 focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"

export function UserPlaylistComposer({
  playlist: initialPlaylist,
  actions,
}: {
  playlist: UserPlaylist
  actions: UserPlaylistOwnerActions
}) {
  const t = useTranslations("UserPlaylists")
  const keySequence = useRef(initialPlaylist.blocks.length)
  const [serverPlaylist, setServerPlaylist] = useState(initialPlaylist)
  const [title, setTitle] = useState(initialPlaylist.title)
  const [description, setDescription] = useState(initialPlaylist.description)
  const [locale, setLocale] = useState(initialPlaylist.locale)
  const [countryCode, setCountryCode] = useState(
    initialPlaylist.countryCode ?? "",
  )
  const [blocks, setBlocks] = useState<EditorBlock[]>(() =>
    initialPlaylist.blocks.map((value, index) => ({
      key: `saved-${index}`,
      value: cloneBlock(value),
    })),
  )
  const [mediaLabels, setMediaLabels] = useState<Record<string, string>>({})
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const [status, setStatus] = useState<SaveStatus>("clean")
  const [message, setMessage] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [managementPending, setManagementPending] = useState(false)

  const unavailableIds = useMemo(
    () => new Set(initialPlaylist.unavailableVideoIds),
    [initialPlaylist.unavailableVideoIds],
  )
  const retainedUnavailable = blocks.some((block) =>
    block.value.kind === "TEXT"
      ? false
      : block.value.items.some((item) => unavailableIds.has(item.videoId)),
  )
  const totalItems = blocks.reduce(
    (total, block) =>
      total + (block.value.kind === "TEXT" ? 0 : block.value.items.length),
    0,
  )
  const dirty =
    status === "dirty" ||
    status.endsWith("error") ||
    status === "stale-conflict"

  useEffect(() => {
    if (!dirty) return
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [dirty])

  function markDirty() {
    setStatus("dirty")
    setMessage(null)
  }

  function changeBlock(
    key: string,
    change: (block: UserPlaylistBlock) => UserPlaylistBlock,
  ) {
    setBlocks((current) =>
      current.map((block) =>
        block.key === key ? { ...block, value: change(block.value) } : block,
      ),
    )
    markDirty()
  }

  function addBlock(kind: UserPlaylistBlock["kind"]) {
    if (blocks.length >= USER_PLAYLIST_BLOCK_LIMIT) return
    const value: UserPlaylistBlock =
      kind === "TEXT" ? { kind, text: "" } : { kind, title: "", items: [] }
    const key = `new-${++keySequence.current}`
    setBlocks((current) => [...current, { key, value }])
    markDirty()
    setAnnouncement(
      t("announcement.addedBlock", {
        position: blocks.length + 1,
        total: blocks.length + 1,
      }),
    )
    requestAnimationFrame(() => focusBlockControl(key, "remove"))
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const destination = index + direction
    if (destination < 0 || destination >= blocks.length) return
    const key = blocks[index]?.key
    if (!key) return
    setBlocks((current) => {
      const next = [...current]
      const [moved] = next.splice(index, 1)
      if (moved) next.splice(destination, 0, moved)
      return next
    })
    markDirty()
    setAnnouncement(
      t("announcement.movedBlock", {
        position: destination + 1,
        total: blocks.length,
      }),
    )
    requestAnimationFrame(() =>
      focusBlockControl(key, direction < 0 ? "up" : "down"),
    )
  }

  function removeBlock(index: number) {
    const nextKey = blocks[index + 1]?.key ?? blocks[index - 1]?.key
    setBlocks((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    )
    markDirty()
    setAnnouncement(t("announcement.removedBlock", { position: index + 1 }))
    requestAnimationFrame(() => {
      if (nextKey) focusBlockControl(nextKey, "remove")
      else
        document
          .querySelector<HTMLButtonElement>('[data-add-block="TEXT"]')
          ?.focus()
    })
  }

  function moveItem(blockKey: string, itemIndex: number, direction: -1 | 1) {
    changeBlock(blockKey, (block) => {
      if (block.kind === "TEXT") return block
      const destination = itemIndex + direction
      if (destination < 0 || destination >= block.items.length) return block
      const items = [...block.items]
      const [moved] = items.splice(itemIndex, 1)
      if (moved) items.splice(destination, 0, moved)
      return { ...block, items }
    })
    const block = blocks.find((candidate) => candidate.key === blockKey)
    const length =
      block?.value.kind === "TEXT" ? 0 : (block?.value.items.length ?? 0)
    setAnnouncement(
      t("announcement.movedVideo", {
        position: itemIndex + direction + 1,
        total: length,
      }),
    )
    requestAnimationFrame(() =>
      focusMediaControl(
        blockKey,
        itemIndex + direction,
        direction < 0 ? "up" : "down",
      ),
    )
  }

  function removeItem(blockKey: string, itemIndex: number) {
    const block = blocks.find((candidate) => candidate.key === blockKey)
    const previousLength =
      block?.value.kind === "TEXT" ? 0 : (block?.value.items.length ?? 0)
    changeBlock(blockKey, (block) =>
      block.kind === "TEXT"
        ? block
        : {
            ...block,
            items: block.items.filter((_, index) => index !== itemIndex),
          },
    )
    setAnnouncement(t("announcement.removedVideo", { position: itemIndex + 1 }))
    requestAnimationFrame(() => {
      const remaining = Math.max(0, previousLength - 1)
      if (remaining > 0) {
        focusMediaControl(
          blockKey,
          Math.min(itemIndex, remaining - 1),
          "remove",
        )
      } else {
        document
          .querySelector<HTMLButtonElement>(
            `[data-block-key="${blockKey}"] [data-add-video]`,
          )
          ?.focus()
      }
    })
  }

  function selectVideo(video: { id: string; title: string }) {
    if (!pickerTarget) return
    const { blockKey, replaceItemIndex } = pickerTarget
    changeBlock(blockKey, (block) => {
      if (block.kind === "TEXT") return block
      const items = [...block.items]
      if (replaceItemIndex == null) {
        if (
          items.length >= USER_PLAYLIST_ITEM_LIMIT ||
          totalItems >= USER_PLAYLIST_TOTAL_ITEM_LIMIT
        ) {
          return block
        }
        items.push({ videoId: video.id })
      } else {
        items[replaceItemIndex] = { videoId: video.id }
      }
      return { ...block, items }
    })
    setMediaLabels((current) => ({ ...current, [video.id]: video.title }))
    setPickerTarget(null)
    setAnnouncement(
      replaceItemIndex == null
        ? t("announcement.addedVideo", { title: video.title })
        : t("announcement.replacedVideo", { title: video.title }),
    )
  }

  async function save() {
    if (status === "saving" || retainedUnavailable) return
    if (!title.trim() || !locale.trim()) {
      setStatus("validation-error")
      setMessage(t("errors.saveValidation"))
      return
    }
    setStatus("saving")
    setMessage(null)
    const result = await actions.update({
      id: serverPlaylist.id,
      expectedVersion: serverPlaylist.version,
      title: title.trim(),
      description: description.trim(),
      locale: locale.trim(),
      countryCode: countryCode.trim().toUpperCase() || null,
      blocks: blocks.map((block) => cloneBlock(block.value)),
    })
    if (!result.ok) {
      if (result.code === "CONFLICT") {
        setStatus("stale-conflict")
        setMessage(t("errors.saveConflict"))
      } else if (
        result.code === "INVALID_INPUT" ||
        result.code === "LIMIT_EXCEEDED"
      ) {
        setStatus("validation-error")
        setMessage(
          result.code === "LIMIT_EXCEEDED"
            ? t("errors.saveLimit")
            : t("errors.saveInvalid"),
        )
      } else {
        setStatus("network-error")
        setMessage(t("errors.saveNetwork"))
      }
      return
    }
    setServerPlaylist(result.data)
    setTitle(result.data.title)
    setDescription(result.data.description)
    setLocale(result.data.locale)
    setCountryCode(result.data.countryCode ?? "")
    setBlocks((current) =>
      result.data.blocks.map((value, index) => ({
        key: current[index]?.key ?? `saved-${index}`,
        value: cloneBlock(value),
      })),
    )
    setStatus("saved")
    setMessage(t("composer.savedMessage", { version: result.data.version }))
    setAnnouncement(t("announcement.saved", { version: result.data.version }))
  }

  async function revealAndUse(use: "copy" | "preview") {
    if (serverPlaylist.shareState !== "SHARED" || managementPending) return
    setManagementPending(true)
    const result = await actions.reveal(serverPlaylist.id)
    setManagementPending(false)
    if (!result.ok) {
      setMessage(t("errors.reveal"))
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
      setAnnouncement(t("announcement.copiedSaved"))
    } catch {
      setMessage(t("errors.copy"))
    }
  }

  async function manage(operation: "unshare" | "reshare" | "rotate") {
    const confirmation = {
      unshare: t("confirm.unshareEditor"),
      reshare: t("confirm.reshareEditor"),
      rotate: t("confirm.rotateEditor"),
    }[operation]
    if (!window.confirm(confirmation)) return
    setManagementPending(true)
    setMessage(null)
    const result = await actions[operation]({
      id: serverPlaylist.id,
      expectedVersion: serverPlaylist.version,
    })
    setManagementPending(false)
    if (!result.ok) {
      setMessage(
        result.code === "CONFLICT"
          ? t("errors.linkConflict")
          : t("errors.linkChange"),
      )
      return
    }
    setServerPlaylist(
      "playlist" in result.data ? result.data.playlist : result.data,
    )
    setAnnouncement(
      operation === "unshare"
        ? t("announcement.sharingOff")
        : operation === "reshare"
          ? t("announcement.linkActive")
          : t("announcement.linkReplaced"),
    )
  }

  async function removePlaylist() {
    if (!window.confirm(t("confirm.delete"))) {
      return
    }
    setManagementPending(true)
    const result = await actions.delete({
      id: serverPlaylist.id,
      expectedVersion: serverPlaylist.version,
    })
    setManagementPending(false)
    if (!result.ok) {
      setMessage(t("errors.delete"))
      return
    }
    window.location.assign("/watch/playlists")
  }

  return (
    <section aria-labelledby="playlist-editor-title" className="pb-32">
      <Link
        href={"/watch/playlists" as Route}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-stone-300 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      >
        <ArrowLeft aria-hidden="true" />
        {t("composer.back")}
      </Link>

      <div className="mt-5 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-widest text-red-400 uppercase">
            {t("composer.eyebrow")}
          </p>
          <h1
            id="playlist-editor-title"
            className="mt-2 truncate text-3xl font-bold tracking-tight text-white sm:text-5xl"
          >
            {serverPlaylist.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-stone-300">
            {t("composer.description")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:max-w-2xl xl:justify-end">
          <button
            type="button"
            className={secondaryButton}
            disabled={
              serverPlaylist.shareState !== "SHARED" || managementPending
            }
            onClick={() => void revealAndUse("preview")}
          >
            <ExternalLink aria-hidden="true" />
            {t("composer.previewSaved")}
          </button>
          <button
            type="button"
            className={secondaryButton}
            disabled={
              serverPlaylist.shareState !== "SHARED" || managementPending
            }
            onClick={() => void revealAndUse("copy")}
          >
            <Copy aria-hidden="true" />
            {t("composer.copySaved")}
          </button>
          {serverPlaylist.shareState === "SHARED" ? (
            <>
              <button
                type="button"
                className={secondaryButton}
                disabled={managementPending}
                onClick={() => void manage("unshare")}
              >
                <Link2Off aria-hidden="true" />
                {t("composer.unshare")}
              </button>
              <button
                type="button"
                className={secondaryButton}
                disabled={managementPending}
                onClick={() => void manage("rotate")}
              >
                <RotateCw aria-hidden="true" />
                {t("composer.replaceLink")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={secondaryButton}
              disabled={managementPending}
              onClick={() => void manage("reshare")}
            >
              <RefreshCw aria-hidden="true" />
              {t("composer.reshare")}
            </button>
          )}
          <button
            type="button"
            className={`${secondaryButton} border-red-400/30 text-red-200 hover:bg-red-950/60`}
            disabled={managementPending}
            onClick={() => void removePlaylist()}
          >
            <Trash2 aria-hidden="true" />
            {t("composer.delete")}
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-5 rounded-2xl border border-white/15 bg-stone-900/70 p-5 sm:grid-cols-2 sm:p-7">
        <label className="grid gap-2 text-sm font-semibold text-white">
          {t("composer.titleLabel")}
          <input
            id="playlist-title"
            value={title}
            maxLength={120}
            className={fieldClass}
            onChange={(event) => {
              setTitle(event.target.value)
              markDirty()
            }}
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-white">
          {t("composer.descriptionLabel")}
          <input
            value={description}
            maxLength={2000}
            className={fieldClass}
            onChange={(event) => {
              setDescription(event.target.value)
              markDirty()
            }}
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-white">
          {t("composer.localeLabel")}
          <input
            value={locale}
            className={fieldClass}
            onChange={(event) => {
              setLocale(event.target.value)
              markDirty()
            }}
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-white">
          {t("composer.countryLabel")}
          <input
            value={countryCode}
            maxLength={2}
            className={`${fieldClass} uppercase`}
            onChange={(event) => {
              setCountryCode(event.target.value)
              markDirty()
            }}
          />
        </label>
        <p className="text-xs leading-5 text-stone-400 sm:col-span-2">
          {t("composer.contextHelp")}
        </p>
      </div>

      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">
            {t("composer.blocksTitle")}
          </h2>
          <p className="mt-2 text-sm text-stone-400">
            {t("composer.blockCount", {
              blocks: blocks.length,
              blockLimit: USER_PLAYLIST_BLOCK_LIMIT,
              items: totalItems,
              itemLimit: USER_PLAYLIST_TOTAL_ITEM_LIMIT,
            })}
          </p>
        </div>
        <div
          aria-label={t("blocks.addLabel")}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {(
            [
              ["TEXT", t("blocks.text")],
              ["MEDIA_COLLECTION", t("blocks.collection")],
              ["VIDEO_CAROUSEL", t("blocks.carousel")],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              data-add-block={kind}
              className={secondaryButton}
              disabled={blocks.length >= USER_PLAYLIST_BLOCK_LIMIT}
              onClick={() => addBlock(kind)}
            >
              <Plus aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <ol className="mt-5 space-y-5">
        {blocks.map((block, index) => (
          <li
            key={block.key}
            data-block-key={block.key}
            className="min-w-0 rounded-2xl border border-white/15 bg-stone-900/75 p-4 sm:p-6"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-semibold text-white">
                {t("blocks.heading", {
                  type:
                    block.value.kind === "TEXT"
                      ? t("blocks.text")
                      : block.value.kind === "MEDIA_COLLECTION"
                        ? t("blocks.collection")
                        : t("blocks.carousel"),
                  position: index + 1,
                  total: blocks.length,
                })}
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <OrderButton
                  action="up"
                  label={t("blocks.moveBlockUpLabel", { position: index + 1 })}
                  disabled={index === 0}
                  onClick={() => moveBlock(index, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">
                    {t("blocks.moveUp")}
                  </span>
                </OrderButton>
                <OrderButton
                  action="down"
                  label={t("blocks.moveBlockDownLabel", {
                    position: index + 1,
                  })}
                  disabled={index === blocks.length - 1}
                  onClick={() => moveBlock(index, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">
                    {t("blocks.moveDown")}
                  </span>
                </OrderButton>
                <OrderButton
                  action="remove"
                  label={t("blocks.removeBlockLabel", { position: index + 1 })}
                  onClick={() => removeBlock(index)}
                >
                  <Trash2 aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">
                    {t("blocks.remove")}
                  </span>
                </OrderButton>
              </div>
            </div>

            <div className="mt-5">
              {block.value.kind === "TEXT" ? (
                <label className="grid gap-2 text-sm font-semibold text-white">
                  {t("blocks.plainText")}
                  <textarea
                    value={block.value.text}
                    maxLength={5000}
                    rows={5}
                    className="rounded-lg border border-white/20 bg-stone-950 px-3 py-3 text-white focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"
                    onChange={(event) =>
                      changeBlock(block.key, () => ({
                        kind: "TEXT",
                        text: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : (
                <MediaBlockEditor
                  value={block.value}
                  unavailableIds={unavailableIds}
                  mediaLabels={mediaLabels}
                  pickerOpen={pickerTarget?.blockKey === block.key}
                  totalItems={totalItems}
                  onTitleChange={(value) =>
                    changeBlock(block.key, (current) =>
                      current.kind === "TEXT"
                        ? current
                        : { ...current, title: value },
                    )
                  }
                  onMoveItem={(itemIndex, direction) =>
                    moveItem(block.key, itemIndex, direction)
                  }
                  onRemoveItem={(itemIndex) => removeItem(block.key, itemIndex)}
                  onOpenPicker={(replaceItemIndex) =>
                    setPickerTarget({
                      blockKey: block.key,
                      ...(replaceItemIndex == null ? {} : { replaceItemIndex }),
                    })
                  }
                  onClosePicker={() => setPickerTarget(null)}
                  onSelectVideo={selectVideo}
                />
              )}
            </div>
          </li>
        ))}
      </ol>

      {blocks.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-white/20 p-10 text-center text-sm text-stone-300">
          {t("composer.emptyBlocks")}
        </p>
      ) : null}

      {retainedUnavailable ? (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100"
        >
          {t("composer.unavailableWarning")}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-stone-950/95 px-4 py-3 shadow-2xl backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite">
            <p className="text-sm font-semibold text-white">
              {t(saveStatusKey(status))}
            </p>
            {message ? (
              <p
                role={
                  status.endsWith("error") || status === "stale-conflict"
                    ? "alert"
                    : undefined
                }
                className="mt-1 max-w-3xl text-xs leading-5 text-stone-300"
              >
                {message}
              </p>
            ) : (
              <p className="mt-1 text-xs text-stone-400">
                {t("composer.publicVersion", {
                  version: serverPlaylist.version,
                })}
              </p>
            )}
          </div>
          <button
            type="button"
            className={primaryButton}
            disabled={status === "saving" || !dirty || retainedUnavailable}
            onClick={() => void save()}
          >
            <Save aria-hidden="true" />
            {status === "saving" ? t("composer.saving") : t("composer.save")}
          </button>
        </div>
      </div>
    </section>
  )
}

function MediaBlockEditor({
  value,
  unavailableIds,
  mediaLabels,
  pickerOpen,
  totalItems,
  onTitleChange,
  onMoveItem,
  onRemoveItem,
  onOpenPicker,
  onClosePicker,
  onSelectVideo,
}: {
  value: Exclude<UserPlaylistBlock, { kind: "TEXT" }>
  unavailableIds: Set<string>
  mediaLabels: Record<string, string>
  pickerOpen: boolean
  totalItems: number
  onTitleChange: (value: string) => void
  onMoveItem: (index: number, direction: -1 | 1) => void
  onRemoveItem: (index: number) => void
  onOpenPicker: (replaceItemIndex?: number) => void
  onClosePicker: () => void
  onSelectVideo: (video: { id: string; title: string }) => void
}) {
  const t = useTranslations("UserPlaylists")
  return (
    <div className="space-y-4">
      <label className="grid gap-2 text-sm font-semibold text-white">
        {t("blocks.titleLabel")}
        <input
          value={value.title}
          maxLength={120}
          className={fieldClass}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      {value.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 p-5 text-sm text-stone-400">
          {t("blocks.noVideos")}
        </p>
      ) : (
        <ol className="space-y-2">
          {value.items.map((item, itemIndex) => {
            const unavailable = unavailableIds.has(item.videoId)
            return (
              <li
                key={`${item.videoId}-${itemIndex}`}
                data-video-index={itemIndex}
                className={`flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
                  unavailable
                    ? "border-amber-300/30 bg-amber-300/10"
                    : "border-white/15 bg-black/25"
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10">
                    <Video aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {unavailable
                        ? t("blocks.videoUnavailable")
                        : (mediaLabels[item.videoId] ?? t("blocks.savedVideo"))}
                    </span>
                    <span className="mt-1 block text-xs text-stone-400">
                      {t("blocks.position", {
                        position: itemIndex + 1,
                        total: value.items.length,
                      })}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <button
                    type="button"
                    aria-label={t("blocks.moveVideoUpLabel", {
                      position: itemIndex + 1,
                    })}
                    data-item-action="up"
                    className={secondaryButton}
                    disabled={itemIndex === 0}
                    onClick={() => onMoveItem(itemIndex, -1)}
                  >
                    <ArrowUp aria-hidden="true" />
                    <span className="sr-only">{t("blocks.moveUp")}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t("blocks.moveVideoDownLabel", {
                      position: itemIndex + 1,
                    })}
                    data-item-action="down"
                    className={secondaryButton}
                    disabled={itemIndex === value.items.length - 1}
                    onClick={() => onMoveItem(itemIndex, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                    <span className="sr-only">{t("blocks.moveDown")}</span>
                  </button>
                  {unavailable ? (
                    <button
                      type="button"
                      data-item-action="replace"
                      className={secondaryButton}
                      onClick={() => onOpenPicker(itemIndex)}
                    >
                      {t("blocks.replace")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-item-action="remove"
                    className={secondaryButton}
                    onClick={() => onRemoveItem(itemIndex)}
                  >
                    {t("blocks.remove")}
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {pickerOpen ? (
        <UserPlaylistVideoPicker
          onSelect={onSelectVideo}
          onCancel={onClosePicker}
        />
      ) : (
        <button
          type="button"
          data-add-video
          className={secondaryButton}
          disabled={
            value.items.length >= USER_PLAYLIST_ITEM_LIMIT ||
            totalItems >= USER_PLAYLIST_TOTAL_ITEM_LIMIT
          }
          onClick={() => onOpenPicker()}
        >
          <Plus aria-hidden="true" />
          {t("blocks.addVideo")}
        </button>
      )}
    </div>
  )
}

function OrderButton({
  action,
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  action: string
  label: string
}) {
  return (
    <button
      {...props}
      type="button"
      data-block-action={action}
      aria-label={label}
      className={secondaryButton}
    >
      {children}
    </button>
  )
}

function focusBlockControl(key: string, action: string) {
  document
    .querySelector<HTMLButtonElement>(
      `[data-block-key="${key}"] [data-block-action="${action}"]`,
    )
    ?.focus()
}

function focusMediaControl(key: string, index: number, action: string) {
  document
    .querySelector<HTMLButtonElement>(
      `[data-block-key="${key}"] [data-video-index="${index}"] [data-item-action="${action}"]`,
    )
    ?.focus()
}

function cloneBlock(block: UserPlaylistBlock): UserPlaylistBlock {
  return block.kind === "TEXT"
    ? { kind: "TEXT", text: block.text }
    : {
        kind: block.kind,
        title: block.title,
        items: block.items.map((item) => ({ videoId: item.videoId })),
      }
}

function saveStatusKey(
  status: SaveStatus,
):
  | "status.clean"
  | "status.dirty"
  | "status.saving"
  | "status.saved"
  | "status.validation"
  | "status.network"
  | "status.conflict" {
  switch (status) {
    case "clean":
      return "status.clean"
    case "dirty":
      return "status.dirty"
    case "saving":
      return "status.saving"
    case "saved":
      return "status.saved"
    case "validation-error":
      return "status.validation"
    case "network-error":
      return "status.network"
    case "stale-conflict":
      return "status.conflict"
  }
}
