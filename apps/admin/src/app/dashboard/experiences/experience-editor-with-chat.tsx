"use client"

/**
 * Page-level client wrapper that composes the chat panel (left rail) +
 * the existing ExperienceEditor (right canvas) and bridges them via an
 * imperative `ExperienceCanvasController` published from the editor on
 * mount. The 10k-line editor stays untouched aside from the
 * `onCanvasController` publish hook (see U4 plan).
 */

import { useCallback, useMemo, useRef, useState } from "react"

import { ExperienceEditor } from "@/app/dashboard/experiences/experience-editor"
import type { VideoLibraryItem } from "@/app/dashboard/experiences/experience-editor/block-helpers"
import {
  ExperienceChatPanel,
  type ExperienceCanvasController,
  type ExperienceChatPanelActions,
} from "@/app/dashboard/experiences/experience-editor/experience-chat-panel"
import { getSuggestedPrompts } from "@/app/dashboard/experiences/experience-editor/experience-chat-suggested-prompts"

type ExperienceEditorProps = Parameters<typeof ExperienceEditor>[0]

type ChatGenerateDraftAction = NonNullable<
  Parameters<typeof ExperienceChatPanel>[0]["generateDraftAction"]
>

type ChatGenerateSectionAction = NonNullable<
  Parameters<typeof ExperienceChatPanel>[0]["generateSectionAction"]
>

export type ExperienceEditorWithChatProps = Omit<
  ExperienceEditorProps,
  "onCanvasController" | "videoLibrary"
> & {
  experienceLocaleId: string
  locale: string
  chatActions: ExperienceChatPanelActions
  videoLibrary: VideoLibraryItem[]
  loadVideosByIdsAction: (
    videoIds: readonly string[],
  ) => Promise<VideoLibraryItem[]>
  /**
   * Multi-step draft workflow trigger surfaced as the chat panel's
   * "Generate full page" button. Optional so the editor still renders
   * in environments without the AI surface configured.
   */
  generateDraftAction?: ChatGenerateDraftAction
  /**
   * Video-anchored section generator surfaced as the chat panel's
   * "Generate section from video" control. Optional, like generateDraftAction.
   */
  generateSectionAction?: ChatGenerateSectionAction
}

function collectVideoIdsFromBlocks(blocks: readonly unknown[]): string[] {
  const ids = new Set<string>()
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!node || typeof node !== "object") return
    const record = node as Record<string, unknown>
    const candidate = record.videoId
    if (typeof candidate === "string" && candidate.length > 0) {
      ids.add(candidate)
    }
    for (const value of Object.values(record)) walk(value)
  }
  walk(blocks)
  return Array.from(ids)
}

export function ExperienceEditorWithChat({
  experienceLocaleId,
  locale,
  chatActions,
  videoLibrary: initialVideoLibrary,
  loadVideosByIdsAction,
  generateDraftAction,
  generateSectionAction,
  ...editorProps
}: ExperienceEditorWithChatProps) {
  const controllerRef = useRef<ExperienceCanvasController | null>(null)
  const [canvasHasBlocks, setCanvasHasBlocks] = useState(false)
  const [, forceTick] = useState(0)
  const [videoLibrary, setVideoLibrary] =
    useState<VideoLibraryItem[]>(initialVideoLibrary)
  const inflightVideoIds = useRef<Set<string>>(new Set())

  const hydrateMissingVideos = useCallback(
    (blocks: readonly unknown[]) => {
      const referenced = collectVideoIdsFromBlocks(blocks)
      if (referenced.length === 0) return
      const known = new Set<string>()
      for (const item of videoLibrary) {
        known.add(item.key)
        known.add(item.id)
      }
      const missing = referenced.filter(
        (id) => !known.has(id) && !inflightVideoIds.current.has(id),
      )
      if (missing.length === 0) return
      missing.forEach((id) => inflightVideoIds.current.add(id))
      loadVideosByIdsAction(missing)
        .then((extras) => {
          if (extras.length === 0) return
          setVideoLibrary((current) => {
            const seen = new Set(current.map((item) => item.key))
            const merged = [...current]
            for (const extra of extras) {
              if (!seen.has(extra.key)) {
                merged.push(extra)
                seen.add(extra.key)
              }
            }
            return merged
          })
        })
        .catch(() => {
          // Silent failure — block will fall back to manual title.
        })
        .finally(() => {
          missing.forEach((id) => inflightVideoIds.current.delete(id))
        })
    },
    [loadVideosByIdsAction, videoLibrary],
  )

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
          hydrateMissingVideos(diff.blocks)
        }
      },
      revertDiff: (diff) => {
        controllerRef.current?.revertDiff(diff)
        if (Array.isArray(diff.blocks)) {
          setCanvasHasBlocks(diff.blocks.length > 0)
          hydrateMissingVideos(diff.blocks)
        }
      },
    }),
    [hydrateMissingVideos],
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

  // Stable identity so ExperienceEditor's publish effect (which lists
  // this callback as a dependency) re-fires only when the capture set
  // actually changes — not on every parent render.
  const handleCanvasController = useCallback(
    (controller: ExperienceCanvasController) => {
      controllerRef.current = controller
      const state = controller.getState()
      setCanvasHasBlocks(state.blocks.length > 0)
      hydrateMissingVideos(state.blocks)
      // Trigger a render so children that captured the proxy on
      // first paint can re-read state if they choose to.
      forceTick((n) => n + 1)
    },
    [hydrateMissingVideos],
  )

  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-start">
      <ExperienceChatPanel
        experienceLocaleId={experienceLocaleId}
        locale={locale}
        canvasController={canvasController}
        actions={chatActions}
        suggestedPrompts={suggestedPrompts}
        generateDraftAction={generateDraftAction}
        generateSectionAction={generateSectionAction}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ExperienceEditor
          {...editorProps}
          videoLibrary={videoLibrary}
          onCanvasController={handleCanvasController}
        />
      </div>
    </div>
  )
}
