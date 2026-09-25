"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Arrow,
  Group,
  Image as CanvasImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva"
import type Konva from "konva"
import {
  MousePointer2,
  Pencil,
  MoveUpRight,
  SquareDashed,
  Type,
  Square,
  Undo2,
  Redo2,
  Trash2,
} from "lucide-react"

import { deleteMark, moveMark, resizeMark, type Mark } from "@/lib/annotations"
import { createClientId } from "@/lib/clientId"
import { copy, type UiLanguage } from "@/lib/copy"

type Tool = "select" | Mark["type"]
const LOGICAL_WIDTH = 1000

export function ImageAnnotationEditor({
  file,
  initialMarks,
  initialTool,
  variant,
  language,
  onSave,
  onCancel,
}: {
  file: File
  initialMarks: Mark[]
  initialTool?: "draw" | "select"
  variant?: "photo"
  language: UiLanguage
  onSave: (file: File, marks: Mark[]) => Promise<void>
  onCancel: () => void
}) {
  const t = copy[language]
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [marks, setMarks] = useState<Mark[]>(initialMarks)
  const [tool, setTool] = useState<Tool>(
    initialTool ?? (initialMarks.length ? "select" : "draw"),
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [textValue, setTextValue] = useState("")
  const [textPosition, setTextPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const [size, setSize] = useState({ width: 360, height: 320 })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const stage = useRef<Konva.Stage>(null)
  const selectedGroup = useRef<Konva.Group>(null)
  const transformer = useRef<Konva.Transformer>(null)
  const trashButton = useRef<HTMLButtonElement>(null)
  const drawing = useRef(false)
  const current = useRef<Mark[]>(initialMarks)
  const history = useRef<Mark[][]>([initialMarks])
  const historyIndex = useRef(0)
  const [historyState, setHistoryState] = useState({ index: 0, length: 1 })

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const loaded = new window.Image()
    loaded.onload = () => {
      const width = Math.min(window.innerWidth - 30, 680)
      const height = Math.min(window.innerHeight * 0.56, 600)
      const ratio = Math.min(
        width / loaded.naturalWidth,
        height / loaded.naturalHeight,
      )
      setSize({
        width: Math.round(loaded.naturalWidth * ratio),
        height: Math.round(loaded.naturalHeight * ratio),
      })
      setImage(loaded)
    }
    loaded.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const logicalHeight = image
    ? (LOGICAL_WIDTH * image.naturalHeight) / image.naturalWidth
    : LOGICAL_WIDTH
  const scale = size.width / LOGICAL_WIDTH
  const positionTrash = useCallback(() => {
    const group = selectedGroup.current
    const button = trashButton.current
    const canvas = stage.current
    if (!group || !button || !canvas) return
    const box = group.getClientRect({ relativeTo: canvas })
    const preferredLeft = box.x + box.width + 12
    const left =
      preferredLeft + 44 <= size.width ? preferredLeft : Math.max(0, box.x - 56)
    const top =
      box.y >= 50
        ? box.y - 50
        : Math.min(size.height - 44, box.y + box.height + 6)
    button.style.left = `${Math.max(0, left)}px`
    button.style.top = `${Math.max(0, top)}px`
  }, [size.width, size.height])
  useEffect(() => {
    transformer.current?.nodes(
      selectedGroup.current ? [selectedGroup.current] : [],
    )
    transformer.current?.getLayer()?.batchDraw()
    positionTrash()
  }, [selected, marks, positionTrash])
  const update = (next: Mark[]) => {
    current.current = next
    setMarks(next)
  }
  const commit = (next: Mark[]) => {
    update(next)
    history.current = history.current
      .slice(0, historyIndex.current + 1)
      .concat([next])
    historyIndex.current += 1
    setHistoryState({
      index: historyIndex.current,
      length: history.current.length,
    })
  }
  const pointer = () => {
    const position = stage.current?.getPointerPosition()
    return position
      ? { x: position.x / scale, y: position.y / (size.height / logicalHeight) }
      : null
  }
  const down = () => {
    const position = pointer()
    if (!position) return
    if (tool === "select") {
      setSelected(null)
      return
    }
    if (tool === "text") {
      setTextPosition(position)
      return
    }
    setSelected(null)
    drawing.current = true
    update([
      ...current.current,
      {
        id: createClientId(),
        type: tool,
        x: position.x,
        y: position.y,
        width: 0,
        height: 0,
        points: [0, 0, 0, 0],
      },
    ])
  }
  const move = () => {
    if (!drawing.current) return
    const position = pointer()
    const previous = current.current
    const last = previous.at(-1)
    if (!position || !last) return
    const x = position.x - last.x
    const y = position.y - last.y
    update([
      ...previous.slice(0, -1),
      {
        ...last,
        width: x,
        height: y,
        points:
          last.type === "draw" ? [...(last.points ?? []), x, y] : [0, 0, x, y],
      },
    ])
  }
  const up = () => {
    if (drawing.current) {
      drawing.current = false
      commit(current.current)
    }
  }
  const changeHistory = (direction: -1 | 1) => {
    const index = historyIndex.current + direction
    if (index < 0 || index >= history.current.length) return
    historyIndex.current = index
    update(history.current[index])
    setSelected(null)
    setHistoryState({ index, length: history.current.length })
  }
  const save = async () => {
    if (!stage.current || !image || saving) return
    setSaving(true)
    setSaveError(false)
    transformer.current?.hide()
    stage.current.draw()
    try {
      const dataUrl = stage.current.toDataURL({
        pixelRatio: Math.min(2048 / size.width, 6),
        mimeType: "image/jpeg",
        quality: 0.88,
      })
      const blob = await (await fetch(dataUrl)).blob()
      const result = new File(
        [blob],
        `${file.name.replace(/\.[^.]+$/, "")}-marked.jpg`,
        { type: "image/jpeg" },
      )
      await onSave(result, current.current)
    } catch {
      setSaveError(true)
    } finally {
      transformer.current?.show()
      stage.current?.draw()
      setSaving(false)
    }
  }
  const selectedMark = marks.find((mark) => mark.id === selected)
  const toolIcons = {
    select: MousePointer2,
    draw: Pencil,
    arrow: MoveUpRight,
    box: SquareDashed,
    text: Type,
    redact: Square,
  }

  return (
    <div
      className={`editor-backdrop ${variant === "photo" ? "photo-editor" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t.editor}
    >
      <div className="editor-topline">
        <h2>{t.editor}</h2>
        <button
          type="button"
          className="secondary"
          onClick={onCancel}
          disabled={saving}
        >
          {t.cancel}
        </button>
      </div>
      <div className="editor-toolbar">
        {(["select", "draw", "arrow", "box", "text", "redact"] as const).map(
          (name) => {
            const Icon = toolIcons[name]
            return (
              <button
                type="button"
                key={name}
                onClick={() => setTool(name)}
                className={tool === name ? "active" : ""}
                aria-pressed={tool === name}
              >
                {variant === "photo" ? <Icon size={22} /> : null}
                {t[name]}
              </button>
            )
          },
        )}
        <button
          type="button"
          disabled={historyState.index === 0}
          onClick={() => changeHistory(-1)}
        >
          {variant === "photo" ? <Undo2 size={22} /> : null}
          {t.undo}
        </button>
        <button
          type="button"
          disabled={historyState.index >= historyState.length - 1}
          onClick={() => changeHistory(1)}
        >
          {variant === "photo" ? <Redo2 size={22} /> : null}
          {t.redo}
        </button>
      </div>
      <div
        className="editor-area"
        style={{ width: size.width, height: size.height }}
      >
        <Stage
          ref={stage}
          width={size.width}
          height={size.height}
          onMouseDown={down}
          onMouseMove={move}
          onMouseUp={up}
          onTouchStart={down}
          onTouchMove={move}
          onTouchEnd={up}
          onTouchCancel={up}
        >
          <Layer scaleX={scale} scaleY={size.height / logicalHeight}>
            {image ? (
              <CanvasImage
                image={image}
                width={LOGICAL_WIDTH}
                height={logicalHeight}
              />
            ) : null}
            {marks.map((mark) => (
              <Group
                key={mark.id}
                ref={selected === mark.id ? selectedGroup : undefined}
                x={mark.x}
                y={mark.y}
                draggable={tool === "select"}
                onMouseDown={(event) => {
                  event.cancelBubble = true
                  setSelected(mark.id)
                  setTool("select")
                }}
                onTouchStart={(event) => {
                  event.cancelBubble = true
                  setSelected(mark.id)
                  setTool("select")
                }}
                onDragEnd={(event) =>
                  commit(
                    moveMark(
                      current.current,
                      mark.id,
                      event.target.x(),
                      event.target.y(),
                    ),
                  )
                }
                onDragMove={positionTrash}
                onTransform={positionTrash}
                onTransformEnd={(event) => {
                  const node = event.target
                  const next = resizeMark(
                    current.current,
                    mark.id,
                    node.x(),
                    node.y(),
                    node.scaleX(),
                    node.scaleY(),
                  )
                  node.scale({ x: 1, y: 1 })
                  commit(next)
                }}
              >
                {mark.type === "draw" ? (
                  <Line
                    points={mark.points ?? []}
                    stroke="#f53125"
                    strokeWidth={5 / scale}
                    hitStrokeWidth={44 / scale}
                    lineCap="round"
                    lineJoin="round"
                  />
                ) : mark.type === "arrow" ? (
                  <Arrow
                    points={mark.points ?? []}
                    stroke="#f53125"
                    fill="#f53125"
                    strokeWidth={4 / scale}
                    hitStrokeWidth={44 / scale}
                    pointerLength={14 / scale}
                    pointerWidth={14 / scale}
                  />
                ) : mark.type === "text" ? (
                  <Text
                    text={mark.label}
                    fontSize={mark.fontSize ?? 28 / scale}
                    fontStyle="bold"
                    fill="#ffffff"
                    shadowColor="#000000"
                    shadowBlur={4 / scale}
                  />
                ) : (
                  <Rect
                    x={Math.min(0, mark.width ?? 0)}
                    y={Math.min(0, mark.height ?? 0)}
                    width={Math.abs(mark.width ?? 0)}
                    height={Math.abs(mark.height ?? 0)}
                    stroke={mark.type === "box" ? "#f53125" : undefined}
                    strokeWidth={5 / scale}
                    hitStrokeWidth={44 / scale}
                    fill={
                      mark.type === "redact" ? "#000000" : "rgba(0,0,0,0.001)"
                    }
                  />
                )}
              </Group>
            ))}
            <Transformer
              ref={transformer}
              rotateEnabled={false}
              enabledAnchors={[
                "top-left",
                "top-right",
                "bottom-left",
                "bottom-right",
              ]}
              borderStroke="#fff"
              borderDash={[7, 5]}
              anchorFill="#fff"
              anchorStroke="#f42c3e"
              anchorSize={16}
              anchorCornerRadius={8}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 25 || newBox.height < 25 ? oldBox : newBox
              }
              onMouseDown={(event) => {
                event.cancelBubble = true
              }}
              onTouchStart={(event) => {
                event.cancelBubble = true
              }}
            />
          </Layer>
        </Stage>
        {selected ? (
          <button
            ref={trashButton}
            type="button"
            className="editor-bin"
            aria-label={t.deleteMark}
            title={t.deleteMark}
            onClick={() => {
              commit(deleteMark(current.current, selected))
              setSelected(null)
            }}
          >
            <Trash2 size={22} />
          </button>
        ) : null}
      </div>
      {selected ? (
        <div className="editor-selection">
          <span>
            {selectedMark
              ? `${t[selectedMark.type]} · ${t.selectedMark}`
              : t.selectedMark}
          </span>
          <small>{t.moveHint}</small>
        </div>
      ) : null}
      {textPosition ? (
        <div className="editor-text">
          <textarea
            className="field"
            aria-label={t.textPrompt}
            value={textValue}
            onChange={(event) => setTextValue(event.target.value)}
            maxLength={120}
            placeholder={t.textPrompt}
          />
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (textValue.trim())
                commit([
                  ...current.current,
                  {
                    id: createClientId(),
                    type: "text",
                    x: textPosition.x,
                    y: textPosition.y,
                    label: textValue.trim(),
                    fontSize: 28 / scale,
                  },
                ])
              setTextValue("")
              setTextPosition(null)
            }}
          >
            {t.addText}
          </button>
        </div>
      ) : null}
      {saveError ? (
        <p className="error-text" role="alert">
          {t.error}
        </p>
      ) : null}
      <div className="editor-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void save()}
          disabled={!image || saving}
        >
          {saving ? t.sending : t.save}
        </button>
      </div>
    </div>
  )
}
