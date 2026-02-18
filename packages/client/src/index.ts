export * from "./generated/graphql"

export type ContentItem = {
  id: string
  slug: string
  locale: string
  title: string
  body: string
  state: string
}

export async function getContentItem(
  _locale: string,
  _slug: string,
): Promise<ContentItem | null> {
  return null
}
