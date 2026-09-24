"use client"

import dynamic from "next/dynamic"
import Image from "next/image"
import Link from "next/link"
import {
  Camera,
  Check,
  CircleHelp,
  Heart,
  ImagePlus,
  Lightbulb,
  TriangleAlert,
  Video,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { copy, type UiLanguage } from "@/lib/copy"
import { createClientId } from "@/lib/clientId"
import type { Mark } from "@/lib/annotations"
import { savePhotoDraft, takePhotoDraft } from "@/lib/photoDraft"
import {
  IMAGE_MAX_BYTES,
  REPORT_MAX_BYTES,
  VIDEO_MAX_BYTES,
  type Category,
  type TvContext,
} from "@/lib/contracts"
import { TurnstileGate } from "./TurnstileGate"

const ImageEditor = dynamic(
  () =>
    import("./ImageAnnotationEditor").then(
      (module) => module.ImageAnnotationEditor,
    ),
  { ssr: false },
)

type Evidence = {
  key: string
  file: File
  sourceFile?: File
  marks?: Mark[]
  url: string
  kind: "image" | "video"
  uploadId?: string
  status: "local" | "uploading" | "validating" | "ready" | "error"
}

async function api<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "unavailable",
    )
  return payload as T
}

function collectPhoneContext() {
  const agent = navigator.userAgent
  return {
    browser: /Edg\//.test(agent)
      ? "Edge"
      : /CriOS|Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Other",
    os: /Android/.test(agent)
      ? "Android"
      : /iPhone|iPad/.test(agent)
        ? "iOS"
        : "Other",
  }
}

export function FeedbackWizard({
  initialTvContext,
}: {
  initialTvContext: TvContext
}) {
  const [language, setLanguage] = useState<UiLanguage>("en")
  const [step, setStep] = useState(0)
  const [category, setCategory] = useState<Category | null>(null)
  const [message, setMessage] = useState("")
  const [expected, setExpected] = useState("")
  const [steps, setSteps] = useState("")
  const [blocked, setBlocked] = useState(false)
  const [tv, setTv] = useState<TvContext>(initialTvContext)
  const [media, setMedia] = useState<Evidence[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [includePhone, setIncludePhone] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState("")
  const [delivery, setDelivery] = useState("processing")
  const [hasSession, setHasSession] = useState(false)
  const idempotencyKey = useRef(createClientId())
  const fileInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const t = copy[language]
  const useChallenge = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
  const onToken = useCallback((token: string) => setTurnstileToken(token), [])

  useEffect(() => {
    if (navigator.language.toLowerCase().startsWith("th")) setLanguage("th")
    const draft = takePhotoDraft()
    if (draft) {
      setCategory("problem")
      setMessage(draft.note)
      setMedia([
        {
          key: createClientId(),
          file: draft.file,
          sourceFile: draft.source,
          marks: draft.marks,
          url: URL.createObjectURL(draft.file),
          kind: "image",
          status: "local",
        },
      ])
      setStep(draft.note.length >= 10 ? 1 : 0)
    }
  }, [])
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
  useEffect(() => {
    if (!receipt) return
    const poll = async () => {
      try {
        const result = await api<{ status: string }>("/api/feedback/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receipt }),
        })
        setDelivery(result.status)
      } catch {
        /* keep the receipt; a temporary status failure must not erase it */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 7000)
    return () => window.clearInterval(timer)
  }, [receipt])

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const additions: Evidence[] = []
    let images = media.filter((item) => item.kind === "image").length
    let videos = media.filter((item) => item.kind === "video").length
    let total = media.reduce((sum, item) => sum + item.file.size, 0)
    for (const file of Array.from(files)) {
      const kind = file.type.startsWith("image/") ? "image" : "video"
      const supported =
        kind === "image"
          ? ["image/jpeg", "image/png", "image/webp"].includes(file.type)
          : ["video/mp4", "video/quicktime"].includes(file.type)
      if (
        !supported ||
        file.size === 0 ||
        file.size > (kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES) ||
        total + file.size > REPORT_MAX_BYTES ||
        (kind === "image" ? images >= 3 : videos >= 1)
      ) {
        setError(
          language === "th"
            ? "ไฟล์นี้มีชนิดหรือขนาดที่ไม่รองรับ"
            : "This file type or size is not supported.",
        )
        continue
      }
      additions.push({
        key: createClientId(),
        file,
        sourceFile: kind === "image" ? file : undefined,
        url: URL.createObjectURL(file),
        kind,
        status: "local",
      })
      total += file.size
      if (kind === "image") images++
      else videos++
    }
    setMedia((previous) => [...previous, ...additions])
    if (additions.length) setError("")
  }

  const remove = async (item: Evidence) => {
    URL.revokeObjectURL(item.url)
    setMedia((previous) => previous.filter((entry) => entry.key !== item.key))
    if (item.uploadId)
      await api(`/api/feedback/uploads/${item.uploadId}`, {
        method: "DELETE",
      }).catch(() => undefined)
  }

  const update = (key: string, change: Partial<Evidence>) =>
    setMedia((previous) =>
      previous.map((item) =>
        item.key === key ? { ...item, ...change } : item,
      ),
    )

  const uploadOne = async (item: Evidence) => {
    if (item.status === "ready") return
    update(item.key, { status: "uploading" })
    const reserved = await api<{ uploadId: string }>("/api/feedback/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: item.file.name,
        type: item.file.type,
        size: item.file.size,
      }),
    })
    update(item.key, { uploadId: reserved.uploadId })
    await api(`/api/feedback/uploads/${reserved.uploadId}`, {
      method: "PUT",
      headers: { "Content-Type": item.file.type },
      body: item.file,
    })
    update(item.key, { status: "validating" })
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
      const state = await api<{ status: string; error_code: string | null }>(
        `/api/feedback/uploads/${reserved.uploadId}`,
        { method: "GET" },
      )
      if (state.status === "ready") {
        update(item.key, { status: "ready" })
        return
      }
      if (state.status === "rejected")
        throw new Error(state.error_code ?? "processing_failed")
    }
    throw new Error("processing_timeout")
  }

  const advance = async () => {
    setError("")
    if (step === 0) {
      if (!category || message.trim().length < 10) {
        setError(
          language === "th"
            ? "กรุณาเลือกประเภทและอธิบายอย่างน้อย 10 ตัวอักษร"
            : "Choose a type and write at least 10 characters.",
        )
        return
      }
      setStep(1)
      return
    }
    if (step === 1 && media.length) {
      if (useChallenge && !turnstileToken) {
        setError(
          language === "th"
            ? "กรุณายืนยันตัวตนก่อนอัปโหลด"
            : "Complete verification before uploading.",
        )
        return
      }
      setBusy(true)
      try {
        if (!hasSession) {
          await api("/api/feedback/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ turnstileToken }),
          })
          setHasSession(true)
        }
        for (const item of media) {
          if (item.status !== "ready") await uploadOne(item)
        }
      } catch {
        setError(t.uploadFailure)
        setMedia((previous) =>
          previous.map((item) =>
            item.status === "uploading" || item.status === "validating"
              ? { ...item, status: "error" }
              : item,
          ),
        )
        setBusy(false)
        return
      }
      setBusy(false)
    }
    setStep((value) => value + 1)
  }

  const send = async () => {
    if (busy || !category) return
    if (useChallenge && !turnstileToken) {
      setError(
        language === "th"
          ? "กรุณายืนยันตัวตนก่อนส่ง"
          : "Complete verification before sending.",
      )
      return
    }
    if (media.some((item) => item.status !== "ready")) {
      setError(t.uploadFailure)
      setStep(1)
      return
    }
    setBusy(true)
    setError("")
    try {
      const result = await api<{ receipt: string }>(
        "/api/feedback/submissions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category,
            message: message.trim(),
            expected: expected.trim() || undefined,
            steps: steps.trim() || undefined,
            blocked,
            tvContext: tv,
            phoneContext: includePhone ? collectPhoneContext() : undefined,
            consentPhoneContext: includePhone,
            name: name.trim() || undefined,
            email: email.trim() || undefined,
            uploadIds: media.map((item) => item.uploadId),
            idempotencyKey: idempotencyKey.current,
            website: "",
            turnstileToken,
          }),
        },
      )
      setReceipt(result.receipt)
      setDelivery("delivered")
    } catch {
      setError(t.error)
    } finally {
      setBusy(false)
    }
  }

  if (receipt)
    return (
      <main className="form-shell" lang={language}>
        <div className="brand">
          <span className="brand-mark">J</span>
          {t.brand}
        </div>
        <div className="hero">
          <div className="success-mark">
            <Check />
          </div>
          <h1>{t.success}</h1>
          <p className="success-copy">{t.successHint}</p>
          <p className="status-line" aria-live="polite">
            {delivery === "delivered"
              ? t.delivered
              : delivery === "needs_attention"
                ? t.issue
                : t.processing}
          </p>
        </div>
      </main>
    )

  return (
    <main className="form-shell" lang={language}>
      <div className="topline">
        <div className="brand">
          <span className="brand-mark">J</span>
          {t.brand}
        </div>
        <Link
          href={`/tv?platform=${tv.platform}${tv.appVersion ? `&appVersion=${encodeURIComponent(tv.appVersion)}` : ""}${tv.build ? `&build=${encodeURIComponent(tv.build)}` : ""}`}
          className="photo-advanced"
          onClick={() => {
            const photo = media.find((item) => item.kind === "image")
            if (photo)
              savePhotoDraft({
                source: photo.sourceFile ?? photo.file,
                file: photo.file,
                marks: photo.marks ?? [],
                note: message,
              })
          }}
        >
          {language === "th" ? "รายงานแบบรูป" : "Quick photo report"}
        </Link>
        <button
          className="locale-button"
          type="button"
          onClick={() => setLanguage(language === "en" ? "th" : "en")}
        >
          {t.language}: {language === "en" ? "ไทย" : "English"}
        </button>
      </div>
      <header className="hero">
        <div className="eyebrow">WATCH TV · BETA</div>
        <h1>{t.title}</h1>
        <p className="lead">{t.intro}</p>
      </header>
      <section className="form-stage" aria-label={t.stages[step]}>
        <div className="progress" aria-label={`${step + 1} / 4`}>
          <span className="step-number">{step + 1} / 4</span>
          {t.stages.map((label, index) => (
            <span
              key={label}
              className={index <= step ? "current" : ""}
              title={label}
            />
          ))}
        </div>
        {step === 0 ? (
          <>
            <h2 className="step-title">{t.category}</h2>
            <div className="choice-grid" role="group" aria-label={t.category}>
              {(["problem", "confusing", "idea", "praise"] as const).map(
                (value) => {
                  const Icon =
                    value === "problem"
                      ? TriangleAlert
                      : value === "confusing"
                        ? CircleHelp
                        : value === "idea"
                          ? Lightbulb
                          : Heart
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`choice ${category === value ? "selected" : ""}`}
                      aria-pressed={category === value}
                      onClick={() => setCategory(value)}
                    >
                      <Icon size={25} />
                      <span>{t.categories[value]}</span>
                    </button>
                  )
                },
              )}
            </div>
            <label className="label" htmlFor="message">
              {t.message}
            </label>
            <textarea
              id="message"
              className="field"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              required
            />
            {category === "problem" || category === "confusing" ? (
              <>
                <label className="label" htmlFor="expected">
                  {t.expected}
                </label>
                <textarea
                  id="expected"
                  className="field"
                  value={expected}
                  onChange={(event) => setExpected(event.target.value)}
                  maxLength={1000}
                />
                <label className="label" htmlFor="steps">
                  {t.steps}
                </label>
                <textarea
                  id="steps"
                  className="field"
                  value={steps}
                  onChange={(event) => setSteps(event.target.value)}
                  maxLength={1000}
                />
                <label className="checkline">
                  <input
                    type="checkbox"
                    checked={blocked}
                    onChange={(event) => setBlocked(event.target.checked)}
                  />
                  {t.blocked}
                </label>
              </>
            ) : null}
          </>
        ) : null}
        {step === 1 ? (
          <>
            <h2 className="step-title">{t.evidence}</h2>
            <p className="hint">{t.evidenceHint}</p>
            <div className="evidence-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus size={20} />
                {t.photo}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => cameraInput.current?.click()}
              >
                <Camera size={20} />
                {t.camera}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => videoInput.current?.click()}
              >
                <Video size={20} />
                {t.video}
              </button>
            </div>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ""
              }}
            />
            <input
              ref={cameraInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ""
              }}
            />
            <input
              ref={videoInput}
              className="visually-hidden"
              type="file"
              accept="video/mp4,video/quicktime"
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ""
              }}
            />
            {media.length ? (
              <div className="evidence-list">
                {media.map((item) => (
                  <div className="evidence-item" key={item.key}>
                    {item.kind === "image" ? (
                      <Image
                        unoptimized
                        src={item.url}
                        alt={item.file.name}
                        width={160}
                        height={120}
                      />
                    ) : (
                      <video
                        src={item.url}
                        controls
                        preload="metadata"
                        aria-label={item.file.name}
                      />
                    )}
                    <div>
                      <div className="evidence-name">{item.file.name}</div>
                      <div className="evidence-status" aria-live="polite">
                        {item.status === "local"
                          ? ""
                          : item.status === "ready"
                            ? t.ready
                            : item.status === "error"
                              ? t.uploadFailure
                              : t.upload}
                      </div>
                      {item.kind === "image" &&
                      item.status !== "uploading" &&
                      item.status !== "validating" ? (
                        <button
                          type="button"
                          className="secondary evidence-edit"
                          onClick={() => setEditing(item.key)}
                        >
                          {t.edit}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => void remove(item)}
                      >
                        {t.remove}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">{t.noFile}</p>
            )}
            <p className="notice">{t.uploadNotice}</p>
            {media.length && !hasSession ? (
              <TurnstileGate onToken={onToken} />
            ) : null}
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h2 className="step-title">{t.detailTitle}</h2>
            <div className="field-row">
              <div>
                <label className="label" htmlFor="platform">
                  {t.platform}
                </label>
                <select
                  id="platform"
                  className="field"
                  value={tv.platform}
                  onChange={(event) =>
                    setTv({
                      ...tv,
                      platform: event.target.value as TvContext["platform"],
                    })
                  }
                >
                  <option value="apple-tv">Apple TV</option>
                  <option value="android-tv">Android TV / Google TV</option>
                  <option value="not-sure">
                    {language === "th" ? "ไม่แน่ใจ" : "Not sure"}
                  </option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="feature">
                  {t.feature}
                </label>
                <select
                  id="feature"
                  className="field"
                  value={tv.feature ?? ""}
                  onChange={(event) =>
                    setTv({
                      ...tv,
                      feature: event.target.value as TvContext["feature"],
                    })
                  }
                >
                  <option value="">
                    {language === "th" ? "เลือกหรือข้าม" : "Select or skip"}
                  </option>
                  {[
                    "home",
                    "search",
                    "playback",
                    "audio",
                    "subtitles",
                    "my-list",
                    "interactive",
                    "other",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {value.replace("-", " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="label" htmlFor="film">
              {t.film}
            </label>
            <input
              id="film"
              className="field"
              value={tv.filmTitle ?? ""}
              onChange={(event) =>
                setTv({ ...tv, filmTitle: event.target.value })
              }
              maxLength={160}
            />
            <div className="field-row">
              <div>
                <label className="label" htmlFor="audio">
                  {t.audio}
                </label>
                <input
                  id="audio"
                  className="field"
                  value={tv.audioLanguage ?? ""}
                  onChange={(event) =>
                    setTv({ ...tv, audioLanguage: event.target.value })
                  }
                  maxLength={80}
                />
              </div>
              <div>
                <label className="label" htmlFor="subtitle">
                  {t.subtitle}
                </label>
                <input
                  id="subtitle"
                  className="field"
                  value={tv.subtitleLanguage ?? ""}
                  onChange={(event) =>
                    setTv({ ...tv, subtitleLanguage: event.target.value })
                  }
                  maxLength={80}
                />
              </div>
            </div>
          </>
        ) : null}
        {step === 3 ? (
          <>
            <h2 className="step-title">{t.review}</h2>
            <p className="hint">{t.reviewHint}</p>
            <dl className="review-table">
              <dt>{t.category}</dt>
              <dd>{category ? t.categories[category] : ""}</dd>
              <dt>{t.message}</dt>
              <dd>{message}</dd>
              <dt>{t.platform}</dt>
              <dd>
                {tv.platform === "apple-tv"
                  ? "Apple TV"
                  : tv.platform === "android-tv"
                    ? "Android TV / Google TV"
                    : language === "th"
                      ? "ไม่แน่ใจ"
                      : "Not sure"}
              </dd>
              <dt>{t.feature}</dt>
              <dd>{tv.feature ? tv.feature.replace("-", " ") : "—"}</dd>
              {tv.appVersion ? (
                <>
                  <dt>{language === "th" ? "เวอร์ชันแอป" : "App version"}</dt>
                  <dd>
                    {tv.appVersion}
                    {tv.build ? ` (${tv.build})` : ""}
                  </dd>
                </>
              ) : null}
              {tv.filmTitle ? (
                <>
                  <dt>{t.film}</dt>
                  <dd>{tv.filmTitle}</dd>
                </>
              ) : null}
              <dt>{t.evidence}</dt>
              <dd>
                {media.length
                  ? `${media.length} ${language === "th" ? "ไฟล์" : "files"}`
                  : t.noFile}
              </dd>
            </dl>
            <div className="review-media">
              {media
                .filter((item) => item.kind === "image")
                .map((item) => (
                  <Image
                    unoptimized
                    key={item.key}
                    src={item.url}
                    alt={item.file.name}
                    width={105}
                    height={76}
                  />
                ))}
              {media
                .filter((item) => item.kind === "video")
                .map((item) => (
                  <video
                    key={item.key}
                    src={item.url}
                    controls
                    preload="metadata"
                    aria-label={item.file.name}
                  />
                ))}
            </div>
            <div className="field-row">
              <div>
                <label className="label" htmlFor="name">
                  {t.name}
                </label>
                <input
                  id="name"
                  className="field"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                />
              </div>
              <div>
                <label className="label" htmlFor="email">
                  {t.email}
                </label>
                <input
                  id="email"
                  type="email"
                  className="field"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                />
              </div>
            </div>
            <label className="checkline">
              <input
                type="checkbox"
                checked={includePhone}
                onChange={(event) => setIncludePhone(event.target.checked)}
              />
              {t.phoneConsent}
            </label>
            <TurnstileGate onToken={onToken} />
          </>
        ) : null}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <div className="nav-row">
          {step > 0 ? (
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setError("")
                setStep((value) => value - 1)
              }}
            >
              {t.back}
            </button>
          ) : null}
          <button
            className="primary"
            type="button"
            disabled={busy || (step === 3 && useChallenge && !turnstileToken)}
            onClick={() => void (step === 3 ? send() : advance())}
          >
            {busy
              ? step === 1
                ? t.preparingEvidence
                : t.sending
              : step === 3
                ? t.send
                : t.next}
          </button>
        </div>
        {editing ? (
          <ImageEditor
            file={
              media.find((item) => item.key === editing)!.sourceFile ??
              media.find((item) => item.key === editing)!.file
            }
            initialMarks={
              media.find((item) => item.key === editing)!.marks ?? []
            }
            language={language}
            onSave={async (file, marks) => {
              const item = media.find((entry) => entry.key === editing)!
              if (file.size > IMAGE_MAX_BYTES) throw new Error("file_too_large")
              if (item.uploadId)
                await api(`/api/feedback/uploads/${item.uploadId}`, {
                  method: "DELETE",
                })
              URL.revokeObjectURL(item.url)
              update(editing, {
                file,
                sourceFile: item.sourceFile ?? item.file,
                marks,
                url: URL.createObjectURL(file),
                status: "local",
                uploadId: undefined,
              })
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </section>
      <footer className="site-footer">
        Jesus Film Project · Watch TV beta
      </footer>
    </main>
  )
}
