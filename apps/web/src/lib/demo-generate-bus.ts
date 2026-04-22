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

"use client"

const triggerListeners = new Set<() => void>()
const pendingListeners = new Set<() => void>()
const searchPendingListeners = new Set<() => void>()
let pending = false
let pendingToken: symbol | null = null
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

// Raising pending = true returns an opaque token. Only the holder of that
// token may clear the flag via clearGeneratePendingWithToken(token). This
// prevents a stale in-flight generate from clobbering a queued pending
// flag raised by a newer submit.
export function setGeneratePending(next: boolean): symbol | null {
  if (next) {
    const token = Symbol("generate-pending")
    pending = true
    pendingToken = token
    pendingListeners.forEach((listener) => listener())
    return token
  }
  if (pending) {
    pending = false
    pendingToken = null
    pendingListeners.forEach((listener) => listener())
  }
  return null
}

export function clearGeneratePendingWithToken(token: symbol | null): void {
  if (token == null) return
  if (pendingToken !== token) return
  pending = false
  pendingToken = null
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
// resolved with the new query's data). Drives the "Loading…" button state.
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
