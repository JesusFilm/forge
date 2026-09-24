"use client"

import dynamic from "next/dynamic"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowRight,
  ChevronLeft,
  Camera,
  Check,
  ImagePlus,
  MousePointer2,
  Pencil,
  RotateCcw,
  Send,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import type { Mark } from "@/lib/annotations"
import { createClientId } from "@/lib/clientId"
import { IMAGE_MAX_BYTES, type TvContext } from "@/lib/contracts"
import { savePhotoDraft, takePhotoDraft } from "@/lib/photoDraft"
import { TurnstileGate } from "./TurnstileGate"

const ImageEditor = dynamic(
  () =>
    import("./ImageAnnotationEditor").then(
      (module) => module.ImageAnnotationEditor,
    ),
  { ssr: false },
)

type Version = { file: File; marks: Mark[]; url: string }
type Language = "en" | "th"
export type PreviewStage = "photo" | "draw" | "editor" | "send" | "received"
const words = {
  en: {
    advanced: "Advanced report",
    photo: "Photo",
    draw: "Draw",
    send: "Send",
    title: "Show us the issue",
    intro: "Take a photo of what you see on your TV.",
    empty: "No photo yet",
    emptyHint: "Take a photo of your TV screen to get started.",
    camera: "Take a photo",
    choose: "Choose a photo",
    usePhoto: "Use this photo",
    drawTitle: "Circle what went wrong",
    drawHint: "Tap Draw to mark your photo. Tap a mark to move or delete it.",
    select: "Select",
    drawAction: "Draw",
    undo: "Undo",
    continue: "Continue",
    skip: "Skip drawing",
    review: "Ready to send",
    reviewHint:
      "Here’s your feedback. If anything looks off, you can edit your drawing.",
    edit: "Edit drawing",
    note: "Describe the issue (at least 10 characters)",
    placeholder: "What happened?",
    privacy: "Your photo and note go to the Watch beta team.",
    sendAction: "Send feedback",
    preparing: "Preparing photo…",
    sending: "Sending feedback…",
    received: "Feedback received",
    thanks: "Thank you for helping us improve Watch.",
    saved: "Report saved",
    queued: "Your photo and note are being delivered to the Watch beta team.",
    testing:
      "Saved for testing. Delivery to the Watch beta team is not enabled here.",
    delivered: "Delivered to the Watch beta team.",
    attention: "Delivery needs attention. Your report is saved.",
    done: "Done",
    invalid: "Choose a JPEG, PNG, or WebP photo under 10 MB.",
    failed:
      "Something went wrong. Your photo and note are still here. Try again.",
    verification: "Complete verification before sending.",
  },
  th: {
    advanced: "รายงานแบบละเอียด",
    photo: "รูป",
    draw: "วาด",
    send: "ส่ง",
    title: "แสดงปัญหาที่พบ",
    intro: "ถ่ายรูปสิ่งที่เห็นบนหน้าจอทีวี",
    empty: "ยังไม่มีรูป",
    emptyHint: "ถ่ายรูปหน้าจอทีวีเพื่อเริ่มต้น",
    camera: "ถ่ายรูป",
    choose: "เลือกรูป",
    usePhoto: "ใช้รูปนี้",
    drawTitle: "วงจุดที่มีปัญหา",
    drawHint: "กดวาดเพื่อทำเครื่องหมาย แตะเครื่องหมายเพื่อย้ายหรือลบ",
    select: "เลือก",
    drawAction: "วาด",
    undo: "ย้อนกลับ",
    continue: "ต่อไป",
    skip: "ข้ามการวาด",
    review: "พร้อมส่ง",
    reviewHint: "ตรวจรูปก่อนส่ง หากต้องแก้ไขสามารถกลับไปแก้ภาพได้",
    edit: "แก้ไขภาพ",
    note: "อธิบายปัญหา (อย่างน้อย 10 ตัวอักษร)",
    placeholder: "เกิดอะไรขึ้น?",
    privacy: "รูปและข้อความของคุณจะส่งให้ทีม Watch beta",
    sendAction: "ส่งความคิดเห็น",
    preparing: "กำลังเตรียมรูป…",
    sending: "กำลังส่งความคิดเห็น…",
    received: "ได้รับความคิดเห็นแล้ว",
    thanks: "ขอบคุณที่ช่วยพัฒนา Watch",
    saved: "บันทึกรายงานแล้ว",
    queued: "กำลังส่งรูปและข้อความให้ทีม Watch beta",
    testing: "บันทึกไว้สำหรับทดสอบ ยังไม่ได้ส่งให้ทีม Watch beta",
    delivered: "ส่งถึงทีม Watch beta แล้ว",
    attention: "การส่งต้องตรวจสอบ แต่รายงานถูกบันทึกแล้ว",
    done: "เสร็จสิ้น",
    invalid: "เลือกรูป JPEG, PNG หรือ WebP ขนาดไม่เกิน 10 MB",
    failed: "เกิดข้อผิดพลาด รูปและข้อความยังอยู่ โปรดลองอีกครั้ง",
    verification: "กรุณายืนยันตัวตนก่อนส่ง",
  },
} as const

async function api<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" })
  if (!response.ok) throw new Error(`request_${response.status}`)
  return (await response.json()) as T
}

export function PhotoFeedbackFlow({
  tvContext,
  advancedHref,
  previewStage,
}: {
  tvContext: TvContext
  advancedHref: string
  previewStage?: PreviewStage
}) {
  const [language, setLanguage] = useState<Language>("en")
  const [step, setStep] = useState(0)
  const [source, setSource] = useState<File | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [versionIndex, setVersionIndex] = useState(0)
  const [editing, setEditing] = useState<"draw" | "select" | null>(null)
  const [note, setNote] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState<"preparing" | "sending" | null>(null)
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState("")
  const [delivery, setDelivery] = useState("processing")
  const cameraInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const urls = useRef(new Set<string>())
  const upload = useRef<{ file: File; id: string; ready: boolean } | null>(null)
  const submissionKey = useRef(createClientId())
  const t = words[language]
  const version = versions[versionIndex]
  const challenge = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
  const preview = previewStage !== undefined
  const onToken = useCallback((value: string) => setToken(value), [])

  useEffect(() => {
    if (navigator.language.toLowerCase().startsWith("th")) setLanguage("th")
    if (previewStage) {
      if (previewStage !== "photo") {
        void fetch("/preview/sample-tv-error.png")
          .then((response) => response.blob())
          .then((blob) => {
            const file = new File([blob], "sample-tv-error.png", {
              type: "image/png",
            })
            const url = URL.createObjectURL(file)
            urls.current.add(url)
            setSource(file)
            setVersions([{ file, marks: [], url }])
            setStep(
              previewStage === "draw" || previewStage === "editor"
                ? 1
                : previewStage === "send"
                  ? 2
                  : 3,
            )
            if (previewStage === "editor") setEditing("select")
            if (previewStage === "received") setReceipt("preview")
          })
      }
      const known = urls.current
      return () => {
        for (const url of known) URL.revokeObjectURL(url)
      }
    }
    const draft = takePhotoDraft()
    if (draft) {
      const url = URL.createObjectURL(draft.file)
      urls.current.add(url)
      setSource(draft.source)
      setVersions([{ file: draft.file, marks: draft.marks, url }])
      setNote(draft.note)
      setStep(2)
    }
    const known = urls.current
    return () => {
      for (const url of known) URL.revokeObjectURL(url)
    }
  }, [previewStage])
  useEffect(() => {
    if (!receipt || preview) return
    const poll = async () => {
      try {
        const result = await api<{ status: string }>("/api/feedback/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receipt }),
        })
        setDelivery(result.status)
      } catch {
        /* receipt stays visible during a temporary status failure */
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 7000)
    return () => window.clearInterval(timer)
  }, [receipt, preview])

  const choosePhoto = (file?: File) => {
    if (!file) return
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size === 0 ||
      file.size > IMAGE_MAX_BYTES
    ) {
      setError(t.invalid)
      return
    }
    const url = URL.createObjectURL(file)
    urls.current.add(url)
    setSource(file)
    setVersions([{ file, marks: [], url }])
    setVersionIndex(0)
    setNote("")
    setStep(1)
    setError("")
    upload.current = null
    submissionKey.current = createClientId()
  }
  const saveDrawing = async (file: File, marks: Mark[]) => {
    if (file.size > IMAGE_MAX_BYTES) throw new Error("file_too_large")
    if (upload.current) {
      await api(`/api/feedback/uploads/${upload.current.id}`, {
        method: "DELETE",
      })
      upload.current = null
    }
    const url = URL.createObjectURL(file)
    urls.current.add(url)
    setVersions((previous) => [
      ...previous.slice(0, versionIndex + 1),
      { file, marks, url },
    ])
    setVersionIndex(versionIndex + 1)
    submissionKey.current = createClientId()
    setEditing(null)
    setError("")
  }
  const prepareUpload = async (file: File): Promise<string> => {
    const existing = upload.current
    if (existing?.file === file && existing.ready) return existing.id
    if (!existing || existing.file !== file) {
      const reserved = await api<{ uploadId: string }>(
        "/api/feedback/uploads",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            type: file.type,
            size: file.size,
          }),
        },
      )
      upload.current = { file, id: reserved.uploadId, ready: false }
      try {
        await api(`/api/feedback/uploads/${reserved.uploadId}`, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        })
      } catch {
        upload.current = null
        throw new Error("upload_failed")
      }
    }
    const id = upload.current!.id
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await api<{ status: string }>(
        `/api/feedback/uploads/${id}`,
        { method: "GET" },
      )
      if (result.status === "ready") {
        upload.current!.ready = true
        return id
      }
      if (result.status === "rejected" || result.status === "removed") {
        upload.current = null
        throw new Error("upload_rejected")
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
    }
    throw new Error("upload_timeout")
  }
  const send = async () => {
    if (!version || busy) return
    if (preview) {
      setReceipt("preview")
      setStep(3)
      return
    }
    if (challenge && !token) {
      setError(t.verification)
      return
    }
    if (note.trim().length < 10) {
      setError(t.invalid)
      return
    }
    setError("")
    setBusy("preparing")
    try {
      await api("/api/feedback/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnstileToken: token }),
      })
      const uploadId = await prepareUpload(version.file)
      setBusy("sending")
      const result = await api<{ receipt: string }>(
        "/api/feedback/submissions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow: "photo",
            category: "problem",
            message: note.trim(),
            tvContext,
            consentPhoneContext: false,
            uploadIds: [uploadId],
            idempotencyKey: submissionKey.current,
            turnstileToken: token,
            website: "",
          }),
        },
      )
      setReceipt(result.receipt)
      setDelivery("delivered")
      setStep(3)
    } catch {
      setError(t.failed)
    } finally {
      setBusy(null)
    }
  }
  const done = () => {
    for (const url of urls.current) URL.revokeObjectURL(url)
    urls.current.clear()
    setVersions([])
    setSource(null)
    setVersionIndex(0)
    setNote("")
    setReceipt("")
    setDelivery("processing")
    setStep(0)
    setError("")
    upload.current = null
    submissionKey.current = createClientId()
  }
  const advanced = () => {
    if (source && version)
      savePhotoDraft({ source, file: version.file, marks: version.marks, note })
  }

  return (
    <main className="photo-flow" lang={language}>
      <header className="photo-header">
        {step > 0 && step < 3 ? (
          <button
            type="button"
            className="photo-back"
            aria-label={language === "th" ? "กลับ" : "Back"}
            onClick={() => setStep(step - 1)}
          >
            <ChevronLeft size={27} />
          </button>
        ) : null}
        <div className="photo-brand">
          <span className="photo-play">▶</span>
          <div>
            <strong>Jesus Film Project</strong>
            <small>WATCH BETA</small>
          </div>
        </div>
        {step < 3 ? (
          <Link
            href={advancedHref}
            onClick={advanced}
            className="photo-advanced"
          >
            {t.advanced} <ArrowRight size={19} />
          </Link>
        ) : null}
      </header>
      {step === 3 ? (
        <section className="photo-receipt">
          <div className="photo-receipt-check">
            <Check size={58} strokeWidth={4} />
          </div>
          <h1>{t.received}</h1>
          <p>{t.thanks}</p>
          <div className="photo-receipt-card">
            <div className="photo-receipt-status">
              <span className="photo-small-check">
                <Check size={25} />
              </span>
              <div>
                <strong>{t.saved}</strong>
                <p aria-live="polite">
                  {delivery === "delivered"
                    ? t.delivered
                    : delivery === "needs_attention"
                      ? t.attention
                      : process.env.NODE_ENV === "development"
                        ? t.testing
                        : t.queued}
                </p>
              </div>
            </div>
            {version ? (
              <Image
                unoptimized
                src={version.url}
                alt={t.saved}
                width={640}
                height={430}
                className="photo-receipt-image"
              />
            ) : null}
          </div>
          <button type="button" className="photo-primary" onClick={done}>
            {t.done}
          </button>
        </section>
      ) : (
        <>
          <div className="photo-progress" aria-label={`${step + 1} of 3`}>
            {[t.photo, t.draw, t.send].map((label, index) => (
              <div key={label} className={index <= step ? "active" : ""}>
                <span>{index < step ? <Check size={18} /> : index + 1}</span>
                {label}
              </div>
            ))}
          </div>
          {step === 0 ? (
            <section className="photo-step">
              <h1>{t.title}</h1>
              <p className="photo-lead">{t.intro}</p>
              {version ? (
                <Image
                  unoptimized
                  src={version.url}
                  alt={t.usePhoto}
                  width={760}
                  height={530}
                  className="photo-preview"
                />
              ) : (
                <div className="photo-empty">
                  <Camera size={66} />
                  <strong>{t.empty}</strong>
                  <p>{t.emptyHint}</p>
                </div>
              )}
              <button
                type="button"
                className="photo-primary"
                onClick={() =>
                  version ? setStep(1) : cameraInput.current?.click()
                }
              >
                {version ? <ArrowRight /> : <Camera />}
                {version ? t.usePhoto : t.camera}
              </button>
              {version ? (
                <button
                  type="button"
                  className="photo-secondary"
                  onClick={() => cameraInput.current?.click()}
                >
                  <Camera />
                  {t.camera}
                </button>
              ) : null}
              <button
                type="button"
                className="photo-secondary"
                onClick={() => photoInput.current?.click()}
              >
                <ImagePlus />
                {t.choose}
              </button>
            </section>
          ) : null}
          {step === 1 && version ? (
            <section className="photo-step">
              <h1>{t.drawTitle}</h1>
              <p className="photo-lead">{t.drawHint}</p>
              <Image
                unoptimized
                src={version.url}
                alt={t.drawTitle}
                width={760}
                height={530}
                className="photo-preview"
              />
              <div className="photo-tool-row">
                <button type="button" onClick={() => setEditing("select")}>
                  <MousePointer2 />
                  {t.select}
                </button>
                <button
                  type="button"
                  className="selected"
                  onClick={() => setEditing("draw")}
                >
                  <Pencil />
                  {t.drawAction}
                </button>
                <button
                  type="button"
                  disabled={versionIndex === 0}
                  onClick={() => {
                    setVersionIndex(versionIndex - 1)
                    submissionKey.current = createClientId()
                  }}
                >
                  <RotateCcw />
                  {t.undo}
                </button>
              </div>
              <button
                type="button"
                className="photo-primary"
                onClick={() => setStep(2)}
              >
                {t.continue}
                <ArrowRight />
              </button>
              {version.marks.length === 0 ? (
                <button
                  type="button"
                  className="photo-skip"
                  onClick={() => setStep(2)}
                >
                  {t.skip}
                </button>
              ) : null}
            </section>
          ) : null}
          {step === 2 && version ? (
            <section className="photo-step photo-review">
              <h1>{t.review}</h1>
              <p className="photo-lead">{t.reviewHint}</p>
              <Image
                unoptimized
                src={version.url}
                alt={t.review}
                width={760}
                height={530}
                className="photo-preview"
              />
              <button
                type="button"
                className="photo-edit"
                onClick={() => setEditing("select")}
              >
                <Pencil size={20} />
                {t.edit}
              </button>
              <label htmlFor="photo-note">{t.note}</label>
              <textarea
                id="photo-note"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value)
                  submissionKey.current = createClientId()
                }}
                maxLength={2000}
                placeholder={t.placeholder}
              />
              <p className="photo-privacy">{t.privacy}</p>
              <TurnstileGate onToken={onToken} />
              <button
                type="button"
                className="photo-primary"
                disabled={
                  Boolean(busy) ||
                  (challenge && !token) ||
                  (!preview && note.trim().length < 10)
                }
                onClick={() => void send()}
              >
                <Send />
                {busy === "preparing"
                  ? t.preparing
                  : busy === "sending"
                    ? t.sending
                    : t.sendAction}
              </button>
            </section>
          ) : null}
          {error ? (
            <p className="photo-error" role="alert">
              {error}
            </p>
          ) : null}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            onChange={(event) => {
              choosePhoto(event.target.files?.[0])
              event.target.value = ""
            }}
          />
          <input
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            onChange={(event) => {
              choosePhoto(event.target.files?.[0])
              event.target.value = ""
            }}
          />
        </>
      )}
      {editing && source && version ? (
        <ImageEditor
          file={source}
          initialMarks={version.marks}
          initialTool={editing}
          variant="photo"
          language={language}
          onSave={saveDrawing}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <button
        type="button"
        className="photo-language"
        onClick={() => setLanguage(language === "en" ? "th" : "en")}
      >
        {language === "en" ? "ไทย" : "English"}
      </button>
    </main>
  )
}
