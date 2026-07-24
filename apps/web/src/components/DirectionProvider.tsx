"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { LocaleTextDirection } from "@/lib/locale"

export type TextDirection = LocaleTextDirection

const DirectionContext = createContext<TextDirection>("ltr")

export function DirectionProvider({
  children,
  direction,
}: {
  children: ReactNode
  direction: TextDirection
}) {
  return (
    <DirectionContext.Provider value={direction}>
      {children}
    </DirectionContext.Provider>
  )
}

export function useDirection(): TextDirection {
  return useContext(DirectionContext)
}
