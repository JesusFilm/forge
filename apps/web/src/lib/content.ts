import { getContentItem } from "@forge/client"

export async function readPublishedContent(slug: string, locale: string) {
  return getContentItem(locale, slug)
}
