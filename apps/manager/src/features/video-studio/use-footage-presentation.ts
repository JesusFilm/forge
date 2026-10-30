import { useEffect, useRef, useState } from "react"
import type { StudioDocument } from "@forge/studio-contracts"
import { footageKey, type FootagePresentation } from "./footage-presentation"

export function useFootagePresentation(
  projectId: string | undefined,
  document: StudioDocument,
) {
  const [presentations, setPresentations] = useState<
    Record<string, FootagePresentation>
  >({})
  const latest = useRef(document)
  useEffect(() => {
    latest.current = document
  }, [document])
  const signature = JSON.stringify(
    [
      ...new Set(
        document.items.flatMap((item) =>
          item.kind === "video" ? [footageKey(item)] : [],
        ),
      ),
    ].sort(),
  )
  useEffect(() => {
    if (!projectId || signature === "[]") return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const load = () => {
      timer = setTimeout(() => {
        void fetch("/api/shorts/footage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, document: latest.current }),
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) return
            const value = (await response.json()) as Record<
              string,
              FootagePresentation
            >
            if (!controller.signal.aborted) setPresentations(value)
          })
          .catch(() => {
            /* Keep source identities visible if artwork is unavailable. */
          })
      }, 200)
    }
    // Filmstrips never compete with the initial page's load resources.
    if (window.document.readyState === "complete") load()
    else window.addEventListener("load", load, { once: true })
    return () => {
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener("load", load)
    }
  }, [projectId, signature])
  return presentations
}
