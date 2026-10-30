"use client"
import { Component, lazy, Suspense, type ReactNode } from "react"
import type { ComponentProps } from "react"
import type ComparisonView from "./comparison-view"
const LazyComparison = lazy(() => import("./comparison-view"))

/** Contain a failed feature import/render while retaining the shell's session and draft. */
class ComparisonErrorBoundary extends Component<
  { children: ReactNode; onExit: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="p-6">
        <p>Comparison couldn&apos;t be opened.</p>
        <button onClick={this.props.onExit}>Return to Forge</button>
      </div>
    ) : (
      this.props.children
    )
  }
}

/** Download the comparison controller only after explicit entry. */
export function ComparisonBoundary(
  props: ComponentProps<typeof ComparisonView>,
) {
  return (
    <ComparisonErrorBoundary onExit={props.onExit}>
      <Suspense
        fallback={
          <div className="p-6" role="status">
            Opening comparison…{" "}
            <button onClick={() => props.onExit()}>Return to Forge</button>
          </div>
        }
      >
        <LazyComparison {...props} />
      </Suspense>
    </ComparisonErrorBoundary>
  )
}
