---
title: "feat: Add native English titles to localized Watch inventories"
type: feat
status: complete
date: 2026-08-05
last_updated: 2026-08-06
---

# Add native English titles to localized Watch inventories

## Summary

Add concise English HTML `title` attributes to localized Watch language
inventory controls and important labels. English-speaking ministry users get
basic browser-native hover guidance while seekers continue to see localized
labels, routes, content titles, and accessible names.

The first implementation included a custom hover/focus tooltip and an `EN` help
dialog. Visual review rejected both surfaces on 2026-08-06. The shipped design
uses native HTML titles only.

## Requirements

- R1. Keep visible interface text, content titles, routes, and primary
  accessible names in the selected locale.
- R2. Give inventory-owned interactive controls and important labels concise
  English `title` text.
- R3. Use the browser's default HTML title behavior; do not render a custom
  tooltip, popup, dialog, or persistent English help trigger.
- R4. Do not intercept pointer, keyboard, or touch events for English help.
- R5. Preserve the inventory read model, localized message catalogs, URL
  contracts, media availability, and language picker behavior.
- R6. Add no data requests, event controller, client overlay, or hydrated
  assistance root.

## Product Decision

Localized pages remain the source of truth for the primary seeker audience.
The English layer is deliberately lightweight and browser-owned:

```tsx
<Link href={localizedRoute} aria-label={localizedTitle} title="Open video">
  {localizedContent}
</Link>
```

Native `title` behavior varies by browser and is not a replacement for localized
accessible names. That limitation is accepted in exchange for avoiding custom
English UI, client-side overlays, and touch interaction changes.

## Native Title Contract

| Page element or state             | English title                                |
| --------------------------------- | -------------------------------------------- |
| Language collection selector      | Choose a language collection                 |
| New section shortcut              | Go to new releases                           |
| Video Bible section shortcut      | Go to Video Bible                            |
| BibleProject section shortcut     | Go to BibleProject                           |
| Sports section shortcut           | Go to sports videos                          |
| Collections section shortcut      | Go to collections                            |
| Subtitles-only section shortcut   | Go to subtitles-only videos                  |
| Previous / next carousel controls | Show the previous / next section             |
| Linked video card or compact row  | Open video                                   |
| Linked collection card or action  | Open collection                              |
| New badge                         | Recently added in this language              |
| Audio availability                | Dubbed audio is available                    |
| Subtitle availability             | Subtitles are available                      |
| Subtitles-only status             | Subtitles are available without dubbed audio |
| Newest-first label                | Videos are ordered from newest to oldest     |

## Scope Boundaries

In scope are the inventory language switcher, section shortcuts, carousel
navigation, video and collection links, compact rows, collection actions,
availability indicators, and section labels.

Out of scope are translated English content titles, a locale toggle, Admin or
GraphQL changes, global navigation, player controls, shared Watch home sections,
the existing multilingual player language picker, custom tooltips, and an
English guide dialog.

## Implementation

1. Keep the typed English copy dictionary under
   `apps/web/src/components/watch-language-inventory/english-assist.ts`, with a
   helper that returns only `{ title }`.
2. Apply the helper to routable inventory cards, section navigation, carousel
   controls, important status labels, and the real language combobox trigger.
3. Do not annotate static cards as actions and do not add focus stops to
   noninteractive labels.
4. Keep localized `aria-label` values, text, callbacks, and hrefs unchanged.
5. Cover the contract in the inventory page and language collection switcher
   tests, including the absence of custom overlay hooks.

## Acceptance Examples

- AE1. A Malagasy video link keeps its Malagasy visible and accessible name and
  exposes `title="Open video"`.
- AE2. The language selector keeps its localized accessible name and exposes
  `title="Choose a language collection"`.
- AE3. The page contains no `EN` guide trigger, tooltip role,
  `data-english-assist` hook, or custom tooltip controller.
- AE4. Activating videos, collections, selectors, and section shortcuts behaves
  exactly as before because no help event handler is installed.
- AE5. Assistance performs no Admin, GraphQL, fetch, or XHR request.

## Verification

- Focused inventory page and language collection switcher tests pass.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`
- Browser smoke a representative localized inventory and confirm native title
  attributes are present while custom tooltips and the guide dialog are absent.
- Confirm localized names and routes remain unchanged and no assistance request
  or client root is added.

## Sources

- `CONCEPTS.md` — Watch Language Inventory domain contract.
- `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
- `apps/web/src/components/watch-language-inventory/LanguageCollectionSwitcher.tsx`
- [WHATWG `title` attribute](https://html.spec.whatwg.org/multipage/dom.html#the-title-attribute)
