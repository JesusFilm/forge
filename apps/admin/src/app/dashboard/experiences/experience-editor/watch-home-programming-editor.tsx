"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { ConfirmModal } from "@/components/confirm-modal"
import type { MediaLibraryBrowserData } from "@/app/dashboard/media/media-library-browser-data"
import {
  WatchHomeProgramSchema,
  type WatchHomeProgram,
  type WatchHomeProgramBucket,
  type WatchHomePromoItem,
} from "@/domain/blocks"
import { AnchorVideoPicker } from "./anchor-video-picker"
import type { VideoLibraryItem } from "./block-helpers"

type DeleteRequest =
  | {
      kind: "bucket"
      bucketIndex: number
      label: string
      slotCount: number
    }
  | { kind: "program" }

export type WatchHomeProgrammingEditorProps = {
  program?: WatchHomeProgram
  videoLibrary: VideoLibraryItem[]
  mediaLibrary: MediaLibraryBrowserData
  onChangeProgram: (program: WatchHomeProgram | undefined) => void
}

export function createEmptyWatchHomeProgram(): WatchHomeProgram {
  return {
    buckets: [
      {
        kind: "video",
        id: "videos-1",
        label: "Videos",
        items: [],
      },
    ],
    rotation: ["videos-1"],
  }
}

function promoMaterialSignature(promo: WatchHomePromoItem) {
  return JSON.stringify({
    playbackId: promo.playbackId,
    primaryActionHref: promo.primaryAction?.href ?? null,
    secondaryActionHref: promo.secondaryAction?.href ?? null,
  })
}

export function hasWatchHomePromoMaterialChangeWithoutNewId(
  previous: WatchHomePromoItem,
  next: WatchHomePromoItem,
) {
  return (
    previous.id === next.id &&
    promoMaterialSignature(previous) !== promoMaterialSignature(next)
  )
}

function allPromos(program: WatchHomeProgram | undefined) {
  if (!program) return []
  return [
    ...(program.intro ? [program.intro] : []),
    ...program.buckets.flatMap((bucket) =>
      bucket.kind === "promo" ? bucket.items : [],
    ),
  ]
}

function stableIdPart(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return sanitized || "item"
}

function nextStableId(base: string, existing: Iterable<string>) {
  const ids = new Set(existing)
  const safeBase = stableIdPart(base)
  if (!ids.has(safeBase)) return safeBase
  let suffix = 2
  while (ids.has(`${safeBase}-${suffix}`)) suffix += 1
  return `${safeBase}-${suffix}`
}

function move<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length || from === to) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function issueMap(result: ReturnType<typeof WatchHomeProgramSchema.safeParse>) {
  if (result.success) return new Map<string, string>()
  return new Map(
    result.error.issues.map((issue) => [
      issue.path.map(String).join("."),
      issue.message,
    ]),
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="mt-1 text-[11px] text-[var(--color-danger)]">
      {message}
    </p>
  )
}

function TextField({
  label,
  value,
  onChange,
  error,
  path,
  multiline = false,
  type = "text",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  path: string
  multiline?: boolean
  type?: "text" | "number" | "url"
}) {
  const errorId = `watch-program-${path.replace(/[^A-Za-z0-9_-]/g, "-")}-error`
  const shared = {
    value,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
    "aria-invalid": error ? (true as const) : undefined,
    "aria-describedby": error ? errorId : undefined,
    className:
      "mt-1 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand)]",
  }

  return (
    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)]">
      {label}
      {multiline ? (
        <textarea {...shared} rows={3} />
      ) : (
        <input {...shared} type={type} />
      )}
      <FieldError id={errorId} message={error} />
    </label>
  )
}

function PosterField({
  value,
  assets,
  onChange,
  error,
  path,
}: {
  value: string
  assets: MediaLibraryBrowserData["images"]
  onChange: (value: string) => void
  error?: string
  path: string
}) {
  const errorId = `watch-program-${path.replace(/[^A-Za-z0-9_-]/g, "-")}-error`
  return (
    <label className="block text-[11px] font-medium text-[var(--color-text-secondary)]">
      Poster media asset
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="mt-1 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand)]"
      >
        <option value="">Choose an approved asset</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.displayName}
          </option>
        ))}
      </select>
      <FieldError id={errorId} message={error} />
    </label>
  )
}

function PromoFields({
  promo,
  path,
  errors,
  mediaLibrary,
  materialWarning,
  onChange,
}: {
  promo: WatchHomePromoItem
  path: string
  errors: Map<string, string>
  mediaLibrary: MediaLibraryBrowserData
  materialWarning: boolean
  onChange: (promo: WatchHomePromoItem) => void
}) {
  function set<K extends keyof WatchHomePromoItem>(
    key: K,
    value: WatchHomePromoItem[K],
  ) {
    onChange({ ...promo, [key]: value })
  }

  function renderAction(kind: "primaryAction" | "secondaryAction") {
    const action = promo[kind]
    if (!action) {
      return (
        <button
          type="button"
          onClick={() => set(kind, { label: "Learn more", href: "/" })}
          className="text-[11px] font-medium text-[var(--color-text-secondary)] underline"
        >
          Add {kind === "primaryAction" ? "primary" : "secondary"} action
        </button>
      )
    }

    return (
      <div className="grid gap-3 rounded-sm border border-[var(--color-hairline)] p-3 sm:grid-cols-2">
        <TextField
          label={
            kind === "primaryAction"
              ? "Primary action label"
              : "Secondary action label"
          }
          value={action.label}
          path={`${path}.${kind}.label`}
          error={errors.get(`${path}.${kind}.label`)}
          onChange={(label) => set(kind, { ...action, label })}
        />
        <TextField
          label="Approved action destination"
          value={action.href}
          type="url"
          path={`${path}.${kind}.href`}
          error={errors.get(`${path}.${kind}.href`)}
          onChange={(href) => set(kind, { ...action, href })}
        />
        <label className="block text-[11px] font-medium text-[var(--color-text-secondary)]">
          Action icon
          <select
            value={action.icon ?? ""}
            onChange={(event) =>
              set(kind, {
                ...action,
                icon:
                  event.target.value === "join" ||
                  event.target.value === "share"
                    ? event.target.value
                    : undefined,
              })
            }
            className="mt-1 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]"
          >
            <option value="">No icon</option>
            <option value="join">Join</option>
            <option value="share">Share</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => set(kind, undefined)}
          className="self-end justify-self-start text-[11px] text-[var(--color-danger)] underline"
        >
          Remove action
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Stable promo ID"
          value={promo.id}
          path={`${path}.id`}
          error={errors.get(`${path}.id`)}
          onChange={(id) => set("id", id)}
        />
        <TextField
          label="Mux playback ID"
          value={promo.playbackId}
          path={`${path}.playbackId`}
          error={errors.get(`${path}.playbackId`)}
          onChange={(playbackId) => set("playbackId", playbackId)}
        />
        <PosterField
          value={promo.posterAssetId}
          assets={mediaLibrary.images}
          path={`${path}.posterAssetId`}
          error={errors.get(`${path}.posterAssetId`)}
          onChange={(posterAssetId) => set("posterAssetId", posterAssetId)}
        />
        <TextField
          label="Duration in seconds (optional)"
          type="number"
          value={promo.durationSeconds?.toString() ?? ""}
          path={`${path}.durationSeconds`}
          error={errors.get(`${path}.durationSeconds`)}
          onChange={(value) => {
            const parsed = Number(value)
            set(
              "durationSeconds",
              value.trim() && Number.isFinite(parsed) ? parsed : undefined,
            )
          }}
        />
        <TextField
          label="Label (optional)"
          value={promo.label ?? ""}
          path={`${path}.label`}
          error={errors.get(`${path}.label`)}
          onChange={(label) => set("label", label || undefined)}
        />
        <TextField
          label="Title"
          value={promo.title}
          path={`${path}.title`}
          error={errors.get(`${path}.title`)}
          onChange={(title) => set("title", title)}
        />
      </div>
      <TextField
        label="Description (optional)"
        value={promo.description ?? ""}
        path={`${path}.description`}
        error={errors.get(`${path}.description`)}
        multiline
        onChange={(description) => set("description", description || undefined)}
      />
      <label className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
        <input
          type="checkbox"
          checked={promo.showLogo ?? false}
          onChange={(event) =>
            set("showLogo", event.target.checked || undefined)
          }
        />
        Show Jesus Film logo
      </label>
      {renderAction("primaryAction")}
      {renderAction("secondaryAction")}
      {materialWarning ? (
        <p
          role="alert"
          className="text-[11px] leading-5 text-[var(--color-warning)]"
        >
          Playback or action destination changed. Assign a new promo ID so the
          materially new campaign is not hidden by prior exposure.
        </p>
      ) : null}
    </div>
  )
}

export function WatchHomeProgrammingEditor({
  program,
  videoLibrary,
  mediaLibrary,
  onChangeProgram,
}: WatchHomeProgrammingEditorProps) {
  const [draft, setDraft] = useState<WatchHomeProgram | null>(program ?? null)
  const [baseline, setBaseline] = useState<WatchHomeProgram | undefined>(
    program,
  )
  const [errors, setErrors] = useState(new Map<string, string>())
  const [announcement, setAnnouncement] = useState("")
  const [videoPickerBucketIndex, setVideoPickerBucketIndex] = useState<
    number | null
  >(null)
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null)
  const focusTarget = useRef<string | null>(null)

  useEffect(() => {
    const id = focusTarget.current
    if (!id) return
    focusTarget.current = null
    document.getElementById(id)?.focus()
  }, [draft])

  const baselinePromos = useMemo(
    () => new Map(allPromos(baseline).map((promo) => [promo.id, promo])),
    [baseline],
  )
  const existingItemIds = useMemo(
    () => new Set(allPromos(draft ?? undefined).map((promo) => promo.id)),
    [draft],
  )

  function change(next: WatchHomeProgram) {
    setDraft(next)
    if (errors.size > 0)
      setErrors(issueMap(WatchHomeProgramSchema.safeParse(next)))
  }

  function apply() {
    if (!draft) return
    const parsed = WatchHomeProgramSchema.safeParse(draft)
    if (!parsed.success) {
      setErrors(issueMap(parsed))
      setAnnouncement(
        "Programming has validation errors. Review the highlighted fields.",
      )
      return
    }
    setErrors(new Map())
    setBaseline(parsed.data)
    setDraft(parsed.data)
    onChangeProgram(parsed.data)
    setAnnouncement("Watch Home programming applied to this block.")
  }

  function cancel() {
    setDraft(baseline ?? null)
    setErrors(new Map())
    setAnnouncement(
      baseline
        ? "Programming changes cancelled."
        : "Programming creation cancelled.",
    )
  }

  function addBucket(kind: WatchHomeProgramBucket["kind"]) {
    if (!draft) return
    const id = nextStableId(
      `${kind === "video" ? "videos" : "promos"}-${draft.buckets.length + 1}`,
      draft.buckets.map((bucket) => bucket.id),
    )
    const bucket: WatchHomeProgramBucket =
      kind === "video"
        ? { kind, id, label: "Videos", items: [] }
        : { kind, id, label: "Promos", items: [] }
    change({
      ...draft,
      buckets: [...draft.buckets, bucket],
      rotation: [...draft.rotation, id],
    })
    focusTarget.current = `watch-program-bucket-${id}`
    setAnnouncement(`${bucket.label} bucket added to the rotation.`)
  }

  function updateBucket(index: number, bucket: WatchHomeProgramBucket) {
    if (!draft) return
    const previousId = draft.buckets[index]?.id
    change({
      ...draft,
      buckets: draft.buckets.map((item, itemIndex) =>
        itemIndex === index ? bucket : item,
      ),
      rotation:
        previousId && previousId !== bucket.id
          ? draft.rotation.map((id) => (id === previousId ? bucket.id : id))
          : draft.rotation,
    })
  }

  function reorderBucket(index: number, offset: -1 | 1) {
    if (!draft) return
    const bucket = draft.buckets[index]
    const to = index + offset
    if (!bucket || to < 0 || to >= draft.buckets.length) return
    change({ ...draft, buckets: move(draft.buckets, index, to) })
    focusTarget.current = `watch-program-bucket-${bucket.id}`
    setAnnouncement(`${bucket.label} bucket moved to position ${to + 1}.`)
  }

  function confirmDelete() {
    if (!draft || !deleteRequest) return
    if (deleteRequest.kind === "program") {
      onChangeProgram(undefined)
      setDraft(null)
      setBaseline(undefined)
      setErrors(new Map())
      setDeleteRequest(null)
      setAnnouncement(
        "Watch Home programming removed; placement-only block restored.",
      )
      return
    }

    const bucket = draft.buckets[deleteRequest.bucketIndex]
    if (!bucket) return
    change({
      ...draft,
      buckets: draft.buckets.filter(
        (_, index) => index !== deleteRequest.bucketIndex,
      ),
      rotation: draft.rotation.filter((id) => id !== bucket.id),
    })
    setDeleteRequest(null)
    focusTarget.current = "watch-program-add-video-bucket"
    setAnnouncement(
      `${bucket.label} bucket and ${deleteRequest.slotCount} rotation ${deleteRequest.slotCount === 1 ? "slot" : "slots"} removed.`,
    )
  }

  function addVideo(bucketIndex: number, video: VideoLibraryItem) {
    if (!draft) return
    const bucket = draft.buckets[bucketIndex]
    if (!bucket || bucket.kind !== "video") return
    const itemId = nextStableId(
      `video-${video.key}`,
      draft.buckets.flatMap((entry) => entry.items.map((item) => item.id)),
    )
    updateBucket(bucketIndex, {
      ...bucket,
      items: [...bucket.items, { id: itemId, videoId: video.key }],
    })
    setAnnouncement(`${video.title} added to ${bucket.label}.`)
  }

  function promoWarning(promo: WatchHomePromoItem) {
    const previous = baselinePromos.get(promo.id)
    return previous
      ? hasWatchHomePromoMaterialChangeWithoutNewId(previous, promo)
      : false
  }

  if (!draft) {
    return (
      <div
        className="rounded-sm border border-dashed border-[var(--color-hairline-strong)] bg-[rgba(8,8,10,0.36)] p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-[14px] font-semibold text-[var(--color-text-primary)]">
          Watch Home programming is not configured
        </h3>
        <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
          This remains a placement-only block and uses the Web fallback until an
          editor explicitly creates and applies programming.
        </p>
        <button
          type="button"
          onClick={() => {
            setDraft(createEmptyWatchHomeProgram())
            setAnnouncement(
              "Programming draft created. Apply it to change the block.",
            )
          }}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-sm bg-[var(--color-brand)] px-4 text-[12px] font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          Create programming
        </button>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>
    )
  }

  return (
    <div
      className="space-y-5 rounded-sm border border-[var(--color-hairline)] bg-[rgba(8,8,10,0.36)] p-5"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            Watch Home programming
          </h3>
          <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            The intro runs once. Rotation slots then repeat in their exact
            order; each bucket shuffles independently on Web.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cancel}
            className="h-9 rounded-sm border border-[var(--color-hairline)] px-3 text-[12px] text-[var(--color-text-primary)]"
          >
            Cancel changes
          </button>
          <button
            type="button"
            onClick={apply}
            className="h-9 rounded-sm bg-[var(--color-brand)] px-4 text-[12px] font-medium text-white"
          >
            Apply programming
          </button>
          {program ? (
            <button
              type="button"
              onClick={() => setDeleteRequest({ kind: "program" })}
              className="h-9 rounded-sm border border-[var(--color-danger)] px-3 text-[12px] text-[var(--color-danger)]"
            >
              Remove programming
            </button>
          ) : null}
        </div>
      </div>

      <section
        aria-labelledby="watch-program-intro-heading"
        className="space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h4
            id="watch-program-intro-heading"
            className="text-[13px] font-semibold text-[var(--color-text-primary)]"
          >
            Intro (plays once)
          </h4>
          {draft.intro ? (
            <button
              type="button"
              onClick={() => change({ ...draft, intro: undefined })}
              aria-label="Remove Watch Home intro"
              className="text-[11px] text-[var(--color-danger)] underline"
            >
              Remove intro
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                change({
                  ...draft,
                  intro: {
                    id: nextStableId("welcome-intro", existingItemIds),
                    playbackId: "",
                    posterAssetId: "",
                    title: "Welcome",
                    showLogo: true,
                  },
                })
              }
              className="text-[11px] text-[var(--color-text-secondary)] underline"
            >
              Add intro
            </button>
          )}
        </div>
        {draft.intro ? (
          <div className="rounded-sm border border-[var(--color-hairline)] p-4">
            <PromoFields
              promo={draft.intro}
              path="intro"
              errors={errors}
              mediaLibrary={mediaLibrary}
              materialWarning={promoWarning(draft.intro)}
              onChange={(intro) => change({ ...draft, intro })}
            />
          </div>
        ) : (
          <p className="text-[11px] text-[var(--color-text-muted)]">
            No intro. A playable rotation item starts the experience.
          </p>
        )}
      </section>

      <section
        aria-labelledby="watch-program-buckets-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4
            id="watch-program-buckets-heading"
            className="text-[13px] font-semibold text-[var(--color-text-primary)]"
          >
            Typed buckets
          </h4>
          <div className="flex gap-2">
            <button
              id="watch-program-add-video-bucket"
              type="button"
              onClick={() => addBucket("video")}
              className="h-8 rounded-sm border border-[var(--color-hairline)] px-3 text-[11px] text-[var(--color-text-primary)]"
            >
              Add video bucket
            </button>
            <button
              type="button"
              onClick={() => addBucket("promo")}
              className="h-8 rounded-sm border border-[var(--color-hairline)] px-3 text-[11px] text-[var(--color-text-primary)]"
            >
              Add promo bucket
            </button>
          </div>
        </div>

        {draft.buckets.map((bucket, bucketIndex) => (
          <article
            id={`watch-program-bucket-${bucket.id}`}
            tabIndex={-1}
            key={`${bucket.kind}-${bucketIndex}`}
            className="space-y-3 rounded-sm border border-[var(--color-hairline)] p-4 outline-none focus:border-[var(--color-brand)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid flex-1 gap-3 sm:grid-cols-2">
                <TextField
                  label="Stable bucket ID"
                  value={bucket.id}
                  path={`buckets.${bucketIndex}.id`}
                  error={errors.get(`buckets.${bucketIndex}.id`)}
                  onChange={(id) =>
                    updateBucket(bucketIndex, { ...bucket, id })
                  }
                />
                <TextField
                  label={`${bucket.kind === "video" ? "Video" : "Promo"} bucket label`}
                  value={bucket.label}
                  path={`buckets.${bucketIndex}.label`}
                  error={errors.get(`buckets.${bucketIndex}.label`)}
                  onChange={(label) =>
                    updateBucket(bucketIndex, { ...bucket, label })
                  }
                />
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => reorderBucket(bucketIndex, -1)}
                  disabled={bucketIndex === 0}
                  aria-label={`Move ${bucket.label} bucket up`}
                  className="h-8 w-8 rounded-sm border border-[var(--color-hairline)] disabled:opacity-40"
                >
                  <ArrowUp className="mx-auto h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => reorderBucket(bucketIndex, 1)}
                  disabled={bucketIndex === draft.buckets.length - 1}
                  aria-label={`Move ${bucket.label} bucket down`}
                  className="h-8 w-8 rounded-sm border border-[var(--color-hairline)] disabled:opacity-40"
                >
                  <ArrowDown className="mx-auto h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDeleteRequest({
                      kind: "bucket",
                      bucketIndex,
                      label: bucket.label,
                      slotCount: draft.rotation.filter((id) => id === bucket.id)
                        .length,
                    })
                  }
                  aria-label={`Delete ${bucket.label} bucket`}
                  className="h-8 w-8 rounded-sm border border-[var(--color-hairline)] text-[var(--color-danger)]"
                >
                  <Trash2 className="mx-auto h-4 w-4" />
                </button>
              </div>
            </div>

            {bucket.kind === "video" ? (
              <div className="space-y-2">
                {bucket.items.map((item, itemIndex) => {
                  const video = videoLibrary.find(
                    (entry) => entry.key === item.videoId,
                  )
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-sm bg-[var(--color-surface-inset)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12px] text-[var(--color-text-primary)]">
                          {video?.title ?? item.videoId}
                        </div>
                        <div className="truncate text-[10px] text-[var(--color-text-muted)]">
                          {item.id}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={itemIndex === 0}
                          aria-label={`Move ${video?.title ?? item.id} up`}
                          onClick={() =>
                            updateBucket(bucketIndex, {
                              ...bucket,
                              items: move(
                                bucket.items,
                                itemIndex,
                                itemIndex - 1,
                              ),
                            })
                          }
                          className="h-7 w-7 disabled:opacity-40"
                        >
                          <ArrowUp className="mx-auto h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={itemIndex === bucket.items.length - 1}
                          aria-label={`Move ${video?.title ?? item.id} down`}
                          onClick={() =>
                            updateBucket(bucketIndex, {
                              ...bucket,
                              items: move(
                                bucket.items,
                                itemIndex,
                                itemIndex + 1,
                              ),
                            })
                          }
                          className="h-7 w-7 disabled:opacity-40"
                        >
                          <ArrowDown className="mx-auto h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${video?.title ?? item.id}`}
                          onClick={() =>
                            updateBucket(bucketIndex, {
                              ...bucket,
                              items: bucket.items.filter(
                                (_, index) => index !== itemIndex,
                              ),
                            })
                          }
                          className="h-7 w-7 text-[var(--color-danger)]"
                        >
                          <Trash2 className="mx-auto h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setVideoPickerBucketIndex(bucketIndex)}
                  className="h-8 rounded-sm border border-[var(--color-hairline)] px-3 text-[11px] text-[var(--color-text-primary)]"
                >
                  Add individual video
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {bucket.items.map((promo, itemIndex) => (
                  <div
                    key={`${promo.id}-${itemIndex}`}
                    className="space-y-3 rounded-sm bg-[var(--color-surface-inset)] p-4"
                  >
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        disabled={itemIndex === 0}
                        aria-label={`Move ${promo.title || promo.id} promo up`}
                        onClick={() =>
                          updateBucket(bucketIndex, {
                            ...bucket,
                            items: move(bucket.items, itemIndex, itemIndex - 1),
                          })
                        }
                        className="h-7 w-7 disabled:opacity-40"
                      >
                        <ArrowUp className="mx-auto h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={itemIndex === bucket.items.length - 1}
                        aria-label={`Move ${promo.title || promo.id} promo down`}
                        onClick={() =>
                          updateBucket(bucketIndex, {
                            ...bucket,
                            items: move(bucket.items, itemIndex, itemIndex + 1),
                          })
                        }
                        className="h-7 w-7 disabled:opacity-40"
                      >
                        <ArrowDown className="mx-auto h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${promo.title || promo.id} promo`}
                        onClick={() =>
                          updateBucket(bucketIndex, {
                            ...bucket,
                            items: bucket.items.filter(
                              (_, index) => index !== itemIndex,
                            ),
                          })
                        }
                        className="h-7 w-7 text-[var(--color-danger)]"
                      >
                        <Trash2 className="mx-auto h-3.5 w-3.5" />
                      </button>
                    </div>
                    <PromoFields
                      promo={promo}
                      path={`buckets.${bucketIndex}.items.${itemIndex}`}
                      errors={errors}
                      mediaLibrary={mediaLibrary}
                      materialWarning={promoWarning(promo)}
                      onChange={(item) =>
                        updateBucket(bucketIndex, {
                          ...bucket,
                          items: bucket.items.map((current, index) =>
                            index === itemIndex ? item : current,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const id = nextStableId(
                      `promo-${bucket.items.length + 1}`,
                      existingItemIds,
                    )
                    updateBucket(bucketIndex, {
                      ...bucket,
                      items: [
                        ...bucket.items,
                        {
                          id,
                          playbackId: "",
                          posterAssetId: "",
                          title: "New promo",
                        },
                      ],
                    })
                  }}
                  className="h-8 rounded-sm border border-[var(--color-hairline)] px-3 text-[11px] text-[var(--color-text-primary)]"
                >
                  Add promo
                </button>
              </div>
            )}
          </article>
        ))}
        <FieldError
          id="watch-program-buckets-error"
          message={errors.get("buckets")}
        />
      </section>

      <section
        aria-labelledby="watch-program-rotation-heading"
        className="space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h4
            id="watch-program-rotation-heading"
            className="text-[13px] font-semibold text-[var(--color-text-primary)]"
          >
            Repeating rotation
          </h4>
          <button
            type="button"
            disabled={draft.buckets.length === 0}
            onClick={() =>
              change({
                ...draft,
                rotation: [...draft.rotation, draft.buckets[0]!.id],
              })
            }
            className="h-8 rounded-sm border border-[var(--color-hairline)] px-3 text-[11px] text-[var(--color-text-primary)] disabled:opacity-40"
          >
            Add rotation slot
          </button>
        </div>
        <ol className="space-y-2">
          {draft.rotation.map((bucketId, slotIndex) => (
            <li key={`slot-${slotIndex}`} className="flex items-center gap-2">
              <span className="w-6 text-right font-mono text-[10px] text-[var(--color-text-muted)]">
                {slotIndex + 1}
              </span>
              <select
                value={bucketId}
                onChange={(event) =>
                  change({
                    ...draft,
                    rotation: draft.rotation.map((id, index) =>
                      index === slotIndex ? event.target.value : id,
                    ),
                  })
                }
                aria-invalid={
                  errors.get(`rotation.${slotIndex}`) ? true : undefined
                }
                aria-describedby={
                  errors.get(`rotation.${slotIndex}`)
                    ? `watch-program-rotation-${slotIndex}-error`
                    : undefined
                }
                className="min-w-0 flex-1 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-inset)] px-3 py-2 text-[12px] text-[var(--color-text-primary)]"
              >
                {draft.buckets.map((bucket) => (
                  <option key={bucket.id} value={bucket.id}>
                    {bucket.label} ({bucket.kind})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={slotIndex === 0}
                aria-label={`Move rotation slot ${slotIndex + 1} up`}
                onClick={() => {
                  change({
                    ...draft,
                    rotation: move(draft.rotation, slotIndex, slotIndex - 1),
                  })
                  setAnnouncement(`Rotation slot ${slotIndex + 1} moved up.`)
                }}
                className="h-8 w-8 disabled:opacity-40"
              >
                <ArrowUp className="mx-auto h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={slotIndex === draft.rotation.length - 1}
                aria-label={`Move rotation slot ${slotIndex + 1} down`}
                onClick={() => {
                  change({
                    ...draft,
                    rotation: move(draft.rotation, slotIndex, slotIndex + 1),
                  })
                  setAnnouncement(`Rotation slot ${slotIndex + 1} moved down.`)
                }}
                className="h-8 w-8 disabled:opacity-40"
              >
                <ArrowDown className="mx-auto h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove rotation slot ${slotIndex + 1}`}
                onClick={() =>
                  change({
                    ...draft,
                    rotation: draft.rotation.filter(
                      (_, index) => index !== slotIndex,
                    ),
                  })
                }
                className="h-8 w-8 text-[var(--color-danger)]"
              >
                <Trash2 className="mx-auto h-4 w-4" />
              </button>
              <FieldError
                id={`watch-program-rotation-${slotIndex}-error`}
                message={errors.get(`rotation.${slotIndex}`)}
              />
            </li>
          ))}
        </ol>
        <FieldError
          id="watch-program-rotation-error"
          message={errors.get("rotation")}
        />
      </section>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <AnchorVideoPicker
        open={videoPickerBucketIndex !== null}
        videoLibrary={videoLibrary.filter(
          (video) => !video.isCollectionTarget && video.label !== "COLLECTION",
        )}
        onClose={() => setVideoPickerBucketIndex(null)}
        onSelect={(video) => {
          if (videoPickerBucketIndex !== null)
            addVideo(videoPickerBucketIndex, video)
        }}
      />

      <ConfirmModal
        open={deleteRequest !== null}
        title={
          deleteRequest?.kind === "program"
            ? "Remove Watch Home programming?"
            : `Delete ${deleteRequest?.label ?? "bucket"}?`
        }
        description={
          deleteRequest?.kind === "bucket"
            ? `This also removes ${deleteRequest.slotCount} referenced rotation ${deleteRequest.slotCount === 1 ? "slot" : "slots"}. The change stays in this draft until you apply programming.`
            : "This restores the placement-only block. Web will use its migration fallback until new programming is applied."
        }
        confirmLabel={
          deleteRequest?.kind === "program"
            ? "Remove programming"
            : "Delete bucket and slots"
        }
        onCancel={() => setDeleteRequest(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
