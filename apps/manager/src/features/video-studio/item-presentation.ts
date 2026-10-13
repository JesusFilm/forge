import type {
  StudioDocument,
  StudioTimelineItem,
} from "@forge/studio-contracts"

export function itemLabel(item: StudioTimelineItem, document?: StudioDocument) {
  if (item.kind === "text") return item.text || "Text"
  if (item.kind === "component") {
    const component = document?.components.find(
      (c) => c.versionId === item.componentVersionId,
    )
    return component?.name || item.componentVersionId
  }
  return item.kind === "video"
    ? "Source footage"
    : item.kind === "audio"
      ? "Audio"
      : "Image"
}
export function isTextComponent(
  item: StudioTimelineItem,
  document?: StudioDocument,
) {
  if (item.kind !== "component") return false
  const component = document?.components.find(
    (c) => c.versionId === item.componentVersionId,
  )
  if (component?.category) return component.category === "text"
  if (
    /caption|subtitle|credit|title|lower[-_ ]?third|(?:^|[-_ ])text(?:$|[-_ ])/i.test(
      component?.name ?? item.componentVersionId,
    )
  )
    return true
  return Boolean(
    component &&
    Object.values(component.controls).some(
      (control) => control.type === "text",
    ),
  )
}
