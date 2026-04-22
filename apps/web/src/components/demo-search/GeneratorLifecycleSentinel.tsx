"use client"

import { useEffect } from "react"
import { setGeneratorMounted, setSearchPending } from "@/lib/demo-generate-bus"

// Rendered inside the Suspense boundary on every render path — even when
// AiExperienceGeneratorDemo doesn't mount (zero-result query). Keeps the
// hero shortcut button unstuck by clearing `searchPending` and signalling
// `generatorMounted` regardless of whether the full generator mounted.
export function GeneratorLifecycleSentinel() {
  useEffect(() => {
    setSearchPending(false)
    setGeneratorMounted(true)
    return () => setGeneratorMounted(false)
  }, [])
  return null
}
