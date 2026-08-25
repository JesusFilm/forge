"use client"

import { lazy, Suspense, useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

const LazyLanguageGlobe = lazy(async () => {
  const { LanguageGlobe } = await import("./LanguageGlobe")
  return { default: LanguageGlobe }
})

type DeferredLanguageGlobeProps = {
  className?: string
}

export function DeferredLanguageGlobe({
  className,
}: DeferredLanguageGlobeProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [shouldLoad, setShouldLoad] = useState(false)

  useEffect(() => {
    const target = viewportRef.current
    if (!target || typeof IntersectionObserver === "undefined") {
      const fallbackTimer = window.setTimeout(() => setShouldLoad(true), 0)
      return () => window.clearTimeout(fallbackTimer)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setShouldLoad(true)
        observer.disconnect()
      },
      { rootMargin: "360px" },
    )
    observer.observe(target)

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={viewportRef}
      aria-hidden={shouldLoad ? undefined : "true"}
      className={cn(
        "relative h-[clamp(31rem,70vw,54rem)] w-full overflow-hidden bg-[#09090b]",
        className,
      )}
      data-testid="deferred-language-globe"
    >
      {shouldLoad ? (
        <Suspense fallback={null}>
          <LazyLanguageGlobe className="h-full" layout="embedded" />
        </Suspense>
      ) : null}
    </div>
  )
}
