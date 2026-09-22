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
 */
export default function dynamicForTests(
  loader: () => Promise<{ default: ComponentType<Record<string, unknown>> }>,
): ComponentType<Record<string, unknown>> {
  const Lazy = lazy(loader)

  return function DynamicTestMock(props: Record<string, unknown>) {
    return createElement(
      Suspense,
      { fallback: null as ReactNode },
      createElement(Lazy, props),
    )
  }
}
