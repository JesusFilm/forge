"use client"

import { useEffect, useRef, useState, type ComponentType } from "react"

import { cn } from "@/lib/utils"

type DeferredLanguageGlobeProps = {
  className?: string
  loadImmediately?: boolean
}

export function DeferredLanguageGlobe({
  className,
  loadImmediately = false,
}: DeferredLanguageGlobeProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [shouldLoad, setShouldLoad] = useState(loadImmediately)
  const [GlobeComponent, setGlobeComponent] = useState<ComponentType<{
    className?: string
    layout?: "standalone" | "embedded"
  }> | null>(null)

  useEffect(() => {
    if (loadImmediately) {
      setShouldLoad(true)
      return
    }

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
  }, [loadImmediately])

  useEffect(() => {
    if (!shouldLoad || GlobeComponent) return
    let active = true

    void import("./LanguageGlobe").then(({ LanguageGlobe }) => {
      if (active) setGlobeComponent(() => LanguageGlobe)
    })

    return () => {
      active = false
    }
  }, [GlobeComponent, shouldLoad])

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
      {GlobeComponent ? (
        <GlobeComponent className="h-full" layout="embedded" />
      ) : null}
    </div>
  )
}
