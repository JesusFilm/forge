---
module: apps/web
tags:
  - i18n
  - watch
  - locale
  - routing
  - rtl
  - seo
problem_type: logic-error
component: apps/web/src/lib/locale.ts
---

# Auxiliary-resource coverage is not content identity

**Claim:** when a field's value is known independently, do not gate it on whether
some _auxiliary_ resource for that value happens to exist. Degrade only the
field that actually depends on the missing resource, and keep the independently
known identity intact.

## The shape

Two fields get conflated because one of them has a coverage gap:

```ts
// apps/web/src/lib/locale.ts — before FGE-170 / W-082
const locale = resolveUiLocale(localeSegment) ?? DEFAULT_LOCALE // chrome catalog
const tag = slugToBcp47Tag(localeSegment) // content language — known!
const htmlLang = tag && resolveUiLocale(tag) === locale ? tag : locale
```

`resolveUiLocale` answers "do we have a `messages/*.json` catalog for this?" —
true for 224 of 2,329 public Watch language slugs. `slugToBcp47Tag` answers
"what language is this content in?" — known for essentially all of them, from a
map generated out of admin.

Requiring the two to agree made translation coverage the gate on a language
_declaration_. For ~2,100 slugs the tag was thrown away and every page rendered
`<html lang="en" dir="ltr">`: Najdi Arabic and Pashto pages declared themselves
English and left-to-right, so RTL content rendered in an LTR box and search
engines and screen readers were told the wrong language. Nothing was missing —
the correct value was sitting in a variable one line above.

The fix is to split the concerns: chrome still falls back to English, the
document declares the content language.

## This is a recurring family, not a one-off

Second confirmed instance in this repo:

- **FGE-81** (PR #2168) — a frozen public-language _corpus snapshot_ was used as
  the route authority, so 58 languages admin had already published 404'd as fake
  implicit-English episodes. Fix: the corpus became a fallback, and
  `isWatchAudioLanguageSlug` consults the live route manifest when it misses.
- **FGE-170 / W-082** — the UI _message catalog_ was used as the authority on
  content language. Same shape, different auxiliary resource.

Both times the auxiliary resource was a generated artifact that lags reality,
and both times the failure was silent and confident rather than an error.

## The counter-rule, learned the same day

Splitting the fields is only half of it. Once the gate is gone, the value flows
somewhere it never used to, and **"we have a value" is not the same as "we can
stand behind this value."** Two ways that bit on the very same change:

1. **The generated map contains values that are not valid at all.**
   `hainanese: "nan-CN-46"`, `javanese-banten: "jv-ID-BT"`,
   `huasteco-san-luis-potosi: "hus-MX-SLP"`, `romani-kalderash-western:
"rmy-kal"` — `new Intl.Locale()` throws `RangeError` on every one. The old
   gate had been suppressing them by accident. Removing it would have put an
   unparseable string into `lang`, which is worse than the English fallback.

2. **A deliberately permissive parser will happily answer the wrong question.**
   `slugToBcp47Tag` accepts any `BCP47_TAG_PATTERN`-shaped string so the
   internal `[htmlLang]` route segment can be read back off a URL. That is right
   for route matching and wrong for a declaration: with a stale corpus, the
   public slug `bel` (whose real tag is `gdd`) parses _as_ a tag and
   canonicalizes to Belarusian.

So the widened field needs its own validity predicate — here
`isDeclarableHtmlLangTag`, which requires both "a tag this app knows" and
"parses as BCP-47". Note the asymmetry: the parser is permissive **on purpose**,
so the right place for the check is the declaration site, not the parser.

## And: the same mis-declaration, pointed the other way

Once the content language propagates, audit the routes that render _chrome_
copy. Watch's `/404` and unavailable-language sentinels inherited the requested
identity, so `/unknown.html/aari.html` rewrote to `/en/aiw/404` — English
recovery copy declared as Aari, exactly the bug being fixed, inverted.

The predicate is not "always use the chrome locale" either: a same-language
regional refinement is still honest (`es-419` on Spanish copy is Spanish), and
two pre-existing tests correctly held that line. What must be dropped is a
_different_ language. That is `chromeDocumentLang(locale, htmlLang)` in
`proxy.ts`, and any derived set (`WATCH_ORDINARY_NOT_FOUND_INTERNAL_PATHS`) has
to be built through the same helper or the 404 path stops matching itself.

## How to apply

When a diff removes a gate between two fields:

1. Name what each field independently means, and what resource each actually
   depends on. Gate each on its own dependency only.
2. Ask what the removed gate was _incidentally_ suppressing. Scan the real
   generated data for values that are malformed, not merely missing — a green
   test suite proves nothing here, because the fixtures are hand-picked valid
   ones. (`hainanese` was found by scanning the corpus, not by reading code.)
3. If the value's producer is deliberately permissive, put the validity check at
   the consumer that declares it.
4. Audit the surfaces that render in the _other_ field's language — error pages,
   sentinels, empty states — for the inverted mis-declaration.
5. Distinguish "refinement of the same thing" from "a different thing" before
   reaching for a blanket fallback; a blanket one throws away correct values and
   will break tests that were right.

## Not to be confused with

`docs/solutions/**/language-identity-on-slug-not-bcp47-20260605.md` says a
language _preference_ must be persisted and matched on the slug, not the BCP-47
tag, because tags collide (three Kurdish dialects all carry `kmr`). That governs
identity for matching. This note governs identity for _declaration_, where
BCP-47 is exactly the right vocabulary. They do not conflict — but note the
collision warning still applies: distinct slugs sharing a tag now render an
identical `<html lang>` where both previously collapsed to `en`.
