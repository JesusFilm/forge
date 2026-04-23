"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useSearchParams } from "next/navigation"

export type FloatingSearchContextValue = {
  open: boolean
  query: string
  hydratedOpen: boolean
  setOpen: (open: boolean) => void
  setQuery: (q: string) => void
  search: (q: string) => void
  closeAndKeepQuery: () => void
}

const FloatingSearchContext = createContext<FloatingSearchContextValue | null>(
  null,
)

export function useFloatingSearch(): FloatingSearchContextValue {
  const ctx = useContext(FloatingSearchContext)
  if (ctx === null) {
    throw new Error(
      "useFloatingSearch must be used inside <FloatingSearchProvider>",
    )
  }
  return ctx
}

export function FloatingSearchProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams()
  const seededQuery = (searchParams.get("q") ?? "").slice(0, 200)

  const [open, setOpen] = useState<boolean>(seededQuery.length > 0)
  const [query, setQuery] = useState<string>(seededQuery)
  const [hydratedOpen] = useState<boolean>(seededQuery.length > 0)

  // Unit 3 wires the full Apollo + router.replace flow inside this callback.
  // Unit 1 ships a stub that keeps state coherent so bar/overlay can be added
  // incrementally without breaking consumers.
  const search = useCallback((q: string) => {
    setQuery(q)
    if (q.length > 0) setOpen(true)
  }, [])

  const closeAndKeepQuery = useCallback(() => {
    setOpen(false)
  }, [])

  const value = useMemo<FloatingSearchContextValue>(
    () => ({
      open,
      query,
      hydratedOpen,
      setOpen,
      setQuery,
      search,
      closeAndKeepQuery,
    }),
    [open, query, hydratedOpen, search, closeAndKeepQuery],
  )

  return (
    <FloatingSearchContext.Provider value={value}>
      <div inert={open || undefined} aria-hidden={open || undefined}>
        {children}
      </div>
      {/* Unit 2 mounts <FloatingSearchBar /> + inline floating logo here. */}
      {/* Unit 3 mounts the portal-rendered <SearchOverlay /> here. */}
    </FloatingSearchContext.Provider>
  )
}
