"use client"

/**
 * Page-level client wrapper that composes the chat panel (left rail) +
 * the existing ExperienceEditor (right canvas) and bridges them via an
 * imperative `ExperienceCanvasController` published from the editor on
 * mount. The 10k-line editor stays untouched aside from the
 * `onCanvasController` publish hook (see U4 plan).
 */

import { useCallback, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"

import type { ExperienceEditor as ExperienceEditorComponent } from "@/app/dashboard/experiences/experience-editor"
import {
  extractAuthoredVideoDubSelectors,
  mergeVideoLibrarySummaries,
  type VideoLibraryItem,
} from "@/app/dashboard/experiences/experience-editor/block-helpers"
import type {
  ExperienceEditorAuthoredDubSelector,
  ExperienceEditorCollectionChildPageActionInput,
  ExperienceEditorDubPageActionInput,
  ExperienceEditorDubSelectionValidationActionInput,
  loadExperienceEditorCollectionChildPage,
  loadExperienceEditorDubPage,
  validateExperienceEditorDubSelections,
} from "@/services/experience-editor-video.service"
import {
  ExperienceChatPanel,
  type ExperienceCanvasController,
  type ExperienceChatPanelActions,
} from "@/app/dashboard/experiences/experience-editor/experience-chat-panel"
import { getSuggestedPrompts } from "@/app/dashboard/experiences/experience-editor/experience-chat-suggested-prompts"
import { PersonaVariantButton } from "@/app/dashboard/experiences/persona-variant-button"
import type { GenerateVariantActionResult } from "@/app/dashboard/experiences/generate-variant-action"

const ExperienceEditor = dynamic(
  () =>
    import("@/app/dashboard/experiences/experience-editor").then(
      (module) => module.ExperienceEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[calc(100vh-3rem)] flex-1 items-center justify-center border-l border-[var(--color-hairline)] bg-[var(--color-surface)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
          Loading editor…
        </div>
      </div>
    ),
  },
)

type ExperienceEditorProps = Parameters<typeof ExperienceEditorComponent>[0]

type ChatGenerateDraftAction = NonNullable<
  Parameters<typeof ExperienceChatPanel>[0]["generateDraftAction"]
>

type ChatGenerateSectionAction = NonNullable<
  Parameters<typeof ExperienceChatPanel>[0]["generateSectionAction"]
>

export type ExperienceEditorWithChatProps = Omit<
  ExperienceEditorProps,
  | "loadVideoCollectionChildrenAction"
  | "onBlocksChange"
  | "onCanvasController"
  | "videoLibrary"
> & {
  experienceLocaleId: string
  locale: string
  chatActions: ExperienceChatPanelActions
  loadVideosByIdsAction: (input: {
    videoIds: readonly string[]
    authoredSelectors: readonly ExperienceEditorAuthoredDubSelector[]
  }) => Promise<VideoLibraryItem[]>
  loadVideoDubPageAction: (
    input: ExperienceEditorDubPageActionInput,
  ) => ReturnType<typeof loadExperienceEditorDubPage>
  loadVideoCollectionChildrenPageAction: (
    input: ExperienceEditorCollectionChildPageActionInput,
  ) => ReturnType<typeof loadExperienceEditorCollectionChildPage>
  validateVideoDubSelectionsAction: (
    input: ExperienceEditorDubSelectionValidationActionInput,
  ) => ReturnType<typeof validateExperienceEditorDubSelections>
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
  /**
   * "Create persona version" — duplicates this experience as a new DRAFT
   * re-toned for a chosen audience persona. Optional; the button only renders
   * when the AI variant surface is wired.
   */
  generateVariantAction?: (input: {
    personaId: string
  }) => Promise<GenerateVariantActionResult>
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

function authoredSelectorIdentity(
  selector: ExperienceEditorAuthoredDubSelector,
) {
  return JSON.stringify([
    selector.videoId,
    selector.languageId,
    selector.legacyStreamingUrl,
  ])
}

export function ExperienceEditorWithChat({
  experienceLocaleId,
  locale,
  chatActions,
  loadVideosByIdsAction,
  loadVideoDubPageAction,
  loadVideoCollectionChildrenPageAction,
  validateVideoDubSelectionsAction,
  searchVideoLibraryAction,
  generateDraftAction,
  generateSectionAction,
  generateVariantAction,
  ...editorProps
}: ExperienceEditorWithChatProps) {
  const controllerRef = useRef<ExperienceCanvasController | null>(null)
  const [canvasHasBlocks, setCanvasHasBlocks] = useState(false)
  const [chatMutationPending, setChatMutationPending] = useState(false)
  const [, forceTick] = useState(0)
  const [videoLibrary, setVideoLibrary] = useState<VideoLibraryItem[]>([])
  const knownVideoIds = useRef<Set<string>>(new Set())
  const inflightVideoIds = useRef<Set<string>>(new Set())
  const knownAuthoredSelectors = useRef<Set<string>>(new Set())
  const inflightAuthoredSelectors = useRef<Set<string>>(new Set())

  const mergeVideoLibraryItems = useCallback((items: VideoLibraryItem[]) => {
    items.forEach((item) => {
      knownVideoIds.current.add(item.key)
      knownVideoIds.current.add(item.id)
    })
    setVideoLibrary((current) => mergeVideoLibrarySummaries(current, items))
  }, [])

  const hydrateMissingVideos = useCallback(
    (blocks: readonly unknown[]) => {
      const referenced = collectVideoIdsFromBlocks(blocks)
      const authoredSelectors = extractAuthoredVideoDubSelectors(blocks)
      if (referenced.length === 0) return
      const missingVideoIds = referenced.filter(
        (id) =>
          !knownVideoIds.current.has(id) && !inflightVideoIds.current.has(id),
      )
      const missingSelectors = authoredSelectors.filter((selector) => {
        const identity = authoredSelectorIdentity(selector)
        return (
          !knownAuthoredSelectors.current.has(identity) &&
          !inflightAuthoredSelectors.current.has(identity)
        )
      })
      const requestedVideoIds = Array.from(
        new Set([
          ...missingVideoIds,
          ...missingSelectors.map((selector) => selector.videoId),
        ]),
      )
      if (requestedVideoIds.length === 0) return
      requestedVideoIds.forEach((id) => inflightVideoIds.current.add(id))
      missingSelectors.forEach((selector) =>
        inflightAuthoredSelectors.current.add(
          authoredSelectorIdentity(selector),
        ),
      )
      const selectorBatches: ExperienceEditorAuthoredDubSelector[][] = []
      for (let index = 0; index < missingSelectors.length; index += 500) {
        selectorBatches.push(missingSelectors.slice(index, index + 500))
      }
      const selectorVideoIds = new Set(
        missingSelectors.map((selector) => selector.videoId),
      )
      const bareVideoIds = missingVideoIds.filter(
        (videoId) => !selectorVideoIds.has(videoId),
      )
      const bareVideoBatches: string[][] = []
      for (let index = 0; index < bareVideoIds.length; index += 500) {
        bareVideoBatches.push(bareVideoIds.slice(index, index + 500))
      }

      void (async () => {
        for (const selectors of selectorBatches) {
          try {
            const extras = await loadVideosByIdsAction({
              videoIds: Array.from(
                new Set(selectors.map((selector) => selector.videoId)),
              ),
              authoredSelectors: selectors,
            })
            mergeVideoLibraryItems(extras)
            selectors.forEach((selector) =>
              knownAuthoredSelectors.current.add(
                authoredSelectorIdentity(selector),
              ),
            )
          } catch {
            // Silent failure — block will fall back to manual title.
          }
        }
        for (const videoIds of bareVideoBatches) {
          try {
            mergeVideoLibraryItems(
              await loadVideosByIdsAction({
                videoIds,
                authoredSelectors: [],
              }),
            )
          } catch {
            // Silent failure — block will fall back to manual title.
          }
        }
      })().finally(() => {
        requestedVideoIds.forEach((id) => inflightVideoIds.current.delete(id))
        missingSelectors.forEach((selector) =>
          inflightAuthoredSelectors.current.delete(
            authoredSelectorIdentity(selector),
          ),
        )
      })
    },
    [loadVideosByIdsAction, mergeVideoLibraryItems],
  )

  const handleSearchVideoLibrary = useCallback(
    async (
      query: string,
      context?: Parameters<NonNullable<typeof searchVideoLibraryAction>>[1],
    ) => {
      if (!searchVideoLibraryAction) return []
      const results = await searchVideoLibraryAction(query, context)
      mergeVideoLibraryItems(results)
      return results
    },
    [mergeVideoLibraryItems, searchVideoLibraryAction],
  )

  const handleLoadVideoCollectionChildrenPage = useCallback(
    async (input: ExperienceEditorCollectionChildPageActionInput) => {
      const page = await loadVideoCollectionChildrenPageAction(input)
      mergeVideoLibraryItems(page.items)
      return page
    },
    [loadVideoCollectionChildrenPageAction, mergeVideoLibraryItems],
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

  const handleBlocksChange = useCallback(
    (blocks: readonly unknown[]) => {
      setCanvasHasBlocks(blocks.length > 0)
      hydrateMissingVideos(blocks)
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
        videoLibrary={videoLibrary}
        generateDraftAction={generateDraftAction}
        generateSectionAction={generateSectionAction}
        onBusyChange={setChatMutationPending}
        utilitySlot={
          generateVariantAction ? (
            <PersonaVariantButton action={generateVariantAction} />
          ) : null
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ExperienceEditor
          {...editorProps}
          duplicatePending={chatMutationPending}
          videoLibrary={videoLibrary}
          onBlocksChange={handleBlocksChange}
          {...{
            loadVideoDubPageAction,
            loadVideoCollectionChildrenPageAction:
              handleLoadVideoCollectionChildrenPage,
            validateVideoDubSelectionsAction,
          }}
          searchVideoLibraryAction={handleSearchVideoLibrary}
          onCanvasController={handleCanvasController}
        />
      </div>
    </div>
  )
}
