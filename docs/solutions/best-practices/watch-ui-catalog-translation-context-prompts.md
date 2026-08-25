---
title: "Give UI catalog translation prompts verified screen context"
date: "2026-08-25"
category: "best-practices"
module: "apps/web Watch i18n catalogs"
problem_type: "best_practice"
component: "tooling"
severity: "medium"
applies_when:
  - "Generating or revising Watch UI catalogs with a model"
  - "Translating only selected keys from a catalog namespace"
tags:
  - "watch"
  - "localization"
  - "catalogs"
  - "translation-prompts"
  - "i18n"
---

# Give UI catalog translation prompts verified screen context

## Context

A dotted catalog key and an English value do not reliably describe how text is
used. A model can preserve ICU variables and pass structural validation while
still writing an unnatural action, an ambiguous accessibility label, or a
literal translation of a faith-related phrase.

## Guidance

Keep the translation prompt builder responsible for three kinds of verified
context:

1. Map every top-level catalog namespace to its Watch surface.
2. Keep exceptional roles and runtime compositions in explicit overrides near
   the prompt builder. Use the component's actual rendering behavior, not a
   guess based only on the dotted key.
3. When translating a selected key, include only omitted source messages from
   the same namespace as read-only surrounding context. Do not send unrelated
   namespaces or request the neighboring messages again.

The batch caller supplies the full flattened English catalog as
`sourceMessages`; `surroundingSourceMessages()` then filters it to the
requested namespace. Preserve the existing key, ICU, rich-text, and
script-validation contracts. Context improves wording quality but is not a
replacement for those checks or for native-speaker review.

```js
await requestTranslations({
  messages: selectedMessages,
  sourceMessages: sourceFlat,
  // locale, references, and validated model settings
})
```

Put target-language guidance in two layers: universal instructions describe
native product writing and established Christian terminology; locale-specific
instructions add only rules that truly belong to that language, such as Chinese
script and interface-writing conventions.

## Why This Matters

The Watch catalog validators can prove message shape, placeholder preservation,
and provenance. They cannot prove that a translated sentence fits its screen.
Verified surface and composition context reduce that semantic gap without
changing runtime routing or sending the whole catalog on every scoped request.

## When to Apply

- A catalog key is used in a modal, error state, player control, or
  accessibility-only label where its purpose is not obvious from the source
  text.
- A targeted translation run updates only part of a namespace.
- A locale needs language-specific writing guidance in addition to shared
  localization rules.

## Examples

- `LanguagePickerModal.noSubtitles` needs to read naturally after a runtime
  native language name is appended.
- `ExperienceError.authFailed` must remain an authentication failure, not be
  generalized into a network error.
- A scoped `BibleQuotes` translation receives the other English
  `BibleQuotes` messages for screen context, but not `SearchOverlay` text.

## Related

- `docs/solutions/ui-bugs/machine-translated-ui-catalog-wrong-language-validation-gap.md`
- `docs/roadmap/platform/feat-422-watch-ui-native-context-translation-prompts.md`
