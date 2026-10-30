"use client"

import { useEffect, useRef, useState } from "react"
import type { EditorSession, EditorSnapshot } from "./editor-session"
import { NumberField } from "./number-field"

export function ProjectSettings({
  session,
  state,
  onClose,
}: {
  session: EditorSession
  state: EditorSnapshot
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(state.document.title)
  const [width, setWidth] = useState(state.document.width)
  const [height, setHeight] = useState(state.document.height)
  const [error, setError] = useState("")
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="nle-dialog nle-project-settings"
      aria-labelledby="nle-project-settings-title"
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!state.editable) return
          if (!title.trim()) {
            setError("Enter a project title")
            return
          }
          try {
            session.edit((document) => ({
              ...document,
              title: title.trim(),
              width,
              height,
            }))
            onClose()
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Invalid project settings",
            )
          }
        }}
      >
        <header>
          <h2 id="nle-project-settings-title">Project settings</h2>
        </header>
        <fieldset disabled={!state.editable}>
          <label>
            Title
            <input
              value={title}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="nle-row">
            <NumberField
              label="Width"
              unit="px"
              value={width}
              min={16}
              max={7680}
              onChange={setWidth}
            />
            <NumberField
              label="Height"
              unit="px"
              value={height}
              min={16}
              max={7680}
              onChange={setHeight}
            />
          </div>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="nle-primary"
            disabled={!state.editable}
          >
            Apply
          </button>
        </footer>
      </form>
    </dialog>
  )
}
