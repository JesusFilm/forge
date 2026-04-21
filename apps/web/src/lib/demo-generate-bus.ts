// Module-level pub/sub for the /demo-search generator. Lets a shortcut
// button (above the fold) and the search input's Enter key ask the main
// AiExperienceGeneratorDemo (further down the page) to run, without
// threading a shared context through every intermediate component.
//
// Scope: client-only. Subscribers register on mount; the main generator
// is the sole handler today.

const triggerListeners = new Set<() => void>()

export function requestGenerate(): void {
  triggerListeners.forEach((listener) => listener())
}

export function subscribeToGenerateRequests(listener: () => void): () => void {
  triggerListeners.add(listener)
  return () => {
    triggerListeners.delete(listener)
  }
}
