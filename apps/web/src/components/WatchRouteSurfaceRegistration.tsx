"use client"

import { useLayoutEffect } from "react"
import { usePathname } from "next/navigation"

import {
  useWatchRouteSurfaceRegistration,
  type WatchRouteSurface,
} from "./FloatingSearchContext"

export function WatchRouteSurfaceRegistration({
  surface,
}: {
  surface: WatchRouteSurface
}) {
  const pathname = usePathname()
  const { register } = useWatchRouteSurfaceRegistration()

  useLayoutEffect(
    () => register(pathname, surface),
    [pathname, register, surface],
  )

  return null
}
