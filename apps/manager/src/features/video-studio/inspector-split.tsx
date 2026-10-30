"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"

export function InspectorSplit({
  children,
  inspector,
}: {
  children: ReactNode
  inspector: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(
    null,
  )
  const [available, setAvailable] = useState(0)
  const [width, setWidth] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const id = useId()
  const min = 200
  const max = Math.max(min, Math.min(560, available - 240))
  const initial = available && available < 900 ? 210 : 245
  const size = Math.min(max, Math.max(min, width ?? initial))
  function resize(next: number) {
    setWidth(Math.min(max, Math.max(min, next)))
  }
  function stop() {
    drag.current = null
    setDragging(false)
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    )
    observer.observe(root.current!)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={root}
      className="nle-workspace nle-inspector-split"
      data-resizing={dragging || undefined}
      style={
        available
          ? { gridTemplateColumns: `minmax(0, 1fr) ${size}px` }
          : undefined
      }
    >
      {children}
      <div id={id} className="nle-inspector-pane">
        <div
          className="nle-inspector-divider"
          role="separator"
          tabIndex={0}
          aria-label="Resize inspector"
          aria-orientation="vertical"
          aria-controls={id}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Math.round(size)}
          aria-valuetext={`${Math.round(size)} pixels of inspector width`}
          title="Drag to resize inspector. Double-click to reset."
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              width: size,
            }
            setDragging(true)
          }}
          onPointerMove={(event) => {
            const start = drag.current
            if (start?.pointerId === event.pointerId)
              resize(start.width + start.x - event.clientX)
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return
            stop()
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onLostPointerCapture={stop}
          onPointerCancel={stop}
          onDoubleClick={() => setWidth(null)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 48 : 16
            const next =
              event.key === "ArrowLeft"
                ? size + step
                : event.key === "ArrowRight"
                  ? size - step
                  : event.key === "Home"
                    ? min
                    : event.key === "End"
                      ? max
                      : null
            if (next === null) return
            event.preventDefault()
            event.stopPropagation()
            resize(next)
          }}
        >
          <span aria-hidden="true" />
        </div>
        {inspector}
      </div>
    </div>
  )
}
