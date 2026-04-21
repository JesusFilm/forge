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
const searchPendingListeners = new Set<() => void>()
let pending = false
let searchPending = false

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

// "Search pending" = the RSC navigation for a new query is in flight. Set
// true when the user submits the hero-bar query and cleared once the new
// AiExperienceGeneratorDemo has mounted (i.e. the Suspense boundary has
// resolved with the new query's data). Drives the "Waiting for search to
// finish" button state.
export function setSearchPending(next: boolean): void {
  if (searchPending === next) return
  searchPending = next
  searchPendingListeners.forEach((listener) => listener())
}

export function getSearchPending(): boolean {
  return searchPending
}

export function subscribeToSearchPending(listener: () => void): () => void {
  searchPendingListeners.add(listener)
  return () => {
    searchPendingListeners.delete(listener)
  }
}
