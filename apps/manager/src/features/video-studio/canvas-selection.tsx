"use client"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { StudioTimelineItem } from "@forge/studio-contracts"
import type { EditorSession, EditorSnapshot } from "./editor-session"
import { itemLabel } from "./item-presentation"
import { defaultTransform } from "./inspector"

type Box = { left: number; top: number; width: number; height: number }

/** Ignore full-frame layout wrappers; hit actual text and visual leaf content. */
export function contentRects(layer: HTMLElement): DOMRect[] {
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const text = walker.currentNode
    if (!text.textContent?.trim()) continue
    const parent = text.parentElement
    if (!parent || parent.closest("script,style")) continue
    const style = getComputedStyle(parent)
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      style.opacity === "0"
    )
      continue
    const range = document.createRange()
    range.selectNodeContents(text)
    rects.push(...Array.from(range.getClientRects()))
  }
  for (const node of layer.querySelectorAll<HTMLElement>(
    "video,img,canvas,svg",
  )) {
    if (getComputedStyle(node).visibility !== "hidden")
      rects.push(node.getBoundingClientRect())
  }
  return rects.filter((r) => r.width > 0 && r.height > 0)
}
export function CanvasSelection({
  session,
  state,
  onError,
}: {
  session: EditorSession
  state: EditorSnapshot
  onError: (message: string) => void
}) {
  const overlay = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const drag = useRef<{
    pointerId: number
    item: StudioTimelineItem
    layer: HTMLElement
    x: number
    y: number
    scale: number
    transform: string
    box: Box | null
  } | null>(null)
  const activeLayers = () =>
    Array.from(
      overlay.current
        ?.closest(".nle-canvas")
        ?.querySelectorAll<HTMLElement>("[data-studio-item]") ?? [],
    ).filter((layer) => {
      const item = state.document.items.find(
        (i) => i.id === layer.dataset.studioItem,
      )
      return (
        item &&
        item.kind !== "audio" &&
        state.playhead >= item.startFrame &&
        state.playhead < item.startFrame + item.durationInFrames
      )
    })
  const layerBox = (layer: HTMLElement): Box | null => {
    const canvas = overlay.current?.getBoundingClientRect()
    if (!canvas) return null
    const rects = contentRects(layer)
    if (!rects.length) rects.push(layer.getBoundingClientRect())
    const left = Math.min(...rects.map((r) => r.left)),
      top = Math.min(...rects.map((r) => r.top))
    return {
      left: left - canvas.left,
      top: top - canvas.top,
      width: Math.max(...rects.map((r) => r.right)) - left,
      height: Math.max(...rects.map((r) => r.bottom)) - top,
    }
  }
  const updateSelection = useEffectEvent(() => {
    if (drag.current) return
    const layer = activeLayers().find(
      (layer) => layer.dataset.studioItem === state.selection,
    )
    setBox(layer ? layerBox(layer) : null)
  })
  useEffect(() => {
    const update = () => updateSelection()
    update()
    const observer = new ResizeObserver(update)
    if (overlay.current) observer.observe(overlay.current)
    const mutations = new MutationObserver(update)
    const preview = overlay.current
      ?.closest(".nle-canvas")
      ?.querySelector(".nle-preview")
    if (preview) mutations.observe(preview, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
    // Measure selection on edits/seeks; playback ticks do not need a layout read.
  }, [state.selection, state.document, state.seekRequest])
  const reset = () => {
    const current = drag.current
    if (current) {
      current.layer.style.transform = current.transform
      setBox(current.box)
    }
    drag.current = null
  }
  useEffect(() => {
    window.addEventListener("blur", reset)
    return () => {
      window.removeEventListener("blur", reset)
      reset()
    }
  }, [])
  const selected = state.document.items.find((i) => i.id === state.selection)
  return (
    <div
      ref={overlay}
      className="nle-canvas-overlay"
      aria-label="Select and move canvas elements"
      onPointerDown={(event) => {
        if (!state.editable || event.button !== 0 || !overlay.current) return
        const layers = activeLayers().reverse()
        const contains = (r: DOMRect) =>
          event.clientX >= r.left &&
          event.clientX <= r.right &&
          event.clientY >= r.top &&
          event.clientY <= r.bottom
        // An explicit timeline selection wins when its content is under the pointer.
        const chosen =
          layers.find(
            (layer) =>
              layer.dataset.studioItem === state.selection &&
              contentRects(layer).some(contains),
          ) ??
          layers.find((layer) => contentRects(layer).some(contains)) ??
          layers[0]
        if (!chosen) return
        const item = state.document.items.find(
          (i) => i.id === chosen.dataset.studioItem,
        )
        if (!item) return
        event.preventDefault()
        session.select(item.id)
        event.currentTarget.setPointerCapture(event.pointerId)
        const bounds = layerBox(chosen)
        setBox(bounds)
        drag.current = {
          pointerId: event.pointerId,
          item,
          layer: chosen,
          x: event.clientX,
          y: event.clientY,
          scale:
            state.document.width /
            overlay.current.getBoundingClientRect().width,
          transform: chosen.style.transform,
          box: bounds,
        }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        const t = current.item.transform ?? defaultTransform
        const dx = event.clientX - current.x,
          dy = event.clientY - current.y
        current.layer.style.transform = `translate(${t.x + dx * current.scale}px,${t.y + dy * current.scale}px) rotate(${t.rotation}deg) scale(${t.scaleX},${t.scaleY})`
        if (current.box)
          setBox({
            ...current.box,
            left: current.box.left + dx,
            top: current.box.top + dy,
          })
      }}
      onPointerUp={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        const x = (event.clientX - current.x) * current.scale,
          y = (event.clientY - current.y) * current.scale
        reset()
        if (Math.abs(x) + Math.abs(y) < 1) return
        const t = current.item.transform ?? defaultTransform
        try {
          session.edit((d) => ({
            ...d,
            items: d.items.map((item) =>
              item.id === current.item.id
                ? { ...item, transform: { ...t, x: t.x + x, y: t.y + y } }
                : item,
            ),
          }))
        } catch (error) {
          onError(
            error instanceof Error ? error.message : "Could not move element",
          )
        }
      }}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
    >
      {box && selected && (
        <div className="nle-canvas-selection" style={box}>
          <span>{itemLabel(selected, state.document)}</span>
        </div>
      )}
    </div>
  )
}
