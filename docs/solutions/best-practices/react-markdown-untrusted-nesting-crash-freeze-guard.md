---
title: "Guard recursive markdown rendering against untrusted-content crash and freeze"
date: "2026-07-20"
category: "best-practices"
problem_type: "best_practice"
module: "apps/chat"
component: "assistant"
resolution_type: "code_fix"
severity: "high"
root_cause: "missing_validation"
tags:
  - "react-markdown"
  - "error-boundary"
  - "untrusted-content"
  - "stack-overflow"
  - "denial-of-service"
  - "chat"
  - "defense-in-depth"
applies_when:
  - "Rendering untrusted or LLM-generated content through a recursive parser (markdown or similar tree-shaped parsers) on a client or server surface"
  - "The parser's cost scales with input nesting/structure, not just byte size, so a byte cap alone does not bound crash or freeze risk"
  - "Blast radius is worst — but the guidance is NOT limited to — when the rendering component sits under no error boundary (a throw unmounts the whole React tree) and when content persists server-side and replays through the same component on every view"
symptoms:
  - "RangeError: Maximum call stack size exceeded thrown from the markdown renderer on one specific message"
  - "The whole chat UI unmounts or goes blank after opening a thread containing a particular reply"
  - "The same thread crashes on every reopen (durable crash from persisted-and-replayed content, not a one-off)"
  - "The tab freezes for seconds with no thrown error on deeply nested markdown below the stack-overflow threshold"
related_components:
  - "apps/web"
---

# Guard recursive markdown rendering against untrusted-content crash and freeze

## Context

feat-268 moved chat's assistant turns from inert `whitespace-pre-wrap` plain text to react-markdown (`react-markdown@^10.1.0`, `apps/chat/package.json`). That swap introduced a failure surface plain text structurally cannot have: react-markdown's node-to-React-element conversion is recursive, so input SHAPE — nesting depth, not byte size — controls stack depth and parse cost. The feature's ce-code-review adversarial pass reproduced it against the exact production config (`ALLOWED_ELEMENTS` + `unwrapDisallowed`): `"> ".repeat(2500) + "hi"` — only ~5 KB of text — throws `RangeError: Maximum call stack size exceeded` synchronously during render; depth 2000 still renders, so the cliff sits between 2000 and 2500 markers (measurements from the feat-268 review session).

Two facts turned a leaf-component throw into an app-level incident:

1. **Chat has no app-level error boundary.** No `error.tsx`/`global-error.tsx` exists under `apps/chat/src`, and the only `getDerivedStateFromError` in the app is the containment added by this fix (`MarkdownRenderBoundary` in `apps/chat/src/components/chat/assistant-markdown.tsx`). An uncaught render throw propagates to the React root and unmounts the entire tree — message list AND sidebar go blank.
2. **Persistence + replay make the crash durable.** feat-208 persists assistant turns server-side (180-day signed-in retention) and feat-241 replays them through the SAME component: `AssistantTurn` in `apps/chat/src/components/chat/message-list.tsx` renders both the live streaming turn and finalized/replayed turns via `AssistantMarkdown`. A persisted pathological reply re-crashes on every open of that thread — the thread bricks itself.

The trigger needn't be hostile. An LLM repetition loop — a well-known real failure mode — emitting `> ` or nested-list markers produces exactly this shape; so does a prompt-injected reply. The pre-feat-268 rendering could not crash on any input.

## Guidance

**The law: any surface that renders model output (or other untrusted text) through a recursive parser needs THREE independent controls — a pre-parse shape guard, a shape-agnostic length cap, and per-message containment matched to the render model. Each catches a class the other two miss.**

The feat-268 branch (unmerged as of this writing) implements all three in `apps/chat/src/components/chat/assistant-markdown.tsx`:

**Layer 1 — pre-parse shape guard.** A cheap regex diverts the SHORT deep-nesting shape to plain text BEFORE the parse — thousands of contiguous block markers that overflow the recursive render while staying under the length cap:

    // A 64+ run of block-nesting markers opening a line — the SHORT deep-nesting
    // shape (e.g. thousands of "> ") that stack-overflows the recursive render
    // while staying well under the length cap below.
    const PATHOLOGICAL_PREFIX = /^[ \t>*+-]{64,}/m

The guard bounds SHAPE (a contiguous run of block markers at line start), not bytes: ~5 KB of `> ` markers passes any sane byte cap and still crashes the parse. But it is deliberately narrow — it matches only a same-character run of `[ \t>*+-]` anchored to column 0. It does NOT catch inline or alternating-delimiter nesting (e.g. `*_*_*_…` mixed emphasis, which builds an equally deep AST with no run and no line-start marker). Layer 2 exists precisely for that class.

**Layer 2 — shape-agnostic length cap.** react-markdown's parse cost grows super-linearly with nested inline emphasis the prefix guard cannot see. A whole-input length cap bounds that cost regardless of nesting style — the only control that does:

    // 8192 UTF-16 units is the per-message text contract cap — a legitimate
    // reply never exceeds it, so this only ever diverts pathological input.
    const MAX_MARKDOWN_PARSE_UNITS = 8192

The two guards compose in the `body` choice; if EITHER fires, the parser never runs:

    const tooLongToParse = content.length > MAX_MARKDOWN_PARSE_UNITS
    const body = PATHOLOGICAL_PREFIX.test(content) || tooLongToParse ? (
      <span className="whitespace-pre-wrap">{content}</span>
    ) : ( /* boundary-wrapped <Markdown> */ )

Set the cap at the surface's existing per-message text ceiling (here 8192 UTF-16 units, the persistence/replay contract cap) so it never clips a legitimate reply. This bounds the worst-case emphasis freeze to whatever an at-cap parse costs (a few hundred ms) instead of unbounded growth — it does NOT make an at-cap emphasis parse instant. A lower cap trades formatting fidelity on long legit replies for a tighter freeze bound; do not set it below the legit envelope.

**Layer 3 — per-message containment matched to the render model.** For any throw the two guards miss, contain the failure to one message. The mechanism depends on where you render:

- **Client tree (chat here):** a class-component error boundary wrapping the `<Markdown>` render. Failure latches for the turn; the fallback is the pre-feat-268 plain-text shape; `content` keeps flowing through props so a streaming turn keeps updating even after latching:

      export class MarkdownRenderBoundary extends Component<
        { content: string; children: ReactNode },
        { failed: boolean }
      > {
        state = { failed: false }
        static getDerivedStateFromError() {
          return { failed: true }
        }
        render() {
          if (this.state.failed) {
            return <span className="whitespace-pre-wrap">{this.props.content}</span>
          }
          return this.props.children
        }
      }

  A client class boundary does NOT contain a server-component render throw — do not copy this class onto a server surface and assume it works. Its permanent latch has one cost worth knowing: because the streaming path re-parses the full accumulated text every token, a throw at an intermediate streaming state degrades the ENTIRE rest of that live turn to plain text even if the finalized markdown would have parsed cleanly. The degradation is confined to the live session and clears on reopen/replay, where a fresh boundary re-parses the final content.

- **Server-rendered surface (e.g. apps/web `Text.tsx`):** the class boundary above is inapplicable. Use the route-segment `error.tsx` (or a `try/catch` around the markdown conversion with a plain-text fallback) so a throw degrades one segment rather than 500-ing the page or failing the ISR render. Layers 1 and 2 apply identically pre-parse regardless of render model.

**Why all three (each catches what the others miss):**

- A boundary alone cannot catch a freeze — the super-linear parse never throws, it just holds the main thread (nested-list shape measured 0.5s at depth 300, 3.4s at 600, 17s at 1000; alternating-emphasis measured ~0.25s at 6 KB rising to ~2 s at 24 KB, both in the review session). Error boundaries only respond to throws.
- The prefix guard alone catches only its narrow contiguous-run shape. The length cap is what bounds every OTHER freeze shape, including the emphasis class the prefix guard is blind to.
- The guards alone cannot catch every throw. react-markdown's recursion can be driven by shapes neither guard anticipates; the boundary is the backstop for the unknown ones.
- Placement matters: the boundary lives INSIDE `AssistantMarkdown`, so the one seam covers both the live streaming path and the finalized/replay path in `message-list.tsx` — no second surface to drift.

The element allowlist (`p/strong/em/ul/ol/li/blockquote/code/a/br`, with `unwrapDisallowed`) is a separate XSS/structure control and does NOT substitute for any of the three — the crash reproduces with the allowlist active, because the recursion happens during parsing/conversion regardless of which elements survive.

## Why This Matters

**The crash cascade.** A synchronous throw in a leaf render, with no boundary anywhere above, unmounts the whole React root. In chat that means the message list and sidebar vanish and the user must full-reload. Server-side persistence then converts a one-time crash into a durable one: the poisoned turn is stored for up to 180 days and replayed through the same component on every thread open. Without containment, one bad reply permanently bricks its thread.

**The freeze half.** Even below the throw threshold, parse cost scales super-linearly with nesting: seconds of main-thread freeze at inputs a repetition loop can plausibly emit — and crucially, NOT only from the guard's contiguous-marker shape. Alternating `*_*_…` emphasis nests just as deep with no marker run and no line-start prefix, so the shape guard is blind to it; it was reproduced at ~2 s of freeze at 24 KB against the production config. Because the streaming path re-parses the FULL accumulated text on every token, a 50 KB in-flight reply costs ~130 ms of re-parse PER TOKEN (measured) — jank that compounds as the buffer grows. A boundary is invisible to all of this (no throw), and the shape guard misses the emphasis class — only the shape-agnostic length cap bounds it.

**The axis taxonomy.** This learning is the SHAPE/DEPTH axis of input bounding, sibling to two existing laws: the byte-cap OOM guard (`docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md`) bounds SIZE, and the outbound-timeout law (`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`) bounds TIME. A byte cap does not bound recursion depth — ~5 KB of markers sails under any reasonable cap and still blows the stack. When the consumer is a recursive parser, input caps must bound nesting/shape too. (Unlike those two, the guarded resource here is a per-client React render, not a shared server process — the axis metaphor transfers; the blast radius differs.)

## When to Apply

- **Any new surface rendering LLM or untrusted markdown** (or similar recursive formats — nested JSON pretty-printers, tree renderers). Chat's assistant turns today; any future admin or manager surface that renders model output. Note: MDX is NOT in this family — it compiles markdown+JSX into executable component code, so untrusted MDX is a code-execution surface that must not be rendered from untrusted input at all; this doc's guard+cap+boundary pattern does not make it safe.
- **apps/web's existing react-markdown surfaces are worth checking when next touched** (`apps/web/src/components/sections/Text.tsx` and `RelatedQuestions.tsx` both render admin-sourced content through react-markdown, and some admin content pipelines are AI-generation ones). The failure mode differs per surface: `Text.tsx` is server-rendered (a throw means a 500 or failed ISR render), while `RelatedQuestions.tsx` is a `"use client"` component (a throw behaves like chat's client-tree case, mediated by web's per-route-segment `error.tsx`). Web was NOT audited in the feat-268 session — this is a flag to verify, not a defect claim.
- **When raising parser input limits** anywhere: re-derive the shape threshold, not just the byte budget. The crash cliff (2000 renders / 2500 throws) is a property of the parser version and config — a react-markdown upgrade or plugin change can move it.
- **When adding remark/rehype plugins** to an existing hardened surface: each plugin adds recursion and cost; re-run the pathological fixtures.

## Examples

From the "pathological-input containment" describe block in `apps/chat/src/components/chat/assistant-markdown.test.tsx`:

- **Blockquote bomb** ("renders a deep blockquote nesting bomb as plain text without throwing"): `"> ".repeat(4000) + "hi"` — comfortably past the measured ~2500-marker throw threshold. Renders as plain text: no `blockquote` element in the DOM, the literal `> > >` markers and the `hi` payload visible as text.
- **List-indentation bomb** ("renders a deep list-indentation bomb as plain text without throwing"): 40 lines of deeply indented `- item` entries — the guard-trigger fixture for the deep-indentation shape family (this 40-line input itself parses cheaply as an indented code block without the guard; its at-depth nested-list form is the O(n^2) freeze). Renders as plain text: no `ul`, no `code` element, the literal `- item` text visible.
- **Alternating-emphasis bomb** ("renders over-length alternating-emphasis input as plain text (length cap)"): `"*_".repeat(6000)` — 12,000 units of `*_*_…` that the prefix guard's regex misses (no marker run) but that nests deeply enough to freeze. Diverted by the length cap: no `em`/`strong`, the `whitespace-pre-wrap` fallback span. A sibling test confirms an at-cap legitimate reply still renders as markdown, so the cap only diverts pathological input.
- **Boundary fallback** ("falls back to plain pre-wrap text when the markdown render throws"): a child component that throws during render inside `MarkdownRenderBoundary` produces the `whitespace-pre-wrap` span carrying the raw content (`raw *text* survives`, asterisks intact — no parse) instead of propagating the throw.

Per the mocked-shape-vs-real-contract discipline, the layers are isolated: the list-indentation bomb's `no code element` assertion can only pass via the prefix guard (without it, the input parses as an indented code block), the emphasis bomb can only pass via the length cap (the prefix regex provably does not match it — the test asserts that), and the thrower test can only pass via the boundary. The blockquote bomb alone cannot distinguish the layers — several produce the same plain-text fallback — which is why the isolating assertions exist.

In every case the user sees their reply — degraded to the pre-feat-268 plain-text presentation for that ONE turn — while the rest of the conversation, the sidebar, and the app keep working.

## Related

- `docs/solutions/best-practices/buffered-http-response-byte-cap-oom-guard-20260629.md` — the SIZE-axis sibling (byte-cap buffered reads; shared server process). This doc is the shape/depth axis.
- `docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md` — the TIME-axis sibling.
- `docs/solutions/design-patterns/extend-experience-text-with-safe-markdown-variant.md` — the repo's other react-markdown safety doc (apps/web TextBlock). Orthogonal threat model: content-injection containment for editor-authored content. Its "no client boundary" guidance is correct for that trusted, server-rendered use case and is NOT a general rule — this doc is the counterexample for untrusted LLM input.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md` — the testing discipline the layer-isolating assertions above follow.
