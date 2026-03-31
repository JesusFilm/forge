"use client"

import { useRef, type ReactNode } from "react"

export default function TiltCard({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    el.style.transform = `perspective(600px) rotateY(${x * 8}deg) rotateX(${y * -8}deg) translateY(-2px)`
  }

  function handleMouseLeave() {
    const el = ref.current
    if (!el) return
    el.style.transform = ""
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`hover:shadow-[0_4px_24px_rgba(255,255,255,0.08)] ${className}`}
      style={{
        willChange: "transform",
        transition: "transform 300ms ease-out, box-shadow 200ms ease",
      }}
    >
      {children}
    </div>
  )
}
