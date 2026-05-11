"use client"

/**
 * Page-level client wrapper that composes the chat panel (left rail) +
 * the existing ExperienceEditor (right canvas) and bridges them via an
 * imperative `ExperienceCanvasController` published from the editor on
 * mount. The 10k-line editor stays untouched aside from the
 * `onCanvasController` publish hook (see U4 plan).
 */

import { useMemo, useRef, useState } from "react"

import { ExperienceEditor } from "@/app/dashboard/experiences/experience-editor"
import {
  ExperienceChatPanel,
  type ExperienceCanvasController,
  type ExperienceChatPanelActions,
} from "@/app/dashboard/experiences/experience-editor/experience-chat-panel"
import { getSuggestedPrompts } from "@/app/dashboard/experiences/experience-editor/experience-chat-suggested-prompts"

type ExperienceEditorProps = Parameters<typeof ExperienceEditor>[0]

export type ExperienceEditorWithChatProps = Omit<
  ExperienceEditorProps,
  "onCanvasController"
> & {
  experienceLocaleId: string
  locale: string
  chatActions: ExperienceChatPanelActions
}

export function ExperienceEditorWithChat({
  experienceLocaleId,
  locale,
  chatActions,
  ...editorProps
}: ExperienceEditorWithChatProps) {
  const controllerRef = useRef<ExperienceCanvasController | null>(null)
  const [canvasHasBlocks, setCanvasHasBlocks] = useState(false)
  const [, forceTick] = useState(0)

  // Stable proxy controller — the panel sees a single object whose
  // methods always delegate to whatever the editor most recently
  // published. Re-mounting the editor (via the parent `key`) replaces
  // the underlying controller without breaking the panel's reference.
  const canvasController = useMemo<ExperienceCanvasController>(
    () => ({
      getState: () =>
        controllerRef.current?.getState() ?? {
          title: "",
          metaDescription: null,
          ogImageUrl: null,
          blocks: [],
        },
      applyDiff: (diff) => {
        controllerRef.current?.applyDiff(diff)
        if (Array.isArray(diff.blocks)) {
          setCanvasHasBlocks(diff.blocks.length > 0)
        }
      },
      revertDiff: (diff) => {
        controllerRef.current?.revertDiff(diff)
        if (Array.isArray(diff.blocks)) {
          setCanvasHasBlocks(diff.blocks.length > 0)
        }
      },
    }),
    [],
  )

  // Re-derive suggested prompts only when canvas occupancy or locale flips.
  const suggestedPrompts = useMemo(
    () =>
      getSuggestedPrompts({
        canvasState: canvasHasBlocks ? "populated" : "empty",
        locale,
      }),
    [canvasHasBlocks, locale],
  )

  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-start">
      <ExperienceChatPanel
        experienceLocaleId={experienceLocaleId}
        locale={locale}
        canvasController={canvasController}
        actions={chatActions}
        suggestedPrompts={suggestedPrompts}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ExperienceEditor
          {...editorProps}
          onCanvasController={(controller) => {
            controllerRef.current = controller
            setCanvasHasBlocks(controller.getState().blocks.length > 0)
            // Trigger a render so children that captured the proxy on
            // first paint can re-read state if they choose to.
            forceTick((n) => n + 1)
          }}
        />
      </div>
    </div>
  )
}
