import { print, type SelectionSetNode } from "graphql"
import { describe, expect, it } from "vitest"

import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"

import { watchExperienceFragment } from "@/lib/fragments/watch-experience"
import { watchMediaCollectionTitlesFragment } from "@/lib/fragments/watch-media-collection-titles"

function collectResolvedTitlePaths(
  selectionSet: SelectionSetNode,
  parentPath: string[] = [],
): string[] {
  return selectionSet.selections.flatMap((selection) => {
    if (selection.kind === "FragmentSpread") return []

    if (selection.kind === "InlineFragment") {
      const typeName = selection.typeCondition?.name.value
      return collectResolvedTitlePaths(
        selection.selectionSet,
        typeName == null ? parentPath : [...parentPath, typeName],
      )
    }

    const fieldName = selection.alias?.value ?? selection.name.value
    const fieldPath = [...parentPath, fieldName]

    if (selection.name.value === "resolvedTitle") {
      return [fieldPath.join(".")]
    }

    return selection.selectionSet == null
      ? []
      : collectResolvedTitlePaths(selection.selectionSet, fieldPath)
  })
}

describe("Web Watch Experience media collection titles", () => {
  it("selects resolvedTitle through every supported collection nesting path", () => {
    const definition = watchMediaCollectionTitlesFragment.definitions.find(
      (candidate) => candidate.kind === "FragmentDefinition",
    )

    expect(definition?.kind).toBe("FragmentDefinition")
    if (definition?.kind !== "FragmentDefinition") return

    expect(collectResolvedTitlePaths(definition.selectionSet)).toEqual([
      "blocks.MediaCollectionBlock.items.resolvedTitle",
      "blocks.ContainerBlock.content.MediaCollectionBlock.items.resolvedTitle",
      "blocks.SectionBlock.sectionContent.MediaCollectionBlock.items.resolvedTitle",
      "blocks.SectionBlock.sectionContent.ContainerBlock.content.MediaCollectionBlock.items.resolvedTitle",
    ])
    expect(print(watchMediaCollectionTitlesFragment)).toMatch(
      /resolvedTitle\(locale:\s*\$locale\)/,
    )
  })

  it("composes the Web extension without changing the canonical fragment", () => {
    expect(print(watchExperienceFragment)).toContain(
      "...WatchMediaCollectionTitles",
    )
    expect(print(adminWatchExperienceFragment)).not.toContain("resolvedTitle")
  })
})
