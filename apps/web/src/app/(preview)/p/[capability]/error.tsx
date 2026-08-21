"use client"

import { useEffect, useRef } from "react"

export default function PublicPlaylistError({ reset }: { reset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <main className="grid min-h-screen place-items-center bg-stone-950 px-5 text-center text-stone-100">
      <div className="max-w-lg">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-3xl font-black outline-none"
        >
          Playlist temporarily unavailable
        </h1>
        <p className="mt-4 leading-7 text-stone-300">
          This playlist cannot be loaded right now. Please try again.
        </p>
        <button
          type="button"
          className="mt-6 min-h-11 rounded-full bg-white px-5 font-bold text-stone-950 focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-4 focus-visible:ring-offset-stone-950 focus-visible:outline-none"
          onClick={reset}
        >
          Try again
        </button>
      </div>
    </main>
  )
}
