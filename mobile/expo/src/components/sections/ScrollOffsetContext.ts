import { createContext, useContext } from "react"

export interface ScrollOffsetValue {
  scrollY: number
  viewportHeight: number
}

export const ScrollOffsetContext = createContext<ScrollOffsetValue>({
  scrollY: 0,
  viewportHeight: 0,
})

export function useScrollOffset(): ScrollOffsetValue {
  return useContext(ScrollOffsetContext)
}
