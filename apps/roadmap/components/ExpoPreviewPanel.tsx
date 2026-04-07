"use client"

import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"

type Props = {
  projectId: string
  channel: string
  buttonClass: string
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 384 512" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  )
}

function PlayStoreIcon() {
  return (
    <svg viewBox="0 0 512 512" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z" />
    </svg>
  )
}

function ExpoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M0 20.084c.043.53.18 1.03.6 1.554.66.823 1.825.832 2.485.01C4.81 19.38 10.92 8.862 11.53 7.47c.263-.601.478-.601.742 0 .613 1.392 6.722 11.91 8.444 14.178.66.822 1.825.813 2.485-.01.42-.524.558-1.023.6-1.554-.698-3.22-8.49-17.123-9.8-19.294-.476-.79-.912-1.044-1.23-.79-.317-.254-.753 0-1.23.79C10.233 2.96 2.44 16.863 1.743 20.084H0z" />
    </svg>
  )
}

export function ExpoPreviewPanel({ projectId, channel, buttonClass }: Props) {
  const [open, setOpen] = useState(false)
  const expoUrl = `exp://u.expo.dev/${encodeURIComponent(projectId)}?channel-name=${encodeURIComponent(channel)}`
  const panelId = `expo-preview-${projectId}`

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg ${buttonClass} px-6 py-3 text-sm font-semibold text-white transition-colors duration-200`}
      >
        {open ? "Close Preview" : "View Preview"}
      </button>

      <div
        id={panelId}
        className="w-full transition-[grid-template-rows] duration-300 ease-in-out"
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-black/20 p-6">
            <h3 className="mb-4 text-center text-sm font-semibold text-white">
              How to preview the app on your phone
            </h3>
            <ol className="mt-4 space-y-3 text-sm text-stone-400">
              <li>
                <span className="font-medium text-stone-300">Step 1:</span>{" "}
                Download the free &quot;Expo Go&quot; app on your phone:
                <div className="mt-2 flex justify-center gap-3">
                  <a
                    href="https://apps.apple.com/app/expo-go/id982107779"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700"
                  >
                    <AppleIcon />
                    App Store (iPhone)
                  </a>
                  <a
                    href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700"
                  >
                    <PlayStoreIcon />
                    Play Store (Android)
                  </a>
                </div>
              </li>
              <li>
                <span className="font-medium text-stone-300">Step 2:</span> Open
                your phone&apos;s camera and point it at the QR code below. A
                prompt will appear to open the app in Expo Go.
              </li>
              <li>
                <span className="font-medium text-stone-300">Tip:</span> Make
                sure Expo Go is updated to the latest version for the best
                experience.
              </li>
            </ol>

            <div className="my-6 flex flex-col items-center">
              <div className="rounded-xl bg-white p-4">
                <QRCodeSVG value={expoUrl} size={200} />
              </div>
            </div>

            <ol start={3} className="space-y-3 text-sm text-stone-400">
              <li>
                <span className="font-medium text-stone-300">Step 3:</span>{" "}
                Alternatively, if you are viewing this page on your phone, tap
                the link below to open the app directly in Expo Go:
                <div className="mt-2 flex justify-center">
                  <a
                    href={expoUrl}
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700"
                  >
                    <ExpoIcon />
                    Open in Expo Go
                  </a>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </>
  )
}
