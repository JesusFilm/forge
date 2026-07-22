import type { CollectionDownloadQueueItem } from "@/components/watch/collection-download-options"

const DOWNLOAD_ERROR_HEADER = "x-watch-download-error"
const DOWNLOAD_AUTH_REQUIRED = "auth-required"

export type CollectionDownloadDirectory = {
  getFileHandle(
    name: string,
    options: { create: true },
  ): Promise<{
    createWritable(): Promise<WritableStream<Uint8Array>>
  }>
}

export type CollectionDownloadProgress = {
  active: CollectionDownloadQueueItem | null
  completed: CollectionDownloadQueueItem[]
  failed: Array<{ item: CollectionDownloadQueueItem; reason: string }>
  total: number
}

export type CollectionDownloadQueueResult = CollectionDownloadProgress & {
  authRequired: boolean
  canceled: boolean
}

export function failedCollectionDownloadItems(
  result: Pick<CollectionDownloadQueueResult, "failed">,
): CollectionDownloadQueueItem[] {
  return result.failed.map(({ item }) => item)
}

function browserSaveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function runCollectionDownloadQueue(input: {
  items: CollectionDownloadQueueItem[]
  signal: AbortSignal
  directory?: CollectionDownloadDirectory | null
  fetchImpl?: typeof fetch
  saveBlob?: (blob: Blob, filename: string) => void
  onProgress?: (progress: CollectionDownloadProgress) => void
}): Promise<CollectionDownloadQueueResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const saveBlob = input.saveBlob ?? browserSaveBlob
  const completed: CollectionDownloadQueueItem[] = []
  const failed: Array<{ item: CollectionDownloadQueueItem; reason: string }> =
    []
  let authRequired = false
  let canceled = false

  const report = (active: CollectionDownloadQueueItem | null) =>
    input.onProgress?.({
      active,
      completed: [...completed],
      failed: [...failed],
      total: input.items.length,
    })

  for (const [index, item] of input.items.entries()) {
    if (input.signal.aborted) {
      canceled = true
      break
    }
    report(item)
    try {
      const response = await fetchImpl(item.url, {
        credentials: "include",
        signal: input.signal,
      })
      if (
        response.status === 401 &&
        response.headers.get(DOWNLOAD_ERROR_HEADER) === DOWNLOAD_AUTH_REQUIRED
      ) {
        authRequired = true
        failed.push(
          ...input.items.slice(index).map((retryItem) => ({
            item: retryItem,
            reason: "auth-required",
          })),
        )
        break
      }
      if (!response.ok || !response.body) {
        failed.push({ item, reason: `http-${response.status}` })
        continue
      }
      if (input.directory) {
        const file = await input.directory.getFileHandle(item.filename, {
          create: true,
        })
        const writable = await file.createWritable()
        await response.body.pipeTo(writable, { signal: input.signal })
      } else {
        const blob = await response.blob()
        if (input.signal.aborted)
          throw new DOMException("Aborted", "AbortError")
        saveBlob(blob, item.filename)
      }
      completed.push(item)
    } catch (error) {
      if (
        input.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        canceled = true
        break
      }
      failed.push({
        item,
        reason: error instanceof Error ? error.message : "download-failed",
      })
    }
  }

  report(null)
  return {
    active: null,
    authRequired,
    canceled,
    completed,
    failed,
    total: input.items.length,
  }
}
