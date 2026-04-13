"use client"

import { useEffect, useState } from "react"
import type { GraphMode, GraphPayload } from "./graph-types"
import { apiFetch } from "@/lib/api-fetch"

type GraphDataState = {
  data: GraphPayload | null
  isLoading: boolean
  error: string | null
}

export function useGraphData(mode: GraphMode): GraphDataState {
  const [state, setState] = useState<GraphDataState>({
    data: null,
    isLoading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    setState({ data: null, isLoading: true, error: null })

    async function load() {
      try {
        const res = await apiFetch(`/api/graph/${mode}`, { cache: "no-store" })
        if (!res.ok) {
          const body = await res.text()
          throw new Error(
            `Graph API returned ${res.status}: ${body.slice(0, 200)}`,
          )
        }
        const payload = (await res.json()) as GraphPayload
        if (!cancelled) {
          setState({ data: payload, isLoading: false, error: null })
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            data: null,
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to load graph",
          })
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [mode])

  return state
}
