import { declaredLanguageAttributes } from "@/lib/language-native-name"

/**
 * A language name in its own language. `lang` is only declared when it is a
 * verified declarable tag (script preserved); `dir` follows that tag. Untagged
 * text still gets `<bdi>` so an RTL name cannot reorder its neighbours.
 *
 * Not for `<option>` content: options take text only, so a mixed option label
 * uses `isolateLanguageName` instead.
 */
export function NativeLanguageName({
  text,
  lang,
}: {
  text: string
  lang?: string | null
}) {
  const declared = declaredLanguageAttributes(lang)
  return (
    <bdi lang={declared?.lang} dir={declared?.dir}>
      {text}
    </bdi>
  )
}

/**
 * The primary (English) language name. Isolated and declared `en`/`ltr` only
 * when the producer proved it is English, so an RTL UI (ar, he) cannot reorder
 * it or read it with the wrong voice; otherwise plain text.
 */
export function PrimaryLanguageName({
  text,
  lang,
}: {
  text: string
  lang?: "en"
}) {
  if (lang !== "en") return <>{text}</>
  return (
    <bdi lang="en" dir="ltr">
      {text}
    </bdi>
  )
}
