"use client"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { StudioTimelineItem } from "@forge/studio-contracts"
import type { EditorSession, EditorSnapshot } from "./editor-session"
import { itemLabel } from "./item-presentation"
import { defaultTransform } from "./inspector"

type Box = {
  left: number
  top: number
  width: number
  height: number
  rotation?: number
}

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
    mode: "move" | "scale" | "rotate"
    anchor: { x: number; y: number }
    origin: { x: number; y: number }
    center: { x: number; y: number }
    next: typeof defaultTransform
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
    const item = state.document.items.find(
      (i) => i.id === layer.dataset.studioItem,
    )
    const t = item?.transform ?? defaultTransform
    const original = layer.style.transform
    let rects: DOMRect[]
    // Measure the local rectangle, then rotate its centre into canvas space.
    // Restored synchronously before paint; never run this on pointer moves.
    try {
      if (t.rotation)
        layer.style.transform = `translate(${t.x}px,${t.y}px) rotate(0deg) scale(${t.scaleX},${t.scaleY})`
      rects = contentRects(layer)
      if (!rects.length) rects.push(layer.getBoundingClientRect())
    } finally {
      if (t.rotation) layer.style.transform = original
    }
    const left = Math.min(...rects.map((r) => r.left)),
      top = Math.min(...rects.map((r) => r.top))
    const width = Math.max(...rects.map((r) => r.right)) - left
    const height = Math.max(...rects.map((r) => r.bottom)) - top
    const scale = canvas.width / state.document.width
    const originX = canvas.left + canvas.width / 2 + t.x * scale
    const originY = canvas.top + canvas.height / 2 + t.y * scale
    const x = left + width / 2 - originX,
      y = top + height / 2 - originY
    const angle = (t.rotation * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle)
    return {
      left: originX + x * cos - y * sin - canvas.left - width / 2,
      top: originY + x * sin + y * cos - canvas.top - height / 2,
      width,
      height,
      rotation: t.rotation,
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
  function updateDrag(clientX: number, clientY: number) {
    const current = drag.current
    if (!current) return
    const t = current.item.transform ?? defaultTransform
    const next = { ...t }
    const dx = clientX - current.x,
      dy = clientY - current.y
    if (current.mode === "move") {
      next.x += dx * current.scale
      next.y += dy * current.scale
      if (current.box)
        setBox({
          ...current.box,
          left: current.box.left + dx,
          top: current.box.top + dy,
        })
    } else if (current.mode === "scale") {
      const vx = current.x - current.anchor.x,
        vy = current.y - current.anchor.y
      const ratio = Math.max(
        0.01 / Math.min(t.scaleX, t.scaleY),
        Math.min(
          100 / Math.max(t.scaleX, t.scaleY),
          ((clientX - current.anchor.x) * vx +
            (clientY - current.anchor.y) * vy) /
            Math.max(1, vx * vx + vy * vy),
        ),
      )
      next.scaleX *= ratio
      next.scaleY *= ratio
      next.x +=
        (current.origin.x - current.anchor.x) * (ratio - 1) * current.scale
      next.y +=
        (current.origin.y - current.anchor.y) * (ratio - 1) * current.scale
      if (current.box)
        setBox({
          ...current.box,
          left:
            current.box.left +
            (current.center.x - current.box.width / 2 - current.anchor.x) *
              (ratio - 1),
          top:
            current.box.top +
            (current.center.y - current.box.height / 2 - current.anchor.y) *
              (ratio - 1),
          width: current.box.width * ratio,
          height: current.box.height * ratio,
        })
    } else {
      const delta =
        Math.atan2(clientY - current.center.y, clientX - current.center.x) -
        Math.atan2(current.y - current.center.y, current.x - current.center.x)
      const proposed = t.rotation + (delta * 180) / Math.PI
      const nearest = Math.round(proposed / 45) * 45
      const rotation = Math.abs(proposed - nearest) <= 4 ? nearest : proposed
      // Use the snapped angle everywhere so the content and handle stay aligned.
      const angle = ((rotation - t.rotation) * Math.PI) / 180
      const cos = Math.cos(angle),
        sin = Math.sin(angle)
      const ox = current.origin.x - current.center.x,
        oy = current.origin.y - current.center.y
      next.rotation = ((((rotation + 180) % 360) + 360) % 360) - 180
      next.x += (ox * cos - oy * sin - ox) * current.scale
      next.y += (ox * sin + oy * cos - oy) * current.scale
      if (current.box)
        setBox({
          ...current.box,
          rotation: (current.box.rotation ?? 0) + (angle * 180) / Math.PI,
        })
    }
    current.next = next
    current.layer.style.transform = `translate(${next.x}px,${next.y}px) rotate(${next.rotation}deg) scale(${next.scaleX},${next.scaleY})`
  }
  const selected = state.document.items.find((i) => i.id === state.selection)
  return (
    <div
      ref={overlay}
      className="nle-canvas-overlay"
      aria-label="Select and move canvas elements"
      onPointerDown={(event) => {
        if (!state.editable || event.button !== 0 || !overlay.current) return
        const handle =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-canvas-handle]")
            : null
        const layers = activeLayers().reverse()
        const contains = (r: DOMRect) =>
          event.clientX >= r.left &&
          event.clientX <= r.right &&
          event.clientY >= r.top &&
          event.clientY <= r.bottom
        // Match front-to-back preview paint order, regardless of prior selection.
        const chosen = handle
          ? layers.find((layer) => layer.dataset.studioItem === state.selection)
          : (layers.find((layer) => contentRects(layer).some(contains)) ??
            layers[0])
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
        const canvas = overlay.current.getBoundingClientRect()
        const t = item.transform ?? defaultTransform
        const corner = handle?.dataset.canvasHandle ?? ""
        const center = {
          x:
            canvas.left +
            (bounds?.left ?? 0) +
            (bounds?.width ?? canvas.width) / 2,
          y:
            canvas.top +
            (bounds?.top ?? 0) +
            (bounds?.height ?? canvas.height) / 2,
        }
        const rotation = ((bounds?.rotation ?? 0) * Math.PI) / 180
        const anchorX =
          ((bounds?.width ?? 0) / 2) * (corner.includes("w") ? 1 : -1)
        const anchorY =
          ((bounds?.height ?? 0) / 2) * (corner.includes("n") ? 1 : -1)
        drag.current = {
          mode: handle ? (corner === "rotate" ? "rotate" : "scale") : "move",
          center,
          origin: {
            x:
              canvas.left +
              canvas.width / 2 +
              (t.x * canvas.width) / state.document.width,
            y:
              canvas.top +
              canvas.height / 2 +
              (t.y * canvas.width) / state.document.width,
          },
          anchor: {
            x:
              center.x +
              anchorX * Math.cos(rotation) -
              anchorY * Math.sin(rotation),
            y:
              center.y +
              anchorX * Math.sin(rotation) +
              anchorY * Math.cos(rotation),
          },
          next: { ...t },
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
        updateDrag(event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        updateDrag(event.clientX, event.clientY)
        const next = current.next
        const original = current.item.transform ?? defaultTransform
        reset()
        if (JSON.stringify(next) === JSON.stringify(original)) return
        try {
          session.edit((d) => ({
            ...d,
            items: d.items.map((item) =>
              item.id === current.item.id ? { ...item, transform: next } : item,
            ),
          }))
        } catch (error) {
          onError(
            error instanceof Error
              ? error.message
              : "Could not transform element",
          )
        }
      }}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
    >
      {box && selected && (
        <div
          className="nle-canvas-selection"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
          }}
        >
          <span>{itemLabel(selected, state.document)}</span>
          {state.editable && (
            <>
              {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                <button
                  key={corner}
                  type="button"
                  className={`nle-canvas-handle nle-canvas-scale nle-canvas-${corner}`}
                  data-canvas-handle={corner}
                  aria-label={`Scale ${{ nw: "top left", ne: "top right", sw: "bottom left", se: "bottom right" }[corner]}`}
                  onKeyDown={(event) => {
                    const direction =
                      event.key === "ArrowUp" || event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowDown" || event.key === "ArrowLeft"
                          ? -1
                          : 0
                    if (!direction) return
                    event.preventDefault()
                    event.stopPropagation()
                    const t = selected.transform ?? defaultTransform
                    const factor = Math.max(
                      0.01 / Math.min(t.scaleX, t.scaleY),
                      Math.min(
                        100 / Math.max(t.scaleX, t.scaleY),
                        1 + direction * 0.05,
                      ),
                    )
                    try {
                      session.edit((d) => ({
                        ...d,
                        items: d.items.map((i) =>
                          i.id === selected.id
                            ? {
                                ...i,
                                transform: {
                                  ...t,
                                  scaleX: t.scaleX * factor,
                                  scaleY: t.scaleY * factor,
                                },
                              }
                            : i,
                        ),
                      }))
                    } catch (error) {
                      onError(
                        error instanceof Error
                          ? error.message
                          : "Could not scale element",
                      )
                    }
                  }}
                />
              ))}
              <button
                type="button"
                className="nle-canvas-handle nle-canvas-rotate"
                data-canvas-handle="rotate"
                data-inset={box.top < 32 || undefined}
                aria-label="Rotate element"
                style={{ top: box.top < 32 ? 28 : -28 }}
                onKeyDown={(event) => {
                  const direction =
                    event.key === "ArrowRight" || event.key === "ArrowUp"
                      ? 1
                      : event.key === "ArrowLeft" || event.key === "ArrowDown"
                        ? -1
                        : 0
                  if (!direction) return
                  event.preventDefault()
                  event.stopPropagation()
                  const t = selected.transform ?? defaultTransform
                  try {
                    session.edit((d) => ({
                      ...d,
                      items: d.items.map((i) =>
                        i.id === selected.id
                          ? {
                              ...i,
                              transform: {
                                ...t,
                                rotation:
                                  ((((t.rotation +
                                    direction * (event.shiftKey ? 15 : 1) +
                                    180) %
                                    360) +
                                    360) %
                                    360) -
                                  180,
                              },
                            }
                          : i,
                      ),
                    }))
                  } catch (error) {
                    onError(
                      error instanceof Error
                        ? error.message
                        : "Could not rotate element",
                    )
                  }
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
