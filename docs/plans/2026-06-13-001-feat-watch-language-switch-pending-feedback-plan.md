---
title: "feat: Add Watch language switch pending feedback"
status: completed
origin: docs/roadmap/topic-experiences/feat-107-watch-language-switch-pending-feedback.md
created: 2026-06-13
---

# feat: Add Watch Language Switch Pending Feedback

## Problem Frame

Changing language on Watch can trigger a slow App Router navigation because the destination language route may need cold server rendering and admin-backed video data. The current modal closes immediately after Apply, so the user sees the unchanged page for several seconds with no progress state.

Live triage on 2026-06-13 showed the shape of the delay:

- Warm language routes can return in under a second.
- Cold per-language routes can take roughly 15 seconds before first byte.
- The worst observed bottleneck is the admin-backed Watch video route/data work on a cold destination, not the local button handler.

The fastest user-visible fix is to keep the language modal open and clearly pending while the existing navigation resolves. Selective prefetch can reduce some warm-path latency, but it should be treated as a best-effort improvement, not the primary correctness fix.

## Scope Boundaries

### In scope

- Keep `LanguagePickerModal` open after Apply when `languageDirty` is true.
- Show pending Apply state as `Switching...` with a spinner or equivalent progress affordance.
- Disable duplicate Apply submits during pending navigation.
- Clear pending state when the route resolves to the selected language or when the existing safety timeout fires.
- Add selective `router.prefetch` for the draft destination language route.
- Add focused tests for pending state, duplicate-submit prevention, timeout recovery, and prefetch behavior.

### Out of scope

- Changing admin GraphQL operations or generated gql.tada outputs.
- Refactoring Watch route resolution or splitting video/experience data paths.
- Adding a global Watch page loading overlay.
- Changing route shape, language slug aliases, or cookie semantics.
- Reworking subtitle controls beyond preserving existing behavior.

### Follow-up candidates

- Add a true video-first route path or typed route discriminator to avoid unnecessary experience resolution on video pages.
- Split the large `videoBySlug` payload so language switches fetch only what the player needs first.
- Pre-warm or cache high-traffic language route combinations after deploys.

## Requirements

- **R1. Pending visibility:** When Apply is clicked with a dirty language selection, the modal remains open until the destination language is reflected in props or the navigation timeout fires.
- **R2. Button state:** While pending, Apply is disabled, displays `Switching...`, and shows a non-layout-shifting spinner/status indicator.
- **R3. Duplicate guard:** Repeated Apply clicks during pending navigation do not rewrite cookies or call `router.push` again.
- **R4. Timeout recovery:** If the route does not resolve, the existing safety timeout releases the pending state and lets the user retry or close.
- **R5. Preference ordering:** `writePreferredLanguageSlug` still runs before `router.push`.
- **R6. Non-language changes:** Applying subtitle-only or other non-route-changing dirty state keeps the current close behavior.
- **R7. Selective prefetch:** A changed, valid draft language prefetches exactly its target Watch route and suppresses duplicate or invalid prefetches.
- **R8. Prefetch failure safety:** `router.prefetch` errors never surface in the UI or block Apply.

## Key Technical Decisions

### Pending state should live in the modal

`LanguagePickerModal` already owns `pendingNavTo`, the navigation in-flight ref, and `NAVIGATING_TIMEOUT_MS`. Keeping the behavior there avoids introducing a global Watch loading state and keeps the fix scoped to the control that feels broken.

### Route resolution should be detected by props

The modal receives `currentLanguageSlug` from the current Watch route. Treat `pendingNavTo !== null && currentLanguageSlug !== pendingNavTo` as pending, and clear the pending state when `currentLanguageSlug` catches up. This matches the existing state shape and avoids trying to subscribe to App Router internals.

### Do not close the modal after route-changing Apply

For a dirty language change, `handleApply` should write the preference cookie, set pending state, push the canonical route, and return without calling `onClose`. For non-route-changing changes, preserve the current close-on-Apply behavior.

### Prefetch only the selected target route

Prefetching every language option would create avoidable server and cache pressure. Prefetch should run only for the valid draft language target, should dedupe the last target path, and should treat failures as no-ops.

## Implementation Units

### U1. Keep modal open and show pending Apply state

**Goal:** Make language switching visibly in progress instead of closing the modal onto an unchanged page.

**Requirements:** R1, R2, R3, R4, R5, R6

**Dependencies:** None

**Files:**

- `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`

**Approach:**

In `handleApply`, keep the existing language-dirty branch order:

1. Validate the selected target language.
2. Set `navigatingRef.current.inFlight = true`.
3. Set `pendingNavTo` to the selected language slug.
4. Call `writePreferredLanguageSlug`.
5. Call `router.push(watchVideoPath(...))`.

Then return without calling `onClose` for the language-dirty route transition. Keep `onClose` for branches that apply local-only settings without route navigation.

Update the Apply button so pending navigation renders:

- disabled state unchanged
- visible label `Switching...`
- spinner/status icon that does not resize the button
- accessible pending text via the button label or an adjacent `aria-live` status if needed

Keep the existing safety timeout and ensure it clears `pendingNavTo` and the in-flight ref.

**Test scenarios:**

- Dirty language Apply writes the cookie, calls `router.push`, and does not call `onClose` immediately.
- Apply button displays `Switching...` while pending.
- Double-clicking Apply while pending calls `router.push` once.
- Updating `currentLanguageSlug` to the pending target clears the pending state.
- Firing the safety timeout clears the pending state and allows retry.
- Subtitle-only Apply, if dirty without language change, preserves current close behavior.

**Verification:**

- `pnpm --filter web test -- LanguagePickerModal.test.tsx`
- `pnpm --filter web typecheck`

### U2. Add selective draft-language prefetch

**Goal:** Reduce avoidable latency when the user pauses on a target language before applying.

**Requirements:** R7, R8

**Dependencies:** U1 can land independently; U2 should reuse the same route-builder inputs.

**Files:**

- `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`

**Approach:**

Add a client-side effect that runs when the modal is open and the draft language changes. If the draft language differs from `currentLanguageSlug`, resolve its `WatchVariant`, build the destination with `watchVideoPath`, and call `router.prefetch(targetPath)`.

Guardrails:

- Skip if the modal is closed.
- Skip if the draft slug equals `currentLanguageSlug`.
- Skip if the draft slug cannot resolve to a variant/language.
- Store the last prefetched path in a ref and skip repeats.
- Wrap prefetch in `try/catch` or `Promise.resolve(...).catch(() => undefined)` so failure is silent.

**Test scenarios:**

- Selecting a different valid language calls `router.prefetch` with the same target path Apply will push.
- Re-selecting the same target does not prefetch twice.
- Selecting the current language does not prefetch.
- Invalid target language does not prefetch.
- Rejected prefetch promise does not throw into the component.

**Verification:**

- `pnpm --filter web test -- LanguagePickerModal.test.tsx`
- `pnpm --filter web typecheck`

### U3. Browser smoke and regression check

**Goal:** Prove the change fixes the perceived-broken state on an actual Watch page.

**Requirements:** R1, R2, R3, R4, R7

**Dependencies:** U1, U2

**Files:**

- No new production files beyond U1/U2.

**Approach:**

Use Helium browser against a local web server or a preview deploy. Navigate to a Watch video route, open the language modal, pick a different audio language, and click Apply.

Confirm:

- The modal remains open after Apply.
- Apply shows `Switching...` while navigation is pending.
- A second click does not trigger repeated navigation.
- The modal recovers if the safety timeout fires.
- On successful route resolution, the pending state clears and the selected language is reflected.

If browser proof uses production data, keep the interaction read-only except for the local language preference cookie.

**Verification:**

- Helium screenshot or snapshot showing the pending state.
- No console errors related to prefetch failure or state updates after unmount.

## Risks And Mitigations

- **Risk:** Keeping the modal open after Apply could feel stuck if route resolution never completes.
  - **Mitigation:** Preserve the existing safety timeout and make the button return to a retryable state.

- **Risk:** Prefetching can add load without improving cold route generation.
  - **Mitigation:** Prefetch only the single selected target and dedupe repeated paths.

- **Risk:** Route prop update may not be observable if the modal unmounts during navigation.
  - **Mitigation:** Treat unmount as acceptable success; tests should cover the state path for mounted rerenders and timeout recovery.

- **Risk:** Spinner styling could resize the Apply button.
  - **Mitigation:** Use stable button dimensions and a fixed-size icon.

## Validation Checklist

- [x] `pnpm --filter web test -- LanguagePickerModal.test.tsx`
- [x] `pnpm --filter web typecheck`
- [x] Helium smoke of Watch language switch pending state: local route `/watch/lumo-the-gospel-of-john.html/english.html` opened the modal, selected Romanian, showed disabled `SWITCHING...` after Apply, then resolved to `/watch/lumo-the-gospel-of-john.html/romanian.html`; console retained unrelated local production-backed/RSC fallback noise during the run
- [x] Confirm no generated GraphQL or unrelated roadmap files changed

## Notes From Investigation

- Cold language route generation is the worst bottleneck observed during live triage; UI feedback will not remove that server wait, but it makes the action legible.
- Selective prefetch helps only when the target route can be fetched before Apply. It will not guarantee savings on first-ever cold routes.
- The separate performance follow-up should inspect `apps/web/src/app/[slug]/[...rest]/page.tsx` and `apps/web/src/lib/content.ts`, especially the experience-first/video-fallback flow and large Watch video payload.
