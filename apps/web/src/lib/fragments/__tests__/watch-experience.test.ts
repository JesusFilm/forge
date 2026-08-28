import { print, type SelectionSetNode } from "graphql"
import { describe, expect, it } from "vitest"

import {
  adminLegacyWatchExperienceFragment,
  adminWatchExperienceFragment,
} from "@forge/admin-graphql/fragments"

import {
  legacyWatchExperienceFragment,
  watchExperienceFragment,
} from "@/lib/fragments/watch-experience"
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
  it("keeps the legacy compatibility fragment identical except for the category rail", () => {
    const currentDefinition = adminWatchExperienceFragment.definitions.find(
      (candidate) => candidate.kind === "FragmentDefinition",
    )
    const legacyDefinition =
      adminLegacyWatchExperienceFragment.definitions.find(
        (candidate) => candidate.kind === "FragmentDefinition",
      )

    expect(currentDefinition?.kind).toBe("FragmentDefinition")
    expect(legacyDefinition?.kind).toBe("FragmentDefinition")
    if (
      currentDefinition?.kind !== "FragmentDefinition" ||
      legacyDefinition?.kind !== "FragmentDefinition"
    ) {
      return
    }

    const stripCategoryRail = (selectionSet: SelectionSetNode) => ({
      ...selectionSet,
      selections: selectionSet.selections.map((selection) => {
        if (selection.kind !== "Field" || selection.name.value !== "blocks") {
          return selection
        }
        return {
          ...selection,
          selectionSet: {
            ...selection.selectionSet,
            selections: selection.selectionSet?.selections.filter(
              (blockSelection) =>
                blockSelection.kind !== "InlineFragment" ||
                blockSelection.typeCondition?.name.value !==
                  "WatchHomeCategoryRailBlock",
            ),
          },
        }
      }),
    })

    expect(stripCategoryRail(currentDefinition.selectionSet)).toEqual(
      legacyDefinition.selectionSet,
    )
    expect(print(adminWatchExperienceFragment)).toContain(
      "WatchHomeCategoryRailBlock",
    )
    expect(print(adminWatchExperienceFragment)).toContain("categoryIds")
    expect(print(adminLegacyWatchExperienceFragment)).not.toContain(
      "WatchHomeCategoryRailBlock",
    )
    expect(print(adminLegacyWatchExperienceFragment)).not.toContain(
      "AdminWatchHomeCategoryRail",
    )
  })

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

  it("keeps resolved titles in Web's old-schema compatibility projection", () => {
    const source = print(legacyWatchExperienceFragment)

    expect(source).toContain("...AdminLegacyWatchExperience")
    expect(source).toContain("...WatchMediaCollectionTitles")
    expect(source).not.toContain("WatchHomeCategoryRailBlock")
  })
})
