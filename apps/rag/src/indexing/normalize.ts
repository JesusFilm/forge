/**
 * normalize — RawDocument fields → NormalizedDocument. Cleans the extracted text
 * (preserving the paragraph boundaries the chunker relies on), decides the
 * document's language from that cleaned content (decide-language.ts, #74 /
 * ADR-0006 — never from the source's declared `languages`), applies the
 * source's registry defaults (category / tags / attribution), and computes the
 * chunk-dedup `contentHash` = sha256(`${title}\n\n${content}`) (architecture §2
 * invariant 1). Pure: no I/O, no chunking, no embedding.
 */
import { createHash } from "node:crypto"
import type { NormalizedDocument } from "../contracts/index.js"
import type { SourceDefinition } from "../contracts/index.js"
import { decideLanguage } from "./decide-language.js"

export interface RawInput {
  url: string
  canonicalUrl: string
  title: string | null
  rawContent: string
}

export type NormalizeOutcome =
  | { ok: true; doc: NormalizedDocument; warning?: string }
  | { ok: false; reason: "empty" | "too-thin" }

/**
 * Collapse intra-line whitespace and blank-line runs while keeping single blank
 * lines as paragraph separators (the chunker splits on `\n\s*\n`). Idempotent on
 * already-tidy extraction output. Exported so the #73 language-sweep can
 * reconstruct the exact cleaned content ingest would produce from a stored
 * `raw_documents.raw_content` snapshot — the sweep re-derives labels by replaying
 * this same normalization, never a re-implementation of it.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ") // collapse spaces/tabs, keep newlines
    .replace(/ *\n */g, "\n") // trim around newlines
    .replace(/\n{3,}/g, "\n\n") // blank-line runs → one blank line
    .trim()
}

export function normalizeDocument(
  entry: SourceDefinition,
  raw: RawInput,
): NormalizeOutcome {
  const content = cleanText(raw.rawContent)
  if (!content) return { ok: false, reason: "empty" }
  if (content.length < entry.crawl.minContentLength) {
    return { ok: false, reason: "too-thin" }
  }

  const title = (raw.title ?? "").trim() || null
  const { language, warning } = decideLanguage(content, {
    declared: entry.languages,
  })
  const category = entry.defaultCategory ?? "general"
  const tags = [...new Set(entry.defaultTags)]
  const contentHash = createHash("sha256")
    .update(`${title ?? ""}\n\n${content}`)
    .digest("hex")

  return {
    ok: true,
    ...(warning !== undefined && { warning }),
    doc: {
      sourceKey: entry.key,
      source: entry.domain, // bare-domain attribution (matches jfa `chunks.source`)
      canonicalUrl: raw.canonicalUrl,
      title,
      content,
      language,
      category,
      tags,
      contentHash,
      metadata: {
        source_key: entry.key,
        source_trust: entry.trust,
        ingestion_mode: entry.ingestionMode,
      },
    },
  }
}
