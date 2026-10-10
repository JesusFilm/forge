"use client"

import { useEffect } from "react"
import { setSearchPending } from "@/lib/demo-generate-bus"

// Rendered inside the Suspense boundary on every render path — even when
// AiExperienceGeneratorDemo doesn't mount (zero-result query). Clears
// `searchPending` so the hero shortcut button transitions out of
// "Loading…" once the Suspense boundary has resolved.
export function GeneratorLifecycleSentinel() {
  useEffect(() => {
    setSearchPending(false)
  }, [])
  return null
}
