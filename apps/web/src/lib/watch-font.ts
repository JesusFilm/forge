import localFont from "next/font/local"

export const montserrat = localFont({
  // Italic variable-font face was dropped — the only italic usage in
  // apps/web is the `italic` Tailwind class on a single AdventCountdown
  // paragraph, which the browser will render via synthetic-italic of the
  // upright face. Saves ~300 KB of font transfer on every route.
  //
  // The face ships as woff2 (~205 KB) rather than ttf (~688 KB raw /
  // ~280 KB gz) — woff2's native brotli compression beats the response-
  // path gzip Next.js applies to ttf transfers.
  src: [
    {
      path: "../../public/fonts/Montserrat-VariableFont_wght.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-montserrat",
  fallback: [
    "Avenir Next",
    "Avenir",
    "Helvetica Neue",
    "Helvetica",
    "Segoe UI",
    "Roboto",
    "Noto Sans",
    "Liberation Sans",
    "Arial",
    "sans-serif",
  ],
  display: "swap",
})
