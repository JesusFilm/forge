import type { CollectionDownloadQueueItem } from "@/components/watch/collection-download-options"

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

function defaultTriggerDownload(item: CollectionDownloadQueueItem): void {
  const anchor = document.createElement("a")
  anchor.href = item.url
  anchor.download = item.filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function defaultDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return signal.aborted
      ? Promise.reject(new DOMException("Aborted", "AbortError"))
      : Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(cleanupAndResolve, ms)

    function cleanup() {
      window.clearTimeout(timeout)
      signal.removeEventListener("abort", cleanupAndReject)
    }

    function cleanupAndResolve() {
      cleanup()
      resolve()
    }

    function cleanupAndReject() {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }

    signal.addEventListener("abort", cleanupAndReject, { once: true })
  })
}

export async function runCollectionDownloadQueue(input: {
  items: CollectionDownloadQueueItem[]
  signal: AbortSignal
  delayMs?: number
  delay?: (ms: number, signal: AbortSignal) => Promise<void>
  triggerDownload?: (item: CollectionDownloadQueueItem) => void
  onProgress?: (progress: CollectionDownloadProgress) => void
}): Promise<CollectionDownloadQueueResult> {
  const completed: CollectionDownloadQueueItem[] = []
  const failed: Array<{ item: CollectionDownloadQueueItem; reason: string }> =
    []
  const delay = input.delay ?? defaultDelay
  const delayMs = input.delayMs ?? 750
  const triggerDownload = input.triggerDownload ?? defaultTriggerDownload
  let canceled = false

  const report = (active: CollectionDownloadQueueItem | null) =>
    input.onProgress?.({
      active,
      completed: [...completed],
      failed: [...failed],
      total: input.items.length,
    })

  for (const item of input.items) {
    if (input.signal.aborted) {
      canceled = true
      break
    }

    report(item)
    try {
      triggerDownload(item)
      completed.push(item)
      await delay(delayMs, input.signal)
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
    authRequired: false,
    canceled,
    completed,
    failed,
    total: input.items.length,
  }
}
