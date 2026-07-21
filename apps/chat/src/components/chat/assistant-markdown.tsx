import { Component, type ReactNode } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"

import { UntrustedLink } from "./untrusted-link"

// The ONLY elements Seeker markdown may put in the DOM (feat-268). Anything
// else is unwrapped to its children (text survives, the element does not).
const ALLOWED_ELEMENTS = [
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "a",
  "br",
]

// remark-breaks renders soft line breaks as <br> (with "br" allowlisted), so
// newline-formatted replies keep their line structure like the pre-markdown
// whitespace-pre-wrap rendering did. Paragraph/blank-line semantics unchanged.
const REMARK_PLUGINS = [remarkBreaks]

// A 64+ run of block-nesting markers opening a line — the SHORT deep-nesting
// shape (e.g. thousands of "> ") that stack-overflows the recursive render
// while staying well under the length cap below. Such turns render as plain text.
const PATHOLOGICAL_PREFIX = /^[ \t>*+-]{64,}/m

// Shape-agnostic freeze bound: parse cost grows super-linearly with nested
// inline emphasis the prefix guard can't see (alternating */_ never forms a
// run), so cap total parsed length. 8192 UTF-16 units is the per-message text
// contract cap (see history-proxy) — a legitimate reply never exceeds it, so
// this only ever diverts pathological input; over-cap turns render as plain text.
const MAX_MARKDOWN_PARSE_UNITS = 8192

// Vigil styling per allowed element: strong is font-medium (Inter Tight loads
// 400/500 only), blockquote gets the scripture treatment, and code keeps the
// body font (no fourth font) — pre-wrap so fenced blocks keep their lines.
const markdownComponents = {
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-medium">{children}</strong>,
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-5 marker:text-ash first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol
      start={start}
      className="my-3 list-decimal space-y-1 pl-5 marker:text-ash first:mt-0 last:mb-0"
    >
      {children}
    </ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-lamplight/50 pl-4 font-scripture text-xl text-vellum italic first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-embersoot px-1.5 py-0.5 text-[0.925em] whitespace-pre-wrap">
      {children}
    </code>
  ),
  a: ({ href, children }) => (
    <UntrustedLink href={href}>{children}</UntrustedLink>
  ),
} satisfies Components

/**
 * Containment for the untrusted parse: react-markdown's recursive render can
 * throw on pathological nesting the prefix guard misses, and chat has no
 * app-level error boundary — an uncontained throw would unmount the whole
 * tree, durably for persisted turns replayed through this component. Failure
 * latches for the turn and falls back to the pre-feat-268 plain-text shape;
 * `content` keeps flowing through props, so a streaming turn keeps updating.
 */
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

type AssistantMarkdownProps = {
  content: string
  // While streaming, the pulse cursor renders inside this container and the
  // cursor-adjacent paragraph flows inline so the cursor sits after the text.
  streaming?: boolean
}

/**
 * Hardened markdown for ASSISTANT turns only (feat-268). Never emits raw HTML:
 * no rehype-raw and skipHtml stays false, so react-markdown turns raw HTML in
 * the content into inert TEXT nodes; the element allowlist plus
 * unwrapDisallowed reduces everything else to the approved set; links pass the
 * shared https-only gate (UntrustedLink). Re-parses the growing partial text
 * on every streaming render — incomplete markdown (unclosed **, half-typed
 * links) degrades to visible literal text, never a throw. Pathological input
 * degrades to plain text three ways: the prefix guard (short deep-nesting
 * crash), the length cap (shape-agnostic freeze bound), and
 * MarkdownRenderBoundary (any throw the guards miss). User turns stay
 * React-escaped plain text in message-list.
 */
export function AssistantMarkdown({
  content,
  streaming = false,
}: AssistantMarkdownProps) {
  const tooLongToParse = content.length > MAX_MARKDOWN_PARSE_UNITS
  const body =
    PATHOLOGICAL_PREFIX.test(content) || tooLongToParse ? (
      <span className="whitespace-pre-wrap">{content}</span>
    ) : (
      <MarkdownRenderBoundary content={content}>
        <Markdown
          allowedElements={ALLOWED_ELEMENTS}
          unwrapDisallowed
          remarkPlugins={REMARK_PLUGINS}
          components={markdownComponents}
        >
          {content}
        </Markdown>
      </MarkdownRenderBoundary>
    )

  return (
    <div
      data-message-content
      className={streaming ? "[&>p:nth-last-child(2)]:inline" : undefined}
    >
      {body}
      {streaming ? (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-1 bg-lamplight [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]"
        />
      ) : null}
    </div>
  )
}
