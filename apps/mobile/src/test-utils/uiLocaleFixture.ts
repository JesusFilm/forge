// Helpers for suites that change the UI language. Each suite keeps its own
// jest.mock calls (see src/i18n/__tests__/useT.test.tsx); the mock factories
// call these helpers so the fixture wiring stays in one place.

type CatalogIndex = {
  CATALOG_TAGS: readonly string[]
  CATALOG_LOADERS: Record<string, () => object>
}

type PluralIndex = {
  PLURAL_DATA_TAG: Record<string, string>
}

/** The real catalog index plus one fixture catalog per tag. */
export function withFixtureCatalogs<T extends CatalogIndex>(
  actual: T,
  fixtures: Record<string, object>,
): T {
  const loaders = { ...actual.CATALOG_LOADERS }
  for (const [tag, messages] of Object.entries(fixtures)) {
    loaders[tag] = () => messages
  }
  return {
    ...actual,
    CATALOG_TAGS: [...actual.CATALOG_TAGS, ...Object.keys(fixtures)],
    CATALOG_LOADERS: loaders,
  }
}

/** The real plural index, with each fixture tag formatting plurals as English.
 *  No fixture catalog here holds a plural message, and this keeps every plural
 *  data load inside the generated index (catalogIndex.guard.test.js). */
export function withFixturePluralData<T extends PluralIndex>(
  actual: T,
  tags: readonly string[],
): T {
  const dataTags = { ...actual.PLURAL_DATA_TAG }
  for (const tag of tags) dataTags[tag] = "en"
  return { ...actual, PLURAL_DATA_TAG: dataTags }
}

/** The shape `expo-localization`'s `getLocales()` returns, for one tag. */
export function phoneLocales(tag: string): { languageTag: string }[] {
  return [{ languageTag: tag }]
}

type TreeNode = {
  props: Record<string, unknown>
  parent?: TreeNode | null
}

/** The RUM tap-action name, resolved in the order of
 *  `@datadog/mobile-react-native` 3.5 (`DdEventsInterceptor`): the closest
 *  `dd-action-name` up the tree, else the node's accessibility label. */
export function tapActionName(node: TreeNode): unknown {
  for (let n: TreeNode | null | undefined = node; n; n = n.parent) {
    const name = n.props["dd-action-name"]
    if (name) return name
  }
  return node.props.accessibilityLabel
}
