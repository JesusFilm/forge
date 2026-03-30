"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div
      className={[
        "prose prose-invert max-w-none",
        // Headings
        "prose-headings:font-semibold prose-headings:text-gray-100",
        "prose-h2:mt-8 prose-h2:border-b prose-h2:border-gray-800 prose-h2:pb-2 prose-h2:text-lg",
        "prose-h3:mt-6 prose-h3:text-base",
        // Body
        "prose-p:text-gray-300 prose-p:leading-relaxed",
        "prose-strong:text-gray-200",
        "prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline",
        // Lists
        "prose-li:text-gray-300 prose-li:marker:text-gray-600",
        "prose-ul:space-y-1 prose-ol:space-y-1",
        // Code
        "prose-code:rounded prose-code:bg-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-code:text-gray-300 prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:rounded-lg prose-pre:border prose-pre:border-gray-800 prose-pre:bg-gray-900/80 prose-pre:text-sm",
        // Tables
        "prose-table:text-sm",
        "prose-th:border-gray-700 prose-th:bg-gray-800/50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-medium prose-th:text-gray-300",
        "prose-td:border-gray-800 prose-td:px-3 prose-td:py-2 prose-td:text-gray-400",
        // Blockquotes
        "prose-blockquote:border-gray-700 prose-blockquote:text-gray-400",
        // HR
        "prose-hr:border-gray-800",
      ].join(" ")}
    >
      {/* @ts-expect-error React 19.1/19.2 type mismatch with react-markdown 10.x */}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
