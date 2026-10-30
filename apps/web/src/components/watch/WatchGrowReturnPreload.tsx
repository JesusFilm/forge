"use client"

import { preloadWatchGrowReturn } from "./watch-grow-loader"

// A separate, tiny client entry lets an explicit return start its chunks before
// the video page's larger dependency graph evaluates and its role store hydrates.
// The server includes this entry only beside an admitted audience surface.
preloadWatchGrowReturn()

export function WatchGrowReturnPreload() {
  return null
}
