import type { StudioDocument } from "@forge/studio-contracts"
export function previewSignature(document: StudioDocument) {
  const activeVersions = new Set(
    document.items.flatMap((item) =>
      item.kind === "component" ? [item.componentVersionId] : [],
    ),
  )
  return JSON.stringify({
    components: document.components.filter((component) =>
      activeVersions.has(component.versionId),
    ),
    media: document.items
      .filter(
        (i) => i.kind === "video" || i.kind === "image" || i.kind === "audio",
      )
      .map((i) =>
        i.kind === "video"
          ? [i.id, i.source]
          : i.kind === "image" || i.kind === "audio"
            ? [i.id, i.asset]
            : [],
      ),
  })
}
/** Match the entire admitted source, including retained descriptor and subtitle identity. */
export function attachPreparedSources(
  current: StudioDocument,
  requested: StudioDocument,
  prepared: StudioDocument,
): StudioDocument {
  return {
    ...current,
    items: current.items.map((item) => {
      const before = requested.items.find((i) => i.id === item.id),
        after = prepared.items.find((i) => i.id === item.id)
      if (
        item.kind !== "video" ||
        before?.kind !== "video" ||
        after?.kind !== "video" ||
        JSON.stringify(item.source) !== JSON.stringify(before.source)
      )
        return item
      if (
        JSON.stringify({ ...after.source, preview: null, export: null }) !==
        JSON.stringify({ ...before.source, preview: null, export: null })
      )
        return item
      return {
        ...item,
        source: {
          ...item.source,
          preview: after.source.preview,
          export: after.source.export,
        },
      }
    }),
  }
}
