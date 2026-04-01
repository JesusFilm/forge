"use client"

import { useEffect, useRef } from "react"

export default function WorldMapBackground() {
  const spotlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (spotlightRef.current) {
        spotlightRef.current.style.setProperty("--mx", `${e.clientX}px`)
        spotlightRef.current.style.setProperty("--my", `${e.clientY}px`)
        spotlightRef.current.style.opacity = "1"
      }
    }

    function handleMouseLeave() {
      if (spotlightRef.current) {
        spotlightRef.current.style.opacity = "0"
      }
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.documentElement.addEventListener("mouseleave", handleMouseLeave)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.documentElement.removeEventListener(
        "mouseleave",
        handleMouseLeave,
      )
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
      {/* Base map layer */}
      <div className="absolute inset-0 bg-[url('/World_map_with_points.svg')] bg-[length:min(1400px,96vw)_auto] bg-top bg-no-repeat opacity-[0.08]" />

      {/* Spotlight layer — reveals brighter SVG map near cursor */}
      <div
        ref={spotlightRef}
        className="absolute inset-0 bg-[url('/World_map_with_points.svg')] bg-[length:min(1400px,96vw)_auto] bg-top bg-no-repeat opacity-0 transition-opacity duration-300"
        style={{
          mask: "radial-gradient(circle 300px at var(--mx, -999px) var(--my, -999px), black 0%, transparent 100%)",
          WebkitMask:
            "radial-gradient(circle 300px at var(--mx, -999px) var(--my, -999px), black 0%, transparent 100%)",
        }}
      />
    </div>
  )
}
