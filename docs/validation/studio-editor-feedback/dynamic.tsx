import React, { lazy, Suspense } from "react"
export default function dynamic(
  load: () => Promise<{ default: React.ComponentType }>,
) {
  const Component = lazy(load)
  return function Dynamic(props: Record<string, unknown>) {
    return (
      <Suspense fallback={null}>
        <Component {...props} />
      </Suspense>
    )
  }
}
