import { print, type SelectionSetNode } from "graphql"
import { describe, expect, it } from "vitest"

import { previewMediaCollectionTitlesFragment } from "@/lib/fragments/preview-media-collection-titles"
import { watchMediaCollectionTitlesFragment } from "@/lib/fragments/watch-media-collection-titles"

// Mirrors the published-path collector in watch-experience.test.ts. It keys on
// the RESPONSE name (alias when present) because that is what reaches
// enrichMediaItem — the preview overlay deliberately aliases a differently
// named Admin field onto `resolvedTitle`.
function collectTitlePaths(
  selectionSet: SelectionSetNode,
  parentPath: string[] = [],
): string[] {
  return selectionSet.selections.flatMap((selection) => {
    if (selection.kind === "FragmentSpread") return []

    if (selection.kind === "InlineFragment") {
      const typeName = selection.typeCondition?.name.value
      return collectTitlePaths(
        selection.selectionSet,
        typeName == null ? parentPath : [...parentPath, typeName],
      )
    }

    const responseName = selection.alias?.value ?? selection.name.value
    const fieldPath = [...parentPath, responseName]

    if (responseName === "resolvedTitle") return [fieldPath.join(".")]

    return selection.selectionSet == null
      ? []
      : collectTitlePaths(selection.selectionSet, fieldPath)
  })
}

describe("Web Experience preview media collection titles", () => {
  it("selects a title through every supported collection nesting path", () => {
    const definition = previewMediaCollectionTitlesFragment.definitions.find(
      (candidate) => candidate.kind === "FragmentDefinition",
    )

    expect(definition?.kind).toBe("FragmentDefinition")
    if (definition?.kind !== "FragmentDefinition") return

    expect(collectTitlePaths(definition.selectionSet)).toEqual([
      "blocks.MediaCollectionBlock.items.resolvedTitle",
      "blocks.ContainerBlock.content.MediaCollectionBlock.items.resolvedTitle",
      "blocks.SectionBlock.sectionContent.MediaCollectionBlock.items.resolvedTitle",
      "blocks.SectionBlock.sectionContent.ContainerBlock.content.MediaCollectionBlock.items.resolvedTitle",
    ])
  })

  it("covers exactly the nesting paths the published overlay covers", () => {
    const previewDefinition =
      previewMediaCollectionTitlesFragment.definitions.find(
        (candidate) => candidate.kind === "FragmentDefinition",
      )
    const publishedDefinition =
      watchMediaCollectionTitlesFragment.definitions.find(
        (candidate) => candidate.kind === "FragmentDefinition",
      )

    if (
      previewDefinition?.kind !== "FragmentDefinition" ||
      publishedDefinition?.kind !== "FragmentDefinition"
    ) {
      throw new Error("expected both overlays to be fragment definitions")
    }

    expect(collectTitlePaths(previewDefinition.selectionSet)).toEqual(
      collectTitlePaths(publishedDefinition.selectionSet),
    )
  })

  it("reads the preview-scoped field under the resolvedTitle alias", () => {
    const source = print(previewMediaCollectionTitlesFragment)

    // The alias is load-bearing: enrichMediaItem reads `resolvedTitle`, so
    // dropping it delivers the title under a name nothing consumes.
    expect(source).toContain("resolvedTitle: previewResolvedTitle")
    expect(source).not.toMatch(/previewResolvedTitle\s*\(/)
  })

  it("attaches to ExperiencePreview, not the published ExperienceLocale", () => {
    const source = print(previewMediaCollectionTitlesFragment)

    expect(source).toContain("on ExperiencePreview")
    expect(print(watchMediaCollectionTitlesFragment)).toContain(
      "on ExperienceLocale",
    )
  })

  it("passes no arguments, so no caller can choose the preview locale", () => {
    const source = print(previewMediaCollectionTitlesFragment)

    expect(source).not.toContain("$locale")
    expect(source).not.toContain("locale:")
  })
})
