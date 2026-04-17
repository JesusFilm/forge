"use client"

import { useState, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { SearchOverlay } from "./SearchOverlay"

export function SearchToggle() {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClose = useCallback(() => {
    setClosing(true)
    timerRef.current = setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 200)
  }, [])

  const handleOpen = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setClosing(false)
    setOpen(true)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-lg p-3 text-stone-300 transition hover:bg-stone-800 hover:text-white"
        aria-label="Search"
        data-testid="search-toggle"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <circle cx={11} cy={11} r={8} />
          <line x1={21} y1={21} x2={16.65} y2={16.65} />
        </svg>
      </button>

      {open &&
        createPortal(
          <SearchOverlay open={open} onClose={handleClose} closing={closing} />,
          document.body,
        )}
    </>
  )
}
