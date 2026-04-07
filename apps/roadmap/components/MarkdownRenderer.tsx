"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Markdown = ReactMarkdown as any

export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div
      className={[
        "prose prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:text-stone-100",
        "prose-h2:mt-8 prose-h2:border-b prose-h2:border-stone-800 prose-h2:pb-2 prose-h2:text-lg",
        "prose-h3:mt-6 prose-h3:text-base",
        "prose-p:text-stone-300 prose-p:leading-relaxed",
        "prose-strong:text-stone-200",
        "prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline",
        "prose-li:text-stone-300 prose-li:marker:text-stone-600",
        "prose-ul:space-y-1 prose-ol:space-y-1",
        "prose-code:rounded prose-code:bg-stone-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-code:text-stone-300 prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:rounded-lg prose-pre:border prose-pre:border-stone-800 prose-pre:bg-stone-900/80 prose-pre:text-sm",
        "prose-table:text-sm",
        "prose-th:border-stone-700 prose-th:bg-stone-800/50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-medium prose-th:text-stone-300",
        "prose-td:border-stone-800 prose-td:px-3 prose-td:py-2 prose-td:text-stone-400",
        "prose-blockquote:border-stone-700 prose-blockquote:text-stone-400",
        "prose-hr:border-stone-800",
      ].join(" ")}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  )
}
