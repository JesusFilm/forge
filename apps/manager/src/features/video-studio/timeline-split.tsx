"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"

export function TimelineSplit({
  workspace,
  children,
}: {
  workspace: ReactNode
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; y: number; height: number } | null>(
    null,
  )
  const [height, setHeight] = useState(0)
  const [ratio, setRatio] = useState(0.4)
  const [dragging, setDragging] = useState(false)
  const id = useId()
  // Reserve preview space; on very short windows share the available space.
  const available = Math.max(0, height)
  const min = Math.min(120, available * 0.4)
  const max = Math.max(min, available - 160)
  const size = height ? Math.min(max, Math.max(min, ratio * available)) : 0
  function resize(next: number) {
    if (available) setRatio(Math.min(max, Math.max(min, next)) / available)
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height)
    })
    observer.observe(root.current!)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={root}
      className="nle-editing-space"
      data-resizing={dragging || undefined}
    >
      <div id={`${id}-preview`} className="nle-preview-pane">
        {workspace}
      </div>
      <div
        id={`${id}-timeline`}
        className="nle-timeline-pane"
        style={{ height: height ? size : "40%" }}
      >
        <div
          className="nle-timeline-divider"
          role="separator"
          tabIndex={0}
          aria-label="Resize timeline"
          aria-orientation="horizontal"
          aria-controls={`${id}-preview ${id}-timeline`}
          aria-valuemin={Math.round(min)}
          aria-valuemax={Math.round(max)}
          aria-valuenow={Math.round(size)}
          aria-valuetext={`${Math.round(size)} pixels of timeline height`}
          title="Drag to resize timeline. Double-click to reset."
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = {
              pointerId: event.pointerId,
              y: event.clientY,
              height: size,
            }
            setDragging(true)
          }}
          onPointerMove={(event) => {
            const start = drag.current
            if (start?.pointerId === event.pointerId)
              resize(start.height + start.y - event.clientY)
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return
            drag.current = null
            setDragging(false)
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onLostPointerCapture={() => {
            drag.current = null
            setDragging(false)
          }}
          onPointerCancel={() => {
            drag.current = null
            setDragging(false)
          }}
          onDoubleClick={() => setRatio(0.4)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 48 : 16
            const next =
              event.key === "ArrowUp"
                ? size + step
                : event.key === "ArrowDown"
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
        {children}
      </div>
    </div>
  )
}
