import { getContentItem } from "@forge/client-ts-web";

export async function readPublishedContent(slug: string, locale: string) {
  return getContentItem(locale, slug);
}
