"use client"

import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import {
  Download,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Trash2,
  Video,
  X,
} from "lucide-react"
import { cx } from "@/components/admin-ui"
import { ConfirmModal } from "@/components/confirm-modal"
import { ToastStack, useToastStack } from "@/components/toast-stack"

type UpdateAssetMetadataActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type DeleteAssetActionResult =
  | { ok: true }
  | {
      ok: false
      error: "forbidden" | "validation" | "unknown"
      message: string
    }

type UsageItem = {
  experienceId: string
  experienceLocaleId: string
  locale: string
  title: string | null
  fieldPath: string
}

type MediaAssetInspectorProps = {
  asset: {
    id: string
    kind: "IMAGE" | "VIDEO" | "PDF" | "FILE"
    displayName: string
    description: string | null
    altText: string | null
    folderLabel: string
    originalFilename: string | null
    supplementalLabel: string
    backend: string
    updatedAtIso: string
    updatedAtLabel: string
    width: number | null
    height: number | null
    previewUrl: string | null
    downloadUrl: string | null
  }
  closeHref: Route
  usage: UsageItem[]
  canEditMetadata: boolean
  canDeleteAsset: boolean
  onUpdateAsset: (
    formData: FormData,
  ) => Promise<UpdateAssetMetadataActionResult>
  onDeleteAsset: (formData: FormData) => Promise<DeleteAssetActionResult>
}

type DraftState = {
  displayName: string
  description: string
  altText: string
}

function initialDraft(asset: MediaAssetInspectorProps["asset"]): DraftState {
  return {
    displayName: asset.displayName,
    description: asset.description ?? "",
    altText: asset.altText ?? "",
  }
}

export function MediaAssetInspector({
  asset,
  closeHref,
  usage,
  canEditMetadata,
  canDeleteAsset,
  onUpdateAsset,
  onDeleteAsset,
}: MediaAssetInspectorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isDeletePending, startDeleteTransition] = useTransition()
  const { toasts, pushToast, dismissToast } = useToastStack()
  const [draft, setDraft] = useState(() => initialDraft(asset))
  const [error, setError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const hasChanges = useMemo(
    () =>
      draft.displayName.trim() !== asset.displayName ||
      draft.description.trim() !== (asset.description ?? "") ||
      draft.altText.trim() !== (asset.altText ?? ""),
    [asset.altText, asset.description, asset.displayName, draft],
  )

  function resetDraft() {
    setDraft(initialDraft(asset))
    setError(null)
  }

  function submitForm(event: globalThis.React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextDisplayName = draft.displayName.trim()
    if (!nextDisplayName) {
      setError("Name the file before saving.")
      return
    }

    const formData = new FormData()
    formData.set("id", asset.id)
    formData.set("displayName", nextDisplayName)
    formData.set("description", draft.description.trim())
    formData.set("altText", draft.altText.trim())

    startTransition(async () => {
      const result = await onUpdateAsset(formData)

      if (!result.ok) {
        setError(result.message)
        pushToast(result.message, "error")
        return
      }

      setError(null)
      pushToast("Asset metadata saved.", "success")
      router.refresh()
    })
  }

  function deleteAsset() {
    if (!canDeleteAsset || usage.length > 0 || isDeletePending) {
      return
    }

    const formData = new FormData()
    formData.set("id", asset.id)

    startDeleteTransition(async () => {
      const result = await onDeleteAsset(formData)

      if (!result.ok) {
        pushToast(result.message, "error")
        setDeleteDialogOpen(false)
        return
      }

      setDeleteDialogOpen(false)
      pushToast("Asset deleted.", "success")
      router.push(closeHref)
      router.refresh()
    })
  }

  return (
    <aside className="relative flex min-h-0 flex-col border-l border-[var(--color-hairline)] bg-[var(--color-surface-raised)]">
      <div className="hairline-strong-b flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {asset.displayName}
          </div>
          {asset.supplementalLabel ? (
            <div className="mono-meta mt-1 truncate text-[var(--color-text-muted)]">
              {asset.supplementalLabel}
            </div>
          ) : null}
        </div>
        <Link
          href={closeHref}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
          aria-label="Close asset inspector"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div>
          {asset.kind === "IMAGE" && asset.previewUrl ? (
            <div className="w-full overflow-hidden rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.previewUrl}
                alt={draft.altText.trim() || asset.displayName}
                width={asset.width ?? undefined}
                height={asset.height ?? undefined}
                className="block h-auto max-h-40 w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)]">
              {asset.kind === "PDF" ? (
                <FileText
                  className="h-7 w-7 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              ) : asset.kind === "VIDEO" ? (
                <Video
                  className="h-7 w-7 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              ) : asset.kind === "FILE" ? (
                <FileIcon
                  className="h-7 w-7 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              ) : (
                <ImageIcon
                  className="h-7 w-7 text-[var(--color-text-muted)]"
                  strokeWidth={1.5}
                />
              )}
            </div>
          )}
        </div>

        <form
          onSubmit={submitForm}
          className="grid gap-3 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3"
        >
          <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Metadata
          </div>
          <label className="grid gap-1.5">
            <span className="label-text">Display name</span>
            <input
              value={draft.displayName}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
              disabled={!canEditMetadata || isPending}
              className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          {asset.kind === "IMAGE" ? (
            <label className="grid gap-1.5">
              <span className="label-text">Alt text</span>
              <input
                value={draft.altText}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    altText: event.target.value,
                  }))
                }
                disabled={!canEditMetadata || isPending}
                className="h-9 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          ) : null}

          <label className="grid gap-1.5">
            <span className="label-text">Description</span>
            <textarea
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              disabled={!canEditMetadata || isPending}
              rows={4}
              className="min-h-24 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-bg)] px-3 py-2 text-[13px] outline-none transition-all duration-[120ms] ease-out focus:border-[var(--color-hairline-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          {error ? (
            <div className="text-[12px] text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          {canEditMetadata ? (
            <div className="mt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={resetDraft}
                disabled={!hasChanges || isPending}
                className="inline-flex h-8 items-center rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] text-[var(--color-text-secondary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={!hasChanges || isPending}
                className={cx(
                  "inline-flex h-8 items-center rounded-sm px-3 text-[13px] font-medium text-white transition-all duration-[120ms] ease-out",
                  !hasChanges || isPending
                    ? "cursor-not-allowed bg-[var(--color-brand)] opacity-60"
                    : "bg-[var(--color-brand)] hover:bg-[var(--color-brand-pressed)]",
                )}
              >
                {isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          ) : (
            <div className="text-[12px] text-[var(--color-text-muted)]">
              Your account cannot edit media metadata.
            </div>
          )}
        </form>

        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5 text-[12px]">
            <div className="label-text">Kind</div>
            <div className="truncate text-[var(--color-text-secondary)]">
              {asset.kind}
            </div>
            <div className="label-text">Folder</div>
            <div
              className="truncate text-[var(--color-text-secondary)]"
              title={asset.folderLabel}
            >
              {asset.folderLabel}
            </div>
            <div className="label-text">Backend</div>
            <div className="truncate text-[var(--color-text-secondary)]">
              {asset.backend}
            </div>
            <div className="label-text">Original</div>
            <div
              className="truncate text-[var(--color-text-secondary)]"
              title={asset.originalFilename ?? ""}
            >
              {asset.originalFilename ?? "n/a"}
            </div>
            <div className="label-text">Updated</div>
            <div
              className="truncate text-[var(--color-text-secondary)]"
              title={asset.updatedAtIso}
            >
              {asset.updatedAtLabel}
            </div>
          </div>
        </div>

        {asset.downloadUrl ? (
          <a
            href={asset.downloadUrl}
            className="inline-flex h-8 items-center gap-2 self-start rounded-sm border border-[var(--color-hairline)] px-3 text-[13px] text-[var(--color-text-primary)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface)]"
          >
            <Download className="h-4 w-4" strokeWidth={1.5} />
            Download
          </a>
        ) : null}

        {canDeleteAsset ? (
          <div className="grid gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  Delete asset
                </div>
                <div className="mt-1 text-[12px] leading-5 text-[var(--color-text-muted)]">
                  {usage.length > 0
                    ? "Clear references before deleting this asset."
                    : "Unused assets can be permanently deleted."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={usage.length > 0 || isDeletePending}
                className={cx(
                  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 text-[13px] font-medium transition-all duration-[120ms] ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-danger)] focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-55",
                  "border-[var(--color-hairline)] text-[var(--color-danger)] hover:bg-[var(--color-surface-raised)]",
                )}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                {isDeletePending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          <div className="hairline-strong-b px-3 py-2">
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
              Where used
            </div>
            <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
              {usage.length} references
            </div>
          </div>
          <div className="divide-y divide-[var(--color-hairline)]">
            {usage.map((item) => (
              <Link
                key={`${item.experienceLocaleId}:${item.fieldPath}`}
                href={
                  `/dashboard/experiences/${item.experienceId}?locale=${item.locale}` as Route
                }
                className="grid gap-1 px-3 py-3 transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)]"
              >
                <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  {item.title ?? item.experienceLocaleId}
                </div>
                <div className="mono-meta text-[var(--color-text-muted)]">
                  {item.locale} / {item.fieldPath}
                </div>
              </Link>
            ))}
            {usage.length === 0 ? (
              <div className="px-3 py-6 text-[12px] text-[var(--color-text-muted)]">
                This asset is not currently referenced by any experience
                metadata or block field.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={deleteDialogOpen}
        title="Delete This Asset?"
        description={`This will permanently delete ${asset.displayName}. This cannot be undone.`}
        confirmLabel="Delete Asset"
        pending={isDeletePending}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={deleteAsset}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </aside>
  )
}
