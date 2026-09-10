const JESUS_HLS =
  "https://stream.mux.com/Dl8dRUL01MKAdzv7XtfvvUj1jVYq029z2TS9TGeH8Xj00o.m3u8"

const home = document.getElementById("home")
const playerScreen = document.getElementById("player")
const heroImage = document.getElementById("hero-image")
const heroKicker = document.getElementById("hero-kicker")
const heroTitle = document.getElementById("hero-title")
const heroDescription = document.getElementById("hero-description")
const demoVideo = document.getElementById("demo-video")
const playerTitle = document.getElementById("player-title")
const playerStatus = document.getElementById("player-status")
const playToggle = document.getElementById("play-toggle")
const playerProgress = document.getElementById("player-progress")
const playerCurrentTime = document.getElementById("player-current-time")
const playerDuration = document.getElementById("player-duration")
const captionsToggle = document.getElementById("captions-toggle")
const captionsLabel = document.getElementById("captions-label")
const watchNow = document.getElementById("watch-now")
const backHome = document.getElementById("back-home")
const toast = document.getElementById("toast")

let shakaPlayer = null
let shakaReady = null
let captionsVisible = false
let preferredTextTrack = null
let loadToken = 0
let toastTimer
let selected = {
  title: heroTitle.textContent,
  image: heroImage.src,
  hls: JESUS_HLS,
}

function visibleFocusables() {
  return [...document.querySelectorAll("[data-focusable]")].filter(
    (element) => element.offsetParent !== null && !element.disabled,
  )
}

function moveFocus(direction) {
  const current = document.activeElement
  const origin = current.getBoundingClientRect()
  const originX = origin.left + origin.width / 2
  const originY = origin.top + origin.height / 2

  const candidates = visibleFocusables()
    .filter((element) => element !== current)
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const dx = x - originX
      const dy = y - originY
      const allowed =
        (direction === "left" && dx < -8) ||
        (direction === "right" && dx > 8) ||
        (direction === "up" && dy < -8) ||
        (direction === "down" && dy > 8)

      if (!allowed) return null

      const primary = direction === "left" || direction === "right" ? dx : dy
      const cross = direction === "left" || direction === "right" ? dy : dx
      return {
        element,
        score: Math.abs(primary) + Math.abs(cross) * 2.3,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)

  candidates[0]?.element.focus()
}

function showToast(message) {
  window.clearTimeout(toastTimer)
  toast.textContent = message
  toast.classList.add("visible")
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600)
}

function setPlayerStatus(label, state = "loading") {
  playerStatus.textContent = label
  playerStatus.dataset.state = state
}

function selectContent(card) {
  selected = {
    title: card.dataset.title,
    image: card.dataset.image,
    hls: card.dataset.hls || null,
  }
  heroKicker.textContent = card.dataset.kicker
  heroTitle.textContent = card.dataset.title
  heroDescription.textContent = card.dataset.description
  heroImage.src = card.dataset.image
  watchNow.querySelector(".button-label").textContent = selected.hls
    ? "Watch now"
    : "Watch demo"
  watchNow.focus()
}

async function ensureShakaPlayer() {
  if (shakaReady) return shakaReady
  if (!window.shaka) throw new Error("shaka_library_missing")

  window.shaka.polyfill.installAll()
  if (!window.shaka.Player.isBrowserSupported()) {
    throw new Error("shaka_browser_unsupported")
  }

  const player = new window.shaka.Player()
  shakaReady = player
    .attach(demoVideo)
    .then(() => {
      player.configure({
        abr: { enabled: true },
        streaming: {
          bufferingGoal: 20,
          rebufferingGoal: 2,
        },
      })
      player.addEventListener("error", (event) => {
        if (playerScreen.hidden) return
        const code = event.detail?.code ?? "unknown"
        setPlayerStatus(`Error ${code}`, "error")
        showToast(`Shaka playback error ${code}`)
      })
      shakaPlayer = player
      return player
    })
    .catch(async (error) => {
      try {
        await player.destroy()
      } finally {
        shakaPlayer = null
        shakaReady = null
      }
      throw error
    })
  return shakaReady
}

function updateCaptionsButton(available) {
  captionsToggle.disabled = !available
  captionsToggle.setAttribute("aria-pressed", String(captionsVisible))
  captionsLabel.textContent = available
    ? captionsVisible
      ? "English subtitles on"
      : "Subtitles off"
    : "No subtitles"
}

function enableEnglishCaptions() {
  const tracks = shakaPlayer?.getTextTracks() ?? []
  const preferred =
    tracks.find((track) => track.language?.toLowerCase().startsWith("en")) ??
    tracks[0]

  if (!preferred || !shakaPlayer) {
    captionsVisible = false
    preferredTextTrack = null
    updateCaptionsButton(false)
    return
  }

  preferredTextTrack = preferred
  shakaPlayer.selectTextTrack(preferred)
  captionsVisible = true
  updateCaptionsButton(true)
}

async function openPlayer() {
  if (!selected.hls) {
    showToast("Choose JESUS to play the Shaka HLS demo")
    return
  }

  const token = ++loadToken
  demoVideo.poster = selected.image
  playerTitle.textContent = selected.title
  playerCurrentTime.textContent = "00:00"
  playerDuration.textContent = "--:--"
  playerProgress.style.width = "0%"
  captionsVisible = false
  updateCaptionsButton(false)
  setPlayerStatus("Connecting")
  home.hidden = true
  playerScreen.hidden = false
  requestAnimationFrame(() => {
    if (token === loadToken) playerScreen.classList.add("visible")
  })
  playToggle.focus()

  try {
    const player = await ensureShakaPlayer()
    if (token !== loadToken) return
    await player.load(selected.hls)
    if (token !== loadToken) return
    enableEnglishCaptions()
    setPlayerStatus("HLS ready", "ready")
    await demoVideo.play()
  } catch (error) {
    if (token !== loadToken) return
    const code = error?.code ?? error?.message ?? "unknown"
    setPlayerStatus(`Error ${code}`, "error")
    updatePlayState(false)
    showToast(`Shaka could not load this stream: ${code}`)
  }
}

function closePlayer() {
  const token = ++loadToken
  demoVideo.pause()
  captionsVisible = false
  preferredTextTrack = null
  updateCaptionsButton(false)
  if (shakaReady) {
    void shakaReady
      .then((player) => {
        if (token === loadToken) return player.unload()
      })
      .catch(() => {})
  }
  playerScreen.classList.remove("visible")
  playerScreen.hidden = true
  home.hidden = false
  watchNow.focus()
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "--:--"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  const parts = [minutes, remainingSeconds].map((part) =>
    String(part).padStart(2, "0"),
  )
  if (hours > 0) parts.unshift(String(hours))
  return parts.join(":")
}

function updatePlayState(playing) {
  playToggle.dataset.playing = String(playing)
  playToggle.setAttribute("aria-label", playing ? "Pause video" : "Play video")
  playToggle.querySelector("span").textContent = playing ? "Ⅱ" : "▶"
}

function togglePlayback() {
  if (demoVideo.paused) {
    demoVideo.play().catch(() => showToast("Video could not start"))
  } else {
    demoVideo.pause()
  }
}

function toggleCaptions() {
  if (!shakaPlayer || captionsToggle.disabled) return
  if (captionsVisible) {
    shakaPlayer.selectTextTrack(null)
    captionsVisible = false
  } else if (preferredTextTrack) {
    shakaPlayer.selectTextTrack(preferredTextTrack)
    captionsVisible = true
  }
  updateCaptionsButton(true)
}

document.querySelectorAll(".content-card").forEach((card) => {
  card.addEventListener("click", () => selectContent(card))
})

watchNow.addEventListener("click", () => void openPlayer())
backHome.addEventListener("click", closePlayer)
playToggle.addEventListener("click", togglePlayback)
captionsToggle.addEventListener("click", toggleCaptions)

demoVideo.addEventListener("play", () => updatePlayState(true))
demoVideo.addEventListener("pause", () => updatePlayState(false))
demoVideo.addEventListener("loadedmetadata", () => {
  playerDuration.textContent = formatTime(demoVideo.duration)
})
demoVideo.addEventListener("timeupdate", () => {
  playerCurrentTime.textContent = formatTime(demoVideo.currentTime)
  const progress = demoVideo.duration
    ? (demoVideo.currentTime / demoVideo.duration) * 100
    : 0
  playerProgress.style.width = `${progress}%`
})
demoVideo.addEventListener("error", () => {
  if (playerScreen.hidden) return
  setPlayerStatus("Media error", "error")
  updatePlayState(false)
})

document.getElementById("more-info").addEventListener("click", () => {
  showToast(`${selected.title} · Mux HLS through Shaka Player`)
})

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => {
    showToast(`${button.textContent.trim()} selected`)
  })
})

document.addEventListener("keydown", (event) => {
  const directions = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  }

  if (directions[event.key]) {
    event.preventDefault()
    moveFocus(directions[event.key])
    return
  }

  if (
    event.keyCode === 461 ||
    event.key === "Escape" ||
    event.key === "Backspace"
  ) {
    if (!playerScreen.hidden) {
      event.preventDefault()
      closePlayer()
    }
  }
})

window.addEventListener("load", () => {
  document.body.classList.add("app-ready")
  window.setTimeout(() => watchNow.focus(), 260)
})
