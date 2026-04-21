// Module-level pub/sub for the /demo-search generator. Lets a shortcut
// button (above the fold) and the search input's Enter key ask the main
// AiExperienceGeneratorDemo (further down the page) to run, without
// threading a shared context through every intermediate component.
//
// Also mirrors the generator's pending-state so every trigger (shortcut
// button, Enter key, main button) shows consistent loading affordances.
//
// Scope: client-only. Subscribers register on mount; the main generator
// is the sole handler today.

const triggerListeners = new Set<() => void>()
const pendingListeners = new Set<() => void>()
let pending = false

export function requestGenerate(): void {
  triggerListeners.forEach((listener) => listener())
}

export function subscribeToGenerateRequests(listener: () => void): () => void {
  triggerListeners.add(listener)
  return () => {
    triggerListeners.delete(listener)
  }
}

export function setGeneratePending(next: boolean): void {
  if (pending === next) return
  pending = next
  pendingListeners.forEach((listener) => listener())
}

export function getGeneratePending(): boolean {
  return pending
}

export function subscribeToGeneratePending(listener: () => void): () => void {
  pendingListeners.add(listener)
  return () => {
    pendingListeners.delete(listener)
  }
}
