---
title: "fix: Admin Chat Composer Contrast"
type: fix
status: active
date: 2026-05-10
---

# fix: Admin Chat Composer Contrast

## Summary

Make the AI Chat composer readable against the dark lower edge of the admin editor by replacing the low-contrast bottom treatment with a solid panel surface and clearer input/button states. The fix stays inside the chat panel visual layer and does not change chat behavior, streaming, or persistence.

---

## Assumptions

_This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input -- un-validated bets that should be reviewed before implementation proceeds._

- The user is referring to the bottom AI Chat composer area in `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`.
- The problem is visual contrast: the textarea and disabled Send button blend into the dark/gradient-looking lower background.
- A solid admin surface using existing tokens is preferred over adding a decorative gradient or new color.

---

## Requirements

- R1. The bottom AI Chat composer reads as a solid, separated surface rather than fading into the page bottom.
- R2. The textarea remains easy to identify when empty, including its placeholder text.
- R3. The Send button remains visually understandable in disabled and enabled states.
- R4. Chat behavior, auto-scroll, cross-locale toggle, streaming, stop, send, and undo logic remain unchanged.

---

## Scope Boundaries

- Do not redesign the full chat panel.
- Do not introduce new color tokens or one-off hex values.
- Do not change textarea copy, send behavior, keyboard handling, or validation.
- Do not alter message rendering or the independent scroll fix.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx` owns the composer, textarea, cross-locale toggle, and Send/Stop controls.
- `apps/admin/src/app/globals.css` defines the admin dark surface tokens: `--color-bg`, `--color-surface`, `--color-surface-inset`, `--color-surface-raised`, and hairline tokens.
- `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx` already covers panel layout and send/stop behavior.

### Institutional Learnings

- Existing admin package guidance says to reuse established UI colors and avoid new palette tokens.

### External References

- None. This is a local visual polish fix.

---

## Key Technical Decisions

- Use a solid `var(--color-surface)` composer background with an existing hairline top border so the composer separates from the scroll area without a gradient.
- Use `var(--color-surface-inset)` for the textarea background and strengthen its border enough to stay visible on the dark surface.
- Replace the disabled Send button's low-opacity red treatment with a token-driven disabled surface so it does not disappear into the bottom edge.
- Add a composer `data-testid` so regression coverage can assert the visual containment contract without relying on computed CSS in jsdom.

---

## Open Questions

### Resolved During Planning

- Visual direction: solid surface, no gradient, no new colors.

### Deferred to Implementation

- Exact utility class ordering may be adjusted by lint/format checks.

---

## Implementation Units

### U1. Strengthen the Chat Composer Surface

**Goal:** Make the lower composer area clearly visible and readable against the dark editor background.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**

- Modify: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- Modify: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
- Create: `docs/roadmap/platform/feat-160-admin-chat-composer-contrast.md`

**Approach:**

- Add `data-testid="experience-chat-composer"` to the composer wrapper.
- Give the composer wrapper a solid token-backed surface background.
- Move the textarea from the page background token to an inset surface token and use a stronger hairline border.
- Make disabled Send use explicit disabled surface/text/border classes instead of only opacity on the red brand button.
- Keep all existing handlers, test IDs, layout structure, and chat state logic intact.

**Patterns to follow:**

- Existing token-based Tailwind utilities in `experience-chat-panel.tsx`.
- Existing chat panel tests that assert key class contracts via `data-testid`.

**Test scenarios:**

- Happy path: rendered composer has a solid surface class and the textarea has an inset surface class.
- Happy path: disabled Send button has explicit disabled-state classes instead of relying only on opacity.
- Regression: existing chat panel behavior tests still pass.

**Verification:**

- On `/dashboard/experiences/[id]?locale=en`, the bottom composer no longer looks like it fades into a gradient, and the empty chatbox remains visible.

---

## System-Wide Impact

- **Interaction graph:** Client-only visual classes change in the chat panel.
- **Error propagation:** No change.
- **State lifecycle risks:** No change.
- **API surface parity:** No GraphQL, Prisma, route, or server-action impact.
- **Integration coverage:** Browser verification is useful because contrast and gradient perception are visual concerns.
- **Unchanged invariants:** Chat send/stop, cross-locale toggle, stream handling, undo, thread loading, and independent scrolling remain unchanged.

---

## Risks & Dependencies

| Risk                                         | Mitigation                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Composer becomes too visually heavy          | Use existing surface token and hairline border rather than a new accent or card treatment. |
| Disabled Send no longer reads as unavailable | Keep `disabled:cursor-not-allowed` and token-muted text while preserving button shape.     |
| Tests assert brittle Tailwind order          | Assert only key class tokens, not full class strings.                                      |

---

## Documentation / Operational Notes

- No operator docs needed. This is a visual readability fix.

---

## Sources & References

- User screenshot/request: bottom gradient makes the chatbox hard to see.
- Related code: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.tsx`
- Related test: `apps/admin/src/app/dashboard/experiences/experience-editor/experience-chat-panel.test.tsx`
