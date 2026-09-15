/**
 * In-memory LanguageDetector fake. Deterministic, no network — unit tests inject
 * a canned verdict (or a per-text lookup) so the sweep's decision/relabel logic
 * is exercised without hitting OpenRouter. Mirrors the real port: `detect`
 * returns `{ language, confidence, evidence }` and exposes `readonly model`.
 */
import type {
  DetectedLanguage,
  LanguageDetector,
  LlmReviewer,
} from "../contracts/index.js"

export interface FakeLanguageDetectorOptions {
  model?: string
  /** Verdict returned for any input, unless `byText` matches first. */
  default?: DetectedLanguage
  /**
   * Exact cleaned-text → verdict overrides, for asserting per-document relabels
   * (e.g. map a known French snippet to `{ language: "fr", … }`).
   */
  byText?: Record<string, DetectedLanguage>
}

const ABSTAIN: DetectedLanguage = {
  language: null,
  confidence: 0,
  evidence: "",
}

export class FakeLanguageDetector implements LanguageDetector {
  readonly model: string
  private readonly fallback: DetectedLanguage
  private readonly byText: Record<string, DetectedLanguage>
  /** Every (text, declared) the fake was asked about — handy for coverage asserts. */
  readonly calls: { text: string; declared: readonly string[] }[] = []

  constructor(options: FakeLanguageDetectorOptions = {}) {
    this.model = options.model ?? "fake/deterministic-language-detector"
    this.fallback = options.default ?? ABSTAIN
    this.byText = options.byText ?? {}
  }

  async detect(
    text: string,
    opts: { declared: readonly string[] },
  ): Promise<DetectedLanguage> {
    this.calls.push({ text, declared: opts.declared })
    const trimmed = text.trim()
    if (!trimmed) return { ...ABSTAIN }
    return { ...(this.byText[trimmed] ?? this.fallback) }
  }
}

/** In-memory LlmReviewer fake — returns a canned verdict, records the input. */
export class FakeLlmReviewer implements LlmReviewer {
  readonly model: string
  private readonly verdict: string
  readonly calls: { instruction: string; content: string }[] = []

  constructor(options: { model?: string; verdict?: string } = {}) {
    this.model = options.model ?? "fake/deterministic-reviewer"
    this.verdict = options.verdict ?? "PASS — no suspicious relabels found."
  }

  async review(instruction: string, content: string): Promise<string> {
    this.calls.push({ instruction, content })
    return this.verdict
  }
}
