---
title: "fix: Admin Experience AI Chat Independent Scroll"
type: fix
status: active
date: 2026-05-10
origin: docs/brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md
---

# fix: Admin Experience AI Chat Independent Scroll

## Summary

Constrain the admin experience editor AI Chat rail to the visible editor viewport so its message list scrolls independently from the main page. The fix stays inside the existing chat/editor layout and does not change chat persistence, streaming, or mutation behavior.

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input — un-validated bets that should be reviewed before implementation proceeds.*

- The user is referring to the `apps/admin` experience editor route at `http://localhost:3003/dashboard/experiences/[id]?locale=en`, not the manager app.
- "AI Chat สามารถ scroll ขึ้นลงแยกจาก page หลัก" means the chat rail should keep its own vertical scroll area while the canvas/page can scroll separately.
- The main editor canvas should keep its current page-level scrolling behavior; only the chat panel needs viewport-bounded independent scrolling.

---

## Requirements

- R1. AI Chat message history can scroll up and down independently of the main editor page.
- R2. The chat header and composer remain visible inside the chat rail while the message list scrolls.
- R3. The fix preserves the existing desktop-first 3-column editor layout from the chat panel plan.
- R4. No changes to chat API behavior, persistence, streaming, undo, or AI mutation semantics.

**Origin actors:** A1 (editor — uses the chat panel)
**Origin flows:** F1 (compose draft → iterate → save), F2 (refine existing draft → save)
**Origin acceptance examples:** AE5 (closing+reopening preserves thread) remains unaffected; this fix only changes layout containment.

---

## Scope Boundaries

- Do not redesign the chat panel or move it to a different side of the editor.
- Do not introduce new colors, spacing tokens, or component abstractions.
- Do not change the main admin shell navigation or header behavior.
- Do not alter chat thread loading, SSE streaming, undo, draft preview, or cross-locale confirmation logic.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx` composes the chat rail plus the existing `ExperienceEditor`.
- `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx` renders the rail, header, thread list, message list, and composer.
- `apps/admin/src/components/admin-shell.tsx` renders a sticky 48px (`h-12`) top bar and treats `/dashboard/experiences/[id]` as a full-canvas route.
- `docs/plans/2026-05-08-001-feat-admin-experience-ai-chat-panel-plan.md` established the 3-column desktop editor layout and fixed-width chat rail.

### Institutional Learnings

- None directly required. Existing admin UI guidance says to reuse admin tokens and avoid new one-off color variants.

### External References

- None. This is a local Tailwind/layout containment fix with sufficient repo patterns.

---

## Key Technical Decisions

- Bound the chat rail to `calc(100vh - 3rem)` because the admin shell header is `h-12` (`3rem`) and the full-canvas route content starts directly below that header.
- Make the chat rail sticky below the header so main page scrolling does not drag the chat controls away.
- Add `min-h-0` to the flex containers that own the scrollable message list; this is the key CSS guard that lets `overflow-y-auto` work inside a column flex layout instead of expanding the page.
- Keep the composer and header outside the scrollable message list so only the transcript/suggestions/draft preview area scrolls.

---

## Open Questions

### Resolved During Planning

- Which app owns the route? `apps/admin`, based on `/dashboard/experiences/[id]` on port `3003` and the existing `ExperienceEditorWithChat` implementation.
- Which scroll should change? The chat rail/message area only; the main canvas remains page-scrollable.

### Deferred to Implementation

- Exact class placement may shift between the wrapper and panel after seeing which parent flex container is responsible for the current overflow.

---

## Implementation Units

### U1. Constrain the Chat Rail and Message Scroller

**Goal:** Make AI Chat vertically bounded to the editor viewport and keep its message list independently scrollable.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx`
- Modify: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- Test: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`

**Approach:**
- Update the editor/chat wrapper so it aligns children at the top instead of stretching the chat rail to the main page's full content height.
- Give the chat panel a viewport-relative height below the shell header, `overflow-hidden`, and `min-h-0`.
- Give the message list `min-h-0 flex-1 overflow-y-auto` so transcript overflow stays inside the chat rail.
- Preserve the existing fixed chat width, borders, background, header, thread list, message rendering, composer, and modal behavior.

**Patterns to follow:**
- Existing Tailwind utility composition in `experience-chat-panel.tsx`.
- Admin shell's fixed header height from `apps/admin/src/components/admin-shell.tsx`.

**Test scenarios:**
- Happy path: rendering `ExperienceChatPanel` includes a viewport-bounded panel container and a message-list element with independent vertical overflow.
- Regression: existing chat panel tests for empty state, thread loading, send, stop, undo, and error rendering still pass.

**Verification:**
- On `/dashboard/experiences/[id]?locale=en`, a long chat transcript scrolls inside AI Chat without moving the main editor page.
- The AI Chat header and composer remain visible while scrolling the chat transcript.

---

## System-Wide Impact

- **Interaction graph:** Client-only layout classes change; server actions and API routes are untouched.
- **Error propagation:** No change.
- **State lifecycle risks:** No change to chat or editor state.
- **API surface parity:** No GraphQL, Prisma, or route contract impact.
- **Integration coverage:** Browser verification should cover actual scroll containment because jsdom cannot compute layout.
- **Unchanged invariants:** Chat persistence, streaming, undo, suggested prompts, cross-locale confirmation, and editor save/publish behavior remain unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Flex children still expand page height despite `overflow-y-auto` | Add `min-h-0` at the rail/message-list boundary and verify in browser. |
| Sticky chat rail overlaps the shell header | Use `top-12` and `h-[calc(100vh-3rem)]` to match the existing `h-12` header. |
| Mobile/narrow behavior regresses | Existing chat v1 is desktop-first; avoid adding mobile-specific behavior in this fix. |

---

## Documentation / Operational Notes

- No operator documentation required. This is a visible UI containment fix.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md](../brainstorms/2026-05-08-admin-experience-ai-chat-panel-requirements.md)
- Related plan: [docs/plans/2026-05-08-001-feat-admin-experience-ai-chat-panel-plan.md](2026-05-08-001-feat-admin-experience-ai-chat-panel-plan.md)
- Related code: `apps/admin/src/app/dashboard/experiences/experience-editor-with-chat.tsx`
- Related code: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
