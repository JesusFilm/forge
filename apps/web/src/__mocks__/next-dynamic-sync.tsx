import {
  createElement,
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
} from "react"

/**
 * Test stand-in for `next/dynamic`.
 *
 * Production `next/dynamic` wraps `React.lazy` in Suspense and hangs the load
 * off Next's chunk runtime, which does not exist under vitest. This keeps the
 * `lazy` + `Suspense` shape — so React re-renders when the loader settles,
 * whether the inner module is `vi.mock`ed (resolves in the same microtask) or
 * real — and drops everything Next-specific. A suite only has to flush
 * microtasks, which `await act(async () => ...)` already does.
 *
 * WHAT THIS ERASES: the identity of the loader. A component collapsed back to
 * a static top-level import behaves identically under this stub, so no test
 * using it can prove a module was deferred. The evidence for deferral is the
 * built chunk graph (`.next/diagnostics/route-bundle-stats.json`) plus the
 * source backstops that assert the `dynamic(() => import(...))` seam.
 *
 * Use as:
 * `vi.mock("next/dynamic", async () => import("@/__mocks__/next-dynamic-sync"))`
 *
 * By default the chunk loads. `holdDeferredChunk()` and
 * `rejectDeferredChunk()` stand in for a slow or failed chunk request: each
 * call mints a FRESH lazy payload for components rendered afterwards, because
 * a real lazy payload settles once and stays settled. Call
 * `resetDeferredChunk()` in `afterEach`.
 */
type ChunkOutcome =
  | { kind: "load" }
  | { kind: "hold"; id: number; gate: Promise<void> }
  | { kind: "reject"; id: number }

let chunkOutcome: ChunkOutcome = { kind: "load" }
let nextOutcomeId = 0

/** Holds every deferred chunk requested from now on until the returned release. */
export function holdDeferredChunk(): () => void {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  chunkOutcome = { kind: "hold", id: (nextOutcomeId += 1), gate }
  return release
}

/** Fails every deferred chunk requested from now on, like a 404 or blocked fetch. */
export function rejectDeferredChunk(): void {
  chunkOutcome = { kind: "reject", id: (nextOutcomeId += 1) }
}

export function resetDeferredChunk(): void {
  chunkOutcome = { kind: "load" }
}

export default function dynamicForTests(
  loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>,
): ComponentType<Record<string, unknown>> {
  const Lazy = lazy(loader)
  const variants = new Map<number, ComponentType<Record<string, unknown>>>()

  function lazyFor(outcome: ChunkOutcome) {
    if (outcome.kind === "load") return Lazy
    let variant = variants.get(outcome.id)
    if (!variant) {
      variant =
        outcome.kind === "hold"
          ? lazy(() => outcome.gate.then(loader))
          : lazy(() => Promise.reject(new Error("ChunkLoadError")))
      variants.set(outcome.id, variant)
    }
    return variant
  }

  return function DynamicTestMock(props: Record<string, unknown>) {
    return createElement(
      Suspense,
      { fallback: null as ReactNode },
      createElement(lazyFor(chunkOutcome), props),
    )
  }
}
